using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Reflection;
using System.Text;

namespace BarBuilds.Playmark.Core
{
    /// <summary>
    /// The JSON Playmark reads and writes. Unity's JsonUtility can't do dictionaries or anonymous
    /// objects, and a dependency is one more thing to install, so this is small and ours.
    /// Parsed values: Dictionary&lt;string, object&gt;, List&lt;object&gt;, string, double, long, bool, null.
    /// </summary>
    public static class Json
    {
        // --- Plain values ------------------------------------------------------------------

        /// <summary>
        /// Anything to JSON-safe values (dictionaries, lists, strings, numbers, bools, null).
        /// Floats round to 0.01, like the Godot addon. Objects become their public fields and
        /// properties. <paramref name="custom"/> converts engine types first (vectors, colors);
        /// it returns null to pass.
        /// </summary>
        public static object Plain(object value, Func<object, object> custom = null, int depth = 0)
        {
            if (value == null) return null;
            if (depth > 6) return value.ToString();
            if (custom != null && !(value is string) && !value.GetType().IsPrimitive)
            {
                var c = custom(value);
                if (c != null) return Plain(c, null, depth + 1);
            }
            switch (value)
            {
                case string s: return s;
                case bool b: return b;
                case float f: return Round(f);
                case double d: return Round(d);
                case decimal m: return Round((double)m);
                case Enum e: return e.ToString();
                case char ch: return ch.ToString();
                case IDictionary dict:
                {
                    var o = new Dictionary<string, object>();
                    foreach (DictionaryEntry kv in dict) o[Convert.ToString(kv.Key, CultureInfo.InvariantCulture)] = Plain(kv.Value, custom, depth + 1);
                    return o;
                }
                case IEnumerable list:
                {
                    var o = new List<object>();
                    foreach (var item in list) o.Add(Plain(item, custom, depth + 1));
                    return o;
                }
            }
            var type = value.GetType();
            if (type.IsPrimitive) return Convert.ToInt64(value, CultureInfo.InvariantCulture);
            var fields = new Dictionary<string, object>();
            foreach (var f in type.GetFields(BindingFlags.Public | BindingFlags.Instance))
                fields[f.Name] = Plain(f.GetValue(value), custom, depth + 1);
            foreach (var p in type.GetProperties(BindingFlags.Public | BindingFlags.Instance))
            {
                if (p.GetIndexParameters().Length > 0 || !p.CanRead) continue;
                try { fields[p.Name] = Plain(p.GetValue(value), custom, depth + 1); }
                catch (Exception) { /* a property that throws is left out */ }
            }
            return fields.Count > 0 ? fields : (object)value.ToString();
        }

        public static double Round(double v, double step = 0.01)
        {
            if (double.IsNaN(v) || double.IsInfinity(v)) return 0;
            return Math.Round(v / step) * step;
        }

        // --- Writing -----------------------------------------------------------------------

        /// <summary>Two-space indented, like the Godot addon writes mark.json.</summary>
        public static string Write(object value, bool pretty = true)
        {
            var sb = new StringBuilder();
            WriteValue(sb, value, pretty, 0);
            return sb.ToString();
        }

