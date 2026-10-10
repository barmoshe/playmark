extends Node
## Playmark runtime (autoload "Playmark").
##
## Play, and when something is off press Ctrl+Shift+M: the game freezes, you pin or box
## what you see (rewind up to 5 s if you missed it), stamp a category, write a note.
## The mark lands in res://.playmark/inbox for Claude Code. Past marks come back as
## ghosts in the world, and when Claude fixes one, a toast says so in-game.
##
## Game hooks (all optional):
##   Playmark.add_context("wand", func(): return {...})   # state saved with every mark
##   Playmark.set_player($Player)                         # ghosts open when the player is near
##   Playmark.set_warp(save_fn, load_fn)                  # save_fn() -> Dictionary, load_fn(d)
##   Playmark.set_scope(func(): return "room/" + room_id) # ghosts only where they belong
##                                                        # (games with many rooms in one scene)
##   Playmark.open()                                      # from a debug button
## or put a node in group "playmark_context" with _playmark_context() -> Dictionary.

signal opened
signal closed
signal saved(location: String)

const VERSION := "0.3.0"
const Settings := preload("res://addons/playmark/settings.gd")
const Brand := preload("res://addons/playmark/brand.gd")
const Overlay := preload("res://addons/playmark/overlay.gd")
const Hud := preload("res://addons/playmark/hud.gd")
const Ghosts := preload("res://addons/playmark/ghosts.gd")
const Sfx := preload("res://addons/playmark/sfx.gd")
const Images := preload("res://addons/playmark/images.gd")
const Snapshot := preload("res://addons/playmark/snapshot.gd")
const FileSink := preload("res://addons/playmark/sinks/file_sink.gd")
const PlaymarkLogger := preload("res://addons/playmark/logger.gd")

const COMBO_WINDOW_S := 90.0
const POLL_S := 2.0
const MAX_AUTO_MARKS := 3

var enabled := false
var sink: RefCounted  # anything with send(data, images, log_text) -> String
var hud: Window
var ghosts: Node2D

var _root := ""
var _logger: PlaymarkLogger
var _sfx: Node
var _contexts := {}
var _player: Node2D
var _warp_save := Callable()
var _warp_load := Callable()
var _scope_fn := Callable()
var _scope := ""
var _next_scope_check := 0.0
var _ghost_layer: CanvasLayer
var _shortcut := {}
var _ghost_key := {}
var _was_down := false
var _ghost_was_down := false
var _overlay: Window
var _session := {}
var _frames: Array[Image] = []
var _frame_us := PackedInt64Array()
var _clip_every_us := 0
var _clip_max := 0
var _clip_width := 640
var _next_frame_us := 0
var _known := {}  # id -> {seq, status, mtime, ...} for every mark on disk
var _next_poll := 0.0
var _saved_this_session := 0
var _combo := 0
var _last_save_s := -1000.0
var _auto_marks := 0
var _auto_seen := {}
var _scene: Node
var _args := {}


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	_logger = PlaymarkLogger.new(int(Settings.value("capture/log_lines")))
	OS.add_logger(_logger)
	enabled = _should_run()
	if not enabled:
		return
	_args = _parse_args()
	_shortcut = _parse_shortcut(str(Settings.value("general/shortcut")))
	_ghost_key = _parse_shortcut(str(Settings.value("ghosts/shortcut")))
	var fps := int(Settings.value("capture/clip_fps"))
	if fps > 0:
		_clip_every_us = 1_000_000 / fps
		_clip_max = maxi(1, int(float(Settings.value("capture/clip_seconds")) * fps))
	_clip_width = int(Settings.value("capture/clip_max_width"))
	_root = _output_root()
	sink = FileSink.new(_root)
	_sfx = Sfx.new()
	add_child(_sfx)
	hud = Hud.new()
	hud.always = _args.has("playmark-selftest")
	add_child(hud)
	# Their own canvas layer, so the game's CanvasModulate (ambient darkness) can't dim
	# them. Ghosts place themselves through the camera and draw in screen pixels.
	_ghost_layer = CanvasLayer.new()
	_ghost_layer.layer = 90
	add_child(_ghost_layer)
	ghosts = Ghosts.new()
	ghosts.visible = bool(Settings.value("ghosts/visible"))
	_ghost_layer.add_child(ghosts)
	ghosts.near_changed.connect(_on_near_ghost)
	_poll(true)
	if _args.has("playmark-warp"):
		_warp_to.call_deferred(str(_args["playmark-warp"]))
	elif _args.has("playmark-smoke"):
		_smoke.call_deferred(str(_args["playmark-smoke"]))
	# --playmark-driver=<file.gd>: a script (extends Node) that drives Playmark for tests or
	# recordings. Loaded from outside the project, so nothing ships in the game.
	if _args.has("playmark-driver"):
		var driver_script = load(str(_args["playmark-driver"]))
		if driver_script:
			var driver: Node = driver_script.new()
			driver.process_mode = Node.PROCESS_MODE_ALWAYS
			add_child(driver)
	else:
		_welcome.call_deferred()


