using System.Collections.Generic;
using BarBuilds.Playmark.Core;
using UnityEngine;

namespace BarBuilds.Playmark
{
    /// <summary>
    /// What Playmark draws over the running game: toasts in the top-right corner ("FIXED #14"),
    /// the card of the ghost you're next to, and the ghosts themselves: past marks drawn back
    /// into the world where they were made. Orange: open. Pulsing blue: Claude is on it. Blue
    /// outline with a check: fixed (go retest it). Works in 2D and 3D, through the game camera.
    /// </summary>
    internal sealed class Hud
    {
        struct Toast
        {
            public string Kind, Title, Body, Meta, KickerText;
            public float Seconds;
        }

        readonly Queue<Toast> _queue = new Queue<Toast>();
        Toast? _current;
        float _until, _shownAt;
        Toast? _card;

        public List<Ghost> Ghosts = new List<Ghost>();
        public bool GhostsVisible = true;
        public string NearId { get; private set; } = "";

        /// <summary>kind: ready, saved, working, fixed, error, warp. Colors the accent.</summary>
        public void ShowToast(string kind, string title, string body, string meta = "", float seconds = 4f)
        {
            _queue.Enqueue(new Toast { Kind = kind, Title = title, Body = body, Meta = meta, Seconds = seconds });
        }

        public void Card(string kicker, string kind, string title, string body, string meta)
        {
            _card = new Toast { KickerText = kicker, Kind = kind, Title = title, Body = body, Meta = meta };
        }

        public void HideCard() => _card = null;

        /// <summary>Finds the ghost the player (or the mouse) is next to. Returns it, or null.</summary>
        public Ghost Near(Vector2 guiPoint, Camera cam)
        {
            if (!GhostsVisible || cam == null) return null;
            var u = Unit();
            Ghost best = null;
            var bestD = 26f * u;
            foreach (var g in Ghosts)
            {
                if (!ToGui(cam, g, out var p)) continue;
                var d = Vector2.Distance(guiPoint, p + new Vector2(0, -8 * u));
                if (d < bestD)
                {
                    bestD = d;
                    best = g;
                }
            }
            NearId = best?.Id ?? "";
            return best;
        }

        public void OnGUI(Camera cam)
        {
            var now = Time.realtimeSinceStartup;
            if (Event.current.type == EventType.Repaint)
            {
                if (_current != null && now >= _until) _current = null;
                if (_current == null && _queue.Count > 0)
                {
                    _current = _queue.Dequeue();
                    _until = now + _current.Value.Seconds;
                    _shownAt = now;
                }
            }
            if (GhostsVisible && cam != null) DrawGhosts(cam, now);
            var showing = _current ?? _card;
            if (showing != null) DrawToast(showing.Value, now);
        }

        // --- Ghosts -------------------------------------------------------------------------

        /// <summary>One ghost "pixel": 1 at 270p, 2 at 540p, 4 at 1080p.</summary>
        static float Unit() => Mathf.Max(Mathf.Round(Screen.height / 270f), 1f);

        static bool ToGui(Camera cam, Ghost g, out Vector2 p)
        {
            var w = new Vector3((float)g.World[0], (float)g.World[1], g.World.Length > 2 ? (float)g.World[2] : 0f);
            var s = cam.WorldToScreenPoint(w);
            p = new Vector2(Mathf.Round(s.x), Mathf.Round(Screen.height - s.y));
            return s.z > 0 && p.x > -50 && p.y > -50 && p.x < Screen.width + 50 && p.y < Screen.height + 50;
        }

