using System;
using System.Collections.Generic;
using BarBuilds.Playmark.Core;
using UnityEngine;

namespace BarBuilds.Playmark
{
    /// <summary>A clip frame read back for the overlay: the texture to show, the pixels to save.</summary>
    internal sealed class ClipFrame
    {
        public Texture2D Texture;
        public RgbaImage Image;
        public float Offset; // seconds before the freeze (negative)
    }

    /// <summary>
    /// The last few seconds of play, kept on the GPU: a ring of small RenderTextures, one
    /// Graphics.Blit per tick and no CPU copy. Frames are read back only when the overlay opens.
    /// 8 fps x 5 s at 640 px wide is 40 frames, about 37 MB of video memory.
    /// </summary>
    internal sealed class Capture : IDisposable
    {
        readonly int _max;
        readonly float _every;
        readonly int _maxWidth;
        readonly RenderTexture[] _ring;
        readonly float[] _times;
        RenderTexture _full;
        int _head, _count;
        float _next;

        /// <summary>Whether clip frames come off the GPU upside down. Settled once per session.</summary>
        static bool? _flipped;

        public Capture(int fps, float seconds, int maxWidth)
        {
            _max = fps > 0 ? Mathf.Max(1, Mathf.RoundToInt(seconds * fps)) : 0;
            _every = fps > 0 ? 1f / fps : float.MaxValue;
            _maxWidth = Mathf.Max(64, maxWidth);
            _ring = new RenderTexture[_max];
            _times = new float[_max];
        }

        public bool Enabled => _max > 0;

        public bool Due(float now) => Enabled && now >= _next;

        /// <summary>Call at the end of a frame (WaitForEndOfFrame): grabs the screen into the ring.</summary>
        public void Grab(float now)
        {
            _next = now + _every;
            int sw = Screen.width, sh = Screen.height;
            if (sw <= 0 || sh <= 0) return;
            if (_full == null || _full.width != sw || _full.height != sh)
            {
                Release(ref _full);
                _full = new RenderTexture(sw, sh, 0, RenderTextureFormat.ARGB32) { name = "Playmark screen", hideFlags = HideFlags.HideAndDontSave };
                _full.Create();
                Clear(); // old frames have another size
            }
            ScreenCapture.CaptureScreenshotIntoRenderTexture(_full);
            var w = Mathf.Min(_maxWidth, sw);
            var h = Mathf.Max(1, Mathf.RoundToInt(sh * (float)w / sw));
            var rt = _ring[_head];
            if (rt == null || rt.width != w || rt.height != h)
            {
                Release(ref _ring[_head]);
                rt = _ring[_head] = new RenderTexture(w, h, 0, RenderTextureFormat.ARGB32) { name = "Playmark clip", hideFlags = HideFlags.HideAndDontSave, filterMode = FilterMode.Bilinear };
                rt.Create();
            }
            Graphics.Blit(_full, rt);
            _times[_head] = now;
            _head = (_head + 1) % _max;
            _count = Mathf.Min(_count + 1, _max);
        }

        public void Clear() => _count = 0;

        /// <summary>
        /// Reads the ring back, oldest first, and empties it. <paramref name="freeze"/> (the
        /// upright freeze frame) settles which way up GPU frames come on this graphics API.
        /// </summary>
        public List<ClipFrame> Read(RgbaImage freeze, float now)
        {
            var frames = new List<ClipFrame>();
            var old = RenderTexture.active;
            for (var i = 0; i < _count; i++)
            {
                var slot = (_head - _count + i + _max) % _max;
                var rt = _ring[slot];
                if (rt == null) continue;
                RenderTexture.active = rt;
                var tex = new Texture2D(rt.width, rt.height, TextureFormat.RGBA32, false) { hideFlags = HideFlags.HideAndDontSave, filterMode = FilterMode.Bilinear };
                tex.ReadPixels(new Rect(0, 0, rt.width, rt.height), 0, 0);
                tex.Apply();
                frames.Add(new ClipFrame { Texture = tex, Image = RgbaImage.FromBottomUp(tex.width, tex.height, tex.GetPixelData<byte>(0).ToArray()), Offset = (float)Math.Round(_times[slot] - now, 2) });
            }
            RenderTexture.active = old;
            Clear();
            // Decided once the frames can tell; until then they are taken as upright.
            if (frames.Count > 0 && freeze != null && _flipped == null)
                _flipped = RgbaImage.Orientation(freeze, frames[frames.Count - 1].Image);
            if (_flipped == true)
                foreach (var f in frames) f.Image.FlipRows();
            return frames;
        }

        /// <summary>True when clip textures must be drawn upside down to look right.</summary>
        public static bool TexturesFlipped => _flipped == true;

        /// <summary>
        /// The frame on screen now, upright. Call at the end of a frame. Reads the back buffer with
        /// ReadPixels: ScreenCapture.CaptureScreenshotAsTexture comes out too bright in Linear
        /// color projects (a known Won't Fix), and ReadPixels from the screen has a fixed row order.
        /// </summary>
        public static (Texture2D texture, RgbaImage image) Freeze()
        {
            int w = Screen.width, h = Screen.height;
            if (w <= 0 || h <= 0) return (null, null);
            var old = RenderTexture.active;
            RenderTexture.active = null;
            var tex = new Texture2D(w, h, TextureFormat.RGBA32, false) { hideFlags = HideFlags.HideAndDontSave };
            tex.ReadPixels(new Rect(0, 0, w, h), 0, 0, false);
            tex.Apply();
            RenderTexture.active = old;
            return (tex, RgbaImage.FromBottomUp(w, h, tex.GetPixelData<byte>(0).ToArray()));
        }

        public void Dispose()
        {
            Release(ref _full);
            for (var i = 0; i < _ring.Length; i++) Release(ref _ring[i]);
        }

        static void Release(ref RenderTexture rt)
        {
            if (rt == null) return;
            rt.Release();
            UnityEngine.Object.Destroy(rt);
            rt = null;
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => _flipped = null;
    }
}
