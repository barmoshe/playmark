using System;
using System.Collections.Generic;
using System.Globalization;
using UnityEngine;

namespace BarBuilds.Playmark
{
    /// <summary>
    /// Photo mode for feedback, drawn with IMGUI over the frozen game: the frame on a dark
    /// stage, a rewind strip, category stamps and a note. Marking is mouse, everything else is
    /// one key, as in the Godot addon:
    ///   click pin · drag box · right-click undo · 1-5 category · ← → rewind ·
    ///   Ctrl/Cmd+Enter save · Esc cancel · typing anywhere starts the note.
    /// </summary>
    internal sealed class Overlay
    {
        public static readonly string[] Categories = { "bug", "feel", "art", "balance", "idea" };
        const int MaxMarks = 9;
        const string NoteControl = "playmark-note";

        public struct Info
        {
            public long Seq;
            public string Scene;
            public int Fps;
            public int Session;
            public int Inbox;
            public int Fixed;
        }

        /// <summary>note, category ("" if none), marks (normalized), frame index (-1 = freeze frame).</summary>
        public event Action<string, string, List<NormMark>, int> Submitted;
        public event Action Cancelled;
        public event Action Finished;

        public readonly List<NormMark> Marks = new List<NormMark>();
        public int FrameIndex = -1;
        public string Note = "";
        public int Category = -1;

        readonly Texture2D _shot;
        readonly List<ClipFrame> _frames;
        readonly Info _info;
        readonly Sounds _sfx;
        readonly float _openedAt;
        Vector2? _dragFrom;
        Vector2 _dragTo;
        bool _focusNote;
        bool _caretToEnd;
        string _state = "open"; // open, saving, saved, failed
        float _stateAt;
        Rect _frameRect;

        public Overlay(Texture2D shot, List<ClipFrame> frames, Info info, Sounds sfx)
        {
            _shot = shot;
            _frames = frames;
            _info = info;
            _sfx = sfx;
            _openedAt = Time.realtimeSinceStartup;
            _sfx?.Play("shutter");
        }

        public bool Busy => _state != "open";

        // --- API (the host and the smoke test drive these) -----------------------------------

        public void AddMark(NormMark m)
        {
            if (Marks.Count >= MaxMarks) return;
            Marks.Add(m);
            _sfx?.Play(m.Box ? "tick" : "pop", 1f + Marks.Count * 0.03f);
        }

        public void UndoMark()
        {
            if (Marks.Count == 0) return;
            Marks.RemoveAt(Marks.Count - 1);
            _sfx?.Play("swish", 1.3f);
        }

        public void SetFrame(int i)
        {
            FrameIndex = Mathf.Clamp(i, -1, _frames.Count - 1);
            _sfx?.Play("tick", 1.4f);
        }

        public void SetNote(string text, string category)
        {
            Note = text ?? "";
            Category = Array.IndexOf(Categories, category);
        }

        public void Submit()
        {
            if (Busy) return;
            _state = "saving";
            _stateAt = Time.realtimeSinceStartup;
            _sfx?.Play("stamp");
            Submitted?.Invoke(Note.Trim(), Category >= 0 ? Categories[Category] : "", new List<NormMark>(Marks), FrameIndex);
        }

        /// <summary>The host calls this when the mark is on disk (or failed to get there).</summary>
        public void Finish(bool saved)
        {
            _state = saved ? "saved" : "failed";
            _stateAt = Time.realtimeSinceStartup;
        }

        void Cancel()
        {
            if (Busy) return;
            _sfx?.Play("swish");
            Cancelled?.Invoke();
        }

        // --- Frame loop ---------------------------------------------------------------------

        public void OnGUI()
        {
            if ((_state == "saved" || _state == "failed") && Time.realtimeSinceStartup - _stateAt > (_state == "saved" ? 0.55f : 1.6f))
            {
                _state = "done";
                Finished?.Invoke();
                return;
            }
            if (_state == "done") return;
            HandleKeys(Event.current);
            Layout(out var head, out var stage, out var scrub, out var deck, out var hint);
            HandleMouse(Event.current, stage);
            // Every event goes through the same calls (IMGUI matches controls by call order).
            Brand.Rect(new Rect(0, 0, Screen.width, Screen.height), Brand.Ground);
            DrawHead(head);
            DrawStage(stage);
            DrawScrub(scrub);
            DrawDeck(deck);
            GUI.Label(hint, HintText(), Brand.Text("mono", 11, Brand.Ink2));
            if (_focusNote)
            {
                GUI.FocusControl(NoteControl);
                _focusNote = false;
                _caretToEnd = true;
            }
        }

