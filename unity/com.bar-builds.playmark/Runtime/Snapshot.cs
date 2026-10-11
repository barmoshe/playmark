using System;
using System.Collections.Generic;
using System.Linq;
using BarBuilds.Playmark.Core;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.UI;
using UnityEngine.UIElements;

namespace BarBuilds.Playmark
{
    /// <summary>A mark in normalized frame coordinates (0..1, top-left origin).</summary>
    internal struct NormMark
    {
        public bool Box;
        public float X, Y, W, H;
    }

    /// <summary>
    /// The game's state at the moment of a mark, and what sits under each pin or box. Runs
    /// while the game is frozen, so positions match the frame. The Unity side of the Godot
    /// addon's snapshot.gd; the JSON keys are the same, so Claude reads both alike.
    /// </summary>
    internal static class Snapshot
    {
        const float PinRadius = 16f;
        const int MaxNodes = 8;

        public static Dictionary<string, object> Collect(IList<NormMark> marks, Vector2 mouse, int shotWidth, int shotHeight, float fps, float timeScale)
        {
            var scene = SceneManager.GetActiveScene();
            var loaded = new List<object>();
            for (var i = 0; i < SceneManager.sceneCount; i++)
            {
                var s = SceneManager.GetSceneAt(i);
                if (s.isLoaded && s != scene) loaded.Add(s.path);
            }
            var data = new Dictionary<string, object>
            {
                ["project"] = new Dictionary<string, object> { ["name"] = Application.productName, ["version"] = Application.version },
                ["engine"] = new Dictionary<string, object> { ["name"] = "unity", ["version"] = Application.unityVersion },
                ["os"] = SystemInfo.operatingSystem,
                ["debug_build"] = Debug.isDebugBuild,
                ["editor"] = Application.isEditor,
                ["scene"] = new Dictionary<string, object> { ["path"] = scene.path, ["name"] = scene.name, ["also_loaded"] = loaded },
                ["render_pipeline"] = UnityEngine.Rendering.GraphicsSettings.currentRenderPipeline != null ? UnityEngine.Rendering.GraphicsSettings.currentRenderPipeline.GetType().Name : "Built-in",
                ["graphics"] = SystemInfo.graphicsDeviceType.ToString(),
                ["window_size"] = new List<object> { Screen.width, Screen.height },
                ["viewport_size"] = new List<object> { Screen.width, Screen.height },
                ["screenshot_size"] = new List<object> { shotWidth, shotHeight },
                ["fps"] = Math.Round(fps),
                ["time_scale"] = Json.Round(timeScale),
                ["uptime_s"] = Math.Round(Time.realtimeSinceStartup, 1),
                ["mouse"] = new List<object> { Math.Round(mouse.x), Math.Round(mouse.y) },
            };
            var under = new List<object>();
            for (var i = 0; i < marks.Count; i++) under.Add(Under(marks[i], i + 1));
            data["under_marks"] = under;
            data["context"] = Contexts();
            return data;
        }

        /// <summary>The camera the player sees through: the main camera, else the deepest enabled one.</summary>
        public static Camera GameCamera()
        {
            var main = Camera.main;
            if (main != null && main.isActiveAndEnabled) return main;
            Camera best = null;
            foreach (var c in Camera.allCameras)
                if (c.isActiveAndEnabled && c.targetTexture == null && (best == null || c.depth > best.depth)) best = c;
            return best;
        }

