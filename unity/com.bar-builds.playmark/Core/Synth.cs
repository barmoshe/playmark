using System;
using System.Collections.Generic;

namespace BarBuilds.Playmark.Core
{
    /// <summary>
    /// Playmark's small UI sounds, synthesized: no audio files to ship. A port of the Godot
    /// addon's sfx.gd, sound for sound: shutter (open), pop (pin), tick (box), chip (category),
    /// stamp (save), swish (cancel), fixed (a mark came back fixed), key and key_back (typing).
    /// Its own seeded random, so the sounds are the same every run.
    /// </summary>
    public sealed class Synth
    {
        public const int Rate = 44100;
        const double Tau = Math.PI * 2;
        readonly Random _rng = new Random(7);

        /// <summary>Typing sits under everything else.</summary>
        public static float PeakOf(string name) => name == "key" ? 0.32f : name == "key_back" ? 0.28f : 0.7f;

        /// <summary>Every sound, peak-normalised. About 0.2 s of maths: run it off the main thread.</summary>
        public Dictionary<string, float[]> All()
        {
            var raw = new Dictionary<string, float[]>
            {
                ["shutter"] = Shutter(), ["pop"] = Pop(), ["tick"] = Tick(), ["chip"] = Chip(),
                ["stamp"] = Stamp(), ["swish"] = Swish(), ["fixed"] = Fixed(),
                ["key"] = Key(2400), ["key_back"] = Key(1500),
            };
            var output = new Dictionary<string, float[]>();
            foreach (var kv in raw) output[kv.Key] = Normalize(kv.Value, PeakOf(kv.Key));
            return output;
        }

        static float[] Normalize(float[] s, float peak)
        {
            var top = 0f;
            foreach (var x in s) top = Math.Max(top, Math.Abs(x));
            var g = top > 0 ? peak / top : 1f;
            for (var i = 0; i < s.Length; i++) s[i] = Math.Max(-1f, Math.Min(1f, s[i] * g));
            FadeEnd(s, 0.004);
            return s;
        }

        // --- The sounds --------------------------------------------------------------------

        float[] Shutter()
        {
            // A camera shutter: a bright blade click, a lower second click as it closes, a little body.
            var o = Buf(0.16);
            Mix(o, NoiseBand(0.03, 4200, 1.6, 160), 0, 0.9);
            Mix(o, Tone(240, 0, 0.05, 70, 0.001), 0, 0.35);
            Mix(o, NoiseBand(0.04, 2600, 1.4, 130), 0.058, 0.6);
            Mix(o, Tone(180, 0, 0.05, 80, 0.001), 0.058, 0.25);
            return o;
        }

        float[] Pop()
        {
            // A soft marimba-like pluck: the pitch drops into the note, a woody overtone dies first.
            var o = Buf(0.24);
            Mix(o, Tone(740, 0.5, 0.24, 22, 0.002, 140), 0, 1.0);
            Mix(o, Tone(740 * 3.93, 0, 0.06, 90, 0.001), 0, 0.18);
            Mix(o, NoiseBand(0.008, 5200, 2.0, 600), 0, 0.25);
            return o;
        }

        float[] Tick()
        {
            // A dry wooden tick.
            var o = Buf(0.06);
            Mix(o, Tone(1650, 0.15, 0.06, 95, 0.0005, 300), 0, 0.8);
            Mix(o, NoiseBand(0.015, 3000, 2.5, 320), 0, 0.5);
            return o;
        }

        float[] Chip()
        {
            // A small glassy tap: a two-operator bell whose brightness falls fast.
            var o = Buf(0.12);
            const double fc = 1480;
            for (var i = 0; i < o.Length; i++)
            {
                var t = (double)i / Rate;
                var index = 2.2 * Math.Exp(-t * 60);
                var env = Math.Min(1, t / 0.0008) * Math.Exp(-t * 34);
                o[i] = (float)(Math.Sin(Tau * fc * t + index * Math.Sin(Tau * fc * 2 * t)) * env);
            }
            return o;
        }

        float[] Stamp()
        {
            // A rubber stamp: a felt thump, the slap of the paper, a short room behind it.
            var o = Buf(0.42);
            Mix(o, Tone(70, 1.2, 0.3, 13, 0.002, 45), 0, 1.0);
            Mix(o, Tone(150, 0.6, 0.12, 30, 0.001, 60), 0, 0.35);
            Mix(o, NoiseBand(0.08, 1300, 0.9, 55), 0, 0.55);
            Mix(o, NoiseBand(0.02, 3600, 1.5, 200), 0.004, 0.25);
            return Room(o, 0.18);
        }

        float[] Swish()
        {
            // Air going away: band-passed noise sweeping down, swelling and fading.
            var o = Buf(0.2);
            double low = 0, band = 0;
            for (var i = 0; i < o.Length; i++)
            {
                var u = (double)i / o.Length;
                var k = 2 * Math.Sin(Math.PI * Lerp(3200, 520, u * u) / Rate);
                var high = Noise() - low - 0.4 * band;
                band += k * high;
                low += k * band;
                o[i] = (float)(band * Math.Pow(Math.Sin(u * Math.PI), 1.6));
            }
            return o;
        }