        void Layout(out Rect head, out Rect stage, out Rect scrub, out Rect deck, out Rect hint)
        {
            var u = Brand.U;
            float pad = 20 * u, w = Screen.width - 2 * pad;
            head = new Rect(pad, 14 * u, w, 44 * u);
            var deckH = 132 * u;
            hint = new Rect(pad, Screen.height - 24 * u, w, 18 * u);
            deck = new Rect(pad, hint.y - 8 * u - deckH, w, deckH);
            scrub = new Rect(pad, deck.y - 10 * u - 30 * u, w, 30 * u);
            var top = head.yMax + 10 * u;
            stage = new Rect(pad, top, w, Mathf.Max(60, scrub.y - 10 * u - top));
        }

        // --- Input --------------------------------------------------------------------------

        void HandleKeys(Event e)
        {
            if (e.type != EventType.KeyDown || Busy) return;
            var mod = e.control || e.command;
            var noteFocused = GUI.GetNameOfFocusedControl() == NoteControl;
            if (e.keyCode == KeyCode.Escape) { Cancel(); e.Use(); return; }
            if (mod && (e.keyCode == KeyCode.Return || e.keyCode == KeyCode.KeypadEnter)) { Submit(); e.Use(); return; }
            if (mod && (e.character == '\n' || e.character == '\r')) { e.Use(); return; } // the newline that follows
            if (mod && e.keyCode == KeyCode.Z && !noteFocused) { UndoMark(); e.Use(); return; }
            if (noteFocused) return; // the note field takes everything else
            if (!mod && e.keyCode >= KeyCode.Alpha1 && e.keyCode <= KeyCode.Alpha5)
            {
                var i = e.keyCode - KeyCode.Alpha1;
                Category = Category == i ? -1 : i;
                _sfx?.Play("chip");
                e.Use();
                return;
            }
            if (!mod && e.keyCode == KeyCode.None && e.character >= '1' && e.character <= '5') { e.Use(); return; }
            if (e.keyCode == KeyCode.LeftArrow) { SetFrame(FrameIndex < 0 ? _frames.Count - 1 : Mathf.Max(FrameIndex - 1, 0)); e.Use(); return; }
            if (e.keyCode == KeyCode.RightArrow) { SetFrame(FrameIndex >= _frames.Count - 1 ? -1 : FrameIndex + 1); e.Use(); return; }
            if (e.keyCode == KeyCode.Return || e.keyCode == KeyCode.Tab) { _focusNote = true; e.Use(); return; }
            if (!mod && e.character >= ' ' && e.keyCode == KeyCode.None)
            {
                // Typing anywhere starts the note; this key lands in it.
                Note += e.character;
                _sfx?.Key(false);
                _focusNote = true;
                e.Use();
            }
        }

        void HandleMouse(Event e, Rect stage)
        {
            if (Busy) return;
            _frameRect = Fit(stage, CurrentSize());
            var p = e.mousePosition;
            switch (e.type)
            {
                case EventType.MouseDown when e.button == 0 && _frameRect.Contains(p):
                    _dragFrom = ToNorm(p);
                    _dragTo = _dragFrom.Value;
                    GUI.FocusControl(null);
                    e.Use();
                    break;
                case EventType.MouseDown when e.button == 1 && stage.Contains(p):
                    UndoMark();
                    e.Use();
                    break;
                case EventType.MouseDrag when _dragFrom != null:
                    _dragTo = ToNorm(p);
                    e.Use();
                    break;
                case EventType.MouseUp when e.button == 0 && _dragFrom != null:
                    var a = _dragFrom.Value;
                    var b = ToNorm(p);
                    _dragFrom = null;
                    var px = Vector2.Scale(b - a, _frameRect.size).magnitude;
                    if (px < 6) AddMark(new NormMark { X = a.x, Y = a.y });
                    else AddMark(new NormMark { Box = true, X = Mathf.Min(a.x, b.x), Y = Mathf.Min(a.y, b.y), W = Mathf.Abs(b.x - a.x), H = Mathf.Abs(b.y - a.y) });
                    e.Use();
                    break;
            }
        }

        Vector2 ToNorm(Vector2 p) => new Vector2(Mathf.Clamp01((p.x - _frameRect.x) / _frameRect.width), Mathf.Clamp01((p.y - _frameRect.y) / _frameRect.height));