func _exit_tree() -> void:
	if _logger:
		OS.remove_logger(_logger)


# --- Public API -----------------------------------------------------------------------

func add_context(key: String, provider: Callable) -> void:
	_contexts[key] = provider


func remove_context(key: String) -> void:
	_contexts.erase(key)


func set_player(node: Node2D) -> void:
	_player = node


func set_warp(save_fn: Callable, load_fn: Callable) -> void:
	_warp_save = save_fn
	_warp_load = load_fn


func set_scope(fn: Callable) -> void:
	_scope_fn = fn
	_scope = _current_scope()
	_refresh_ghosts()


func is_open() -> bool:
	return _overlay != null


## Freezes the frame and opens the marking window. Returns it (tests drive it directly).
func open() -> Window:
	if not enabled or _overlay:
		return _overlay
	var shot := _grab()
	if shot == null:
		return null
	var now := Time.get_ticks_usec()
	var counts := _counts()
	var combo := _combo + 1 if _now_s() - _last_save_s < COMBO_WINDOW_S else 1
	_session = {
		"shot": shot,
		"frames": _frames.duplicate(),
		"offsets": Array(_frame_us).map(func(t): return snappedf((t - now) / 1_000_000.0, 0.01)),
		"mouse": Snapshot.mouse_in_shot(self, shot.get_size()),
		"paused": get_tree().paused,
		"mouse_mode": Input.mouse_mode,
		"time": Time.get_datetime_dict_from_system(),
		"seq": _next_seq(),
		"combo": combo,
	}
	_frames.clear()
	_frame_us.clear()
	get_tree().paused = true
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	var scene := get_tree().current_scene
	_overlay = Overlay.new(shot, _session.frames, _session.offsets, {
		"seq": _session.seq,
		"scene": scene.scene_file_path if scene else "",
		"fps": int(Engine.get_frames_per_second()),
		"session": _saved_this_session,
		"inbox": counts.open,
		"fixed": counts.fixed,
		"combo": combo,
	}, _sfx)
	_overlay.submitted.connect(_on_submitted)
	_overlay.cancelled.connect(_close)
	_overlay.finished.connect(_close)
	add_child(_overlay)
	opened.emit()
	return _overlay


# --- Frame loop -----------------------------------------------------------------------

func _process(_delta: float) -> void:
	if not enabled:
		return
	_follow_scene()
	var down := _keys_down(_shortcut)
	if down and not _was_down and not _overlay:
		open()
	_was_down = down
	var gdown := _keys_down(_ghost_key)
	if gdown and not _ghost_was_down and not _overlay:
		ghosts.visible = not ghosts.visible
		_sfx.play("chip", 1.2 if ghosts.visible else 0.8)
		hud.toast("ready", "Ghosts %s" % ("on" if ghosts.visible else "off"), "%d marks in this scene" % ghosts.marks.size(), Brand.keys(str(Settings.value("ghosts/shortcut"))) + " TO TOGGLE", 1.6)
	_ghost_was_down = gdown
	if _overlay:
		return
	var now := Time.get_ticks_usec()
	if _clip_max > 0 and now >= _next_frame_us and Engine.get_process_frames() > 10:
		_next_frame_us = now + _clip_every_us
		_grab_clip_frame(now)
	if _now_s() >= _next_poll:
		_poll(false)
	var err := _logger.take_error()
	if not err.is_empty():
		_auto_mark(err)


