using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using BarBuilds.Playmark.Core;
using Xunit;

public class JsonTests
{
    [Fact]
    public void RoundTripsNestedValues()
    {
        var data = new Dictionary<string, object>
        {
            ["note"] = "Boxy should be \"orange\"\nnow",
            ["seq"] = 3L,
            ["ok"] = true,
            ["none"] = null,
            ["norm"] = new List<object> { 0.5, 0.25 },
            ["marks"] = new List<object> { new Dictionary<string, object> { ["type"] = "pin", ["x"] = 12.5 } },
            ["hebrew"] = "הבוס חזק מדי",
        };
        var back = (Dictionary<string, object>)Json.Parse(Json.Write(data));
        Assert.Equal(data["note"], back["note"]);
        Assert.Equal(3L, back["seq"]);
        Assert.Equal(true, back["ok"]);
        Assert.Null(back["none"]);
        Assert.Equal(0.25, ((List<object>)back["norm"])[1]);
        Assert.Equal(12.5, ((Dictionary<string, object>)((List<object>)back["marks"])[0])["x"]);
        Assert.Equal("הבוס חזק מדי", back["hebrew"]);
    }

    [Fact]
    public void ShortNumberListsStayOnOneLine()
    {
        var text = Json.Write(new Dictionary<string, object> { ["world"] = new List<object> { 1.5, -2.0, 0.0 } });
        Assert.Contains("\"world\": [1.5, -2, 0]", text);
    }

    class Player { public int hp = 7; public string Wand { get; set; } = "fire"; public float speed = 1.23456f; }

    [Fact]
    public void PlainTurnsObjectsIntoDictionariesAndRoundsFloats()
    {
        var p = (Dictionary<string, object>)Json.Plain(new Player());
        Assert.Equal(7L, p["hp"]);
        Assert.Equal("fire", p["Wand"]);
        Assert.Equal(1.23, (double)p["speed"], 6);
        var anon = (Dictionary<string, object>)Json.Plain(new { level = 3, tags = new[] { "a", "b" } });
        Assert.Equal(new List<object> { "a", "b" }, anon["tags"]);
    }

    [Fact]
    public void PlainAsksTheEngineConverterFirst()
    {
        var v = Json.Plain(new Uri("http://x"), o => o is Uri ? new List<object> { 1.0, 2.0 } : null);
        Assert.Equal(new List<object> { 1.0, 2.0 }, v);
    }

    [Theory]
    [InlineData("{")]
    [InlineData("[1,]")]
    [InlineData("{\"a\" 1}")]
    [InlineData("nul")]
    public void RejectsBrokenJson(string text)
    {
        Assert.Throws<FormatException>(() => Json.Parse(text));
        Assert.Null(Json.TryParseObject(text));
    }
}

