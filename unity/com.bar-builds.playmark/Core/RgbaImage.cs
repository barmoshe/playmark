using System;
using System.Collections.Generic;

namespace BarBuilds.Playmark.Core
{
    /// <summary>A mark as the player drew it, in the pixels of the frame they marked.</summary>
    public struct MarkShape
    {
        public bool IsBox;
        public float X, Y, W, H;

        public static MarkShape Pin(float x, float y) => new MarkShape { X = x, Y = y };
        public static MarkShape Box(float x, float y, float w, float h) => new MarkShape { IsBox = true, X = x, Y = y, W = w, H = h };
    }

    /// <summary>
    /// 8-bit RGBA pixels, rows top to bottom (PNG order). Image work for a mark happens here,
    /// off the main thread and without a renderer: the annotated frame, the clip contact sheet.
    /// Ported from the Godot addon's images.gd so both engines draw the same marks.
    /// </summary>
    public sealed class RgbaImage
    {
        public readonly int Width, Height;
        public readonly byte[] Pixels;

        // Brand spot inks: pins print orange, boxes are blueprint blue.
        public static readonly byte[] Orange = { 0xF2, 0x62, 0x1B, 0xFF };
        public static readonly byte[] Blue = { 0x6F, 0xAE, 0xF2, 0xFF };
        public static readonly byte[] Ink = { 0x11, 0x11, 0x11, 0xFF };
        public static readonly byte[] White = { 0xFF, 0xFF, 0xFF, 0xFF };

        /// <summary>3x5 digits, row by row.</summary>
        public static readonly string[] Digits =
        {
            "111101101101111", "010110010010111", "111001111100111", "111001111001111", "101101111001001",
            "111100111001111", "111100111101111", "111001001001001", "111101111101111", "111101111001111",
        };

        public RgbaImage(int width, int height, byte[] pixels = null)
        {
            if (width <= 0 || height <= 0) throw new ArgumentException("Empty image");
            Width = width;
            Height = height;
            Pixels = pixels ?? new byte[width * height * 4];
            if (Pixels.Length != width * height * 4) throw new ArgumentException("Pixel count does not match the size");
        }

        /// <summary>From rows stored bottom to top (Unity's Texture2D order).</summary>
        public static RgbaImage FromBottomUp(int width, int height, byte[] pixels)
        {
            var img = new RgbaImage(width, height, (byte[])pixels.Clone());
            img.FlipRows();
            return img;
        }

        public RgbaImage Clone() => new RgbaImage(Width, Height, (byte[])Pixels.Clone());

        public void FlipRows()
        {
            var stride = Width * 4;
            var tmp = new byte[stride];
            for (int y = 0, y2 = Height - 1; y < y2; y++, y2--)
            {
                Buffer.BlockCopy(Pixels, y * stride, tmp, 0, stride);
                Buffer.BlockCopy(Pixels, y2 * stride, Pixels, y * stride, stride);
                Buffer.BlockCopy(tmp, 0, Pixels, y2 * stride, stride);
            }
        }

        public void Fill(byte[] c) => FillRect(0, 0, Width, Height, c);

        public void FillRect(int x, int y, int w, int h, byte[] c)
        {
            var x0 = Math.Max(0, x);
            var y0 = Math.Max(0, y);
            var x1 = Math.Min(Width, x + w);
            var y1 = Math.Min(Height, y + h);
            for (var yy = y0; yy < y1; yy++)
            {
                var i = (yy * Width + x0) * 4;
                for (var xx = x0; xx < x1; xx++, i += 4)
                {
                    Pixels[i] = c[0]; Pixels[i + 1] = c[1]; Pixels[i + 2] = c[2]; Pixels[i + 3] = c[3];
                }
            }
        }

        public void SetPixel(int x, int y, byte[] c)
        {
            if (x < 0 || y < 0 || x >= Width || y >= Height) return;
            var i = (y * Width + x) * 4;
            Pixels[i] = c[0]; Pixels[i + 1] = c[1]; Pixels[i + 2] = c[2]; Pixels[i + 3] = c[3];
        }

        public void Blit(RgbaImage src, int atX, int atY)
        {
            for (var y = 0; y < src.Height; y++)
            {
                var dy = atY + y;
                if (dy < 0 || dy >= Height) continue;
                var sx0 = Math.Max(0, -atX);
                var sx1 = Math.Min(src.Width, Width - atX);
                if (sx1 <= sx0) continue;
                Buffer.BlockCopy(src.Pixels, (y * src.Width + sx0) * 4, Pixels, (dy * Width + atX + sx0) * 4, (sx1 - sx0) * 4);
            }
        }