        Vector2 ToScreen(float nx, float ny) => new Vector2(_frameRect.x + nx * _frameRect.width, _frameRect.y + ny * _frameRect.height);

        Vector2 CurrentSize()
        {
            var t = FrameIndex < 0 ? _shot : _frames[FrameIndex].Texture;
            return t != null ? new Vector2(t.width, t.height) : new Vector2(16, 9);
        }

        static Rect Fit(Rect area, Vector2 size)
        {
            var k = Mathf.Min(area.width / size.x, area.height / size.y);
            var w = size.x * k;
            var h = size.y * k;
            return new Rect(area.x + (area.width - w) / 2, area.y + (area.height - h) / 2, w, h);
        }

        // --- Drawing ------------------------------------------------------------------------

        void DrawHead(Rect r)
        {
            var u = Brand.U;
            Brand.Rect(new Rect(r.x, r.y + 6 * u, 10 * u, 30 * u), Brand.Orange);
            GUI.Label(new Rect(r.x + 18 * u, r.y, 300 * u, 30 * u), "PLAYMARK", Brand.Text("900", 26, Brand.Paper));
            GUI.Label(new Rect(r.x + 18 * u, r.y + 28 * u, r.width * 0.6f, 16 * u), Dateline(), Brand.Text("mono", 11, Brand.Ink2));
            var x = r.xMax;
            x = Stat(x, r.y, "FIXED", _info.Fixed.ToString(CultureInfo.InvariantCulture), Brand.Blue);
            x = Stat(x, r.y, "INBOX", _info.Inbox.ToString(CultureInfo.InvariantCulture), Brand.Orange);
            Stat(x, r.y, "THIS SESSION", (_info.Session + 1).ToString(CultureInfo.InvariantCulture), Brand.Paper);
            Brand.Rect(new Rect(r.x, r.yMax + 4 * u, r.width, 1), Brand.Rule);
        }

        float Stat(float right, float y, string caption, string value, Color c)
        {
            var u = Brand.U;
            var w = 96 * u;
            var x = right - w;
            GUI.Label(new Rect(x, y - 2 * u, w, 30 * u), value, Brand.Text("900", 24, c, TextAnchor.UpperRight));
            GUI.Label(new Rect(x, y + 28 * u, w, 14 * u), caption, Brand.Text("mono", 10, Brand.Ink2, TextAnchor.UpperRight));
            return x - 16 * u;
        }

        string Dateline()
        {
            var scene = System.IO.Path.GetFileNameWithoutExtension(_info.Scene ?? "").ToUpperInvariant();
            var parts = new List<string> { "MARK #" + _info.Seq, DateTime.Now.ToString("HH:mm", CultureInfo.InvariantCulture) };
            if (scene.Length > 0) parts.Add(scene);
            parts.Add(_info.Fps + " FPS");
            parts.Add("GAME FROZEN");
            return string.Join("  ·  ", parts);
        }

        void DrawStage(Rect stage)
        {
            var u = Brand.U;
            Brand.Rect(stage, Brand.Ground2);
            _frameRect = Fit(stage, CurrentSize());
            if (FrameIndex < 0)
            {
                if (_shot != null) GUI.DrawTexture(_frameRect, _shot, ScaleMode.StretchToFill, false);
            }
            else
            {
                var t = _frames[FrameIndex].Texture;
                if (Capture.TexturesFlipped) GUI.DrawTextureWithTexCoords(_frameRect, t, new Rect(0, 1, 1, -1), false);
                else GUI.DrawTexture(_frameRect, t, ScaleMode.StretchToFill, false);
                Brand.Rect(new Rect(_frameRect.x, _frameRect.y, _frameRect.width, 22 * u), Brand.Alpha(Brand.Ink, 0.7f));
                GUI.Label(new Rect(_frameRect.x + 8 * u, _frameRect.y + 3 * u, 400 * u, 18 * u), "REWOUND " + Offset(FrameIndex) + "  ·  MARKING THIS FRAME", Brand.Text("mono-bold", 11, Brand.Blue));
            }
            // A flash when the shutter fires.
            var flash = 1f - (Time.realtimeSinceStartup - _openedAt) / 0.28f;
            if (flash > 0) Brand.Rect(_frameRect, Brand.Alpha(Brand.Paper, flash * 0.6f));
            Brand.Outline(_frameRect, 1, Brand.Rule);

            for (var i = 0; i < Marks.Count; i++) DrawMark(Marks[i], i + 1, 1f);
            if (_dragFrom != null)
            {
                var a = _dragFrom.Value;
                var b = _dragTo;
                var r = Rect.MinMaxRect(Mathf.Min(a.x, b.x), Mathf.Min(a.y, b.y), Mathf.Max(a.x, b.x), Mathf.Max(a.y, b.y));
                if (Vector2.Scale(b - a, _frameRect.size).magnitude >= 6)
                    DrawMark(new NormMark { Box = true, X = r.x, Y = r.y, W = r.width, H = r.height }, Marks.Count + 1, 0.6f);
            }
            if (Marks.Count == 0 && _dragFrom == null && !Busy)
            {
                var tip = new Rect(_frameRect.x, _frameRect.yMax - 30 * u, _frameRect.width, 30 * u);
                Brand.Rect(tip, Brand.Alpha(Brand.Ink, 0.72f));
                GUI.Label(tip, "CLICK TO PIN  ·  DRAG TO BOX  ·  RIGHT-CLICK UNDOES", Brand.Text("mono-bold", 12, Brand.Paper, TextAnchor.MiddleCenter));
            }
            if (Busy) DrawStamp();
        }

