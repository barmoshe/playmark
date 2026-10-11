using System.Collections.Generic;
using BarBuilds.Playmark.Core;
using UnityEngine;

namespace BarBuilds.Playmark
{
    /// <summary>
    /// Bar Builds newsprint brand, dark plate: paper on ink, blueprint blue and print orange.
    /// Square corners, rules instead of boxes, no shadows. Heebo for display and UI, Cascadia
    /// Mono for meta (SIL OFL, see OFL.txt). Same palette as the Godot addon's brand.gd.
    ///
    /// The overlay is IMGUI: it needs no scene objects, no EventSystem, no theme asset, and it
    /// works with either input system.
    /// </summary>
    internal static class Brand
    {
        public static readonly Color Ground = Hex(0x111111);
        public static readonly Color Ground2 = Hex(0x1b1b1b);
        public static readonly Color Paper = Hex(0xf2efe6);
        public static readonly Color Ink2 = Hex(0xb3b0a8);
        public static readonly Color Rule = new Color(0.95f, 0.94f, 0.9f, 0.22f);
        public static readonly Color Blue = Hex(0x6faef2);
        public static readonly Color BlueDeep = Hex(0x1f5fae);
        public static readonly Color Orange = Hex(0xf2621b);
        public static readonly Color Ink = Hex(0x111111);

        static readonly Dictionary<string, Font> Fonts = new Dictionary<string, Font>();
        static readonly Dictionary<string, GUIStyle> Styles = new Dictionary<string, GUIStyle>();
        static readonly Dictionary<string, Texture2D> Boxes = new Dictionary<string, Texture2D>();
        static Texture2D _white, _disc;

        public static Color Hex(int rgb) => new Color(((rgb >> 16) & 0xff) / 255f, ((rgb >> 8) & 0xff) / 255f, (rgb & 0xff) / 255f, 1f);

        public static Color Alpha(Color c, float a) => new Color(c.r, c.g, c.b, a);

        /// <summary>UI scale: 1 at 800 px tall, so the overlay reads the same at any window size.</summary>
        public static float U => Mathf.Clamp(Screen.height / 800f, 0.7f, 2.5f);

        public static bool Mac => Application.platform == RuntimePlatform.OSXEditor || Application.platform == RuntimePlatform.OSXPlayer;

        /// <summary>Heebo 500, 800 or 900; "mono" or "mono-bold" for Cascadia Mono.</summary>
        public static Font Font(string name)
        {
            if (Fonts.TryGetValue(name, out var f) && f != null) return f;
            var file = name == "mono" ? "CascadiaMono-400" : name == "mono-bold" ? "CascadiaMono-600" : "Heebo-" + name;
            f = Resources.Load<Font>("Playmark/" + file);
            if (f == null) f = GUI.skin != null ? GUI.skin.font : null; // the built-in font, rather than nothing
            Fonts[name] = f;
            return f;
        }

        /// <summary>A text style, cached. Sizes are in overlay units (multiplied by U).</summary>
        public static GUIStyle Text(string font, float size, Color color, TextAnchor anchor = TextAnchor.UpperLeft, bool wrap = false)
        {
            var px = Mathf.Max(8, Mathf.RoundToInt(size * U));
            var key = font + "|" + px + "|" + ColorUtility.ToHtmlStringRGBA(color) + "|" + anchor + "|" + wrap;
            if (Styles.TryGetValue(key, out var s)) return s;
            s = new GUIStyle { font = Font(font), fontSize = px, alignment = anchor, wordWrap = wrap, clipping = TextClipping.Clip, richText = false };
            s.normal.textColor = color;
            Styles[key] = s;
            return s;
        }