        /// <summary>Nearest-neighbour resize (keeps pixel art crisp).</summary>
        public RgbaImage ResizeNearest(int w, int h)
        {
            var o = new RgbaImage(w, h);
            for (var y = 0; y < h; y++)
            {
                var sy = Math.Min(Height - 1, y * Height / h);
                for (var x = 0; x < w; x++)
                {
                    var sx = Math.Min(Width - 1, x * Width / w);
                    Buffer.BlockCopy(Pixels, (sy * Width + sx) * 4, o.Pixels, (y * w + x) * 4, 4);
                }
            }
            return o;
        }

        /// <summary>Area-average downscale, for clip frames and comparisons.</summary>
        public RgbaImage Downscale(int w, int h)
        {
            if (w >= Width && h >= Height) return Clone();
            var o = new RgbaImage(w, h);
            for (var y = 0; y < h; y++)
            {
                int sy0 = y * Height / h, sy1 = Math.Max(sy0 + 1, (y + 1) * Height / h);
                for (var x = 0; x < w; x++)
                {
                    int sx0 = x * Width / w, sx1 = Math.Max(sx0 + 1, (x + 1) * Width / w);
                    int r = 0, g = 0, b = 0, a = 0, n = 0;
                    for (var yy = sy0; yy < sy1; yy++)
                    {
                        var i = (yy * Width + sx0) * 4;
                        for (var xx = sx0; xx < sx1; xx++, i += 4, n++)
                        {
                            r += Pixels[i]; g += Pixels[i + 1]; b += Pixels[i + 2]; a += Pixels[i + 3];
                        }
                    }
                    var o4 = (y * w + x) * 4;
                    o.Pixels[o4] = (byte)(r / n); o.Pixels[o4 + 1] = (byte)(g / n); o.Pixels[o4 + 2] = (byte)(b / n); o.Pixels[o4 + 3] = (byte)(a / n);
                }
            }
            return o;
        }

        /// <summary>Scaled down to at most maxWidth, keeping the aspect.</summary>
        public RgbaImage FitWidth(int maxWidth)
        {
            if (Width <= maxWidth) return Clone();
            return Downscale(maxWidth, Math.Max(1, (int)Math.Round(Height * (double)maxWidth / Width)));
        }

        /// <summary>Mean absolute difference per channel (0..255) against an image of any size.</summary>
        public double Difference(RgbaImage other, int w = 32, int h = 18)
        {
            var a = Downscale(w, h);
            var b = other.Downscale(w, h);
            long sum = 0;
            for (var i = 0; i < a.Pixels.Length; i += 4)
                sum += Math.Abs(a.Pixels[i] - b.Pixels[i]) + Math.Abs(a.Pixels[i + 1] - b.Pixels[i + 1]) + Math.Abs(a.Pixels[i + 2] - b.Pixels[i + 2]);
            return sum / (double)(w * h * 3);
        }

        /// <summary>
        /// True when <paramref name="frame"/> matches <paramref name="reference"/> better upside
        /// down. Clip frames come off the GPU, whose row order differs by graphics API; the
        /// freeze frame is known to be upright, so one comparison settles it for the session.
        /// </summary>
        public static bool LooksFlipped(RgbaImage reference, RgbaImage frame) => Orientation(reference, frame) == true;

        /// <summary>
        /// True: upside down. False: upright. Null: the frame can't tell (a fade to black, a
        /// symmetric scene), so ask again with the next one rather than guess for the session.
        /// </summary>
        public static bool? Orientation(RgbaImage reference, RgbaImage frame)
        {
            var flipped = frame.Clone();
            flipped.FlipRows();
            var asIs = reference.Difference(frame);
            var turned = reference.Difference(flipped);
            if (Math.Abs(asIs - turned) < 4) return null;
            return turned < asIs;
        }

        // --- Marks on the frame (images.gd) ------------------------------------------------

        public static byte[] ColorFor(MarkShape m) => m.IsBox ? Blue : Orange;

        public static string ColorName(MarkShape m) => m.IsBox ? "blue" : "orange";