        static void WriteValue(StringBuilder sb, object v, bool pretty, int indent)
        {
            switch (v)
            {
                case null: sb.Append("null"); return;
                case string s: WriteString(sb, s); return;
                case bool b: sb.Append(b ? "true" : "false"); return;
                case double d: WriteNumber(sb, d); return;
                case float f: WriteNumber(sb, f); return;
                case int or long or short or byte or uint or ulong or ushort or sbyte:
                    sb.Append(Convert.ToString(v, CultureInfo.InvariantCulture)); return;
                case IDictionary<string, object> dict:
                {
                    if (dict.Count == 0) { sb.Append("{}"); return; }
                    sb.Append('{');
                    var first = true;
                    foreach (var kv in dict)
                    {
                        if (!first) sb.Append(',');
                        first = false;
                        NewLine(sb, pretty, indent + 1);
                        WriteString(sb, kv.Key);
                        sb.Append(pretty ? ": " : ":");
                        WriteValue(sb, kv.Value, pretty, indent + 1);
                    }
                    NewLine(sb, pretty, indent);
                    sb.Append('}');
                    return;
                }
                case IEnumerable list:
                {
                    var items = new List<object>();
                    foreach (var item in list) items.Add(item);
                    if (items.Count == 0) { sb.Append("[]"); return; }
                    // Short lists of numbers stay on one line ([x, y] reads better than 4 lines).
                    var inline = items.Count <= 4 && items.TrueForAll(i => i is double || i is float || i is int || i is long);
                    sb.Append('[');
                    for (var i = 0; i < items.Count; i++)
                    {
                        if (i > 0) sb.Append(inline && pretty ? ", " : ",");
                        if (!inline) NewLine(sb, pretty, indent + 1);
                        WriteValue(sb, items[i], pretty, indent + 1);
                    }
                    if (!inline) NewLine(sb, pretty, indent);
                    sb.Append(']');
                    return;
                }
                default:
                    WriteValue(sb, Plain(v), pretty, indent);
                    return;
            }
        }

        static void NewLine(StringBuilder sb, bool pretty, int indent)
        {
            if (!pretty) return;
            sb.Append('\n');
            sb.Append(' ', indent * 2);
        }

        static void WriteNumber(StringBuilder sb, double d)
        {
            if (double.IsNaN(d) || double.IsInfinity(d)) { sb.Append("null"); return; }
            if (Math.Abs(d - Math.Round(d)) < 1e-9 && Math.Abs(d) < 1e15) { sb.Append(((long)Math.Round(d)).ToString(CultureInfo.InvariantCulture)); return; }
            sb.Append(d.ToString("0.0##############", CultureInfo.InvariantCulture));
        }

        static void WriteString(StringBuilder sb, string s)
        {
            sb.Append('"');
            foreach (var c in s)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
        }

        // --- Reading -----------------------------------------------------------------------

        /// <summary>Parses JSON text. Throws FormatException on bad input.</summary>
        public static object Parse(string text)
        {
            var p = new Parser(text);
            var v = p.Value();
            p.SkipSpace();
            if (!p.AtEnd) throw new FormatException("Trailing characters at " + p.Pos);
            return v;
        }

        /// <summary>Parses, or returns null on bad input.</summary>
        public static Dictionary<string, object> TryParseObject(string text)
        {
            try { return Parse(text) as Dictionary<string, object>; }
            catch (FormatException) { return null; }
        }

        sealed class Parser
        {
            readonly string _s;
            int _i;
            public Parser(string s) { _s = s ?? ""; }
            public int Pos => _i;
            public bool AtEnd => _i >= _s.Length;

            public void SkipSpace()
            {
                while (_i < _s.Length && char.IsWhiteSpace(_s[_i])) _i++;
            }

            public object Value()
            {
                SkipSpace();
                if (AtEnd) throw new FormatException("Unexpected end");
                var c = _s[_i];
                switch (c)
                {
                    case '{': return Obj();
                    case '[': return Arr();
                    case '"': return Str();
                    case 't': Expect("true"); return true;
                    case 'f': Expect("false"); return false;
                    case 'n': Expect("null"); return null;
                    default: return Num();
                }
            }

            void Expect(string word)
            {
                if (string.CompareOrdinal(_s, _i, word, 0, word.Length) != 0) throw new FormatException("Expected " + word + " at " + _i);
                _i += word.Length;
            }

