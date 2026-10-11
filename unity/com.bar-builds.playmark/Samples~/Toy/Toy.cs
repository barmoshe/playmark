using System.Collections.Generic;
using BarBuilds.Playmark;
using UnityEngine;

/// <summary>
/// A toy scene to try Playmark on: four shapes in a row, each built from one line of
/// ToyLooks. Press Play, then Ctrl+Shift+M, pin a shape and write what should change
/// ("Boxy should be orange"). Claude Code edits ToyLooks.cs; stop and play again to see it.
/// </summary>
public sealed class Toy : MonoBehaviour
{
    readonly List<ToyShape> _shapes = new List<ToyShape>();

    void Start()
    {
        var looks = ToyLooks.Shapes;
        for (var i = 0; i < looks.Length; i++)
        {
            var (shapeName, kind, color, motion) = looks[i];
            var go = new GameObject(shapeName);
            go.transform.SetParent(transform, false);
            go.transform.localPosition = new Vector3((i - (looks.Length - 1) / 2f) * 2.6f, 0, 0);
            var shape = go.AddComponent<ToyShape>();
            shape.Setup(kind, ColorUtility.TryParseHtmlString(color, out var c) ? c : Color.white, motion, i * 1.3f);
            _shapes.Add(shape);
        }
        // State that rides along with every mark: what each shape is right now.
        Playmark.AddContext("toy", () =>
        {
            var d = new Dictionary<string, object>();
            foreach (var s in _shapes) d[s.name] = new { s.Kind, s.Motion, color = s.Color };
            return d;
        });
    }
}

/// <summary>One shape: a sprite drawn in code, moving in place.</summary>
public sealed class ToyShape : MonoBehaviour
{
    public string Kind { get; private set; }
    public string Motion { get; private set; }
    public Color Color { get; private set; }

    Transform _body;
    float _phase;

    public void Setup(string kind, Color color, string motion, float phase)
    {
        Kind = kind;
        Color = color;
        Motion = motion;
        _phase = phase;
        _body = new GameObject("Body").transform;
        _body.SetParent(transform, false);
        var sr = _body.gameObject.AddComponent<SpriteRenderer>();
        sr.sprite = MakeSprite(kind);
        sr.color = color;
        var col = gameObject.AddComponent<CircleCollider2D>();
        col.radius = 1f;
    }

    void Update()
    {
        var s = Time.time + _phase;
        var off = Vector3.zero;
        var rot = 0f;
        var sc = Vector3.one;
        switch (Motion)
        {
            case "pulse": sc = Vector3.one * (1f + 0.07f * Mathf.Sin(s * 3.2f)); break;
            case "wobble": rot = 11f * Mathf.Sin(s * 2.6f); break;
            case "bob": off.y = 0.2f * Mathf.Sin(s * 2.4f); break;
            case "spin": rot = s * 80f; break;
            case "hop":
                var h = Mathf.Abs(Mathf.Sin(s * 3f));
                off.y = 0.9f * h;
                var squash = Mathf.Clamp01(1f - h * 4f);
                sc = new Vector3(1f + 0.16f * squash, 1f - 0.16f * squash, 1f);
                break;
        }
        _body.localPosition = off;
        _body.localRotation = Quaternion.Euler(0, 0, rot);
        _body.localScale = sc;
    }

    static Sprite MakeSprite(string kind)
    {
        const int n = 128;
        var tex = new Texture2D(n, n, TextureFormat.RGBA32, false) { filterMode = FilterMode.Bilinear };
        var poly = Polygon(kind);
        var px = new Color32[n * n];
        for (var y = 0; y < n; y++)
        for (var x = 0; x < n; x++)
        {
            var p = new Vector2((x + 0.5f) / n * 2f - 1f, (y + 0.5f) / n * 2f - 1f);
            var inside = poly == null ? p.magnitude <= 0.92f : Inside(p, poly);
            px[y * n + x] = inside ? new Color32(255, 255, 255, 255) : new Color32(0, 0, 0, 0);
        }
        tex.SetPixels32(px);
        tex.Apply();
        return Sprite.Create(tex, new Rect(0, 0, n, n), new Vector2(0.5f, 0.5f), n / 2f);
    }

    /// <summary>The outline as points in -1..1, or null for a circle.</summary>
    static Vector2[] Polygon(string kind)
    {
        switch (kind)
        {
            case "square": return new[] { new Vector2(-0.8f, -0.8f), new Vector2(0.8f, -0.8f), new Vector2(0.8f, 0.8f), new Vector2(-0.8f, 0.8f) };
            case "triangle": return new[] { new Vector2(0, 0.95f), new Vector2(0.9f, -0.75f), new Vector2(-0.9f, -0.75f) };
            case "hexagon": return Regular(6, 0.92f, 0f, 0f);
            case "star": return Regular(10, 0.95f, 0.42f, 90f);
            default: return null;
        }
    }

    static Vector2[] Regular(int count, float r, float inner, float startDeg)
    {
        var pts = new Vector2[count];
        for (var i = 0; i < count; i++)
        {
            var a = (startDeg + i * 360f / count) * Mathf.Deg2Rad;
            var rr = inner > 0 && i % 2 == 1 ? inner : r;
            pts[i] = new Vector2(Mathf.Cos(a), Mathf.Sin(a)) * rr;
        }
        return pts;
    }

    static bool Inside(Vector2 p, Vector2[] poly)
    {
        var inside = false;
        for (int i = 0, j = poly.Length - 1; i < poly.Length; j = i++)
            if ((poly[i].y > p.y) != (poly[j].y > p.y) && p.x < (poly[j].x - poly[i].x) * (p.y - poly[i].y) / (poly[j].y - poly[i].y) + poly[i].x)
                inside = !inside;
        return inside;
    }
}
