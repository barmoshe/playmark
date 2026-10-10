extends RefCounted
## The game's state at the moment of a mark, and what sits under each pin or box.
## Runs while the tree is paused, so positions match the frozen frame.

const PIN_RADIUS := 16.0
const MAX_NODES := 8
const SKIP_CLASSES := ["CPUParticles2D", "GPUParticles2D", "CanvasModulate", "RemoteTransform2D", "AudioStreamPlayer2D"]


static func collect(host: Node, shot_size: Vector2i, marks: Array, mouse: Vector2, contexts: Dictionary) -> Dictionary:
	var tree := host.get_tree()
	var vp := host.get_viewport()
	var scene := tree.current_scene
	var data := {
		"project": {
			"name": ProjectSettings.get_setting("application/config/name", ""),
			"version": ProjectSettings.get_setting("application/config/version", ""),
		},
		"engine": Engine.get_version_info().string,
		"os": OS.get_name(),
		"debug_build": OS.is_debug_build(),
		"scene": {
			"path": scene.scene_file_path if scene else "",
			"name": String(scene.name) if scene else "",
		},
		"window_size": _plain(DisplayServer.window_get_size()),
		"screen_scale": DisplayServer.screen_get_scale(DisplayServer.window_get_current_screen()),
		"viewport_size": _plain(vp.get_visible_rect().size),
		"screenshot_size": _plain(shot_size),
		"fps": Engine.get_frames_per_second(),
		"time_scale": Engine.time_scale,
		"uptime_s": snappedf(Time.get_ticks_msec() / 1000.0, 0.1),
		"mouse": _plain(mouse.round()),
		"under_marks": [],
		"context": {},
	}
	var to_vp := vp.get_visible_rect().size / Vector2(shot_size)
	for i in marks.size():
		data.under_marks.append(_under(host, marks[i], to_vp, i + 1))
	data.context = _contexts(tree, contexts)
	return data


## Mouse position in screenshot pixels.
static func mouse_in_shot(host: Node, shot_size: Vector2i) -> Vector2:
	var vp := host.get_viewport()
	return vp.get_mouse_position() * Vector2(shot_size) / vp.get_visible_rect().size


static func _under(host: Node, m: Dictionary, to_vp: Vector2, number: int) -> Dictionary:
	var vp := host.get_viewport()
	var is_box: bool = m.type == "box"
	var rect := Rect2(Vector2(m.x, m.y) * to_vp, Vector2(m.get("w", 0), m.get("h", 0)) * to_vp)
	var point := rect.get_center() if is_box else rect.position
	var out := {"mark": number, "nodes": [], "physics": [], "ui": []}

	# 2D world: the root canvas transform maps world to viewport.
	var to_world := vp.get_canvas_transform().affine_inverse()
	var world_pt := to_world * point
	var world_rect := to_world * rect
	var scale := to_world.get_scale().x
	var space := vp.world_2d.direct_space_state if vp.world_2d else null
	if space:
		var q := PhysicsPointQueryParameters2D.new()
		q.position = world_pt
		q.collide_with_areas = true
		for hit in space.intersect_point(q, MAX_NODES):
			if hit.collider is Node:
				out.physics.append(_describe(host, hit.collider, world_pt))
	var near: Array = []
	for n in host.get_tree().root.find_children("*", "Node2D", true, false):
		var n2 := n as Node2D
		if n2 == null or host.is_ancestor_of(n2) or not n2.is_visible_in_tree() or n2.get_class() in SKIP_CLASSES:
			continue
		var p := n2.global_position
		var d := world_pt.distance_to(p)
		if (is_box and world_rect.has_point(p)) or (not is_box and d <= PIN_RADIUS * scale):
			near.append([0 if n2.get_script() else 1, d, n2])
	near.sort_custom(func(a, b): return a[0] < b[0] or (a[0] == b[0] and a[1] < b[1]))
	for e in near.slice(0, MAX_NODES):
		out.nodes.append(_describe(host, e[2], world_pt))

	out.world = _plain(world_pt)

	# 3D: ray from the active camera.
	var cam := vp.get_camera_3d()
	if cam and vp.world_3d:
		var from := cam.project_ray_origin(point)
		var to := from + cam.project_ray_normal(point) * cam.far
		var hit := vp.world_3d.direct_space_state.intersect_ray(PhysicsRayQueryParameters3D.create(from, to))
		if hit and hit.collider is Node:
			var d := _describe(host, hit.collider, Vector2.ZERO)
			d.hit = _plain(hit.position)
			out.physics.append(d)
			out.world_3d = _plain(hit.position)

	# UI: visible Controls under the point, innermost last.
	for c in host.get_tree().root.find_children("*", "Control", true, false):
		var ctl := c as Control
		if ctl and not host.is_ancestor_of(ctl) and ctl.is_visible_in_tree() and ctl.get_global_rect().has_point(point) and ctl.mouse_filter != Control.MOUSE_FILTER_IGNORE:
			out.ui.append(_describe(host, ctl, Vector2.ZERO))
	out.ui = out.ui.slice(maxi(out.ui.size() - 5, 0))
	# A pin on the HUD has no place in the world: no ghost for it.
	if out.nodes.is_empty() and out.physics.is_empty() and not out.ui.is_empty():
		out.erase("world")
	return out