            Dictionary<string, object> Obj()
            {
                var o = new Dictionary<string, object>();
                _i++;
                SkipSpace();
                if (_i < _s.Length && _s[_i] == '}') { _i++; return o; }
                while (true)
                {
                    SkipSpace();
                    if (AtEnd || _s[_i] != '"') throw new FormatException("Expected a key at " + _i);
                    var key = Str();
                    SkipSpace();
                    if (AtEnd || _s[_i] != ':') throw new FormatException("Expected : at " + _i);
                    _i++;
                    o[key] = Value();
                    SkipSpace();
                    if (AtEnd) throw new FormatException("Unclosed object");
                    if (_s[_i] == ',') { _i++; continue; }
                    if (_s[_i] == '}') { _i++; return o; }
                    throw new FormatException("Expected , or } at " + _i);
                }
            }

            List<object> Arr()
            {
                var a = new List<object>();
                _i++;
                SkipSpace();
                if (_i < _s.Length && _s[_i] == ']') { _i++; return a; }
                while (true)
                {
                    a.Add(Value());
                    SkipSpace();
                    if (AtEnd) throw new FormatException("Unclosed array");
                    if (_s[_i] == ',') { _i++; continue; }
                    if (_s[_i] == ']') { _i++; return a; }
                    throw new FormatException("Expected , or ] at " + _i);
                }
            }

            string Str()
            {
                var sb = new StringBuilder();
                _i++;
                while (true)
                {
                    if (AtEnd) throw new FormatException("Unclosed string");
                    var c = _s[_i++];
                    if (c == '"') return sb.ToString();
                    if (c != '\\') { sb.Append(c); continue; }
                    if (AtEnd) throw new FormatException("Bad escape");
                    var e = _s[_i++];
                    switch (e)
                    {
                        case '"': sb.Append('"'); break;
                        case '\\': sb.Append('\\'); break;
                        case '/': sb.Append('/'); break;
                        case 'b': sb.Append('\b'); break;
                        case 'f': sb.Append('\f'); break;
                        case 'n': sb.Append('\n'); break;
                        case 'r': sb.Append('\r'); break;
                        case 't': sb.Append('\t'); break;
                        case 'u':
                            if (_i + 4 > _s.Length) throw new FormatException("Bad \\u escape");
                            sb.Append((char)int.Parse(_s.Substring(_i, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture));
                            _i += 4;
                            break;
                        default: throw new FormatException("Bad escape \\" + e);
                    }
                }
            }

            object Num()
            {
                var start = _i;
                while (_i < _s.Length && "+-0123456789.eE".IndexOf(_s[_i]) >= 0) _i++;
                var t = _s.Substring(start, _i - start);
                if (t.Length == 0) throw new FormatException("Unexpected character at " + start);
                if (t.IndexOfAny(new[] { '.', 'e', 'E' }) < 0 && long.TryParse(t, NumberStyles.Integer, CultureInfo.InvariantCulture, out var l)) return l;
                if (double.TryParse(t, NumberStyles.Float, CultureInfo.InvariantCulture, out var d)) return d;
                throw new FormatException("Bad number " + t);
            }
        }

        // --- Reading helpers ---------------------------------------------------------------

        public static string Str(IDictionary<string, object> d, string key, string fallback = "")
        {
            return d != null && d.TryGetValue(key, out var v) && v != null ? Convert.ToString(v, CultureInfo.InvariantCulture) : fallback;
        }

        public static long Long(IDictionary<string, object> d, string key, long fallback = 0)
        {
            if (d == null || !d.TryGetValue(key, out var v) || v == null) return fallback;
            return v switch
            {
                long l => l,
                double x => (long)x,
                string s when long.TryParse(s, out var p) => p,
                _ => fallback,
            };
        }

        public static double Double(object v, double fallback = 0)
        {
            return v switch
            {
                long l => l,
                double d => d,
                int i => i,
                float f => f,
                _ => fallback,
            };
        }

        public static Dictionary<string, object> Obj(IDictionary<string, object> d, string key)
        {
            return d != null && d.TryGetValue(key, out var v) ? v as Dictionary<string, object> : null;
        }

        public static List<object> List(IDictionary<string, object> d, string key)
        {
            return d != null && d.TryGetValue(key, out var v) ? v as List<object> : null;
        }
    }
}
