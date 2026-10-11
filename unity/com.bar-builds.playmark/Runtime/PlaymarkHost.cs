using System;
using System.Collections;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using BarBuilds.Playmark.Core;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace BarBuilds.Playmark
{
    /// <summary>
    /// Playmark's runtime: one hidden object that starts with Play Mode (and Development
    /// Builds) and needs nothing in your scenes. It watches for the shortcut, keeps the last
    /// seconds of play, freezes the game for the overlay, saves marks, and polls the inbox so
    /// a fix Claude made shows up as a toast and a ghost turning blue.
    /// </summary>
    [AddComponentMenu("")]
    internal sealed class PlaymarkHost : MonoBehaviour
    {
        public static PlaymarkHost Instance { get; private set; }

        const float ComboWindow = 90f;
        const float PollEvery = 2f;
        const int MaxAutoMarks = 3;

        static LogRing _log;

        sealed class Session
        {
            public float TimeScale;
            public bool AudioPaused;
            public CursorLockMode LockState;
            public bool CursorVisible;
            public DateTime Time;
            public long Seq;
            public float Fps;
            public Vector2 Mouse;
            public Texture2D Shot;
            public RgbaImage ShotImage;
            public List<ClipFrame> Frames = new List<ClipFrame>();
        }

        PlaymarkSettings _settings;
        Inbox _inbox;
        Capture _capture;
        Hud _hud;
        Sounds _sfx;
        Overlay _overlay;
        Session _session;
        Shortcut _shortcut, _ghostKey;
        string _root;
        // Not serialized: a script reload mid-Play must not restore a stuck flag.
        [NonSerialized] bool _hideGui, _opening, _busy;
        float _nextPoll, _nextSceneCheck, _fps = 60f;
        string _scenePath, _scope = "";
        int _savedThisSession, _autoMarks;
        Vector2 _mouse;
        readonly ConcurrentQueue<Action> _main = new ConcurrentQueue<Action>();
        readonly System.Random _rng = new System.Random();

        public bool IsOpen => _overlay != null || _opening;

        // --- Boot ---------------------------------------------------------------------------

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            Instance = null;
            Application.logMessageReceivedThreaded -= OnLog;
            _log = null;
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void Boot()
        {
            if (!ShouldRun(PlaymarkSettings.Current)) return;
            var go = new GameObject("Playmark") { hideFlags = HideFlags.HideInHierarchy };
            DontDestroyOnLoad(go);
            go.AddComponent<PlaymarkHost>();
        }

        static bool ShouldRun(PlaymarkSettings s)
        {
            if (!s.enabled) return false;
            if (!Debug.isDebugBuild && !s.releaseBuilds) return false;
            if (Application.isBatchMode || SystemInfo.graphicsDeviceType == UnityEngine.Rendering.GraphicsDeviceType.Null) return false;
            if (Application.isMobilePlatform || Application.platform == RuntimePlatform.WebGLPlayer)
            {
                Debug.Log("Playmark: " + Application.platform + " is coming soon. Desktop only for now.");
                return false;
            }
            return true;
        }

        static void OnLog(string condition, string stack, LogType type) => _log?.Add(type.ToString(), condition, stack);

        void Awake() => Init();

        /// <summary>
        /// Also runs after a script reload in Play Mode ("Recompile And Continue Playing"): the
        /// object survives but everything not serialized is gone, so it starts over from disk.
        /// </summary>
        void OnEnable()
        {
            if (_inbox == null) Init();
        }

        void Init()
        {
            Instance = this;
            _hideGui = _opening = _busy = false;
            _settings = PlaymarkSettings.Current;
            if (_log == null)
            {
                _log = new LogRing(_settings.logLines);
                Application.logMessageReceivedThreaded += OnLog;
            }
            _shortcut = Shortcut.Parse(_settings.shortcut);
            _ghostKey = Shortcut.Parse(_settings.ghostsShortcut);
            if (!_shortcut.IsValid) Debug.LogWarning("Playmark: can't read the shortcut '" + _settings.shortcut + "'");
            _root = OutputRoot(_settings);
            _inbox = new Inbox(_root);
            _capture = new Capture(_settings.clipFps, _settings.clipSeconds, _settings.clipMaxWidth);
            _hud = new Hud { GhostsVisible = _settings.ghostsVisible };
            if (_sfx == null) _sfx = new Sounds(gameObject);
            Poll(true);
            FollowScene(true);

            var request = Hooks.TakeRequest?.Invoke();
            var args = CommandLine();
            if (!string.IsNullOrEmpty(request)) StartCoroutine(RunRequest(Json.TryParseObject(request)));
            else if (args.TryGetValue("playmark-warp", out var warp)) StartCoroutine(Warp(warp, args.TryGetValue("playmark-shot", out var shot) ? shot : "", null));
            else if (args.TryGetValue("playmark-smoke", out var smoke)) StartCoroutine(Smoke(smoke, null));
            else Welcome();
        }

        void OnDisable()
        {
            // A script reload while the overlay is open: give the game its time back first.
            if (_session != null) Close();
            _capture?.Dispose();
            _capture = null;
            _inbox = null;
        }

        void OnDestroy()
        {
            if (Instance == this) Instance = null;
        }

        static string OutputRoot(PlaymarkSettings s)
        {
            // inbox.mjs runs a build with -playmark-dir=<project>/.playmark, so warp finds the mark.
            if (CommandLine().TryGetValue("playmark-dir", out var dir) && dir.Length > 0) return Path.GetFullPath(dir);
            if (Application.isEditor) return Path.GetFullPath(Path.Combine(Application.dataPath, "..", string.IsNullOrEmpty(s.outputDir) ? ".playmark" : s.outputDir));
            return Path.Combine(Application.persistentDataPath, "playmark");
        }

        static Dictionary<string, string> CommandLine()
        {
            var o = new Dictionary<string, string>();
            foreach (var a in Environment.GetCommandLineArgs())
            {
                if (!a.StartsWith("-playmark-") && !a.StartsWith("--playmark-")) continue;
                var kv = a.TrimStart('-').Split(new[] { '=' }, 2);
                o[kv[0]] = kv.Length > 1 ? kv[1] : "";
            }
            return o;
        }

        // --- Frame loop ---------------------------------------------------------------------

        void Update()
        {
            if (_inbox == null)
            {
                // A script reload that didn't call OnEnable: start over from disk.
                if (isActiveAndEnabled) Init();
                if (_inbox == null) return;
            }
            PollShortcutsFromInputSystem();
            _sfx.Install();
            _fps = Mathf.Lerp(_fps, 1f / Mathf.Max(Time.unscaledDeltaTime, 1e-4f), 0.05f);
            while (_main.TryDequeue(out var a)) a();
            if (_overlay != null || _opening) return;
            FollowScene(false);
            var now = Time.realtimeSinceStartup;
            if (_capture.Due(now) && Time.frameCount > 10) StartCoroutine(GrabClipFrame(now));
            if (now >= _nextPoll) Poll(false);
            var err = _log.TakeError();
            if (err != null) AutoMark(err);
        }

        IEnumerator GrabClipFrame(float now)
        {
            yield return new WaitForEndOfFrame();
            if (_overlay == null && !_opening && _capture != null) _capture.Grab(now);
        }

        void OnGUI()
        {
            if (_inbox == null) return;
            GUI.depth = -1000;
            var e = Event.current;
            if (e.isMouse || e.type == EventType.Repaint) _mouse = e.mousePosition;
            if (e.type == EventType.KeyDown && e.keyCode != KeyCode.None && _overlay == null && !_opening)
            {
                if (Matches(e, _shortcut))
                {
                    e.Use();
                    Trigger(true);
                    return;
                }
                if (Matches(e, _ghostKey))
                {
                    e.Use();
                    Trigger(false);
                }
            }
            if (_hideGui) return;
            if (_overlay != null)
            {
                _overlay.OnGUI();
                return;
            }
            var cam = Snapshot.GameCamera();
            if (e.type == EventType.Repaint) UpdateNear(cam);
            _hud.OnGUI(cam);
        }

        int _triggeredFrame = -1;

        /// <summary>The shortcut can arrive twice in one frame (IMGUI and the Input System): act once.</summary>
        void Trigger(bool open)
        {
            if (_triggeredFrame == Time.frameCount || _overlay != null || _opening) return;
            _triggeredFrame = Time.frameCount;
            if (open)
            {
                Open();
                return;
            }
            _hud.GhostsVisible = !_hud.GhostsVisible;
            _sfx.Play("chip", _hud.GhostsVisible ? 1.2f : 0.8f);
            _hud.ShowToast("ready", "Ghosts " + (_hud.GhostsVisible ? "on" : "off"), _hud.Ghosts.Count + " marks in this scene", Keys(_ghostKey) + " TO TOGGLE", 1.6f);
        }

        /// <summary>
        /// With only the Input System enabled, IMGUI keyboard events are not guaranteed (reports
        /// conflict), so the shortcut is also read from the keyboard device directly.
        /// </summary>
        void PollShortcutsFromInputSystem()
        {
#if PLAYMARK_INPUT_SYSTEM && ENABLE_INPUT_SYSTEM
            var kb = UnityEngine.InputSystem.Keyboard.current;
            if (kb == null || _overlay != null || _opening) return;
            if (Pressed(kb, _shortcut)) Trigger(true);
            else if (Pressed(kb, _ghostKey)) Trigger(false);
#endif
        }

#if PLAYMARK_INPUT_SYSTEM && ENABLE_INPUT_SYSTEM
        static bool Pressed(UnityEngine.InputSystem.Keyboard kb, Shortcut s)
        {
            if (!s.IsValid) return false;
            var name = s.Key.Length == 1 && char.IsDigit(s.Key[0]) ? "Digit" + s.Key : s.Key;
            if (!Enum.TryParse(name, true, out UnityEngine.InputSystem.Key key) || key == UnityEngine.InputSystem.Key.None) return false;
            var k = kb[key];
            return k != null && k.wasPressedThisFrame
                && kb.ctrlKey.isPressed == s.Ctrl && kb.shiftKey.isPressed == s.Shift
                && kb.altKey.isPressed == s.Alt && (kb.leftMetaKey.isPressed || kb.rightMetaKey.isPressed) == s.Cmd;
        }
#endif

        static bool Matches(Event e, Shortcut s)
        {
            if (!s.IsValid || e.control != s.Ctrl || e.shift != s.Shift || e.alt != s.Alt || e.command != s.Cmd) return false;
            var name = s.Key.Length == 1 && char.IsDigit(s.Key[0]) ? "Alpha" + s.Key : s.Key;
            return Enum.TryParse(name, true, out KeyCode k) && e.keyCode == k;
        }

        /// <summary>
        /// Spelled out, not ⌃⇧M: the bundled fonts have no key symbols, and the fallback draws them
        /// unreadably small in a toast's hint line. Ctrl is Control on a Mac too.
        /// </summary>
        static string Keys(Shortcut s) => s.Text.ToUpperInvariant();

        string _nearId = "";

        void UpdateNear(Camera cam)
        {
            var from = _mouse;
            if (Playmark.Player != null && cam != null)
            {
                var s = cam.WorldToScreenPoint(Playmark.Player.position);
                from = new Vector2(s.x, Screen.height - s.y);
            }
            var g = _hud.Near(from, cam);
            var id = g?.Id ?? "";
            if (id == _nearId) return;
            _nearId = id;
            if (g == null)
            {
                _hud.HideCard();
                return;
            }
            _sfx.Play("tick", 1.3f);
            var fixedMark = g.Status == "fixed";
            var res = Json.Str(g.Resolution, "note");
            var kicker = "MARK #" + g.Seq + " · " + (string.IsNullOrEmpty(g.Category) ? "NOTE" : g.Category.ToUpperInvariant());
            var title = fixedMark && res.Length > 0 ? "Fixed: " + res : (g.Note.Length > 0 ? g.Note : "(no note)");
            var meta = fixedMark ? "FIXED BY CLAUDE · RETEST IT" : g.Status == "working" ? "CLAUDE IS ON IT" : "OPEN";
            _hud.Card(kicker, fixedMark ? "fixed" : g.Status == "working" ? "working" : "ghost", title, fixedMark ? g.Note : "", meta);
        }

        // --- Opening and closing ------------------------------------------------------------

        /// <summary>Freezes the game and opens the overlay at the end of this frame.</summary>
        public void Open()
        {
            if (_inbox == null || _overlay != null || _opening) return;
            if (_busy)
            {
                _hud.ShowToast("saved", "One moment", "Still saving the last mark", "", 1.6f);
                return;
            }
            _opening = true;
            _session = new Session
            {
                TimeScale = Time.timeScale,
                AudioPaused = AudioListener.pause,
                LockState = Cursor.lockState,
                CursorVisible = Cursor.visible,
                Time = DateTime.Now,
                Seq = _inbox.NextSeq(),
                Fps = _fps,
                Mouse = _mouse,
            };
            Time.timeScale = 0f;
            AudioListener.pause = true;
            InputGate.Block();
            Cursor.lockState = CursorLockMode.None;
            Cursor.visible = true;
            _hideGui = true; // the freeze frame is the game, not our toasts and ghosts
            StartCoroutine(OpenAtEndOfFrame());
        }

        IEnumerator OpenAtEndOfFrame()
        {
            yield return new WaitForEndOfFrame();
            var (tex, img) = Capture.Freeze();
            _hideGui = false;
            if (tex == null)
            {
                Debug.LogWarning("Playmark: no frame to capture");
                _opening = false;
                Close();
                yield break;
            }
            try
            {
                _session.Shot = tex;
                _session.ShotImage = img;
                _session.Frames = _capture.Read(img, Time.realtimeSinceStartup);
                var counts = _inbox.Counts();
                _overlay = new Overlay(tex, _session.Frames, new Overlay.Info
                {
                    Seq = _session.Seq,
                    Scene = SceneManager.GetActiveScene().path,
                    Fps = Mathf.RoundToInt(_session.Fps),
                    Session = _savedThisSession,
                    Inbox = counts.open,
                    Fixed = counts.fixedCount,
                }, _sfx);
            }
            catch (Exception e)
            {
                // Never leave the game frozen behind an overlay that didn't open.
                Debug.LogError("Playmark: the overlay could not open: " + e);
                _opening = false;
                _overlay = null;
                Close();
                yield break;
            }
            _overlay.Submitted += OnSubmitted;
            _overlay.Cancelled += Close;
            _overlay.Finished += Close;
            _opening = false;
            Playmark.RaiseOpened();
        }

        void Close()
        {
            var wasOpen = _overlay != null;
            _overlay = null;
            _opening = false;
            if (_session != null)
            {
                Time.timeScale = _session.TimeScale;
                AudioListener.pause = _session.AudioPaused;
                Cursor.lockState = _session.LockState;
                Cursor.visible = _session.CursorVisible;
                InputGate.Release();
                DestroyTextures(_session.Shot, _session.Frames);
                _session = null;
            }
            if (wasOpen) Playmark.RaiseClosed();
        }

        static void DestroyTextures(Texture2D shot, List<ClipFrame> frames)
        {
            if (shot != null) Destroy(shot);
            if (frames == null) return;
            foreach (var f in frames)
                if (f.Texture != null) Destroy(f.Texture);
        }

        // --- Saving -------------------------------------------------------------------------

        void OnSubmitted(string note, string category, List<NormMark> marks, int frameIndex)
        {
            var s = _session;
            if (s == null) return;
            var image = frameIndex < 0 ? s.ShotImage : s.Frames[frameIndex].Image;
            var offset = frameIndex < 0 ? 0f : s.Frames[frameIndex].Offset;
            try
            {
                Save(image, s.Frames, marks, note, category, offset, "player", s.Seq, s.Time, s.Mouse, s.Fps, s.TimeScale, ok =>
                {
                    if (ok) _savedThisSession++;
                    _overlay?.Finish(ok);
                });
            }
            catch (Exception e)
            {
                // The overlay shows "not saved" and closes; the game gets its time back.
                Debug.LogError("Playmark: the mark was not saved: " + e);
                _busy = false;
                _overlay?.Finish(false);
            }
        }

        void Save(RgbaImage image, List<ClipFrame> frames, List<NormMark> marks, string note, string category, float offset, string source,
            long seq, DateTime time, Vector2 mouse, float fps, float timeScale, Action<bool> done)
        {
            var id = Inbox.NewId(time, _rng);
            var snap = Snapshot.Collect(marks, mouse * new Vector2(image.Width / (float)Mathf.Max(1, Screen.width), image.Height / (float)Mathf.Max(1, Screen.height)), image.Width, image.Height, fps, timeScale);
            var under = (List<object>)snap["under_marks"];
            var markList = new List<object>();
            var shapes = new List<MarkShape>();
            for (var i = 0; i < marks.Count; i++)
            {
                var m = marks[i];
                var d = new Dictionary<string, object>
                {
                    ["type"] = m.Box ? "box" : "pin",
                    ["x"] = Math.Round(m.X * image.Width, 1),
                    ["y"] = Math.Round(m.Y * image.Height, 1),
                };
                if (m.Box)
                {
                    d["w"] = Math.Round(m.W * image.Width, 1);
                    d["h"] = Math.Round(m.H * image.Height, 1);
                }
                d["number"] = i + 1;
                d["color"] = m.Box ? "blue" : "orange";
                d["norm"] = m.Box
                    ? new List<object> { Json.Round(m.X, 0.001), Json.Round(m.Y, 0.001), Json.Round(m.W, 0.001), Json.Round(m.H, 0.001) }
                    : new List<object> { Json.Round(m.X, 0.001), Json.Round(m.Y, 0.001) };
                if (under[i] is Dictionary<string, object> u && u.TryGetValue("world", out var w)) d["world"] = w;
                markList.Add(d);
                shapes.Add(m.Box ? MarkShape.Box(m.X * image.Width, m.Y * image.Height, m.W * image.Width, m.H * image.Height) : MarkShape.Pin(m.X * image.Width, m.Y * image.Height));
            }

            var data = new Dictionary<string, object>
            {
                ["playmark"] = Playmark.Version,
                ["schema"] = 2,
                ["id"] = id,
                ["seq"] = seq,
                ["created_at"] = time.ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture),
                ["status"] = "new",
                ["source"] = source,
                ["category"] = category,
                ["note"] = note,
                ["marks"] = markList,
                ["frame_offset_s"] = Json.Round(offset),
                ["scope"] = CurrentScope(),
            };
            foreach (var kv in snap) data[kv.Key] = kv.Value;
            object warpData = null;
            try { warpData = Playmark.WarpSave != null ? Snapshot.Plain(Playmark.WarpSave()) : null; }
            catch (Exception e) { Debug.LogWarning("Playmark: the warp save function threw: " + e.Message); }
            data["warp"] = new Dictionary<string, object> { ["scene"] = SceneManager.GetActiveScene().path, ["camera"] = Snapshot.CameraPose(), ["data"] = warpData };
            var files = new List<object> { "screenshot.png", "annotated.png", "log.txt" };
            if (frames.Count > 0) files.Add("clip_sheet.png");
            data["files"] = files;
            data["clip"] = new Dictionary<string, object>
            {
                ["frames"] = frames.Count,
                ["fps"] = _settings.clipFps,
                ["offsets_s"] = frames.Select(f => (object)Json.Round(f.Offset)).ToList(),
                ["dir"] = frames.Count > 0 ? "clip/" : "",
            };

            var clip = frames.Select(f => f.Image).ToList();
            var log = _log.Dump();
            var root = _root;
            _busy = true;
            // PNG work and disk writes happen on a worker: saving never hitches the game.
            Task.Run(() =>
            {
                var bytes = new Dictionary<string, byte[]>
                {
                    ["screenshot.png"] = Png.Encode(image),
                    ["annotated.png"] = Png.Encode(RgbaImage.Annotate(image, shapes)),
                };
                if (clip.Count > 0)
                {
                    bytes["clip_sheet.png"] = Png.Encode(RgbaImage.ContactSheet(clip));
                    for (var i = 0; i < clip.Count; i++) bytes["clip/" + i.ToString("000", CultureInfo.InvariantCulture) + ".png"] = Png.Encode(clip[i]);
                }
                return Inbox.Write(root, id, data, bytes, log);
            }).ContinueWith(t => _main.Enqueue(() =>
            {
                _busy = false;
                if (t.IsFaulted || _inbox == null)
                {
                    Debug.LogError("Playmark: the mark was not saved: " + t.Exception?.GetBaseException().Message);
                    done(false);
                    return;
                }
                Debug.Log("Playmark: saved #" + seq + " " + t.Result);
                _inbox.Remember(id, data);
                RefreshGhosts();
                Playmark.RaiseSaved(t.Result);
                done(true);
            }));
        }

        /// <summary>The first error of its kind (3 a session at most) becomes a bug mark by itself.</summary>
        void AutoMark(string err)
        {
            if (!_settings.autoOnError || _autoMarks >= MaxAutoMarks || _busy || _opening) return;
            _autoMarks++;
            _busy = true; // so the shortcut in this same frame can't take the same #seq
            StartCoroutine(AutoMarkAtEndOfFrame(err));
        }

        IEnumerator AutoMarkAtEndOfFrame(string err)
        {
            _hideGui = true;
            yield return new WaitForEndOfFrame();
            var (tex, img) = Capture.Freeze();
            _hideGui = false;
            if (tex == null)
            {
                _busy = false;
                yield break;
            }
            var frames = new List<ClipFrame>();
            try
            {
                frames = _capture.Read(img, Time.realtimeSinceStartup);
                var seq = _inbox.NextSeq();
                Save(img, frames, new List<NormMark>(), "Auto: " + err, "bug", 0f, "auto-error", seq, DateTime.Now, _mouse, _fps, Time.timeScale, ok =>
                {
                    if (!ok) return;
                    _sfx.Play("tick", 0.7f);
                    _hud.ShowToast("error", "Saved as #" + seq, err, "BUG MARK · CLIP + LOG ATTACHED");
                });
            }
            catch (Exception e)
            {
                Debug.LogError("Playmark: the error mark was not saved: " + e);
                _busy = false;
            }
            // Saving works from the pixels; the textures were only for the overlay.
            DestroyTextures(tex, frames);
        }

        // --- The loop back from Claude ------------------------------------------------------

        /// <summary>Reads every mark's status. Changes since the last poll become toasts.</summary>
        void Poll(bool first)
        {
            _nextPoll = Time.realtimeSinceStartup + PollEvery;
            var changes = _inbox.Poll(first, out var changed);
            foreach (var c in changes)
            {
                var m = c.Mark;
                if (m.Status == "working")
                {
                    _hud.ShowToast("working", "On #" + m.Seq + " now", m.Note.Length > 0 ? m.Note : "(no note)", "CLAUDE CODE");
                }
                else if (m.Status == "fixed")
                {
                    _sfx.Play("fixed");
                    var res = Json.Str(m.Resolution, "note");
                    // A script fix lands after a reload; stopping and replaying is the clean retest.
                    _hud.ShowToast("fixed", "Fixed #" + m.Seq, res.Length > 0 ? res : m.Note, "REPLAY TO RETEST · " + Keys(_ghostKey) + " GHOSTS", 6f);
                }
            }
            if (changed) RefreshGhosts();
        }

        void FollowScene(bool force)
        {
            var now = Time.realtimeSinceStartup;
            if (!force && now < _nextSceneCheck) return;
            _nextSceneCheck = now + 0.5f;
            var path = SceneManager.GetActiveScene().path;
            var scope = CurrentScope();
            if (!force && path == _scenePath && scope == _scope) return;
            _scenePath = path;
            _scope = scope;
            RefreshGhosts();
        }

        static string CurrentScope()
        {
            try { return Playmark.Scope?.Invoke() ?? ""; }
            catch (Exception) { return ""; }
        }

        void RefreshGhosts()
        {
            if (_hud == null || _inbox == null) return;
            _hud.Ghosts = _inbox.GhostsFor(SceneManager.GetActiveScene().path, CurrentScope(), _settings.ghostsFixedHours, DateTime.UtcNow);
        }

        void Welcome()
        {
            var c = _inbox.Counts();
            _hud.ShowToast("ready", "Playmark is on", c.open + " open · " + c.fixedCount + " fixed", Keys(_shortcut) + " MARK · " + Keys(_ghostKey) + " GHOSTS", 3.5f);
        }

        // --- Runs asked for from outside: warp and smoke ------------------------------------

        IEnumerator RunRequest(Dictionary<string, object> req)
        {
            if (req == null) yield break;
            // Asked from a terminal, Unity is usually in the background, where Play Mode pauses
            // unless the game runs in the background. This session is a test run: let it.
            Application.runInBackground = true;
            var id = Json.Str(req, "id");
            switch (Json.Str(req, "action"))
            {
                case "warp": yield return Warp(Json.Str(req, "mark"), Json.Str(req, "shot"), id); break;
                case "smoke": yield return Smoke(Json.Str(req, "out"), id); break;
                default:
                    Requests.WriteResult(_root, id, false, null, "Unknown action '" + Json.Str(req, "action") + "'.");
                    break;
            }
        }

        /// <summary>
        /// Loads the mark's scene, hands its warp data to the game, and with a shot path saves a
        /// frame and stops (Claude checks its fix this way).
        /// </summary>
        IEnumerator Warp(string reference, string shot, string requestId)
        {
            yield return null;
            var m = _inbox.Find(reference);
            if (m == null)
            {
                Finish(requestId, false, null, "No mark '" + reference + "' to warp to.", !string.IsNullOrEmpty(shot));
                yield break;
            }
            var d = Json.TryParseObject(File.ReadAllText(Path.Combine(_inbox.FolderOf(m), "mark.json")));
            var warp = Json.Obj(d, "warp");
            var scenePath = Json.Str(warp, "scene");
            if (scenePath.Length > 0 && SceneManager.GetActiveScene().path != scenePath)
            {
                var loaded = Hooks.LoadSceneInPlayMode?.Invoke(scenePath) ?? false;
                if (!loaded)
                {
                    if (SceneUtility.GetBuildIndexByScenePath(scenePath) < 0)
                    {
                        Finish(requestId, false, null, "The scene " + scenePath + " is not in the build, so a build can't load it.", !string.IsNullOrEmpty(shot));
                        yield break;
                    }
                    SceneManager.LoadScene(scenePath);
                }
                for (var i = 0; i < 3; i++) yield return null;
            }
            for (var i = 0; i < 2; i++) yield return null; // the game's Start registers its warp
            if (Playmark.WarpLoad != null && warp != null && warp.TryGetValue("data", out var data) && data is Dictionary<string, object> dd)
            {
                try { Playmark.WarpLoad(dd); }
                catch (Exception e) { Debug.LogError("Playmark: the game's warp load threw: " + e.Message); }
            }
            FollowScene(true);
            _hud.ShowToast("warp", "At #" + m.Seq, m.Note, "WARPED BACK TO THE MARK");
            if (string.IsNullOrEmpty(shot))
            {
                Finish(requestId, true, null, null, false);
                yield break;
            }
            var until = Time.frameCount + 45;
            while (Time.frameCount < until) yield return null;
            _hideGui = true;
            yield return new WaitForEndOfFrame();
            var (tex, img) = Capture.Freeze();
            _hideGui = false;
            if (tex == null)
            {
                Finish(requestId, false, null, "No frame to capture.", true);
                yield break;
            }
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(shot)) ?? ".");
            File.WriteAllBytes(shot, Png.Encode(img));
            Destroy(tex);
            Debug.Log("Playmark: warp shot " + shot);
            Finish(requestId, true, shot, null, true);
        }

        /// <summary>
        /// An unattended check for any game: plays 6 s, opens the overlay, pins the center, boxes a
        /// corner, saves a picture of the overlay and the mark, and stops.
        /// </summary>
        IEnumerator Smoke(string outDir, string requestId)
        {
            yield return new WaitForSecondsRealtime(6f);
            // An automatic mark (the game logged an error) may still be saving: Open would refuse.
            var deadline = Time.realtimeSinceStartup + 15f;
            while ((_busy || _opening) && Time.realtimeSinceStartup < deadline) yield return null;
            Open();
            deadline = Time.realtimeSinceStartup + 3f;
            while (_overlay == null && Time.realtimeSinceStartup < deadline) yield return null;
            if (_overlay == null)
            {
                Debug.LogError("Playmark smoke: FAILED to open");
                Finish(requestId, false, null, "The overlay did not open.", true);
                yield break;
            }
            yield return new WaitForSecondsRealtime(0.7f);
            var ov = _overlay;
            ov.AddMark(new NormMark { X = 0.5f, Y = 0.5f });
            ov.AddMark(new NormMark { Box = true, X = 0.1f, Y = 0.15f, W = 0.2f, H = 0.25f });
            ov.SetNote("Smoke test: the overlay opens, marks land, the mark saves.", "bug");
            yield return new WaitForSecondsRealtime(0.5f);
            if (!string.IsNullOrEmpty(outDir)) yield return SaveScreen(Path.Combine(outDir, "smoke-overlay.png"), false);
            var saved = "";
            Action<string> onSaved = f => saved = f;
            Playmark.Saved += onSaved;
            ov.Submit();
            deadline = Time.realtimeSinceStartup + 15f;
            while (_overlay != null && Time.realtimeSinceStartup < deadline) yield return null;
            Playmark.Saved -= onSaved;
            yield return new WaitForSecondsRealtime(1f);
            if (!string.IsNullOrEmpty(outDir)) yield return SaveScreen(Path.Combine(outDir, "smoke-game.png"), true);
            var ok = saved.Length > 0;
            if (ok) Debug.Log("Playmark smoke: OK " + saved);
            else Debug.LogError("Playmark smoke: FAILED to save the mark");
            Finish(requestId, ok, null, ok ? null : "The mark was not saved.", true);
        }

        IEnumerator SaveScreen(string path, bool hideGui)
        {
            _hideGui = hideGui;
            yield return new WaitForEndOfFrame();
            var (tex, img) = Capture.Freeze();
            _hideGui = false;
            if (tex == null) yield break;
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path)) ?? ".");
            File.WriteAllBytes(path, Png.Encode(img));
            Destroy(tex);
        }

        /// <summary>Answers the request, if one asked, and with exit leaves Play Mode (or quits a build).</summary>
        void Finish(string requestId, bool ok, string shot, string error, bool exit)
        {
            if (!ok) Debug.LogWarning("Playmark: " + error);
            if (!string.IsNullOrEmpty(requestId)) Requests.WriteResult(_root, requestId, ok, shot, error);
            if (!exit) return;
            if (Hooks.ExitPlay != null) Hooks.ExitPlay();
            else if (!Application.isEditor) Application.Quit(ok ? 0 : 1);
        }
    }
}
