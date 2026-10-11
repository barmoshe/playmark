using System;
using System.Collections.Generic;
using System.IO;

namespace BarBuilds.Playmark.Core
{
    /// <summary>
    /// Runs asked for from outside the game: inbox.mjs writes requests/&lt;id&gt;.json, the Unity
    /// Editor claims it (renames it to .taken), plays, and the game writes &lt;id&gt;.result.json.
    /// A folder is the API, like the inbox: no sockets, no MCP server, nothing to keep running.
    ///
    /// Request: {"id": "...", "action": "warp" | "smoke", "mark": "&lt;mark id&gt;", "shot": "&lt;png path&gt;", "out": "&lt;dir&gt;"}
    /// Result:  {"id": "...", "ok": true | false, "shot": "...", "error": "..."}
    /// </summary>
    public static class Requests
    {
        public static string Dir(string root) => Path.Combine(root, "requests");

        /// <summary>Claims the oldest waiting request, or returns null. Safe if two editors race.</summary>
        public static Dictionary<string, object> ClaimNext(string root)
        {
            var dir = Dir(root);
            if (!Directory.Exists(dir)) return null;
            var files = new List<string>();
            foreach (var f in Directory.GetFiles(dir, "*.json"))
                if (!f.EndsWith(".result.json", StringComparison.Ordinal)) files.Add(f);
            files.Sort(StringComparer.Ordinal);
            foreach (var f in files)
            {
                var taken = Path.ChangeExtension(f, ".taken");
                try { File.Move(f, taken); }
                catch (IOException) { continue; } // someone else took it
                var d = Json.TryParseObject(File.ReadAllText(taken));
                if (d == null)
                {
                    WriteResult(root, Path.GetFileNameWithoutExtension(f), false, null, "The request is not valid JSON.");
                    continue;
                }
                if (!d.ContainsKey("id")) d["id"] = Path.GetFileNameWithoutExtension(f);
                return d;
            }
            return null;
        }

        public static void WriteResult(string root, string id, bool ok, string shot, string error)
        {
            var dir = Dir(root);
            Directory.CreateDirectory(dir);
            var data = new Dictionary<string, object> { ["id"] = id, ["ok"] = ok };
            if (!string.IsNullOrEmpty(shot)) data["shot"] = shot;
            if (!string.IsNullOrEmpty(error)) data["error"] = error;
            var tmp = Path.Combine(dir, id + ".result.tmp");
            File.WriteAllText(tmp, Json.Write(data) + "\n");
            var final = Path.Combine(dir, id + ".result.json");
            if (File.Exists(final)) File.Delete(final);
            File.Move(tmp, final);
            var taken = Path.Combine(dir, id + ".taken");
            if (File.Exists(taken)) File.Delete(taken);
        }
    }
}