        void DrawMark(NormMark m, int n, float alpha)
        {
            var u = Brand.U;
            var c = Brand.Alpha(m.Box ? Brand.Blue : Brand.Orange, alpha);
            var ink = Brand.Alpha(Brand.Ink, alpha);
            Vector2 tag;
            if (m.Box)
            {
                var a = ToScreen(m.X, m.Y);
                var b = ToScreen(m.X + m.W, m.Y + m.H);
                var r = Rect.MinMaxRect(a.x, a.y, b.x, b.y);
                Brand.Outline(new Rect(r.x - 2 * u, r.y - 2 * u, r.width + 4 * u, r.height + 4 * u), 5 * u, ink);
                Brand.Outline(r, 3 * u, c);
                Brand.Rect(r, Brand.Alpha(c, 0.08f * alpha));
                tag = new Vector2(r.x - 2 * u, r.y - 26 * u);
            }
            else
            {
                var p = ToScreen(m.X, m.Y);
                Brand.Dot(p, 15 * u, ink);
                Brand.Dot(p, 12 * u, c);
                Brand.Dot(p, 8 * u, ink);
                Brand.Dot(p, 3 * u, c);
                tag = new Vector2(p.x + 12 * u, p.y - 34 * u);
            }
            var tr = new Rect(tag.x, tag.y, 22 * u, 22 * u);
            Brand.Rect(tr, c);
            GUI.Label(tr, n.ToString(CultureInfo.InvariantCulture), Brand.Text("900", 15, ink, TextAnchor.MiddleCenter));
        }

        void DrawStamp()
        {
            var u = Brand.U;
            var text = _state == "saving" ? "SAVING" : _state == "failed" ? "NOT SAVED" : "SAVED #" + _info.Seq;
            var c = _state == "failed" ? Brand.Orange : Brand.Paper;
            var t = Mathf.Clamp01((Time.realtimeSinceStartup - _stateAt) / 0.18f);
            var scale = Mathf.Lerp(1.4f, 1f, t * t);
            var size = new Vector2(320, 84) * u * scale;
            var center = _frameRect.center;
            var r = new Rect(center - size / 2, size);
            var old = GUI.matrix;
            GUIUtility.RotateAroundPivot(-6f, center);
            Brand.Rect(r, Brand.Alpha(Brand.Ink, 0.75f));
            Brand.Outline(r, 4 * u, c);
            GUI.Label(r, text, Brand.Text("900", 34 * scale, c, TextAnchor.MiddleCenter));
            GUI.matrix = old;
        }

        string Offset(int i) => i < 0 ? "0.0 s" : _frames[i].Offset.ToString("0.00", CultureInfo.InvariantCulture) + " s";