        /// <summary>A flat button: fill, border, hover and pressed looks. Square corners.</summary>
        public static GUIStyle Button(string kind)
        {
            var key = "button|" + kind + "|" + Mathf.RoundToInt(U * 100);
            if (Styles.TryGetValue(key, out var s)) return s;
            var u = U;
            switch (kind)
            {
                case "chip":
                    s = Flat(Text("800", 13, Paper, TextAnchor.MiddleCenter), Color.clear, Rule, Alpha(Paper, 0.08f), Paper);
                    break;
                case "chip-on":
                    s = Flat(Text("800", 13, Ink, TextAnchor.MiddleCenter), Orange, Orange, Orange, Paper);
                    break;
                case "primary":
                    s = Flat(Text("900", 16, Ink, TextAnchor.MiddleCenter), Paper, Paper, Orange, Orange);
                    break;
                default: // ghost
                    s = new GUIStyle(Text("mono", 12, Ink2, TextAnchor.MiddleCenter));
                    s.hover.textColor = Paper;
                    s.active.textColor = Paper;
                    return Styles[key] = s;
            }
            s.padding = new RectOffset(Mathf.RoundToInt(14 * u), Mathf.RoundToInt(14 * u), Mathf.RoundToInt(6 * u), Mathf.RoundToInt(6 * u));
            return Styles[key] = s;
        }

        static GUIStyle Flat(GUIStyle text, Color fill, Color border, Color hoverFill, Color hoverBorder)
        {
            var s = new GUIStyle(text) { border = new RectOffset(3, 3, 3, 3) };
            s.normal.background = Box(fill, border, 2);
            s.hover.background = Box(hoverFill, hoverBorder, 2);
            s.active.background = Box(Orange, Paper, 2);
            s.hover.textColor = text.normal.textColor == Ink ? Ink : Paper;
            s.active.textColor = Ink;
            return s;
        }

        /// <summary>The note field: dark well, rule border, orange when focused.</summary>
        public static GUIStyle NoteField()
        {
            var key = "note|" + Mathf.RoundToInt(U * 100);
            if (Styles.TryGetValue(key, out var s)) return s;
            s = new GUIStyle(Text("500", 17, Paper, TextAnchor.UpperLeft, true)) { border = new RectOffset(3, 3, 3, 3) };
            var pad = Mathf.RoundToInt(12 * U);
            s.padding = new RectOffset(pad, pad, Mathf.RoundToInt(10 * U), Mathf.RoundToInt(10 * U));
            s.normal.background = Box(Ground2, Rule, 1);
            s.hover.background = s.normal.background;
            s.focused.background = Box(Ground2, Orange, 2);
            s.focused.textColor = Paper;
            s.hover.textColor = Paper;
            return Styles[key] = s;
        }

        /// <summary>An 8x8 nine-slice texture: fill with a border of `width` pixels.</summary>
        public static Texture2D Box(Color fill, Color border, int width)
        {
            var key = ColorUtility.ToHtmlStringRGBA(fill) + ColorUtility.ToHtmlStringRGBA(border) + width;
            if (Boxes.TryGetValue(key, out var t) && t != null) return t;
            t = new Texture2D(8, 8, TextureFormat.RGBA32, false) { filterMode = FilterMode.Point, hideFlags = HideFlags.HideAndDontSave };
            var px = new Color[64];
            for (var y = 0; y < 8; y++)
            for (var x = 0; x < 8; x++)
                px[y * 8 + x] = x < width || y < width || x >= 8 - width || y >= 8 - width ? border : fill;
            t.SetPixels(px);
            t.Apply();
            return Boxes[key] = t;
        }

        public static Texture2D White
        {
            get
            {
                if (_white != null) return _white;
                _white = new Texture2D(1, 1, TextureFormat.RGBA32, false) { hideFlags = HideFlags.HideAndDontSave };
                _white.SetPixel(0, 0, Color.white);
                _white.Apply();
                return _white;
            }
        }

