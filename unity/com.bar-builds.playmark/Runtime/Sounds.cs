using System.Collections.Generic;
using System.Threading.Tasks;
using BarBuilds.Playmark.Core;
using UnityEngine;

namespace BarBuilds.Playmark
{
    /// <summary>
    /// The UI sounds from Core.Synth, played through AudioSources that ignore AudioListener.pause,
    /// so they play while the game is frozen. Synthesized on a worker: a sound asked for before
    /// it is ready just doesn't play.
    /// </summary>
    internal sealed class Sounds
    {
        readonly Dictionary<string, AudioSource> _sources = new Dictionary<string, AudioSource>();
        readonly System.Random _pitch = new System.Random();
        Task<Dictionary<string, float[]>> _task;
        readonly GameObject _host;

        public Sounds(GameObject host)
        {
            _host = host;
            // After a script reload in Play Mode the old sources are still on the object.
            foreach (var old in host.GetComponents<AudioSource>()) Object.Destroy(old);
            _task = Task.Run(() => new Synth().All());
        }

        /// <summary>Call every frame until it returns true: turns the synthesized samples into clips.</summary>
        public void Install()
        {
            if (_task == null || !_task.IsCompleted) return;
            if (_task.Status == TaskStatus.RanToCompletion)
            {
                foreach (var kv in _task.Result)
                {
                    var clip = AudioClip.Create("Playmark " + kv.Key, kv.Value.Length, 1, Synth.Rate, false);
                    clip.SetData(kv.Value, 0);
                    var src = _host.AddComponent<AudioSource>();
                    src.clip = clip;
                    src.playOnAwake = false;
                    src.ignoreListenerPause = true;
                    src.spatialBlend = 0;
                    src.volume = 0.4f; // -8 dB, as in the Godot addon
                    _sources[kv.Key] = src;
                }
            }
            _task = null;
        }

        public void Play(string name, float pitch = 1f)
        {
            if (!_sources.TryGetValue(name, out var src)) return;
            src.pitch = pitch;
            if (name.StartsWith("key")) src.PlayOneShot(src.clip); // fast typing overlaps
            else src.Play();
        }

        /// <summary>One key press: a slightly different pitch each time, so fast typing doesn't machine-gun.</summary>
        public void Key(bool deleting)
        {
            Play(deleting ? "key_back" : "key", 0.9f + (float)_pitch.NextDouble() * 0.22f);
        }
    }
}