func _grab() -> Image:
	var tex := get_viewport().get_texture()
	var img := tex.get_image() if tex else null
	if img == null:
		push_warning("Playmark: no frame to capture (headless?)")
		return null
	img.convert(Image.FORMAT_RGBA8)
	return img


func _grab_clip_frame(now: int) -> void:
	var img := get_viewport().get_texture().get_image()
	if img == null:
		return
	if img.get_width() > _clip_width:
		img.resize(_clip_width, roundi(img.get_height() * float(_clip_width) / img.get_width()), Image.INTERPOLATE_BILINEAR)
	img.convert(Image.FORMAT_RGBA8)
	_frames.append(img)
	_frame_us.append(now)
	if _frames.size() > _clip_max:
		_frames.pop_front()
		_frame_us.remove_at(0)


## Ghosts belong to a scene (and a scope inside it): refresh when either changes.
func _follow_scene() -> void:
	var scene := get_tree().current_scene
	var now := _now_s()
	if scene == _scene and now < _next_scope_check:
		return
	_next_scope_check = now + 0.5
	var scope := _current_scope()
	if scene == _scene and scope == _scope:
		return
	_scene = scene
	_scope = scope
	_refresh_ghosts()


func _current_scope() -> String:
	if _scope_fn.is_valid():
		return str(_scope_fn.call())
	return ""


# --- Saving ---------------------------------------------------------------------------

func _on_submitted(note: String, category: String, marks: Array, frame_index: int) -> void:
	var image: Image = _session.shot if frame_index < 0 else _session.frames[frame_index]
	var offset := 0.0 if frame_index < 0 else float(_session.offsets[frame_index])
	var location := _save(image, _session.frames, _session.offsets, marks, note, category, offset, "player", _session.seq, _session.time)
	if not location.is_empty():
		_saved_this_session += 1
		_combo = _session.combo
		_last_save_s = _now_s()
	if _overlay:
		_overlay.finish(not location.is_empty())


func _save(image: Image, frames: Array, offsets: Array, marks: Array, note: String, category: String, offset_s: float, source: String, seq: int, t: Dictionary) -> String:
	var id := "%04d%02d%02d-%02d%02d%02d-%04x" % [t.year, t.month, t.day, t.hour, t.minute, t.second, randi() % 0x10000]
	var w := float(image.get_width())
	var h := float(image.get_height())
	var snap := Snapshot.collect(self, image.get_size(), marks, _session.get("mouse", Vector2.ZERO), _contexts)
	var mark_list := []
	for i in marks.size():
		var m: Dictionary = marks[i].duplicate()
		m.number = i + 1
		m.color = Images.color_name(m)
		m.norm = [snappedf(m.x / w, 0.001), snappedf(m.y / h, 0.001)]
		if m.type == "box":
			m.norm += [snappedf(m.w / w, 0.001), snappedf(m.h / h, 0.001)]
		var under: Dictionary = snap.under_marks[i]
		if under.has("world"):
			m.world = under.world
		if under.has("world_3d"):
			m.world_3d = under.world_3d
		mark_list.append(m)

	var data := {
		"playmark": VERSION,
		"id": id,
		"seq": seq,
		"created_at": Time.get_datetime_string_from_datetime_dict(t, false),
		"status": "new",
		"source": source,
		"category": category,
		"note": note,
		"marks": mark_list,
		"frame_offset_s": offset_s,
		"scope": _current_scope(),
	}
	data.merge(snap)
	data.warp = {
		"scene": data.scene.path,
		"camera": Snapshot.camera_center(self),
		"data": Snapshot._plain(_warp_save.call()) if _warp_save.is_valid() else null,
	}
	var images := {"screenshot.png": image, "annotated.png": Images.annotate(image, marks)}
	var files := ["screenshot.png", "annotated.png", "log.txt"]
	if not frames.is_empty():
		images["clip_sheet.png"] = Images.contact_sheet(frames)
		files.append("clip_sheet.png")
		for i in frames.size():
			images["clip/%03d.png" % i] = frames[i]
	data.files = files
	data.clip = {
		"frames": frames.size(),
		"fps": int(Settings.value("capture/clip_fps")),
		"offsets_s": offsets,
		"dir": "clip/" if not frames.is_empty() else "",
	}
	var location: String = sink.send(data, images, _logger.dump())
	if location.is_empty():
		push_error("Playmark: the mark was not saved")
		return ""
	print("Playmark: saved #%d %s" % [seq, location])
	_known[id] = {"seq": seq, "status": "new", "note": note, "category": category, "scene": data.scene.path, "scope": data.scope, "marks": mark_list, "mtime": 0}
	_refresh_ghosts()
	saved.emit(location)
	return location


