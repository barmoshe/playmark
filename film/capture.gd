extends Node
## Film driver for the show-and-tell clip, loaded with --playmark-driver. Run the game under
## Godot's movie writer (--write-movie x.avi --fixed-fps 30) so time is fixed and the audio
## is recorded; this script writes 1920x1080 composites (game + Playmark's native windows +
## a cursor) to --film-out, one PNG per frame, and meta.json with the first frame's index.
##
##   --film-part=mark   play, open Playmark, box + pin + stamp + note, save
##   --film-part=fixed  play; Claude's fix lands (resolve via the CLI); toast, ghost, card
##   --film-part=pick-mark   any game with a `shapes` array: pin shapes[--film-target],
##                           optional rewind (--film-rewind=1), stamp --film-cat, type --film-note
##   --film-part=pick-fixed  resolve the newest mark with --film-res, then hold on the toast
##   --film-still=<png>      also save the overlay right before Save (README shots)

const W := 1920
const H := 1080
const NOTE := "חשוך מדי בפינות, הסליימים נעלמים שם"
const NOTE_COLOR := "השחקן צריך להיות כתום"

var out := ""
var part := "mark"
var pm: Node
var _recording := false
var _n := 0
var _first_frame := 0
var _cursor := Vector2(-1, -1)  # in output pixels; negative hides it
var _cursor_img: Image
var _click := 0.0
var opts := {}
var _held := []  # [enemy, position] kept still every frame (--film-hold-at)


func _ready() -> void:
	pm = get_parent()
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--film-out="):
			out = a.get_slice("=", 1)
		elif a.begins_with("--film-part="):
			part = a.get_slice("=", 1)
		if a.begins_with("--film-"):
			var kv := a.trim_prefix("--film-").split("=", true, 1)
			opts[kv[0]] = kv[1] if kv.size() > 1 else ""
	DirAccess.make_dir_recursive_absolute(out.path_join("frames"))
	_cursor_img = _make_cursor()
	pm.hud.always = true
	_run.call_deferred()


func _process(delta: float) -> void:
	_click = maxf(_click - delta * 5.0, 0.0)
	for h in _held:
		if is_instance_valid(h[0]):
			h[0].global_position = h[1]
	if _recording:
		_frame()


func _run() -> void:
	await _wait(4.0)  # warm-up, not recorded
	_start()
	match part:
		"mark": await _part_mark()
		"fixed": await _part_fixed()
		"color-mark": await _part_color_mark()
		"color-fixed": await _part_color_fixed()
		"pick-mark": await _part_pick_mark()
		"pick-fixed": await _part_pick_fixed()
		"group-mark": await _part_group_mark()
		"group-fixed": await _part_group_fixed()
		"enemy-mark": await _part_enemy_mark()
		"enemy-fixed": await _part_enemy_fixed()
		"debug":
			_spawn_kind()
			await _wait(2.6)
			var vp := get_viewport()
			var world = get_tree().current_scene.get("world")
			print("film-debug vis=", vp.get_visible_rect().size, " tex=", vp.get_texture().get_image().get_size(), " canvas=", vp.get_canvas_transform())
			for en in world.enemies:
				print("film-debug ", en.kind, " node=", en.global_position, " sprite=", en.sprite.global_position, " vis=", en.sprite.visible, " spawn_t=", en.spawn_t, " screen=", vp.get_canvas_transform() * en.sprite.global_position)
	_recording = false
	var f := FileAccess.open(out.path_join("meta.json"), FileAccess.WRITE)
	f.store_string(JSON.stringify({"first_frame": _first_frame, "frames": _n, "fps": 30, "part": part}))
	f.close()
	print("film: %s done, %d frames from %d" % [part, _n, _first_frame])
	get_tree().quit()


func _start() -> void:
	_first_frame = Engine.get_frames_drawn()
	_recording = true