public class InboxTests : IDisposable
{
    readonly string _root = Path.Combine(Path.GetTempPath(), "playmark-core-" + Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, true);
    }

    string Save(string id, long seq, string status = "new", string scene = "Assets/Main.unity", List<object> world = null)
    {
        var data = new Dictionary<string, object>
        {
            ["id"] = id, ["seq"] = seq, ["status"] = status, ["note"] = "note " + seq, ["category"] = "bug",
            ["scene"] = new Dictionary<string, object> { ["path"] = scene },
            ["scope"] = "",
            ["marks"] = new List<object> { new Dictionary<string, object> { ["type"] = "pin", ["world"] = world ?? new List<object> { 1.0, 2.0, 0.0 } } },
        };
        return Inbox.Write(_root, id, data, new Dictionary<string, byte[]> { ["screenshot.png"] = new byte[] { 1 } }, "log line");
    }

    [Fact]
    public void WritesTheGodotLayout()
    {
        var folder = Save("20261011-120000-aaaa", 1);
        Assert.True(File.Exists(Path.Combine(folder, "mark.json")));
        Assert.True(File.Exists(Path.Combine(folder, "screenshot.png")));
        Assert.Equal("log line\n", File.ReadAllText(Path.Combine(folder, "log.txt")));
        Assert.Contains("*", File.ReadAllText(Path.Combine(_root, ".gitignore")));
        Assert.False(File.Exists(Path.Combine(folder, "mark.json.tmp")));
    }

    [Fact]
    public void PollReportsStatusChangesButNotOnTheFirstPoll()
    {
        Save("20261011-120000-aaaa", 1);
        Save("20261011-120100-bbbb", 2);
        var inbox = new Inbox(_root);
        Assert.Empty(inbox.Poll(true, out var changed));
        Assert.True(changed);
        Assert.Equal(3, inbox.NextSeq());
        Assert.Equal((2, 0), inbox.Counts());

        // What inbox.mjs claim + resolve do: status working, then move to done/ as fixed.
        var file = Path.Combine(_root, "inbox", "20261011-120000-aaaa", "mark.json");
        File.WriteAllText(file, File.ReadAllText(file).Replace("\"status\": \"new\"", "\"status\": \"working\""));
        File.SetLastWriteTimeUtc(file, DateTime.UtcNow.AddSeconds(5));
        var changes = inbox.Poll(false, out _);
        Assert.Single(changes);
        Assert.Equal("working", changes[0].Mark.Status);
        Assert.Equal("new", changes[0].From);

        Directory.CreateDirectory(Path.Combine(_root, "done"));
        Directory.Move(Path.Combine(_root, "inbox", "20261011-120000-aaaa"), Path.Combine(_root, "done", "20261011-120000-aaaa"));
        file = Path.Combine(_root, "done", "20261011-120000-aaaa", "mark.json");
        File.WriteAllText(file, File.ReadAllText(file).Replace("\"working\"", "\"fixed\"").TrimEnd().TrimEnd('}') + ",\"resolution\": {\"note\": \"orange now\"}}");
        changes = inbox.Poll(false, out _);
        Assert.Equal("fixed", changes.Single().Mark.Status);
        Assert.Equal("orange now", Json.Str(changes[0].Mark.Resolution, "note"));
        Assert.Equal((1, 1), inbox.Counts());
        Assert.Equal("done", inbox.Find("#1").Box);
        Assert.Equal("20261011-120100-bbbb", inbox.Find("bbbb").Id);
    }

    [Fact]
    public void ShortNumbersAreMarkNumbersNotIdTails()
    {
        Save("20261011-120000-aaa2", 1);
        Save("20261011-120100-bbbb", 2);
        var inbox = new Inbox(_root);
        inbox.Poll(true, out _);
        Assert.Equal(2, inbox.Find("2").Seq); // not the id that ends in "2"
        Assert.Null(inbox.Find("7"));
        Assert.Equal(1, inbox.Find("aaa2").Seq);
    }

    [Fact]
    public void ForgetsDeletedMarks()
    {
        Save("20261011-120000-aaaa", 1);
        var inbox = new Inbox(_root);
        inbox.Poll(true, out _);
        Directory.Delete(Path.Combine(_root, "inbox", "20261011-120000-aaaa"), true);
        inbox.Poll(false, out var changed);
        Assert.True(changed);
        Assert.Empty(inbox.Known);
    }

    [Fact]
    public void GhostsBelongToTheirSceneAndFadeWhenFixedLongAgo()
    {
        Save("20261011-120000-aaaa", 1, world: new List<object> { 4.0, 5.0, 6.0 });
        Save("20261011-120100-bbbb", 2, scene: "Assets/Other.unity");
        Save("20261011-120200-cccc", 3, status: "fixed");
        var inbox = new Inbox(_root);
        inbox.Poll(true, out _);
        var now = DateTime.UtcNow;
        var ghosts = inbox.GhostsFor("Assets/Main.unity", "", 72, now);
        Assert.Equal(new long[] { 1, 3 }, ghosts.Select(g => g.Seq).ToArray());
        Assert.Equal(new[] { 4.0, 5.0, 6.0 }, ghosts[0].World);
        Assert.Equal(new long[] { 1 }, inbox.GhostsFor("Assets/Main.unity", "", 72, now.AddHours(100)).Select(g => g.Seq).ToArray());
        Assert.Equal(2, inbox.GhostsFor("Assets/Main.unity", "", -1, now.AddHours(100)).Count);
        Assert.Empty(inbox.GhostsFor("Assets/Main.unity", "room/2", 72, now));
    }

    [Fact]
    public void IdsSortByTime()
    {
        var id = Inbox.NewId(new DateTime(2026, 10, 11, 9, 5, 3), new Random(1));
        Assert.Matches(@"^20261011-090503-[0-9a-f]{4}$", id);
    }

    [Fact]
    public void RequestsAreClaimedOnceAndAnswered()
    {
        Directory.CreateDirectory(Requests.Dir(_root));
        File.WriteAllText(Path.Combine(Requests.Dir(_root), "r1.json"), "{\"action\": \"warp\", \"mark\": \"aaaa\"}");
        File.WriteAllText(Path.Combine(Requests.Dir(_root), "r2.json"), "not json");
        var r = Requests.ClaimNext(_root);
        Assert.Equal("r1", r["id"]);
        Assert.Equal("warp", r["action"]);
        Assert.True(File.Exists(Path.Combine(Requests.Dir(_root), "r1.taken")));
        Assert.Null(Requests.ClaimNext(_root)); // r2 is answered with an error, nothing else waits
        var bad = Json.TryParseObject(File.ReadAllText(Path.Combine(Requests.Dir(_root), "r2.result.json")));
        Assert.Equal(false, bad["ok"]);
        Requests.WriteResult(_root, "r1", true, "/tmp/shot.png", null);
        var res = Json.TryParseObject(File.ReadAllText(Path.Combine(Requests.Dir(_root), "r1.result.json")));
        Assert.Equal(true, res["ok"]);
        Assert.Equal("/tmp/shot.png", res["shot"]);
        Assert.False(File.Exists(Path.Combine(Requests.Dir(_root), "r1.taken")));
    }

    [Fact]
    public void StaleRequestsAreAnsweredNotRun()
    {
        var dir = Requests.Dir(_root);
        Directory.CreateDirectory(dir);
        var old = Path.Combine(dir, "old.json");
        File.WriteAllText(old, "{\"action\": \"smoke\"}");
        File.SetLastWriteTimeUtc(old, DateTime.UtcNow.AddHours(-3));
        File.WriteAllText(Path.Combine(dir, "fresh.json"), "{\"action\": \"smoke\"}");
        File.WriteAllText(Path.Combine(dir, "fresh.taken"), "{}"); // left by a crashed run with the same id
        var r = Requests.ClaimNext(_root);
        Assert.Equal("fresh", r["id"]);
        var expired = Json.TryParseObject(File.ReadAllText(Path.Combine(dir, "old.result.json")));
        Assert.Equal(false, expired["ok"]);
        Assert.Contains("expired", (string)expired["error"]);
        Assert.False(File.Exists(old));
    }
}