## The first script error of its kind (max 3 a session) becomes a bug mark by itself.
func _auto_mark(err: String) -> void:
	if not Settings.value("capture/auto_on_error") or _auto_marks >= MAX_AUTO_MARKS or _auto_seen.has(err) or _overlay:
		return
	_auto_seen[err] = true
	_auto_marks += 1
	var shot := _grab()
	if shot == null:
		return
	var now := Time.get_ticks_usec()
	var offsets := Array(_frame_us).map(func(t): return snappedf((t - now) / 1_000_000.0, 0.01))
	var seq := _next_seq()
	var loc := _save(shot, _frames.duplicate(), offsets, [], "Auto: " + err, "bug", 0.0, "auto-error", seq, Time.get_datetime_dict_from_system())
	if not loc.is_empty():
		_sfx.play("tick", 0.7)
		hud.toast("error", "Saved as #%d" % seq, err, "BUG MARK · CLIP + LOG ATTACHED")


func _close() -> void:
	if _overlay:
		_overlay.queue_free()
		_overlay = null
	if not _session.is_empty():
		get_tree().paused = _session.paused
		Input.mouse_mode = _session.mouse_mode
	_session = {}
	_was_down = true  # the shortcut must be released before it opens again
	closed.emit()


# --- The loop back from Claude --------------------------------------------------------

## Reads every mark's status. Changes since the last poll become toasts.
func _poll(first: bool) -> void:
	_next_poll = _now_s() + POLL_S
	var seen := {}
	var changed := false
	for box in ["inbox", "done"]:
		var dir := _root.path_join(box)
		if not DirAccess.dir_exists_absolute(dir):
			continue
		for id in DirAccess.get_directories_at(dir):
			var file := dir.path_join(id).path_join("mark.json")
			var mtime := FileAccess.get_modified_time(file)
			seen[id] = true
			var prev: Dictionary = _known.get(id, {})
			if prev.get("mtime", -1) == mtime and prev.get("box", "") == box:
				continue
			var d = JSON.parse_string(FileAccess.get_file_as_string(file))
			if not d is Dictionary:
				continue
			var entry := {"seq": int(d.get("seq", 0)), "status": str(d.get("status", "new")), "note": str(d.get("note", "")),
				"category": str(d.get("category", "")), "scene": str(d.get("scene", {}).get("path", "")), "scope": str(d.get("scope", "")), "marks": d.get("marks", []),
				"resolution": d.get("resolution", {}), "mtime": mtime, "box": box}
			_known[id] = entry
			changed = true
			if first or prev.is_empty() or prev.get("status") == entry.status:
				continue
			if entry.status == "working":
				hud.toast("working", "On #%d now" % entry.seq, entry.note if entry.note else "(no note)", "CLAUDE CODE")
			elif entry.status == "fixed":
				_sfx.play("fixed")
				var res: Dictionary = entry.resolution if entry.resolution is Dictionary else {}
				hud.toast("fixed", "Fixed #%d" % entry.seq, str(res.get("note", entry.note)), "GO RETEST IT · " + Brand.keys(str(Settings.value("ghosts/shortcut"))) + " GHOSTS", 6.0)
	for id in _known.keys():
		if not seen.has(id):
			_known.erase(id)
			changed = true
	if changed:
		_refresh_ghosts()


