using UnityEngine;

namespace BarBuilds.Playmark
{
    /// <summary>
    /// Playmark's settings: Project Settings, Playmark. Stored as
    /// Assets/Resources/PlaymarkSettings.asset once you change one; the defaults apply until then.
    /// Same keys and defaults as the Godot addon's playmark/* settings.
    /// </summary>
    public sealed class PlaymarkSettings : ScriptableObject
    {
        public const string ResourceName = "PlaymarkSettings";

        [Tooltip("Turn Playmark off without removing the package.")]
        public bool enabled = true;

        [Tooltip("Opens the overlay. Modifiers: Ctrl, Shift, Alt, Cmd.")]
        public string shortcut = "Ctrl+Shift+M";

        [Tooltip("Also run in release builds. Off: Playmark runs in the Editor and in Development Builds only.")]
        public bool releaseBuilds;

        [Header("Capture")]
        public float clipSeconds = 5f;

        [Tooltip("Frames per second kept for the clip. 0 turns the clip off.")]
        public int clipFps = 8;

        [Tooltip("Clip frames are scaled down to this width.")]
        public int clipMaxWidth = 640;

        [Tooltip("The first error of each kind becomes a bug mark by itself (3 per session at most).")]
        public bool autoOnError = true;

        public int logLines = 200;

        [Header("Ghosts")]
        public bool ghostsVisible = true;
        public string ghostsShortcut = "Ctrl+Shift+G";

        [Tooltip("Fixed marks stay visible this long, so you can retest them. -1: forever.")]
        public float ghostsFixedHours = 72f;

        [Header("Output")]
        [Tooltip("Where marks are saved in the Editor, relative to the project folder. Builds use Application.persistentDataPath/playmark.")]
        public string outputDir = ".playmark";

        static PlaymarkSettings _current;

        public static PlaymarkSettings Current
        {
            get
            {
                if (_current == null) _current = Resources.Load<PlaymarkSettings>(ResourceName);
                if (_current == null) _current = CreateInstance<PlaymarkSettings>();
                return _current;
            }
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void ResetStatics() => _current = null;
    }
}