public class LogRingTests
{
    [Fact]
    public void KeepsTheLastLinesAndEachErrorOnce()
    {
        var log = new LogRing(4);
        log.Add("Log", "one", "");
        log.Add("Warning", "two", "stack is ignored");
        log.Add("Error", "NullReferenceException: boss", "Boss.Update () (at Assets/Boss.cs:12)");
        log.Add("Error", "NullReferenceException: boss", "again");
        log.Add("Log", "Playmark: saved", "");
        Assert.Equal("NullReferenceException: boss", log.TakeError());
        Assert.Null(log.TakeError());
        var lines = log.Dump().Split('\n');
        Assert.Equal(4, lines.Length);
        Assert.Equal("Playmark: saved", lines[^1]);
        Assert.Contains("ERROR: NullReferenceException: boss", lines);
    }

    [Fact]
    public void IgnoresPlaymarksOwnErrors()
    {
        var log = new LogRing(10);
        log.Add("Error", "Playmark: can't write", "");
        Assert.Null(log.TakeError());
    }

    [Fact]
    public void IgnoresErrorsThrownOnlyInsideUnity()
    {
        var log = new LogRing(40);
        // Seen on Unity 6000.3: Quick Search's indexer, and the Pipeline package's server.
        log.Add("Exception", "ArgumentOutOfRangeException: Index was out of range.",
            "System.Collections.Generic.List`1[T].get_Item (System.Int32 index) (at <4ac0ee78>:0)\n" +
            "UnityEditor.Search.SearchDatabase+<EnumerateAll>d__83.MoveNext () (at /Users/bokken/build/output/unity/unity/Modules/QuickSearch/Editor/Indexing/SearchDatabase.cs:453)\n" +
            "UnityEditor.EditorApplication.Internal_CallDelayFunctions () (at /Users/bokken/build/output/unity/unity/Editor/Mono/EditorApplication.cs:407)\n");
        log.Add("Error", "Failed to handle /api/exec request: Main thread operation timed out after 5000ms",
            "UnityEngine.Debug:LogError (object)\n" +
            "Unity.Pipeline.BasePipelineServer/<HandleExecRequest>d__119:MoveNext () (at ./Library/PackageCache/com.unity.pipeline@62c08c808737/Runtime/Common/BasePipelineServer.cs:2257)\n" +
            "System.Threading._ThreadPoolWaitCallback:PerformWaitCallback ()\n");
        Assert.Null(log.TakeError());
        Assert.Contains("EXCEPTION: ArgumentOutOfRangeException: Index was out of range.", log.Dump());

        // The game's own frame anywhere in the stack, or no stack at all, is the game's error.
        log.Add("Error", "Boss has no target", "UnityEngine.Debug:LogError (object)\nBoss:Update () (at Assets/Boss.cs:12)\n");
        log.Add("Error", "The referenced script on this Behaviour is missing!", "");
        Assert.Equal("Boss has no target", log.TakeError());
        Assert.Equal("The referenced script on this Behaviour is missing!", log.TakeError());
    }
}

