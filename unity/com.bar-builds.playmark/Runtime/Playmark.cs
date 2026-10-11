using System;
using System.Collections.Generic;
using UnityEngine;

namespace BarBuilds.Playmark
{
    /// <summary>
    /// Playmark: press Ctrl+Shift+M while playing, pin or box what you see, write a note. The
    /// mark lands in .playmark/inbox for Claude Code. Past marks come back as ghosts in the
    /// world, and when Claude fixes one, a toast says so.
    ///
    /// Nothing to set up: it starts with Play Mode (and Development Builds). Everything here is
    /// optional and safe to call when Playmark is off.
    /// </summary>
    public static class Playmark
    {
        public const string Version = "0.4.0";

        /// <summary>The overlay opened (the game is frozen).</summary>
        public static event Action Opened;

        /// <summary>The overlay closed (the game runs again).</summary>
        public static event Action Closed;

        /// <summary>A mark was saved; the argument is its folder.</summary>
        public static event Action<string> Saved;

        /// <summary>True while Playmark runs (the Editor and Development Builds, by default).</summary>
        public static bool IsEnabled => PlaymarkHost.Instance != null;

        /// <summary>True while the overlay is open. Games on the old Input Manager can skip input then.</summary>
        public static bool IsOpen => PlaymarkHost.Instance != null && PlaymarkHost.Instance.IsOpen;

        internal static readonly Dictionary<string, Func<object>> Contexts = new Dictionary<string, Func<object>>();
        internal static Transform Player;
        internal static Func<string> Scope;
        internal static Func<object> WarpSave;
        internal static Action<IDictionary<string, object>> WarpLoad;

        /// <summary>State saved with every mark: Playmark.AddContext("player", () => new { hp, wand });</summary>
        public static void AddContext(string key, Func<object> provider) => Contexts[key] = provider;

        public static void RemoveContext(string key) => Contexts.Remove(key);

        /// <summary>Ghosts open their note when the player walks up to them (the mouse otherwise).</summary>
        public static void SetPlayer(Transform player) => Player = player;

        /// <summary>Many rooms in one scene: keep each ghost in its room. () => "room/" + roomId</summary>
        public static void SetScope(Func<string> scope) => Scope = scope;

        /// <summary>
        /// Warp: what to save with a mark, and how to put the game back there.
        /// save() returns anything JSON can hold; load gets it back as dictionaries, lists,
        /// strings, doubles, longs and bools. An "args" list in it is passed to a build's command line.
        /// </summary>
        public static void SetWarp(Func<object> save, Action<IDictionary<string, object>> load)
        {
            WarpSave = save;
            WarpLoad = load;
        }

        /// <summary>Opens the overlay, from a debug button for example.</summary>
        public static void Open() => PlaymarkHost.Instance?.Open();

        internal static void RaiseOpened() => Opened?.Invoke();
        internal static void RaiseClosed() => Closed?.Invoke();
        internal static void RaiseSaved(string folder) => Saved?.Invoke(folder);

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics()
        {
            // Play Mode without a domain reload keeps statics: start each session clean.
            Contexts.Clear();
            Player = null;
            Scope = null;
            WarpSave = null;
            WarpLoad = null;
            Opened = null;
            Closed = null;
            Saved = null;
        }
    }

    /// <summary>Any MonoBehaviour with this adds its state to every mark, under its GameObject's name.</summary>
    public interface IPlaymarkContext
    {
        object PlaymarkContext();
    }
}