        static Dictionary<string, object> Under(NormMark m, int number)
        {
            float sw = Screen.width, sh = Screen.height;
            // Screen space here is Unity's: origin bottom-left.
            var point = m.Box ? new Vector2((m.X + m.W / 2) * sw, (1 - m.Y - m.H / 2) * sh) : new Vector2(m.X * sw, (1 - m.Y) * sh);
            var box = new Rect(m.X * sw, (1 - m.Y - m.H) * sh, m.W * sw, m.H * sh);
            var outD = new Dictionary<string, object> { ["mark"] = number };
            var physics = new List<object>();
            var nodes = new List<object>();
            var ui = new List<object>();
            var seen = new HashSet<GameObject>();
            var cam = GameCamera();
            Vector3? world = null;

            if (cam != null)
            {
                var ray = cam.ScreenPointToRay(point);
#if PLAYMARK_PHYSICS
                var hits3 = Physics.RaycastAll(ray, cam.farClipPlane, Physics.DefaultRaycastLayers, QueryTriggerInteraction.Collide);
                Array.Sort(hits3, (a, b) => a.distance.CompareTo(b.distance));
                foreach (var h in hits3.Take(MaxNodes))
                {
                    if (!seen.Add(h.collider.gameObject)) continue;
                    var d = Describe(h.collider.gameObject, h.collider);
                    d["hit"] = V(h.point);
                    physics.Add(d);
                    if (world == null) world = h.point;
                }
#endif
#if PLAYMARK_PHYSICS2D
                var hits2 = m.Box && cam.orthographic
                    ? Physics2D.OverlapAreaAll(cam.ScreenToWorldPoint(new Vector3(box.xMin, box.yMin, 0)), cam.ScreenToWorldPoint(new Vector3(box.xMax, box.yMax, 0)))
                    : Physics2D.GetRayIntersectionAll(ray, Mathf.Infinity).Select(h => h.collider).ToArray();
                foreach (var c in hits2.Take(MaxNodes))
                {
                    if (c == null || !seen.Add(c.gameObject)) continue;
                    physics.Add(Describe(c.gameObject, c));
                }
#endif
                // Renderers under the pin or inside the box: the colliderless sprites and meshes.
                var near = new List<(int scripted, float area, Renderer r)>();
                foreach (var r in UnityEngine.Object.FindObjectsByType<Renderer>(FindObjectsInactive.Exclude, FindObjectsSortMode.None))
                {
                    if (!r.enabled || r is ParticleSystemRenderer || r is TrailRenderer || seen.Contains(r.gameObject)) continue;
                    if (((1 << r.gameObject.layer) & cam.cullingMask) == 0) continue;
                    if (!ScreenRect(cam, r.bounds, out var sr)) continue;
                    var hit = m.Box ? box.Contains(sr.center) : Grow(sr, PinRadius).Contains(point);
                    if (hit) near.Add((UserScript(r.gameObject) != null ? 0 : 1, sr.width * sr.height, r));
                }
                var picked = near.OrderBy(e => e.scripted).ThenBy(e => e.area).Take(MaxNodes).ToList();
                foreach (var e in picked)
                {
                    seen.Add(e.r.gameObject);
                    var d = Describe(e.r.gameObject, e.r);
                    d["distance"] = Json.Round(Vector2.Distance(cam.WorldToScreenPoint(e.r.bounds.center), point));
                    nodes.Add(d);
                }
                // No 3D hit: the point on the plane of what is under the pin (z = 0 for most 2D games).
                if (world == null) world = PointOnPlane(cam, point, picked.Count > 0 ? picked[0].r.bounds.center.z : 0f);
            }

            // uGUI: graphics under the point that take raycasts, innermost (deepest) last.
            var graphics = new List<(int depth, Graphic g)>();
            foreach (var g in UnityEngine.Object.FindObjectsByType<Graphic>(FindObjectsInactive.Exclude, FindObjectsSortMode.None))
            {
                if (!g.raycastTarget || g.canvas == null || !g.isActiveAndEnabled) continue;
                var c = g.canvas.renderMode == RenderMode.ScreenSpaceOverlay ? null : g.canvas.worldCamera;
                if (RectTransformUtility.RectangleContainsScreenPoint(g.rectTransform, point, c)) graphics.Add((g.depth, g));
            }
            foreach (var e in graphics.OrderBy(e => e.g.canvas.sortingOrder).ThenBy(e => e.depth)) ui.Add(Describe(e.g.gameObject, e.g));

            // UI Toolkit: the top element under the point in each document.
            foreach (var doc in UnityEngine.Object.FindObjectsByType<UIDocument>(FindObjectsInactive.Exclude, FindObjectsSortMode.None))
            {
                var panel = doc.rootVisualElement?.panel;
                if (panel == null) continue;
                var local = RuntimePanelUtils.ScreenToPanel(panel, new Vector2(point.x, sh - point.y));
                var el = panel.Pick(local);
                if (el == null) continue;
                var d = Describe(doc.gameObject, doc);
                d["element"] = string.IsNullOrEmpty(el.name) ? el.GetType().Name : "#" + el.name;
                d["element_class"] = el.GetType().Name;
                var classes = el.GetClasses().ToList();
                if (classes.Count > 0) d["uss_classes"] = classes.Cast<object>().ToList();
                if (doc.visualTreeAsset != null) d["uxml"] = doc.visualTreeAsset.name;
                ui.Add(d);
            }

            outD["physics"] = physics;
            outD["nodes"] = nodes;
            outD["ui"] = ui.Skip(Math.Max(0, ui.Count - 5)).ToList();
            // A pin on the HUD has no place in the world: no ghost for it.
            if (world != null && !(nodes.Count == 0 && physics.Count == 0 && ui.Count > 0)) outD["world"] = V(world.Value);
            return outD;
        }