        float[] Key(double click)
        {
            // A soft keyboard key: the click of the switch, the keycap bottoming out under it.
            var o = Buf(0.05);
            Mix(o, NoiseBand(0.02, click * 1.6, 1.3, 280), 0, 0.8);
            Mix(o, Tone(click, 0.1, 0.02, 200, 0.0003, 500), 0, 0.25);
            Mix(o, Tone(330, 0.25, 0.04, 110, 0.0008, 200), 0.004, 0.4);
            return o;
        }

        float[] Fixed()
        {
            // A rising bell arpeggio (G5 C6 E6 G6), each note ringing into the next, in a small room.
            double[] notes = { 783.99, 1046.5, 1318.5, 1567.98 };
            const double step = 0.075;
            var o = Buf(step * (notes.Length - 1) + 2.0);
            for (var i = 0; i < notes.Length; i++)
            {
                var last = i == notes.Length - 1;
                Mix(o, Bell(notes[i], last ? 1.0 : 0.7), step * i, last ? 1.0 : 0.75);
            }
            return Room(o, 0.22);
        }

        // --- Building blocks ---------------------------------------------------------------

        static double Lerp(double a, double b, double t) => a + (b - a) * t;

        double Noise() => _rng.NextDouble() * 2 - 1;

        static float[] Buf(double dur) => new float[(int)(dur * Rate)];

        /// <summary>A raised-cosine fade over the last secs, so nothing ends on a click.</summary>
        static void FadeEnd(float[] buf, double secs)
        {
            var n = Math.Min((int)(secs * Rate), buf.Length);
            for (var i = 0; i < n; i++) buf[buf.Length - n + i] *= (float)(0.5 + 0.5 * Math.Cos(Math.PI * i / n));
        }

        /// <summary>Adds src into dst at `at` seconds, scaled by gain.</summary>
        static void Mix(float[] dst, float[] src, double at, double gain)
        {
            var o = (int)(at * Rate);
            for (var i = 0; i < Math.Min(src.Length, dst.Length - o); i++) dst[o + i] += (float)(src[i] * gain);
        }

        /// <summary>
        /// A sine at f that starts `bend` higher and falls to f at bendRate per second, with an
        /// attack of `attack` s and an exponential decay of `decay` per second.
        /// </summary>
        static float[] Tone(double f, double bend, double dur, double decay, double attack, double bendRate = 60)
        {
            var o = Buf(dur);
            double phase = 0;
            for (var i = 0; i < o.Length; i++)
            {
                var t = (double)i / Rate;
                phase += Tau * f * (1 + bend * Math.Exp(-t * bendRate)) / Rate;
                o[i] = (float)(Math.Sin(phase) * Math.Min(1, t / attack) * Math.Exp(-t * decay));
            }
            FadeEnd(o, dur * 0.15);
            return o;
        }

        /// <summary>White noise through a band-pass (state-variable filter), decaying per second.</summary>
        float[] NoiseBand(double dur, double f, double q, double decay)
        {
            var o = Buf(dur);
            var k = 2 * Math.Sin(Math.PI * Math.Min(f, Rate / 6.0) / Rate);
            double low = 0, band = 0;
            for (var i = 0; i < o.Length; i++)
            {
                var t = (double)i / Rate;
                var high = Noise() - low - q * band;
                band += k * high;
                low += k * band;
                o[i] = (float)(band * Math.Min(1, t / 0.0004) * Math.Exp(-t * decay));
            }
            return o;
        }

        /// <summary>A struck bell: inharmonic partials, the high ones dying first.</summary>
        static float[] Bell(double f, double length)
        {
            double[,] partials = { { 1.0, 1.0, 3.2 }, { 2.0, 0.32, 5.5 }, { 3.01, 0.12, 8.0 }, { 4.17, 0.07, 12.0 }, { 5.43, 0.03, 16.0 } };
            var o = Buf(2 * length);
            for (var p = 0; p < partials.GetLength(0); p++)
            {
                var w = Tau * f * partials[p, 0] / Rate;
                var amp = partials[p, 1];
                var decay = partials[p, 2] / length;
                for (var i = 0; i < o.Length; i++)
                {
                    var t = (double)i / Rate;
                    o[i] += (float)(Math.Sin(w * i) * amp * Math.Min(1, t / 0.002) * Math.Exp(-t * decay));
                }
            }
            FadeEnd(o, 0.5 * length);
            return o;
        }

        /// <summary>A small room: four damped combs into two all-passes (Schroeder), mixed in at wet.</summary>
        static float[] Room(float[] dry, double wet)
        {
            var n = dry.Length + (int)(0.35 * Rate);
            var acc = new double[n];
            foreach (var d in new[] { 1116, 1188, 1277, 1356 })
            {
                var line = new double[d];
                var pos = 0;
                double lp = 0;
                for (var i = 0; i < n; i++)
                {
                    var y = line[pos];
                    lp = Lerp(y, lp, 0.3);
                    line[pos] = (i < dry.Length ? dry[i] : 0) + lp * 0.72;
                    pos = (pos + 1) % d;
                    acc[i] += y * 0.25;
                }
            }
            foreach (var d in new[] { 556, 441 })
            {
                var line = new double[d];
                var pos = 0;
                for (var i = 0; i < n; i++)
                {
                    var b = line[pos];
                    var x = acc[i];
                    line[pos] = x + b * 0.5;
                    acc[i] = b - x * 0.5;
                    pos = (pos + 1) % d;
                }
            }
            var o = new float[n];
            for (var i = 0; i < n; i++) o[i] = (float)((i < dry.Length ? dry[i] : 0) + acc[i] * wet);
            return o;
        }
    }
}