func _refresh_ghosts() -> void:
	if ghosts == null:
		return
	var scene := get_tree().current_scene
	var path := scene.scene_file_path if scene else ""
	var hours := float(Settings.value("ghosts/fixed_hours"))
	var list := []
	for id in _known:
		var e: Dictionary = _known[id]
		if e.scene != path or e.get("scope", "") != _scope or e.marks.is_empty():
			continue
		if e.status == "fixed" and hours >= 0 and _age_hours(id) > hours:
			continue
		var first: Dictionary = e.marks[0]
		if not first.has("world"):
			continue
		list.append({"id": id, "seq": e.seq, "status": e.status, "note": e.note, "category": e.category,
			"resolution": e.get("resolution", {}), "world": first.world})
	ghosts.marks = list
	if is_instance_valid(_player):
		ghosts.anchor = _player


func _on_near_ghost(m: Dictionary) -> void:
	if m.is_empty():
		hud.card({})
		return
	_sfx.play("tick", 1.3)
	var res: Dictionary = m.resolution if m.get("resolution") is Dictionary else {}
	var fixed: bool = m.status == "fixed"
	hud.card({
		"kind": "fixed" if fixed else ("working" if m.status == "working" else "ghost"),
		"kicker": "MARK #%d · %s" % [m.seq, (m.category if m.category else "note").to_upper()],
		"title": ("Fixed: " + str(res.get("note", ""))) if fixed and res.get("note") else (m.note if m.note else "(no note)"),
		"body": m.note if fixed else "",
		"meta": {"fixed": "FIXED BY CLAUDE · RETEST IT", "working": "CLAUDE IS ON IT", "new": "OPEN"}.get(m.status, ""),
	})


func _welcome() -> void:
	var c := _counts()
	hud.toast("ready", "Playmark is on", "%d open · %d fixed" % [c.open, c.fixed],
		"%s MARK · %s GHOSTS" % [Brand.keys(str(Settings.value("general/shortcut"))), Brand.keys(str(Settings.value("ghosts/shortcut")))], 3.5)


## --playmark-warp=<seq or id>: load the mark's scene, hand its warp data to the game,
## and with --playmark-shot=<png> save a frame and quit (Claude checks its fix this way).
func _warp_to(ref: String) -> void:
	var target := ""
	for id in _known:
		if id == ref or id.ends_with(ref) or str(_known[id].seq) == ref.trim_prefix("#"):
			target = id
	if target.is_empty():
		push_warning("Playmark: no mark '%s' to warp to" % ref)
		return
	var dir := _root.path_join(_known[target].box).path_join(target)
	var d = JSON.parse_string(FileAccess.get_file_as_string(dir.path_join("mark.json")))
	var warp: Dictionary = d.get("warp", {}) if d is Dictionary else {}
	var scene_path := str(warp.get("scene", ""))
	if not scene_path.is_empty() and (get_tree().current_scene == null or get_tree().current_scene.scene_file_path != scene_path):
		get_tree().change_scene_to_file(scene_path)
		for i in 3:
			await get_tree().process_frame
	if _warp_load.is_valid() and warp.get("data") != null:
		_warp_load.call(warp.data)
	_follow_scene()
	hud.toast("warp", "At #%d" % _known[target].seq, _known[target].note, "WARPED BACK TO THE MARK")
	if _args.has("playmark-shot"):
		for i in 45:
			await get_tree().process_frame
		var img := _grab()
		if img:
			img.save_png(str(_args["playmark-shot"]))
			print("Playmark: warp shot %s" % _args["playmark-shot"])
		get_tree().quit()