func _part_mark() -> void:
	await _wait(3.0)
	var ov: Window = pm.open()
	await _wait(0.7)
	var shot := Vector2(ov.current_image().get_size())
	# Box a dark corner of the room: drag it out with the cursor.
	var a := Vector2(0.255, 0.60)
	var b := Vector2(0.42, 0.79)
	await _move_to(_ov_point(ov, a), 0.45)
	_click = 1.0
	var st = ov._stage
	st._drag_from = a
	var t := 0.0
	while t < 0.55:
		t += get_process_delta_time()
		var k := ease(minf(t / 0.55, 1.0), -2.0)
		st._drag_to = a.lerp(b, k)
		_cursor = _ov_point(ov, st._drag_to)
		await get_tree().process_frame
	st._drag_from = null
	ov.add_mark({"type": "box", "x": a.x * shot.x, "y": a.y * shot.y, "w": (b.x - a.x) * shot.x, "h": (b.y - a.y) * shot.y})
	await _wait(0.3)
	# Pin the nearest enemy (or a spot near the box).
	var target := Vector2(0.33, 0.69)
	var world = get_tree().current_scene.get("world")
	if world and not world.enemies.is_empty():
		var vp := get_viewport()
		var p: Vector2 = vp.get_canvas_transform() * world.enemies[0].global_position
		target = (p / vp.get_visible_rect().size).clamp(Vector2(0.05, 0.05), Vector2(0.95, 0.95))
	await _move_to(_ov_point(ov, target), 0.4)
	_click = 1.0
	ov.add_mark({"type": "pin", "x": target.x * shot.x, "y": target.y * shot.y})
	await _wait(0.35)
	# Stamp ART (key 3) and type the note.
	ov._stamps[2].button_pressed = true
	ov.sfx.play("chip")
	await _wait(0.3)
	ov._note.grab_focus()
	for i in NOTE.length():
		ov._note.text = NOTE.substr(0, i + 1)
		ov._note.set_caret_column(i + 1)
		await _wait(0.045)
	await _wait(0.45)
	# Save: the cursor goes to the button.
	await _move_to(_ctl_point(ov, ov.save_button), 0.35)
	_click = 1.0
	ov.submit()
	await pm.closed
	_cursor = Vector2(-1, -1)
	await _wait(1.2)


func _part_fixed() -> void:
	await _wait(1.6)
	# Claude resolves the mark from the terminal; the game polls and hears about it.
	var ids := DirAccess.get_directories_at(ProjectSettings.globalize_path("res://.playmark/inbox"))
	ids.sort()
	var id: String = ids[ids.size() - 1]
	var cli := ProjectSettings.globalize_path("res://addons/playmark/../../../../playmark/scripts/inbox.mjs")
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--film-cli="):
			cli = a.get_slice("=", 1)
	OS.execute("node", [cli, "resolve", id, "--note", "Ambient light 0.74 → 0.9, the corners read now."])
	await _wait(4.2)
	# Walk to the ghost: the card opens.
	pm.hud._current = {}
	var world = get_tree().current_scene.get("world")
	if world and not pm.ghosts.marks.is_empty():
		var g: Array = pm.ghosts.marks[0].world
		world.player.global_position = Vector2(g[0], g[1]) + Vector2(10, 4)
	await _wait(2.6)


## The simple one: pin the player, ART, "the player should be orange", save.
func _part_color_mark() -> void:
	await _wait(1.6)
	var ov: Window = pm.open()
	await _wait(0.6)
	var shot := Vector2(ov.current_image().get_size())
	var player: Node2D = get_tree().current_scene.get("player")
	var vp := get_viewport()
	var target := ((vp.get_canvas_transform() * player.global_position) / vp.get_visible_rect().size)
	await _move_to(_ov_point(ov, target), 0.5)
	_click = 1.0
	ov.add_mark({"type": "pin", "x": target.x * shot.x, "y": target.y * shot.y})
	await _wait(0.35)
	ov._stamps[2].button_pressed = true
	ov.sfx.play("chip")
	await _wait(0.25)
	ov._note.grab_focus()
	for i in NOTE_COLOR.length():
		ov._note.text = NOTE_COLOR.substr(0, i + 1)
		ov._note.set_caret_column(i + 1)
		await _wait(0.05)
	await _wait(0.35)
	await _move_to(_ctl_point(ov, ov.save_button), 0.35)
	_click = 1.0
	ov.submit()
	await pm.closed
	_cursor = Vector2(-1, -1)
	await _wait(0.6)


