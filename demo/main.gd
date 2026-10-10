extends Node2D
## A tiny arena to try Playmark on: a player circling, two enemies with colliders,
## a wall and a HUD. Press Ctrl+Shift+M to mark.
## `godot --path demo -- --playmark-selftest=<dir>` runs the whole flow by itself.

var score := 0
var player: Node2D
var enemies: Array[Area2D] = []
var t := 0.0
var score_label: Label


func _ready() -> void:
	var cam := Camera2D.new()
	cam.position = Vector2(320, 180)
	add_child(cam)
	_poly("Floor", Rect2(0, 0, 640, 360), Color("23233a"))
	_poly("Wall", Rect2(420, 60, 24, 220), Color("5a5a7a"))
	player = _poly("Player", Rect2(-10, -10, 20, 20), Color("3ee07a"))
	player.set_script(preload("res://player.gd"))
	for i in 2:
		var e := Area2D.new()
		e.name = "Enemy%d" % (i + 1)
		var shape := CollisionShape2D.new()
		shape.shape = CircleShape2D.new()
		shape.shape.radius = 14
		e.add_child(shape)
		var body := Polygon2D.new()
		body.polygon = PackedVector2Array([Vector2(0, -14), Vector2(14, 10), Vector2(-14, 10)])
		body.color = Color("ff3b5c")
		e.add_child(body)
		e.position = Vector2(200 + i * 230, 120 + i * 90)
		add_child(e)
		enemies.append(e)
	var hud := CanvasLayer.new()
	var label := Label.new()
	score_label = label
	label.name = "Score"
	label.position = Vector2(12, 8)
	label.mouse_filter = Control.MOUSE_FILTER_PASS
	hud.add_child(label)
	add_child(hud)
	Playmark.set_player(player)
	Playmark.add_context("demo", func(): return {"score": score, "player": player.position, "enemies": enemies.size()})
	print("demo: ready")
	var args := OS.get_cmdline_user_args()
	for a in args:
		if a.begins_with("--playmark-selftest"):
			_selftest(a.get_slice("=", 1) if "=" in a else "")


func _process(delta: float) -> void:
	t += delta
	player.position = Vector2(320, 180) + Vector2(cos(t), sin(t * 1.3)) * Vector2(160, 110)
	for i in enemies.size():
		enemies[i].rotation += delta * (1 + i)
	if int(t * 4) != int((t - delta) * 4):
		score += 1
		if score % 10 == 0:
			print("demo: score %d" % score)
	score_label.text = "SCORE %d" % score


func _poly(n: String, r: Rect2, c: Color) -> Polygon2D:
	var p := Polygon2D.new()
	p.name = n
	p.polygon = PackedVector2Array([r.position, Vector2(r.end.x, r.position.y), r.end, Vector2(r.position.x, r.end.y)])
	p.color = c
	add_child(p)
	return p


## The whole loop, unattended: open, pin Enemy1, box the player, rewind, stamp, save;
## then Claude claims and fixes it (via the CLI), the toast and ghost appear, and an
## error gets auto-captured. Captures land in out_dir (window regions only).
func _selftest(out_dir: String) -> void:
	get_tree().create_timer(60.0).timeout.connect(func(): print("demo: selftest TIMEOUT"); get_tree().quit(2))
	await _wait(3.5)
	push_warning("demo: a warning for the log")
	var ov := Playmark.open()
	if ov == null:
		print("demo: selftest FAILED, overlay did not open")
		get_tree().quit(1)
		return
	await _wait(0.6)
	var to_px := get_viewport().get_canvas_transform()
	var shot_scale := Vector2(ov.current_image().get_size()) / get_viewport().get_visible_rect().size
	var e := to_px * enemies[0].global_position * shot_scale
	var p := to_px * player.global_position * shot_scale
	ov.add_mark({"type": "pin", "x": e.x, "y": e.y})
	await _wait(0.25)
	ov.add_mark({"type": "box", "x": p.x - 40, "y": p.y - 40, "w": 80, "h": 80})
	ov.set_note("Selftest: the enemy spins too fast and the player clips the wall.", "feel")
	await _wait(0.5)
	_capture(ov, out_dir, "overlay")
	Playmark.saved.connect(func(loc): print("demo: selftest SAVED ", loc), CONNECT_ONE_SHOT)
	ov.submit()
	await _wait(0.42)
	_capture(ov, out_dir, "stamp")
	await Playmark.closed
	var id := _latest_id()
	print("demo: saved id ", id)
	await _wait(1.0)
	_cli(["claim", id])
	await _wait(3.0)
	_capture_game(out_dir, "working")
	_cli(["resolve", id, "--note", "Enemy spin slowed to 1 rad/s; the player keeps 6 px off walls."])
	await _wait(3.0)
	_capture_game(out_dir, "fixed")
	# Walk the player onto the ghost: the card opens.
	set_process(false)
	player.global_position = enemies[0].global_position + Vector2(0, -10)
	await _wait(0.6)
	_capture_game(out_dir, "near")
	set_process(true)
	push_error("demo: boom, a test error")
	await _wait(5.0)
	_capture_game(out_dir, "auto")
	print("demo: selftest DONE")
	get_tree().quit(0)


func _wait(s: float) -> void:
	await get_tree().create_timer(s, true, false, true).timeout


func _latest_id() -> String:
	var ids := DirAccess.get_directories_at(ProjectSettings.globalize_path("res://.playmark/done")) + DirAccess.get_directories_at(ProjectSettings.globalize_path("res://.playmark/inbox"))
	var top := ""
	for i in ids:
		if i > top:
			top = i
	return top


func _cli(args: Array) -> void:
	var out := []
	OS.execute("node", [ProjectSettings.globalize_path("res://").path_join("../scripts/inbox.mjs")] + args, out, true)
	print("demo: cli ", " ".join(args), " -> ", "".join(out).strip_edges())


## In-engine captures only: the game's own frame with Playmark's native windows composited
## where they sit. Never a screenshot of the screen, so nothing else on the desktop leaks in.
func _capture(ov: Window, out_dir: String, name: String) -> void:
	if not out_dir.is_empty():
		ov.get_texture().get_image().save_png(out_dir.path_join(name + ".png"))


func _capture_game(out_dir: String, name: String) -> void:
	if out_dir.is_empty():
		return
	var win := DisplayServer.window_get_size()
	var img := get_viewport().get_texture().get_image()
	img.resize(win.x, win.y, Image.INTERPOLATE_BILINEAR)
	img.convert(Image.FORMAT_RGBA8)
	var hud: Window = Playmark.hud
	if hud.visible:
		var h := hud.get_texture().get_image()
		h.convert(Image.FORMAT_RGBA8)
		img.blit_rect(h, Rect2i(Vector2i.ZERO, h.get_size()), hud.position - DisplayServer.window_get_position())
	img.save_png(out_dir.path_join(name + ".png"))