## --playmark-smoke=<dir>: an unattended check for any game. Plays 6 s, opens the
## overlay, pins the center, boxes the mouse corner, saves the overlay image to <dir>,
## saves the mark, quits.
func _smoke(out_dir: String) -> void:
	hud.always = true
	await get_tree().create_timer(6.0, true, false, true).timeout
	var ov := open()
	if ov == null:
		print("Playmark smoke: FAILED to open")
		get_tree().quit(1)
		return
	await get_tree().create_timer(0.7, true, false, true).timeout
	var s := Vector2(ov.current_image().get_size())
	ov.add_mark({"type": "pin", "x": s.x * 0.5, "y": s.y * 0.5})
	ov.add_mark({"type": "box", "x": s.x * 0.1, "y": s.y * 0.15, "w": s.x * 0.2, "h": s.y * 0.25})
	ov.set_note("Smoke test: the overlay opens, marks land, the mark saves.", "bug")
	await get_tree().create_timer(0.5, true, false, true).timeout
	if not out_dir.is_empty():
		DirAccess.make_dir_recursive_absolute(out_dir)
		ov.get_texture().get_image().save_png(out_dir.path_join("smoke-overlay.png"))
	ov.submit()
	await closed
	await get_tree().create_timer(1.0, true, false, true).timeout
	if not out_dir.is_empty():
		var img := _grab()
		if img:
			img.save_png(out_dir.path_join("smoke-game.png"))
	print("Playmark smoke: OK")
	get_tree().quit(0)


# --- Helpers --------------------------------------------------------------------------

func _counts() -> Dictionary:
	var open := 0
	var fixed := 0
	for id in _known:
		if _known[id].status == "fixed":
			fixed += 1
		else:
			open += 1
	return {"open": open, "fixed": fixed}


func _next_seq() -> int:
	var top := 0
	for id in _known:
		top = maxi(top, int(_known[id].seq))
	return top + 1


func _age_hours(id: String) -> float:
	var e: Dictionary = _known[id]
	return (Time.get_unix_time_from_system() - float(e.get("mtime", 0))) / 3600.0


func _now_s() -> float:
	return Time.get_ticks_msec() / 1000.0


func _should_run() -> bool:
	if not Settings.value("general/enabled"):
		return false
	if not OS.is_debug_build() and not Settings.value("general/release_builds"):
		return false
	if OS.has_feature("web") or OS.has_feature("mobile"):
		print("Playmark: %s is coming soon. Desktop only for now." % OS.get_name())
		return false
	return DisplayServer.get_name() != "headless"


func _output_root() -> String:
	if OS.has_feature("editor"):
		return ProjectSettings.globalize_path(str(Settings.value("output/dir")))
	return ProjectSettings.globalize_path("user://playmark")


func _parse_args() -> Dictionary:
	var out := {}
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--playmark-"):
			var kv := a.trim_prefix("--").split("=", true, 1)
			out[kv[0]] = kv[1] if kv.size() > 1 else ""
	return out


func _parse_shortcut(text: String) -> Dictionary:
	var out := {"ctrl": false, "shift": false, "alt": false, "meta": false, "key": KEY_NONE}
	for part in text.split("+", false):
		match part.strip_edges().to_lower():
			"ctrl", "control":
				out.ctrl = true
			"shift":
				out.shift = true
			"alt", "option":
				out.alt = true
			"cmd", "command", "meta", "super":
				out.meta = true
			var k:
				out.key = OS.find_keycode_from_string(k.capitalize() if k.length() > 1 else k.to_upper())
	if out.key == KEY_NONE:
		push_warning("Playmark: can't read shortcut '%s'" % text)
	return out


func _keys_down(s: Dictionary) -> bool:
	return (s.get("key", KEY_NONE) != KEY_NONE
		and Input.is_physical_key_pressed(s.key)
		and Input.is_key_pressed(KEY_CTRL) == s.ctrl
		and Input.is_key_pressed(KEY_SHIFT) == s.shift
		and Input.is_key_pressed(KEY_ALT) == s.alt
		and Input.is_key_pressed(KEY_META) == s.meta)