func _part_color_fixed() -> void:
	await _wait(1.0)
	var ids := DirAccess.get_directories_at(ProjectSettings.globalize_path("res://.playmark/inbox"))
	ids.sort()
	var cli := ""
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--film-cli="):
			cli = a.get_slice("=", 1)
	OS.execute("node", [cli, "resolve", ids[ids.size() - 1], "--note", "Player color: green → orange (#F2621B)."])
	await _wait(4.5)


func _part_pick_mark() -> void:
	await _wait(float(opts.get("lead", "1.6")))
	var ov: Window = pm.open()
	await _wait(0.6)
	if opts.get("rewind", "") == "1":
		# Scrub back through the clip, as if looking for the moment.
		var n: int = ov._frames.size()
		for k in range(0, mini(n, 14)):
			ov.set_frame(n - 1 - k)
			await _wait(0.06)
		await _wait(0.4)
	var shot := Vector2(ov.current_image().get_size())
	var shapes: Array = get_tree().current_scene.get("shapes")
	var s: Node2D = shapes[int(opts.get("target", "0"))]
	var vp := get_viewport()
	var target := (vp.get_canvas_transform() * s.global_position) / vp.get_visible_rect().size
	if ov.frame_index >= 0:
		target.y -= 0.0  # shapes stay in place; the rewound frame shows them where they stand
	await _move_to(_ov_point(ov, target), 0.5)
	_click = 1.0
	ov.add_mark({"type": "pin", "x": target.x * shot.x, "y": target.y * shot.y})
	await _wait(0.35)
	var cats := ["bug", "feel", "art", "balance", "idea"]
	var ci := cats.find(opts.get("cat", "art"))
	ov._stamps[maxi(ci, 0)].button_pressed = true
	ov.sfx.play("chip")
	await _wait(0.25)
	ov._note.grab_focus()
	var note: String = opts.get("note", "")
	for i in note.length():
		ov._note.text = note.substr(0, i + 1)
		ov._note.set_caret_column(i + 1)
		await _wait(0.05)
	await _wait(0.35)
	if opts.has("still"):
		ov.get_texture().get_image().save_png(opts.still)
	await _move_to(_ctl_point(ov, ov.save_button), 0.35)
	_click = 1.0
	ov.submit()
	await pm.closed
	_cursor = Vector2(-1, -1)
	await _wait(0.8)


func _part_pick_fixed() -> void:
	await _wait(1.0)
	var ids := DirAccess.get_directories_at(ProjectSettings.globalize_path("res://.playmark/inbox"))
	ids.sort()
	OS.execute("node", [opts.get("cli", ""), "resolve", ids[ids.size() - 1], "--note", opts.get("res", "")])
	await _wait(float(opts.get("hold", "4.5")))


## Wandcraft: spawn --film-kind enemies near the player (the bot fights them), then box
## the nearest one, stamp ART, type --film-note, save. Recording-only: the game has no
## spawn flag, so the driver calls world.spawn_enemy itself.
func _spawn_kind() -> Array:
	var world = get_tree().current_scene.get("world")
	var kind := StringName(opts.get("kind", "ram"))
	var out := []
	# --film-hold-at=x,y: one enemy on that open spot, held still, so the shot frames it clearly.
	if opts.has("hold-at"):
		var xy: PackedStringArray = str(opts["hold-at"]).split(",")
		var at := Vector2(float(xy[0]), float(xy[1]))
		var held = world.spawn_enemy(kind, at)
		held.spawn_t = 0.0
		held.sprite.visible = true
		held.max_hp *= 50.0
		held.hp = held.max_hp
		_held.append([held, at])
		return [held]
	var spots := [Vector2(70, 40), Vector2(90, -20), Vector2(-60, 50), Vector2(40, 70), Vector2(110, 30), Vector2(-90, -10)]
	for off in spots:
		if out.size() >= 2:
			break
		var p: Vector2 = world.player.global_position + off
		if world.solid_at(p) or world.solid_at(p + Vector2(10, 0)) or world.solid_at(p - Vector2(10, 0)):
			continue
		var e = world.spawn_enemy(kind, p)
		e.spawn_t = 0.0
		e.sprite.visible = true
		e.max_hp *= 20.0
		e.hp = e.max_hp
		out.append(e)
	return out


