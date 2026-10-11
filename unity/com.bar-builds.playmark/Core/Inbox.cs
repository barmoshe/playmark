using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;

namespace BarBuilds.Playmark.Core
{
    /// <summary>One mark on disk, as the game keeps track of it.</summary>
    public sealed class KnownMark
    {
        public string Id;
        public string Box;       // "inbox" or "done"
        public long Seq;
        public string Status;    // new, working, fixed
        public string Note;
        public string Category;
        public string Scene;
        public string Scope;
        public List<object> Marks;
        public Dictionary<string, object> Resolution;
        public DateTime Modified; // UTC
    }

    /// <summary>A status that changed since the last poll: the game turns these into toasts.</summary>
    public sealed class StatusChange
    {
        public KnownMark Mark;
        public string From;
    }

    /// <summary>A past mark to draw back into the world.</summary>
    public sealed class Ghost
    {
        public string Id;
        public long Seq;
        public string Status;
        public string Note;
        public string Category;
        public Dictionary<string, object> Resolution;
        public double[] World; // x, y[, z]
    }

    /// <summary>
    /// The .playmark folder: inbox/ (open marks), done/ (fixed), requests/ (warp and smoke runs
    /// asked for by inbox.mjs). Same layout as the Godot addon, so the Claude Code side reads
    /// both without knowing which engine wrote it.
    /// </summary>
    public sealed class Inbox
    {
        public readonly string Root;
        readonly Dictionary<string, KnownMark> _known = new Dictionary<string, KnownMark>();

        public Inbox(string root) { Root = root; }

        public IReadOnlyDictionary<string, KnownMark> Known => _known;

        /// <summary>20261011-153012-a3f9: sortable, and the last 4 characters are enough to name it.</summary>
        public static string NewId(DateTime local, Random random)
        {
            return local.ToString("yyyyMMdd-HHmmss", CultureInfo.InvariantCulture) + "-" + random.Next(0, 0x10000).ToString("x4");
        }

        public long NextSeq()
        {
            long top = 0;
            foreach (var m in _known.Values) top = Math.Max(top, m.Seq);
            return top + 1;
        }

        public (int open, int fixedCount) Counts()
        {
            int open = 0, fixedCount = 0;
            foreach (var m in _known.Values)
            {
                if (m.Status == "fixed") fixedCount++;
                else open++;
            }
            return (open, fixedCount);
        }

        /// <summary>
        /// Rereads every mark whose file changed. Returns the status changes (empty on the first
        /// poll, so starting the game doesn't replay old news). <paramref name="changed"/> is true
        /// when anything was added, edited or removed.
        /// </summary>
        public List<StatusChange> Poll(bool first, out bool changed)
        {
            var changes = new List<StatusChange>();
            var seen = new HashSet<string>();
            changed = false;
            foreach (var box in new[] { "inbox", "done" })
            {
                var dir = Path.Combine(Root, box);
                if (!Directory.Exists(dir)) continue;
                string[] folders;
                try { folders = Directory.GetDirectories(dir); }
                catch (IOException) { continue; }
                foreach (var folder in folders)
                {
                    var id = Path.GetFileName(folder);
                    var file = Path.Combine(folder, "mark.json");
                    if (!File.Exists(file)) continue;
                    seen.Add(id);
                    var mtime = File.GetLastWriteTimeUtc(file);
                    _known.TryGetValue(id, out var prev);
                    if (prev != null && prev.Modified == mtime && prev.Box == box) continue;
                    Dictionary<string, object> d;
                    try { d = Json.TryParseObject(File.ReadAllText(file)); }
                    catch (IOException) { continue; } // mid-write: next poll
                    if (d == null) continue;
                    var entry = FromJson(id, box, d);
                    entry.Modified = mtime;
                    _known[id] = entry;
                    changed = true;
                    if (first || prev == null || prev.Status == entry.Status) continue;
                    changes.Add(new StatusChange { Mark = entry, From = prev.Status });
                }
            }
            var gone = new List<string>();
            foreach (var id in _known.Keys) if (!seen.Contains(id)) gone.Add(id);
            foreach (var id in gone) { _known.Remove(id); changed = true; }
            return changes;
        }