        /// <summary>Where the camera ray meets the plane z = planeZ: the 2D world point under a pin.</summary>
        static Vector3? PointOnPlane(Camera cam, Vector2 screen, float planeZ)
        {
            var ray = cam.ScreenPointToRay(screen);
            if (Mathf.Abs(ray.direction.z) < 1e-5f) return null;
            var t = (planeZ - ray.origin.z) / ray.direction.z;
            return t < 0 ? (Vector3?)null : ray.GetPoint(t);
        }

        static bool ScreenRect(Camera cam, Bounds b, out Rect r)
        {
            r = default;
            var min = new Vector2(float.MaxValue, float.MaxValue);
            var max = new Vector2(float.MinValue, float.MinValue);
            for (var i = 0; i < 8; i++)
            {
                var corner = new Vector3((i & 1) == 0 ? b.min.x : b.max.x, (i & 2) == 0 ? b.min.y : b.max.y, (i & 4) == 0 ? b.min.z : b.max.z);
                var s = cam.WorldToScreenPoint(corner);
                if (s.z < 0) return false; // behind the camera
                min = Vector2.Min(min, s);
                max = Vector2.Max(max, s);
            }
            r = Rect.MinMaxRect(min.x, min.y, max.x, max.y);
            return r.width > 0 || r.height > 0;
        }

        static Rect Grow(Rect r, float by) => Rect.MinMaxRect(r.xMin - by, r.yMin - by, r.xMax + by, r.yMax + by);

        // --- Describing an object ---------------------------------------------------------

        /// <summary>
        /// path (in the hierarchy), class (the component that matched), script (the game script
        /// on it or its nearest parent), prefab, position. The script path is the fastest route
        /// to the code: in the Editor it is the asset ("Assets/Scripts/Enemy.cs"); in a build, the type name.
        /// </summary>
        public static Dictionary<string, object> Describe(GameObject go, Component matched)
        {
            var d = new Dictionary<string, object>
            {
                ["path"] = PathOf(go.transform),
                ["class"] = matched != null ? matched.GetType().Name : "GameObject",
            };
            if (go.scene != SceneManager.GetActiveScene() && go.scene.IsValid()) d["scene"] = go.scene.path;
            var script = UserScript(go);
            if (script != null)
            {
                d["script"] = ScriptPath(script);
                if (script.gameObject != go) d["script_on"] = PathOf(script.transform);
                var others = script.GetComponents<MonoBehaviour>().Where(b => b != script && IsUserScript(b)).Select(b => (object)ScriptPath(b)).Distinct().Take(3).ToList();
                if (others.Count > 0) d["other_scripts"] = others;
            }
            var prefab = Hooks.PrefabPath?.Invoke(go);
            if (!string.IsNullOrEmpty(prefab)) d["prefab"] = prefab;
            d["components"] = go.GetComponents<Component>().Where(c => c != null && !(c is Transform)).Select(c => (object)c.GetType().Name).Take(8).ToList();
            d["position"] = V(go.transform.position);
            if (go.layer != 0) d["layer"] = LayerMask.LayerToName(go.layer);
            if (!go.CompareTag("Untagged")) d["tag"] = go.tag;
            return d;
        }