func _part_enemy_mark() -> void:
	var foes := _spawn_kind()
	await _wait(float(opts.get("lead", "2.6")))
	var ov: Window = pm.open()
	await _wait(0.6)
	var shot := Vector2(ov.current_image().get_size())
	var vp := get_viewport()
	# The enemy of that kind nearest the screen center, as frozen.
	var world = get_tree().current_scene.get("world")
	var kind := StringName(opts.get("kind", "ram"))
	var e: Node2D = foes[0]
	var best := INF if _held.is_empty() else -1.0
	for en in (world.enemies if _held.is_empty() else []):
		if en.kind == kind and not en.dead and en.sprite.visible and en.spawn_t <= 0.0 and not world.solid_at(en.global_position):
			var d: float = en.sprite.global_position.distance_to(world.player.sprite.global_position if "sprite" in world.player else world.player.global_position)
			if d < best:
				best = d
				e = en
	# Wandcraft's sim moves the sprite, not the enemy node: aim at what is drawn.
	var drawn: Vector2 = e.sprite.global_position if "sprite" in e else e.global_position
	var c := (vp.get_canvas_transform() * drawn) / vp.get_visible_rect().size
	# A roomy box: the number tag sits in its corner without hiding the enemy.
	var half := Vector2(34, 24) / vp.get_visible_rect().size
	var a := c - half + Vector2(-half.x * 0.25, -half.y * 0.35)
	var b := c + half
	await _move_to(_ov_point(ov, a), 0.5)
	_click = 1.0
	var st = ov._stage
	st._drag_from = a
	var t := 0.0
	while t < 0.5:
		t += get_process_delta_time()
		st._drag_to = a.lerp(b, ease(minf(t / 0.5, 1.0), -2.0))
		_cursor = _ov_point(ov, st._drag_to)
		await get_tree().process_frame
	st._drag_from = null
	ov.add_mark({"type": "box", "x": a.x * shot.x, "y": a.y * shot.y, "w": (b.x - a.x) * shot.x, "h": (b.y - a.y) * shot.y})
	await _wait(0.35)
	ov._stamps[2].button_pressed = true
	ov.sfx.play("chip")
	await _wait(0.25)
	ov._note.grab_focus()
	var note: String = opts.get("note", "")
	for i in note.length():
		ov._note.text = note.substr(0, i + 1)
		ov._note.set_caret_column(i + 1)
		await _wait(0.04)
	await _wait(0.4)
	if opts.has("still"):
		ov.get_texture().get_image().save_png(opts.still)
	await _move_to(_ctl_point(ov, ov.save_button), 0.35)
	_click = 1.0
	ov.submit()
	await pm.closed
	_cursor = Vector2(-1, -1)
	await _wait(1.0)


func _part_enemy_fixed() -> void:
	_spawn_kind()
	await _wait(1.4)
	var ids := DirAccess.get_directories_at(ProjectSettings.globalize_path("res://.playmark/inbox"))
	ids.sort()
	OS.execute("node", [opts.get("cli", ""), "resolve", ids[ids.size() - 1], "--note", opts.get("res", "")])
	await _wait(float(opts.get("hold", "5.0")))
	if opts.has("still"):
		var img: Image = get_viewport().get_texture().get_image()
		img.save_png(opts.still)