public class ImageTests
{
    static RgbaImage Gradient(int w, int h)
    {
        var img = new RgbaImage(w, h);
        for (var y = 0; y < h; y++)
        for (var x = 0; x < w; x++)
        {
            var i = (y * w + x) * 4;
            img.Pixels[i] = (byte)(x * 255 / Math.Max(1, w - 1));
            img.Pixels[i + 1] = (byte)(y * 255 / Math.Max(1, h - 1));
            img.Pixels[i + 2] = 40;
            img.Pixels[i + 3] = 255;
        }
        return img;
    }

    /// <summary>An independent decoder: inflate IDAT, undo the per-row filters.</summary>
    static RgbaImage Decode(byte[] png)
    {
        Assert.Equal(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A }, png.Take(8).ToArray());
        int pos = 8, w = 0, h = 0;
        var idat = new MemoryStream();
        while (pos < png.Length)
        {
            var len = (png[pos] << 24) | (png[pos + 1] << 16) | (png[pos + 2] << 8) | png[pos + 3];
            var type = System.Text.Encoding.ASCII.GetString(png, pos + 4, 4);
            if (type == "IHDR")
            {
                w = (png[pos + 8] << 24) | (png[pos + 9] << 16) | (png[pos + 10] << 8) | png[pos + 11];
                h = (png[pos + 12] << 24) | (png[pos + 13] << 16) | (png[pos + 14] << 8) | png[pos + 15];
                Assert.Equal(8, png[pos + 16]);
                Assert.Equal(6, png[pos + 17]);
            }
            if (type == "IDAT") idat.Write(png, pos + 8, len);
            pos += 12 + len;
        }
        idat.Position = 0;
        var raw = new MemoryStream();
        using (var z = new ZLibStream(idat, CompressionMode.Decompress)) z.CopyTo(raw);
        var bytes = raw.ToArray();
        var img = new RgbaImage(w, h);
        var stride = w * 4;
        for (var y = 0; y < h; y++)
        {
            var filter = bytes[y * (stride + 1)];
            Assert.Equal(1, filter);
            for (var x = 0; x < stride; x++)
            {
                var left = x >= 4 ? img.Pixels[y * stride + x - 4] : 0;
                img.Pixels[y * stride + x] = (byte)(bytes[y * (stride + 1) + 1 + x] + left);
            }
        }
        return img;
    }

    [Fact]
    public void PngRoundTrips()
    {
        var img = Gradient(37, 21);
        var back = Decode(Png.Encode(img));
        Assert.Equal(img.Width, back.Width);
        Assert.Equal(img.Pixels, back.Pixels);
    }

    [Fact]
    public void FlipRowsAndBottomUp()
    {
        var img = Gradient(3, 4);
        var flipped = img.Clone();
        flipped.FlipRows();
        Assert.Equal(img.Pixels, RgbaImage.FromBottomUp(3, 4, flipped.Pixels).Pixels);
    }

    [Fact]
    public void DetectsUpsideDownClipFrames()
    {
        var shot = Gradient(320, 180);
        var frame = shot.FitWidth(64);
        Assert.False(RgbaImage.LooksFlipped(shot, frame));
        frame.FlipRows();
        Assert.True(RgbaImage.LooksFlipped(shot, frame));
        var flat = new RgbaImage(16, 9);
        flat.Fill(RgbaImage.Blue);
        Assert.Null(RgbaImage.Orientation(flat, flat.Clone())); // nothing to tell apart: ask again later
        Assert.False(RgbaImage.LooksFlipped(flat, flat.Clone()));
    }

    [Fact]
    public void AnnotateUpscalesAndDrawsEachMark()
    {
        var shot = new RgbaImage(480, 270);
        shot.Fill(RgbaImage.White);
        var out1 = RgbaImage.Annotate(shot, new[] { MarkShape.Pin(100, 100), MarkShape.Box(200, 50, 100, 80) });
        Assert.Equal(960, out1.Width); // 480 upscales by 2 to reach 960
        Assert.Equal(540, out1.Height);
        bool Has(byte[] c) => Enumerable.Range(0, out1.Width * out1.Height).Any(i => out1.Pixels[i * 4] == c[0] && out1.Pixels[i * 4 + 1] == c[1] && out1.Pixels[i * 4 + 2] == c[2]);
        Assert.True(Has(RgbaImage.Orange));
        Assert.True(Has(RgbaImage.Blue));
        // The box's top edge, in blue, at 2x.
        var i0 = (100 * 960 + 450) * 4;
        Assert.Equal(RgbaImage.Blue[0], out1.Pixels[i0]);
    }

    [Fact]
    public void ContactSheetSamplesEvenlyInAGrid()
    {
        var frames = Enumerable.Range(0, 40).Select(_ => Gradient(64, 36)).ToList();
        var sheet = RgbaImage.ContactSheet(frames);
        Assert.Equal(4 * 64 + 5 * 4, sheet.Width);
        Assert.Equal(3 * 36 + 4 * 4, sheet.Height);
        Assert.Null(RgbaImage.ContactSheet(new List<RgbaImage>()));
    }

    [Fact]
    public void LabelsStayInsideTheImage()
    {
        var img = new RgbaImage(10, 10);
        img.Label(500, -40, 123, RgbaImage.Orange, 1); // clamped, no throw
        Assert.Contains(img.Pixels, b => b != 0);
    }
}