        void DrawGhosts(Camera cam, float t)
        {
            if (Event.current.type != EventType.Repaint) return;
            var u = Unit();
            foreach (var g in Ghosts)
            {
                if (!ToGui(cam, g, out var basePt)) continue;
                var near = g.Id == NearId;
                var r = (near ? 9f : 7f) * u;
                var lit = g.Status == "new" ? Brand.Orange : Brand.Blue;
                // The marker floats above the spot on a stem, so it never hides inside what it marks.
                var bob = Mathf.Round(Mathf.Sin(t * 2.2f + g.Seq) * 1.5f) * u;
                var p = basePt + new Vector2(0, -16 * u + bob);
                // A soft glow on the floor.
                var old = GUI.color;
                GUI.color = Brand.Alpha(lit, 0.18f);
                GUI.DrawTexture(new Rect(basePt.x - r * 1.6f, basePt.y + 2 * u - r * 0.56f, r * 3.2f, r * 1.12f), Brand.Disc);
                GUI.color = old;
                Brand.Rect(new Rect(basePt.x - u / 2, p.y + r, u, Mathf.Max(0, basePt.y - p.y - r)), Brand.Alpha(g.Status != "fixed" ? Brand.Paper : Brand.Blue, 0.6f));
                Brand.Rect(new Rect(basePt.x - u, basePt.y - u, 2 * u, 2 * u), lit);
                switch (g.Status)
                {
                    case "fixed":
                        Brand.Diamond(p, r + u, Brand.Blue);
                        Brand.Diamond(p, r - u, Brand.Alpha(Brand.Ink, 0.85f));
                        Brand.Rect(new Rect(p.x - 3 * u, p.y, 2 * u, u), Brand.Blue);
                        Brand.Rect(new Rect(p.x - u, p.y + u, u, u), Brand.Blue);
                        Brand.Rect(new Rect(p.x, p.y - 2 * u, u, 3 * u), Brand.Blue);
                        Brand.Rect(new Rect(p.x + u, p.y - 3 * u, 2 * u, u), Brand.Blue);
                        break;
                    case "working":
                        Brand.Diamond(p, r + u, Brand.Ink);
                        Brand.Diamond(p, r, Brand.Alpha(Brand.Blue, 0.55f + 0.45f * Mathf.Sin(t * 6f)));
                        break;
                    default:
                        Brand.Diamond(p, r + u, Brand.Ink);
                        Brand.Diamond(p, r, Brand.Orange);
                        break;
                }
                Brand.Digits(new Vector2(p.x + r + 2 * u, p.y - r - 3 * u), g.Seq, u, g.Status != "fixed" ? Brand.Paper : Brand.Blue, Brand.Alpha(Brand.Ink, 0.75f));
            }
        }

        // --- Toast and card -----------------------------------------------------------------

        void DrawToast(Toast d, float now)
        {
            var u = Brand.U;
            var w = 380 * u;
            var h = 96 * u;
            var slide = Mathf.Clamp01(1f - (now - _shownAt) * 6f);
            var r = new Rect(Screen.width - w - 14 * u + 36 * u * slide * slide, 14 * u, w, h);
            var accent = d.Kind == "fixed" || d.Kind == "working" || d.Kind == "warp" ? Brand.Blue : d.Kind == "ready" ? Brand.Paper : Brand.Orange;
            Brand.Rect(r, Brand.Ground);
            Brand.Outline(r, 1, Brand.Rule);
            var bar = d.Kind == "working" ? Brand.Alpha(accent, 0.35f + 0.65f * Mathf.Abs(Mathf.Sin(now * 1000f / 220f))) : accent;
            Brand.Rect(new Rect(r.x, r.y, 6 * u, h), bar);
            var x = r.x + 22 * u;
            var inner = r.width - 36 * u;
            GUI.Label(new Rect(x, r.y + 10 * u, inner, 14 * u), d.KickerText ?? Kicker(d.Kind), Brand.Text("mono-bold", 10, accent));
            var title = Brand.Text("900", 20, Brand.Paper);
            GUI.Label(new Rect(x, r.y + 24 * u, inner, 28 * u), Brand.Fit(d.Title, title, inner), title);
            var body = Brand.Text("500", 14, Brand.Paper);
            GUI.Label(new Rect(x, r.y + 52 * u, inner, 20 * u), Brand.Fit(d.Body, body, inner), body);
            var meta = Brand.Text("mono", 10, Brand.Ink2);
            GUI.Label(new Rect(x, r.y + 74 * u, inner, 14 * u), Brand.Fit(d.Meta, meta, inner), meta);
        }

        static string Kicker(string kind)
        {
            switch (kind)
            {
                case "saved": return "MARK SAVED";
                case "working": return "CLAUDE IS ON IT";
                case "fixed": return "FIXED BY CLAUDE";
                case "error": return "CAUGHT AN ERROR";
                case "warp": return "WARPED";
                case "ghost": return "MARK";
                default: return "PLAYMARK";
            }
        }
    }
}