## Any game: mark the node of --film-group nearest the screen center (--film-shape=box|pin).
## --film-hit=1 drops the nearest meteor on the ship a second before the freeze, and the
## mark rewinds to that moment. Star Dodger's scene has `meteors` and `ship`.
func _part_group_mark() -> void:
	var lead := float(opts.get("lead", "2.4"))
	if opts.get("hit", "") == "1":
		await _wait(lead - 1.0)
		_force_hit()
		await _wait(1.0)
	else:
		await _wait(lead)
	var ov: Window = pm.open()
	await _wait(0.6)
	if opts.get("hit", "") == "1":
		# Rewind to the hit: step back through the clip.
		var n: int = ov._frames.size()
		for k in range(0, mini(n, 9)):
			ov.set_frame(n - 1 - k)
			await _wait(0.08)
		await _wait(0.3)
	var shot := Vector2(ov.current_image().get_size())
	var vp := get_viewport()
	var size := vp.get_visible_rect().size
	var best: Node2D = null
	var best_d := INF
	for node in get_tree().get_nodes_in_group(opts.get("group", "meteor")):
		var p: Vector2 = (vp.get_canvas_transform() * node.global_position) / size
		if p.y < 0.18 or p.y > 0.9 or p.x < 0.08 or p.x > 0.92:
			continue
		var d := p.distance_to(Vector2(0.5, 0.5))
		if d < best_d:
			best_d = d
			best = node
	var c := Vector2(0.5, 0.5) if best == null else (vp.get_canvas_transform() * best.global_position) / size
	if ov.frame_index >= 0 and opts.get("group", "") == "ship":
		c.y = 0.82
	if opts.get("shape", "box") == "pin":
		await _move_to(_ov_point(ov, c), 0.5)
		_click = 1.0
		ov.add_mark({"type": "pin", "x": c.x * shot.x, "y": c.y * shot.y})
	else:
		var half := Vector2(30, 30) / size
		var a := c - half
		var b := c + half
		await _move_to(_ov_point(ov, a), 0.45)
		_click = 1.0
		var st = ov._stage
		st._drag_from = a
		var t := 0.0
		while t < 0.45:
			t += get_process_delta_time()
			st._drag_to = a.lerp(b, ease(minf(t / 0.45, 1.0), -2.0))
			_cursor = _ov_point(ov, st._drag_to)
			await get_tree().process_frame
		st._drag_from = null
		ov.add_mark({"type": "box", "x": a.x * shot.x, "y": a.y * shot.y, "w": (b.x - a.x) * shot.x, "h": (b.y - a.y) * shot.y})
	await _wait(0.3)
	var cats := ["bug", "feel", "art", "balance", "idea"]
	ov._stamps[maxi(cats.find(opts.get("cat", "art")), 0)].button_pressed = true
	ov.sfx.play("chip")
	await _wait(0.25)
	ov._note.grab_focus()
	var note: String = opts.get("note", "")
	for i in note.length():
		ov._note.text = note.substr(0, i + 1)
		ov._note.set_caret_column(i + 1)
		await _wait(0.04)
	await _wait(0.4)
	if opts.has("still"):
		ov.get_texture().get_image().save_png(opts.still)
	await _move_to(_ctl_point(ov, ov.save_button), 0.35)
	_click = 1.0
	ov.submit()
	await pm.closed
	_cursor = Vector2(-1, -1)
	await _wait(0.8)


func _part_group_fixed() -> void:
	await _wait(1.0)
	var ids := DirAccess.get_directories_at(ProjectSettings.globalize_path("res://.playmark/inbox"))
	ids.sort()
	OS.execute("node", [opts.get("cli", ""), "resolve", ids[ids.size() - 1], "--note", opts.get("res", "")])
	if opts.get("hit", "") == "1":
		await _wait(1.6)
		_force_hit()
		await _wait(float(opts.get("hold", "3.5")) - 1.6)
	else:
		await _wait(float(opts.get("hold", "4.0")))


func _force_hit() -> void:
	var scene = get_tree().current_scene
	var ship: Node2D = scene.get("ship")
	var ms: Array = scene.get("meteors")
	if ship and not ms.is_empty():
		ms[0].position = ship.position + Vector2(0, -2)


# --- Compositing --------------------------------------------------------------------