public class MiscTests
{
    [Fact]
    public void SynthMakesEverySoundWithinItsPeak()
    {
        var all = new Synth().All();
        Assert.Equal(9, all.Count);
        foreach (var kv in all)
        {
            Assert.NotEmpty(kv.Value);
            var peak = kv.Value.Max(Math.Abs);
            Assert.InRange(peak, 0.05f, Synth.PeakOf(kv.Key) + 0.001f);
        }
        Assert.True(all["fixed"].Length > Synth.Rate * 2); // bells ring out, with a room
    }

    [Theory]
    [InlineData("Ctrl+Shift+M", true, true, false, false, "M", "⌃⇧M")]
    [InlineData("cmd + shift + g", false, true, false, true, "G", "⇧⌘G")]
    [InlineData("Alt+F8", false, false, true, false, "F8", "⌥F8")]
    public void ShortcutsParse(string text, bool ctrl, bool shift, bool alt, bool cmd, string key, string mac)
    {
        var s = Shortcut.Parse(text);
        Assert.Equal((ctrl, shift, alt, cmd, key), (s.Ctrl, s.Shift, s.Alt, s.Cmd, s.Key));
        Assert.Equal(mac, s.Display(true));
        Assert.Equal(text, s.Display(false));
        Assert.False(Shortcut.Parse("Ctrl+Shift").IsValid);
    }
}