        /// <summary>
        /// The frame upscaled (nearest, whole factor) to at least minWidth, every mark drawn on
        /// it and numbered from 1. Marks are in frame pixels.
        /// </summary>
        public static RgbaImage Annotate(RgbaImage shot, IList<MarkShape> marks, int minWidth = 960)
        {
            var k = Math.Max(1, (int)Math.Ceiling(minWidth / (double)shot.Width));
            var img = k > 1 ? shot.ResizeNearest(shot.Width * k, shot.Height * k) : shot.Clone();
            var u = Math.Max(1.0, img.Width / 960.0);
            var t = (int)Math.Round(3 * u);
            var radius = (int)Math.Round(14 * u);
            var labelScale = (int)Math.Round(4 * u);
            for (var i = 0; i < marks.Count; i++)
            {
                var m = marks[i];
                var c = ColorFor(m);
                int ax, ay;
                if (m.IsBox)
                {
                    int rx = (int)(m.X * k), ry = (int)(m.Y * k), rw = (int)(m.W * k), rh = (int)(m.H * k);
                    img.Outline(rx - t, ry - t, rw + 2 * t, rh + 2 * t, t, Ink);
                    img.Outline(rx, ry, rw, rh, t, c);
                    ax = rx - t;
                    ay = ry - t - 7 * labelScale;
                }
                else
                {
                    int px = (int)(m.X * k + k / 2), py = (int)(m.Y * k + k / 2);
                    img.Ring(px, py, radius + 1, t + 2, Ink);
                    img.Ring(px, py, radius, t, c);
                    img.FillRect(px - 2, py - 2, 5, 5, Ink);
                    img.FillRect(px - 1, py - 1, 3, 3, c);
                    ax = px + radius;
                    ay = py - radius - 6 * labelScale;
                }
                img.Label(ax, ay, i + 1, c, labelScale);
            }
            return img;
        }

        /// <summary>Up to maxFrames frames, evenly sampled, oldest first, in a grid.</summary>
        public static RgbaImage ContactSheet(IList<RgbaImage> frames, int maxFrames = 12, int cols = 4)
        {
            if (frames == null || frames.Count == 0) return null;
            var n = Math.Min(frames.Count, maxFrames);
            var picked = new List<RgbaImage>();
            for (var i = 0; i < n; i++) picked.Add(frames[(int)Math.Round(i * (frames.Count - 1) / (double)Math.Max(n - 1, 1))]);
            int fw = picked[0].Width, fh = picked[0].Height, gap = 4;
            cols = Math.Min(cols, n);
            var rows = (int)Math.Ceiling(n / (double)cols);
            var sheet = new RgbaImage(cols * fw + gap * (cols + 1), rows * fh + gap * (rows + 1));
            sheet.Fill(Ink);
            for (var i = 0; i < n; i++)
            {
                var f = picked[i];
                if (f.Width != fw || f.Height != fh) f = f.Downscale(fw, fh);
                int x = gap + (i % cols) * (fw + gap), y = gap + (i / cols) * (fh + gap);
                sheet.Blit(f, x, y);
                sheet.Label(x + fw - 20, y + fh - 18, i + 1, White, 2);
            }
            return sheet;
        }

        void Outline(int x, int y, int w, int h, int t, byte[] c)
        {
            FillRect(x, y, w, t, c);
            FillRect(x, y + h - t, w, t, c);
            FillRect(x, y, t, h, c);
            FillRect(x + w - t, y, t, h, c);
        }

        void Ring(int cx, int cy, int radius, int t, byte[] c)
        {
            for (var y = cy - radius; y <= cy + radius; y++)
            for (var x = cx - radius; x <= cx + radius; x++)
            {
                var d = Math.Sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
                if (d <= radius && d > radius - t) SetPixel(x, y, c);
            }
        }

        /// <summary>A number on a colored tag. Digits are 3x5 cells scaled by s.</summary>
        public void Label(int x, int y, int number, byte[] bg, int s = 4)
        {
            var text = number.ToString(System.Globalization.CultureInfo.InvariantCulture);
            var pad = s;
            int w = text.Length * 4 * s - s + pad * 2, h = 5 * s + pad * 2;
            x = Math.Max(0, Math.Min(x, Math.Max(Width - w, 0)));
            y = Math.Max(0, Math.Min(y, Math.Max(Height - h, 0)));
            FillRect(x, y, w, h, bg);
            var luminance = (0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2]) / 255.0;
            var fg = luminance > 0.4 ? Ink : White;
            for (var ci = 0; ci < text.Length; ci++)
            {
                var glyph = Digits[text[ci] - '0'];
                for (var row = 0; row < 5; row++)
                for (var col = 0; col < 3; col++)
                    if (glyph[row * 3 + col] == '1')
                        FillRect(x + pad + ci * 4 * s + col * s, y + pad + row * s, s, s, fg);
            }
        }
    }
}