## Where the camera looks, in world space: enough to warp back for many 2D games.
static func camera_center(host: Node) -> Variant:
	var vp := host.get_viewport()
	if vp.get_camera_3d():
		return {"position": _plain(vp.get_camera_3d().global_position), "rotation": _plain(vp.get_camera_3d().global_rotation)}
	return _plain(vp.get_canvas_transform().affine_inverse() * vp.get_visible_rect().get_center())


static func _describe(host: Node, n: Node, from: Vector2) -> Dictionary:
	var scene := host.get_tree().current_scene
	var path := String(scene.get_path_to(n)) if scene and (scene == n or scene.is_ancestor_of(n)) else String(n.get_path())
	var d := {"path": path, "class": n.get_class()}
	var s: Script = n.get_script()
	if s and not s.resource_path.is_empty():
		d.script = s.resource_path
	if n is Node2D:
		d.position = _plain((n as Node2D).global_position.round())
		if from != Vector2.ZERO:
			d.distance = snappedf(from.distance_to((n as Node2D).global_position), 0.1)
	return d


static func _contexts(tree: SceneTree, providers: Dictionary) -> Dictionary:
	var out := {}
	for key: String in providers:
		var c: Callable = providers[key]
		if c.is_valid():
			out[key] = _plain(c.call())
	for n in tree.get_nodes_in_group("playmark_context"):
		if n.has_method("_playmark_context"):
			out[String(n.name)] = _plain(n.call("_playmark_context"))
	return out


## Anything to JSON-safe values.
static func _plain(v: Variant) -> Variant:
	match typeof(v):
		TYPE_NIL, TYPE_BOOL, TYPE_INT, TYPE_STRING:
			return v
		TYPE_FLOAT:
			return snappedf(v, 0.01)
		TYPE_STRING_NAME, TYPE_NODE_PATH:
			return String(v)
		TYPE_VECTOR2, TYPE_VECTOR2I:
			return [_plain(v.x), _plain(v.y)]
		TYPE_VECTOR3, TYPE_VECTOR3I:
			return [_plain(v.x), _plain(v.y), _plain(v.z)]
		TYPE_RECT2, TYPE_RECT2I:
			return {"position": _plain(v.position), "size": _plain(v.size)}
		TYPE_COLOR:
			return "#" + v.to_html(v.a < 1.0)
		TYPE_DICTIONARY:
			var d := {}
			for k in v:
				d[str(k)] = _plain(v[k])
			return d
		TYPE_OBJECT:
			if v is Node:
				return String(v.get_path())
			if v is Resource and not v.resource_path.is_empty():
				return v.resource_path
			return str(v)
	if v is Array or typeof(v) >= TYPE_PACKED_BYTE_ARRAY:
		var a := []
		for e in v:
			a.append(_plain(e))
		return a
	return str(v)