        /// <summary>An anti-aliased white disc, tinted with GUI.color.</summary>
        public static Texture2D Disc
        {
            get
            {
                if (_disc != null) return _disc;
                const int n = 64;
                _disc = new Texture2D(n, n, TextureFormat.RGBA32, false) { hideFlags = HideFlags.HideAndDontSave, filterMode = FilterMode.Bilinear, wrapMode = TextureWrapMode.Clamp };
                var px = new Color[n * n];
                for (var y = 0; y < n; y++)
                for (var x = 0; x < n; x++)
                {
                    var d = Vector2.Distance(new Vector2(x + 0.5f, y + 0.5f), new Vector2(n / 2f, n / 2f));
                    px[y * n + x] = new Color(1, 1, 1, Mathf.Clamp01(n / 2f - d));
                }
                _disc.SetPixels(px);
                _disc.Apply();
                return _disc;
            }
        }

        // --- Drawing ----------------------------------------------------------------------

        public static void Rect(Rect r, Color c)
        {
            var old = GUI.color;
            GUI.color = c;
            GUI.DrawTexture(r, White);
            GUI.color = old;
        }

        public static void Outline(Rect r, float t, Color c)
        {
            Rect(new Rect(r.x, r.y, r.width, t), c);
            Rect(new Rect(r.x, r.yMax - t, r.width, t), c);
            Rect(new Rect(r.x, r.y, t, r.height), c);
            Rect(new Rect(r.xMax - t, r.y, t, r.height), c);
        }

        public static void Dot(Vector2 center, float radius, Color c)
        {
            var old = GUI.color;
            GUI.color = c;
            GUI.DrawTexture(new Rect(center.x - radius, center.y - radius, radius * 2, radius * 2), Disc);
            GUI.color = old;
        }

        /// <summary>A diamond (a square turned 45 degrees), filled.</summary>
        public static void Diamond(Vector2 center, float radius, Color c)
        {
            var m = GUI.matrix;
            GUIUtility.RotateAroundPivot(45f, center);
            var side = radius * 1.4142f;
            Rect(new Rect(center.x - side / 2, center.y - side / 2, side, side), c);
            GUI.matrix = m;
        }

        /// <summary>The pixel digits from the annotated PNGs, so a number reads in pixel-art games too.</summary>
        public static void Digits(Vector2 at, long n, float u, Color c, Color? bg = null)
        {
            var text = n.ToString(System.Globalization.CultureInfo.InvariantCulture);
            if (bg.HasValue) Rect(new Rect(at.x - u, at.y - u, text.Length * 4 * u + u, 7 * u), bg.Value);
            for (var ci = 0; ci < text.Length; ci++)
            {
                var glyph = RgbaImage.Digits[text[ci] - '0'];
                for (var row = 0; row < 5; row++)
                for (var col = 0; col < 3; col++)
                    if (glyph[row * 3 + col] == '1')
                        Rect(new Rect(at.x + (ci * 4 + col) * u, at.y + row * u, u, u), c);
            }
        }

        /// <summary>Shortens text with an ellipsis until it fits the width.</summary>
        public static string Fit(string text, GUIStyle style, float width)
        {
            if (string.IsNullOrEmpty(text) || style.CalcSize(new GUIContent(text)).x <= width) return text ?? "";
            int lo = 0, hi = text.Length;
            while (lo < hi)
            {
                var mid = (lo + hi + 1) / 2;
                if (style.CalcSize(new GUIContent(text.Substring(0, mid) + "…")).x <= width) lo = mid;
                else hi = mid - 1;
            }
            return text.Substring(0, lo).TrimEnd() + "…";
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            // Styles hold textures that may not survive leaving Play Mode: rebuild per session,
            // and free the old ones (they are HideAndDontSave, so nothing else would).
            foreach (var t in Boxes.Values) if (t != null) UnityEngine.Object.DestroyImmediate(t);
            if (_white != null) UnityEngine.Object.DestroyImmediate(_white);
            if (_disc != null) UnityEngine.Object.DestroyImmediate(_disc);
            Styles.Clear();
            Boxes.Clear();
            Fonts.Clear();
            _white = null;
            _disc = null;
        }
    }
}