func _frame() -> void:
	var img := Image.create_empty(W, H, false, Image.FORMAT_RGBA8)
	img.fill(Color("111111"))
	var ov: Window = pm._overlay
	if ov and ov.visible:
		var o := ov.get_texture().get_image()
		o.convert(Image.FORMAT_RGBA8)
		var r := _fit(o.get_size())
		o.resize(int(r.size.x), int(r.size.y), Image.INTERPOLATE_BILINEAR)
		img.blit_rect(o, Rect2i(Vector2i.ZERO, o.get_size()), Vector2i(r.position))
	else:
		var g := get_viewport().get_texture().get_image()
		g.convert(Image.FORMAT_RGBA8)
		var integer := W % g.get_width() == 0 and H % g.get_height() == 0
		g.resize(W, H, Image.INTERPOLATE_NEAREST if integer else Image.INTERPOLATE_BILINEAR)
		img.blit_rect(g, Rect2i(0, 0, W, H), Vector2i.ZERO)
		var hud: Window = pm.hud
		if hud.visible:
			var h := hud.get_texture().get_image()
			h.convert(Image.FORMAT_RGBA8)
			var k := float(W) / DisplayServer.window_get_size().x
			var at := Vector2(hud.position - DisplayServer.window_get_position()) * k
			h.resize(int(h.get_width() * k), int(h.get_height() * k), Image.INTERPOLATE_BILINEAR)
			img.blend_rect(h, Rect2i(Vector2i.ZERO, h.get_size()), Vector2i(at))
	if _cursor.x >= 0:
		var c := _cursor_img
		if _click > 0.0:
			_ring(img, Vector2i(_cursor), int(10 + 26 * (1.0 - _click)), Color(1, 1, 1, _click))
		img.blend_rect(c, Rect2i(Vector2i.ZERO, c.get_size()), Vector2i(_cursor) - Vector2i(3, 2))
	img.save_png(out.path_join("frames/%05d.png" % _n))
	_n += 1


func _fit(s: Vector2i) -> Rect2:
	var k := minf(float(W) / s.x, float(H) / s.y)
	var size := Vector2(s) * k
	return Rect2((Vector2(W, H) - size) / 2, size)


## A point on the overlay's stage (normalized frame coords) in output pixels.
func _ov_point(ov: Window, norm: Vector2) -> Vector2:
	var st: Control = ov._stage
	var local: Vector2 = st.to_screen(norm)
	var px := (st.get_global_rect().position + local) * ov.content_scale_factor
	var r := _fit(ov.size)
	return r.position + px * (r.size.x / ov.size.x)


func _ctl_point(ov: Window, c: Control) -> Vector2:
	var px := c.get_global_rect().get_center() * ov.content_scale_factor
	var r := _fit(ov.size)
	return r.position + px * (r.size.x / ov.size.x)


func _move_to(p: Vector2, secs: float) -> void:
	if _cursor.x < 0:
		_cursor = Vector2(W * 0.62, H * 0.55)
	var from := _cursor
	var t := 0.0
	while t < secs:
		t += get_process_delta_time()
		_cursor = from.lerp(p, ease(minf(t / secs, 1.0), -2.2))
		await get_tree().process_frame
	_cursor = p


func _wait(s: float) -> void:
	await get_tree().create_timer(s, true, false, true).timeout


## A plain white arrow with a black edge, 2x.
func _make_cursor() -> Image:
	var rows := [
		"X", "XX", "X.X", "X..X", "X...X", "X....X", "X.....X", "X......X", "X.......X", "X........X",
		"X.....XXXXX", "X..X..X", "X.X X..X", "XX  X..X", "X    X..X", "     X..X", "      XX",
	]
	var s := 2
	var img := Image.create_empty(12 * s, rows.size() * s, false, Image.FORMAT_RGBA8)
	for y in rows.size():
		var row: String = rows[y]
		for x in row.length():
			var ch := row[x]
			if ch == "X" or ch == ".":
				img.fill_rect(Rect2i(x * s, y * s, s, s), Color.BLACK if ch == "X" else Color.WHITE)
	return img


func _ring(img: Image, p: Vector2i, r: int, c: Color) -> void:
	for i in 64:
		var a := TAU * i / 64.0
		for w in 2:
			var q := p + Vector2i(Vector2(cos(a), sin(a)) * (r + w))
			if q.x >= 0 and q.y >= 0 and q.x < img.get_width() and q.y < img.get_height():
				img.set_pixel(q.x, q.y, img.get_pixel(q.x, q.y).lerp(Color(c, 1), c.a))
