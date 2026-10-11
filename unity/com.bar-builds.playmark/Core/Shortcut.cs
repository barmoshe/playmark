using System;
using System.Text;

namespace BarBuilds.Playmark.Core
{
    /// <summary>A key combo written as text: "Ctrl+Shift+M". Modifiers: Ctrl, Shift, Alt, Cmd.</summary>
    public sealed class Shortcut
    {
        public bool Ctrl, Shift, Alt, Cmd;
        /// <summary>The key without modifiers, as written ("M", "F8", "Backquote").</summary>
        public string Key = "";
        public string Text = "";

        public bool IsValid => Key.Length > 0;

        public static Shortcut Parse(string text)
        {
            var s = new Shortcut { Text = text ?? "" };
            foreach (var raw in s.Text.Split(new[] { '+' }, StringSplitOptions.RemoveEmptyEntries))
            {
                var part = raw.Trim();
                switch (part.ToLowerInvariant())
                {
                    case "ctrl": case "control": s.Ctrl = true; break;
                    case "shift": s.Shift = true; break;
                    case "alt": case "option": s.Alt = true; break;
                    case "cmd": case "command": case "meta": case "super": s.Cmd = true; break;
                    default: s.Key = part.Length == 1 ? part.ToUpperInvariant() : char.ToUpperInvariant(part[0]) + part.Substring(1); break;
                }
            }
            return s;
        }

        /// <summary>"⌃⇧M" on macOS, "Ctrl+Shift+M" elsewhere.</summary>
        public string Display(bool mac)
        {
            if (!mac) return Text;
            var sb = new StringBuilder();
            if (Ctrl) sb.Append('⌃');
            if (Alt) sb.Append('⌥');
            if (Shift) sb.Append('⇧');
            if (Cmd) sb.Append('⌘');
            sb.Append(Key.ToUpperInvariant());
            return sb.ToString();
        }
    }
}