        /// <summary>The first game script on the object or up to three parents above it.</summary>
        static MonoBehaviour UserScript(GameObject go)
        {
            var t = go.transform;
            for (var up = 0; t != null && up < 4; up++, t = t.parent)
                foreach (var b in t.GetComponents<MonoBehaviour>())
                    if (IsUserScript(b)) return b;
            return null;
        }

        static bool IsUserScript(MonoBehaviour b)
        {
            if (b == null) return false;
            var ns = b.GetType().Namespace ?? "";
            return !(ns.StartsWith("UnityEngine") || ns.StartsWith("Unity.") || ns.StartsWith("UnityEditor") || ns.StartsWith("TMPro") || ns.StartsWith("BarBuilds.Playmark"));
        }

        static string ScriptPath(MonoBehaviour b)
        {
            var p = Hooks.ScriptPath?.Invoke(b);
            return string.IsNullOrEmpty(p) ? b.GetType().FullName : p;
        }

        public static string PathOf(Transform t)
        {
            var parts = new List<string>();
            for (; t != null; t = t.parent) parts.Add(t.name);
            parts.Reverse();
            return string.Join("/", parts);
        }

        // --- Context ----------------------------------------------------------------------

        static Dictionary<string, object> Contexts()
        {
            var o = new Dictionary<string, object>();
            foreach (var kv in Playmark.Contexts)
            {
                try { o[kv.Key] = Plain(kv.Value?.Invoke()); }
                catch (Exception e) { o[kv.Key] = "error: " + e.Message; }
            }
            foreach (var b in UnityEngine.Object.FindObjectsByType<MonoBehaviour>(FindObjectsInactive.Exclude, FindObjectsSortMode.None))
            {
                if (!(b is IPlaymarkContext c)) continue;
                try { o[b.gameObject.name] = Plain(c.PlaymarkContext()); }
                catch (Exception e) { o[b.gameObject.name] = "error: " + e.Message; }
            }
            return o;
        }

        // --- Unity values to JSON ---------------------------------------------------------

        public static object Plain(object v) => Json.Plain(v, Convert);

        public static List<object> V(Vector3 v) => new List<object> { Json.Round(v.x), Json.Round(v.y), Json.Round(v.z) };

        static object Convert(object v)
        {
            switch (v)
            {
                case Vector2 a: return new List<object> { Json.Round(a.x), Json.Round(a.y) };
                case Vector3 a: return V(a);
                case Vector4 a: return new List<object> { Json.Round(a.x), Json.Round(a.y), Json.Round(a.z), Json.Round(a.w) };
                case Vector2Int a: return new List<object> { (long)a.x, (long)a.y };
                case Vector3Int a: return new List<object> { (long)a.x, (long)a.y, (long)a.z };
                case Quaternion q: return V(q.eulerAngles);
                case Color c: return "#" + ColorUtility.ToHtmlStringRGBA(c);
                case Color32 c: return "#" + ColorUtility.ToHtmlStringRGBA(c);
                case Rect r: return new Dictionary<string, object> { ["position"] = Convert(r.position), ["size"] = Convert(r.size) };
                case Bounds b: return new Dictionary<string, object> { ["center"] = V(b.center), ["size"] = V(b.size) };
                case GameObject g: return PathOf(g.transform);
                case Component c: return c != null ? PathOf(c.transform) + " (" + c.GetType().Name + ")" : null;
                case UnityEngine.Object o: return o != null ? o.name : null;
            }
            return null;
        }

        /// <summary>Where the camera is: enough to warp back for many games.</summary>
        public static Dictionary<string, object> CameraPose()
        {
            var cam = GameCamera();
            if (cam == null) return null;
            var d = new Dictionary<string, object> { ["position"] = V(cam.transform.position), ["rotation"] = V(cam.transform.eulerAngles) };
            if (cam.orthographic) d["size"] = Json.Round(cam.orthographicSize);
            else d["fov"] = Json.Round(cam.fieldOfView);
            return d;
        }
    }
}