        /// <summary>Remembers a mark the game just saved, before the next poll sees it.</summary>
        public void Remember(string id, Dictionary<string, object> data)
        {
            var e = FromJson(id, "inbox", data);
            e.Modified = DateTime.MinValue;
            _known[id] = e;
        }

        static KnownMark FromJson(string id, string box, Dictionary<string, object> d)
        {
            return new KnownMark
            {
                Id = id,
                Box = box,
                Seq = Json.Long(d, "seq"),
                Status = Json.Str(d, "status", "new"),
                Note = Json.Str(d, "note"),
                Category = Json.Str(d, "category"),
                Scene = Json.Str(Json.Obj(d, "scene"), "path"),
                Scope = Json.Str(d, "scope"),
                Marks = Json.List(d, "marks") ?? new List<object>(),
                Resolution = Json.Obj(d, "resolution") ?? new Dictionary<string, object>(),
            };
        }

        /// <summary>
        /// The marks to draw in this scene and scope: each one's first mark, where it has a
        /// place in the world. Fixed marks fade out after <paramref name="fixedHours"/> (-1 keeps them).
        /// </summary>
        public List<Ghost> GhostsFor(string scene, string scope, double fixedHours, DateTime utcNow)
        {
            var list = new List<Ghost>();
            foreach (var e in _known.Values)
            {
                if (e.Scene != scene || (e.Scope ?? "") != (scope ?? "") || e.Marks.Count == 0) continue;
                if (e.Status == "fixed" && fixedHours >= 0 && e.Modified != DateTime.MinValue && (utcNow - e.Modified).TotalHours > fixedHours) continue;
                if (!(e.Marks[0] is Dictionary<string, object> first) || !(first.TryGetValue("world", out var w) && w is List<object> world) || world.Count < 2) continue;
                var xyz = new double[world.Count];
                for (var i = 0; i < world.Count; i++) xyz[i] = Json.Double(world[i]);
                list.Add(new Ghost { Id = e.Id, Seq = e.Seq, Status = e.Status, Note = e.Note, Category = e.Category, Resolution = e.Resolution, World = xyz });
            }
            list.Sort((a, b) => a.Seq.CompareTo(b.Seq));
            return list;
        }

        /// <summary>Finds a mark by number (14 or #14), full id, or the id's last characters.</summary>
        public KnownMark Find(string reference)
        {
            if (string.IsNullOrEmpty(reference)) return null;
            // A short number is a mark number (#14), as in inbox.mjs; anything else is an id or its tail.
            var r = reference.TrimStart('#');
            if (r.Length <= 4 && long.TryParse(r, NumberStyles.None, CultureInfo.InvariantCulture, out var seq))
            {
                foreach (var m in _known.Values) if (m.Seq == seq) return m;
                return null;
            }
            foreach (var m in _known.Values)
                if (m.Id == reference || m.Id.EndsWith(reference, StringComparison.Ordinal)) return m;
            return null;
        }

        public string FolderOf(KnownMark m) => Path.Combine(Root, m.Box, m.Id);

        /// <summary>
        /// Writes one mark: images and log first, mark.json last (a folder with mark.json is
        /// complete). Also drops a .gitignore so marks stay local. Returns the folder.
        /// </summary>
        public static string Write(string root, string id, Dictionary<string, object> data, IDictionary<string, byte[]> files, string log)
        {
            var folder = Path.Combine(root, "inbox", id);
            Directory.CreateDirectory(Path.Combine(folder, "clip"));
            WriteOnce(Path.Combine(root, ".gitignore"), "# Playmark marks stay local by default.\n*\n");
            foreach (var kv in files) File.WriteAllBytes(Path.Combine(folder, kv.Key.Replace('/', Path.DirectorySeparatorChar)), kv.Value);
            File.WriteAllText(Path.Combine(folder, "log.txt"), (log ?? "") + "\n");
            var tmp = Path.Combine(folder, "mark.json.tmp");
            File.WriteAllText(tmp, Json.Write(data) + "\n");
            var final = Path.Combine(folder, "mark.json");
            if (File.Exists(final)) File.Delete(final);
            File.Move(tmp, final);
            return folder;
        }

        static void WriteOnce(string path, string text)
        {
            if (!File.Exists(path)) File.WriteAllText(path, text);
        }
    }
}