        void DrawScrub(Rect r)
        {
            var u = Brand.U;
            var label = Brand.Text("mono", 11, Brand.Ink2, TextAnchor.MiddleLeft);
            GUI.Label(new Rect(r.x, r.y, 150 * u, r.height), _frames.Count > 0 ? "← → REWIND" : "NO CLIP", label);
            var right = Brand.Text("mono-bold", 11, FrameIndex < 0 ? Brand.Paper : Brand.Blue, TextAnchor.MiddleRight);
            GUI.Label(new Rect(r.xMax - 150 * u, r.y, 150 * u, r.height), FrameIndex < 0 ? "FREEZE FRAME" : Offset(FrameIndex), right);
            var n = _frames.Count + 1;
            var track = new Rect(r.x + 160 * u, r.y, r.width - 320 * u, r.height);
            if (track.width <= 0) return;
            var step = track.width / n;
            for (var i = 0; i < n; i++)
            {
                var index = i == n - 1 ? -1 : i;
                var on = index == FrameIndex;
                var cell = new Rect(track.x + i * step + 1, track.y + (on ? 4 : 9) * u, Mathf.Max(1, step - 2), track.height - (on ? 8 : 18) * u);
                Brand.Rect(cell, on ? (index < 0 ? Brand.Paper : Brand.Blue) : (index < 0 ? Brand.Alpha(Brand.Paper, 0.45f) : Brand.Rule));
                var hit = new Rect(track.x + i * step, track.y, step, track.height);
                if (!Busy && Event.current.type == EventType.MouseDown && Event.current.button == 0 && hit.Contains(Event.current.mousePosition))
                {
                    SetFrame(index);
                    Event.current.Use();
                }
            }
        }

        void DrawDeck(Rect r)
        {
            var u = Brand.U;
            var rightW = 210 * u;
            var left = new Rect(r.x, r.y, r.width - rightW - 16 * u, r.height);
            float x = left.x, chipH = 34 * u;
            for (var i = 0; i < Categories.Length; i++)
            {
                var text = (i + 1) + "  " + Categories[i].ToUpperInvariant();
                var style = Brand.Button(Category == i ? "chip-on" : "chip");
                var w = style.CalcSize(new GUIContent(text)).x + 4 * u;
                if (GUI.Button(new Rect(x, left.y, w, chipH), text, style) && !Busy)
                {
                    Category = Category == i ? -1 : i;
                    _sfx?.Play("chip");
                }
                x += w + 6 * u;
            }
            var noteRect = new Rect(left.x, left.y + chipH + 8 * u, left.width, left.height - chipH - 8 * u);
            var before = Note;
            GUI.SetNextControlName(NoteControl);
            GUI.enabled = !Busy;
            Note = GUI.TextArea(noteRect, Note, 500, Brand.NoteField());
            GUI.enabled = true;
            // A field that just took focus puts the caret at the start (or selects all): typing
            // that started outside it must carry on at the end.
            if (_caretToEnd && GUI.GetNameOfFocusedControl() == NoteControl && GUIUtility.keyboardControl != 0)
            {
                var editor = (TextEditor)GUIUtility.GetStateObject(typeof(TextEditor), GUIUtility.keyboardControl);
                editor.text = Note;
                editor.MoveTextEnd();
                _caretToEnd = false;
            }
            if (Note != before)
            {
                _sfx?.Key(Note.Length < before.Length);
            }
            if (Note.Length == 0 && GUI.GetNameOfFocusedControl() != NoteControl)
            {
                var pad = 12 * u;
                GUI.Label(new Rect(noteRect.x + pad, noteRect.y + 10 * u, noteRect.width - 2 * pad, 24 * u), "What did you notice?", Brand.Text("500", 17, Brand.Alpha(Brand.Ink2, 0.7f)));
            }

            var right = new Rect(r.xMax - rightW, r.y, rightW, r.height);
            var save = "SAVE MARK  " + (Brand.Mac ? "⌘" : "Ctrl+") + "↵";
            if (GUI.Button(new Rect(right.x, right.yMax - 50 * u - 34 * u, right.width, 50 * u), save, Brand.Button("primary"))) Submit();
            if (GUI.Button(new Rect(right.x, right.yMax - 28 * u, right.width, 28 * u), "ESC  CANCEL", Brand.Button("ghost"))) Cancel();
        }

        string HintText()
        {
            if (Busy) return "SAVING TO .playmark/inbox";
            var parts = new List<string>();
            parts.Add(Marks.Count == 0 ? "NO MARKS YET" : Marks.Count + (Marks.Count == 1 ? " MARK" : " MARKS"));
            parts.Add(Category >= 0 ? Categories[Category].ToUpperInvariant() : "NO CATEGORY (1-5)");
            if (_frames.Count > 0) parts.Add(_frames.Count + " CLIP FRAMES");
            parts.Add("CLAUDE CODE READS IT NEXT PROMPT");
            return string.Join("  ·  ", parts);
        }
    }
}
