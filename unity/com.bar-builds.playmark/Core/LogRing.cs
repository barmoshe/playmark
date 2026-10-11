using System;
using System.Collections.Generic;
using System.Text;

namespace BarBuilds.Playmark.Core
{
    /// <summary>
    /// The last N log lines, fed from any thread (Unity's threaded log callback), plus the
    /// first error of each kind for automatic bug marks.
    /// </summary>
    public sealed class LogRing
    {
        readonly object _lock = new object();
        readonly Queue<string> _lines = new Queue<string>();
        readonly Queue<string> _errors = new Queue<string>();
        readonly HashSet<string> _seenErrors = new HashSet<string>();
        readonly int _max;

        public LogRing(int maxLines) { _max = Math.Max(1, maxLines); }

        /// <param name="level">Log, Warning, Error, Assert, Exception (Unity's LogType names).</param>
        public void Add(string level, string message, string stack)
        {
            message ??= "";
            var head = level == "Log" ? message : level.ToUpperInvariant() + ": " + message;
            lock (_lock)
            {
                foreach (var line in head.Split('\n')) Push(line.TrimEnd('\r'));
                if (level != "Log" && level != "Warning" && !string.IsNullOrEmpty(stack))
                    foreach (var line in stack.TrimEnd().Split('\n')) Push("    " + line.TrimEnd('\r'));
                if ((level == "Error" || level == "Exception" || level == "Assert") && !message.StartsWith("Playmark", StringComparison.Ordinal))
                {
                    var first = FirstLine(message);
                    if (_seenErrors.Add(first)) _errors.Enqueue(first);
                }
            }
        }

        void Push(string line)
        {
            _lines.Enqueue(line);
            while (_lines.Count > _max) _lines.Dequeue();
        }

        /// <summary>The next error not handed out yet, or null.</summary>
        public string TakeError()
        {
            lock (_lock) return _errors.Count > 0 ? _errors.Dequeue() : null;
        }

        public string Dump()
        {
            lock (_lock)
            {
                var sb = new StringBuilder();
                foreach (var l in _lines) sb.Append(l).Append('\n');
                return sb.ToString().TrimEnd('\n');
            }
        }

        static string FirstLine(string s)
        {
            var i = s.IndexOf('\n');
            var line = i < 0 ? s : s.Substring(0, i);
            return line.Length > 200 ? line.Substring(0, 200) : line;
        }
    }
}
