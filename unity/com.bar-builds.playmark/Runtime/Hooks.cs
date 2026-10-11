using System;
using UnityEngine;

namespace BarBuilds.Playmark
{
    /// <summary>
    /// What only the Unity Editor can answer, filled in by the Editor assembly. All null in a
    /// build, where Playmark falls back to type names and Application.Quit.
    /// </summary>
    internal static class Hooks
    {
        /// <summary>The script asset of a component: "Assets/Scripts/Enemy.cs".</summary>
        public static Func<MonoBehaviour, string> ScriptPath;

        /// <summary>The prefab an object comes from: "Assets/Prefabs/Enemy.prefab".</summary>
        public static Func<GameObject, string> PrefabPath;

        /// <summary>A request (warp, smoke) the Editor entered Play Mode for, as JSON. Taking it clears it.</summary>
        public static Func<string> TakeRequest;

        /// <summary>Leaves Play Mode (the end of a warp shot or a smoke run).</summary>
        public static Action ExitPlay;

        /// <summary>Loads a scene by path in Play Mode, even one that is not in the build list.</summary>
        public static Func<string, bool> LoadSceneInPlayMode;
    }
}
