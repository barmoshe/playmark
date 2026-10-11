using System;
using System.Collections.Generic;
using System.IO;
using BarBuilds.Playmark.Core;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace BarBuilds.Playmark.EditorTools
{
    /// <summary>
    /// The Editor half of Playmark:
    /// 1. Tells the runtime what only the Editor knows: a component's script asset and an
    ///    object's prefab, so marks point at "Assets/Scripts/Enemy.cs", not a type name.
    /// 2. The request bridge: inbox.mjs (Claude Code's side) drops a JSON file in
    ///    .playmark/requests/; this picks it up, opens the mark's scene, and enters Play Mode
    ///    for a warp or a smoke run. The game writes the result next to the request.
    /// </summary>
    [InitializeOnLoad]
    internal static class PlaymarkEditor
    {
        const string RequestKey = "Playmark.Request";
        const string StartedKey = "Playmark.RequestStarted";
        static double _nextPoll;

        static PlaymarkEditor()
        {
            Hooks.ScriptPath = b =>
            {
                var script = b != null ? MonoScript.FromMonoBehaviour(b) : null;
                return script != null ? AssetDatabase.GetAssetPath(script) : null;
            };
            Hooks.PrefabPath = go => go != null ? PrefabUtility.GetPrefabAssetPathOfNearestInstanceRoot(go) : null;
            Hooks.TakeRequest = () =>
            {
                var s = SessionState.GetString(RequestKey, "");
                SessionState.EraseString(RequestKey);
                return s;
            };
            Hooks.ExitPlay = EditorApplication.ExitPlaymode;
            Hooks.LoadSceneInPlayMode = path =>
            {
                EditorSceneManager.LoadSceneInPlayMode(path, new LoadSceneParameters(LoadSceneMode.Single));
                return true;
            };
            EditorApplication.update -= Poll;
            EditorApplication.update += Poll;
        }

        /// <summary>The project's .playmark folder (Project Settings, Playmark, Output Dir).</summary>
        public static string Root
        {
            get
            {
                var dir = PlaymarkSettings.Current.outputDir;
                return Path.GetFullPath(Path.Combine(Application.dataPath, "..", string.IsNullOrEmpty(dir) ? ".playmark" : dir));
            }
        }

        static void Poll()
        {
            if (EditorApplication.timeSinceStartup < _nextPoll) return;
            _nextPoll = EditorApplication.timeSinceStartup + 0.5;
            // A playtest in progress is the player's: requests wait until it ends.
            if (EditorApplication.isCompiling || EditorApplication.isUpdating || EditorApplication.isPlayingOrWillChangePlaymode) return;
            if (FailUntakenRequest()) return;
            if (!Waiting()) return;
            // Claude's edits may not be imported yet while Unity sits in the background.
            AssetDatabase.Refresh();
            if (EditorApplication.isCompiling) return; // claim it once the scripts are built
            Dictionary<string, object> req;
            try { req = Requests.ClaimNext(Root); }
            catch (IOException) { return; }
            if (req == null) return;
            if (EditorUtility.scriptCompilationFailed)
            {
                Requests.WriteResult(Root, Json.Str(req, "id"), false, null, "Unity has script compile errors, so it can't enter Play Mode. Fix them (see the Console), then run it again.");
                return;
            }
            Start(req);
        }

        static bool Waiting()
        {
            var dir = Requests.Dir(Root);
            if (!Directory.Exists(dir)) return false;
            foreach (var f in Directory.GetFiles(dir, "*.json"))
                if (!f.EndsWith(".result.json", StringComparison.Ordinal)) return true;
            return false;
        }

        /// <summary>
        /// A request Play Mode never took (it refused to start, or Playmark is turned off): answer
        /// it as failed rather than replaying it the next time someone presses Play.
        /// </summary>
        static bool FailUntakenRequest()
        {
            var pending = SessionState.GetString(RequestKey, "");
            if (pending.Length == 0) return false;
            if (EditorApplication.timeSinceStartup - SessionState.GetFloat(StartedKey, 0f) < 5) return true;
            SessionState.EraseString(RequestKey);
            var req = Json.TryParseObject(pending);
            var why = EditorUtility.scriptCompilationFailed
                ? "Unity has script compile errors, so it can't enter Play Mode. Fix them (see the Console), then run it again."
                : "Play Mode didn't run the request. Is Playmark turned off in Project Settings, Playmark?";
            Requests.WriteResult(Root, Json.Str(req, "id"), false, null, why);
            return true;
        }

        static void Start(Dictionary<string, object> req)
        {
            var id = Json.Str(req, "id");
            var action = Json.Str(req, "action");
            if (action == "warp")
            {
                var inbox = new Inbox(Root);
                inbox.Poll(true, out _);
                var mark = inbox.Find(Json.Str(req, "mark"));
                if (mark == null)
                {
                    Requests.WriteResult(Root, id, false, null, "No mark '" + Json.Str(req, "mark") + "' in " + Root + ".");
                    return;
                }
                var data = Json.TryParseObject(File.ReadAllText(Path.Combine(inbox.FolderOf(mark), "mark.json")));
                var scene = Json.Str(Json.Obj(data, "warp"), "scene");
                if (scene.Length > 0 && SceneManager.GetActiveScene().path != scene)
                {
                    if (AssetDatabase.LoadAssetAtPath<SceneAsset>(scene) == null)
                    {
                        Requests.WriteResult(Root, id, false, null, "The mark's scene " + scene + " is not in this project any more.");
                        return;
                    }
                    for (var i = 0; i < SceneManager.sceneCount; i++)
                    {
                        if (!SceneManager.GetSceneAt(i).isDirty) continue;
                        Requests.WriteResult(Root, id, false, null, "The open scene has unsaved changes. Save it in Unity, then warp again.");
                        return;
                    }
                    EditorSceneManager.OpenScene(scene, OpenSceneMode.Single);
                }
            }
            else if (action != "smoke")
            {
                Requests.WriteResult(Root, id, false, null, "Unknown action '" + action + "'.");
                return;
            }
            Debug.Log("Playmark: " + action + " requested from Claude Code, entering Play Mode");
            SessionState.SetString(RequestKey, Json.Write(req, false));
            SessionState.SetFloat(StartedKey, (float)EditorApplication.timeSinceStartup);
            EditorApplication.EnterPlaymode();
        }

        // --- Menu ---------------------------------------------------------------------------

        [MenuItem("Tools/Playmark/Open Marks Folder")]
        static void OpenFolder()
        {
            Directory.CreateDirectory(Path.Combine(Root, "inbox"));
            EditorUtility.RevealInFinder(Path.Combine(Root, "inbox"));
        }

        [MenuItem("Tools/Playmark/Run Smoke Test")]
        public static void RunSmoke()
        {
            var id = "smoke-" + DateTime.Now.ToString("yyyyMMdd-HHmmss");
            var dir = Requests.Dir(Root);
            Directory.CreateDirectory(dir);
            var req = new Dictionary<string, object> { ["id"] = id, ["action"] = "smoke", ["out"] = Path.Combine(Root, "smoke") };
            File.WriteAllText(Path.Combine(dir, id + ".json"), Json.Write(req) + "\n");
            Debug.Log("Playmark: smoke test queued; it plays 6 s, marks, saves and stops. Pictures go to " + Path.Combine(Root, "smoke"));
        }

        [MenuItem("Tools/Playmark/Run Smoke Test", true)]
        static bool CanRunSmoke() => !EditorApplication.isPlayingOrWillChangePlaymode;
    }
}
