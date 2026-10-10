extends Window
## Photo mode for feedback. A native OS window over the game (so it renders at screen
## resolution even when the game draws at 480x270): the frozen frame on a blueprint
## stage, a rewind strip, category stamps and a note. Saving stamps the frame and
## ejects it into the inbox counter.

signal submitted(note: String, category: String, marks: Array, frame_index: int)
signal cancelled
signal finished

const Brand := preload("res://addons/playmark/brand.gd")
const CATEGORIES := [["bug", "BUG"], ["feel", "FEEL"], ["art", "ART"], ["balance", "BALANCE"], ["idea", "IDEA"]]
const MAX_MARKS := 9

## Marks in normalized frame coordinates (0..1): {type, x, y[, w, h]}.
var marks: Array = []
## -1 is the freeze frame; 0..n-1 index the clip, oldest first.
var frame_index := -1
var info: Dictionary
var sfx: Node

var _shot: Image
var _frames: Array
var _offsets: Array
var _textures := {}
var _stage: Stage
var _scrub: Scrubber
var _note: TextEdit
var _stamps: Array[Button] = []
var _inbox_label: Label
var _hint: Label
var _busy := false
var save_button: Button


func _init(shot: Image, frames: Array, offsets: Array, info_: Dictionary, sfx_: Node) -> void:
	_shot = shot
	_frames = frames
	_offsets = offsets
	info = info_
	sfx = sfx_
	title = "Playmark"
	visible = false  # force_native can only change while hidden
	force_native = true
	borderless = true
	always_on_top = true
	transient = false
	unresizable = true
	wrap_controls = false
	theme = Brand.theme()
	var screen := DisplayServer.window_get_current_screen()
	var k := DisplayServer.screen_get_scale(screen)
	content_scale_factor = k
	# Cover the game window, but never smaller than a comfortable workspace.
	var game_pos := DisplayServer.window_get_position()
	var game_size := DisplayServer.window_get_size()
	var usable := DisplayServer.screen_get_usable_rect(screen)
	var want := Vector2i(maxi(game_size.x, int(1040 * k)), maxi(game_size.y, int(680 * k)))
	size = want.min(Vector2i(Vector2(usable.size) * 0.96))
	var pos := game_pos + (game_size - size) / 2
	position = pos.clamp(usable.position, usable.end - size)
	close_requested.connect(_cancel)
	window_input.connect(_on_window_input)
	_build()


func _ready() -> void:
	show()
	grab_focus()
	_stage.flash = 1.0
	_stage.zoom = 1.04
	var tw := create_tween().set_parallel()
	tw.tween_property(_stage, "flash", 0.0, 0.28).set_ease(Tween.EASE_OUT).set_trans(Tween.TRANS_QUAD)
	tw.tween_property(_stage, "zoom", 1.0, 0.4).set_ease(Tween.EASE_OUT).set_trans(Tween.TRANS_QUART)
	_play("shutter")


# --- API (the runtime and tests drive these) ---------------------------------------

func current_image() -> Image:
	return _shot if frame_index < 0 else _frames[frame_index]


func current_texture() -> Texture2D:
	if not _textures.has(frame_index):
		_textures[frame_index] = ImageTexture.create_from_image(current_image())
	return _textures[frame_index]


## A mark in pixels of the current frame.
func add_mark(m: Dictionary) -> void:
	if marks.size() >= MAX_MARKS or _busy:
		return
	var s := Vector2(current_image().get_size())
	var n := {"type": m.type, "x": m.x / s.x, "y": m.y / s.y}
	if m.type == "box":
		n.w = m.w / s.x
		n.h = m.h / s.y
	marks.append(n)
	_stage.pop(marks.size() - 1)
	_play("pop" if m.type == "pin" else "tick", 1.0 + 0.06 * (marks.size() - 1))
	_update_hint()


func undo_mark() -> void:
	if not marks.is_empty() and not _busy:
		marks.pop_back()
		_play("swish", 1.4)
		_stage.queue_redraw()
		_update_hint()


func set_frame(i: int) -> void:
	i = clampi(i, -1, _frames.size() - 1)
	if i != frame_index:
		frame_index = i
		_play("tick", 1.6)
		_stage.queue_redraw()
		_scrub.queue_redraw()


func set_note(text: String, category := "") -> void:
	_note.text = text
	for i in CATEGORIES.size():
		_stamps[i].button_pressed = CATEGORIES[i][0] == category


func category() -> String:
	for i in CATEGORIES.size():
		if _stamps[i].button_pressed:
			return CATEGORIES[i][0]
	return ""


## Stamp the frame, then hand the mark over. The runtime saves it and calls finish().
func submit() -> void:
	if _busy:
		return
	_busy = true
	_note.release_focus()
	_stage.stamp_text = "MARKED #%d" % info.get("seq", 0)
	_stage.stamp_sub = "COMBO ×%d" % info.combo if info.get("combo", 1) > 1 else (category().to_upper() if category() else "NOTED")
	var tw := create_tween()
	tw.tween_property(_stage, "stamp_t", 1.0, 0.3).from(0.0)
	tw.parallel().tween_callback(func(): _play("stamp"); _stage.shake = 1.0).set_delay(0.2)
	tw.tween_interval(0.3)
	tw.tween_callback(func(): submitted.emit(_note.text.strip_edges(), category(), _marks_in_pixels(), frame_index))


## Called after the mark is saved: eject the frame into the inbox counter.
func finish(saved: bool) -> void:
	var tw := create_tween()
	if saved:
		tw.tween_property(_stage, "eject", 1.0, 0.38).set_ease(Tween.EASE_IN).set_trans(Tween.TRANS_BACK)
		tw.tween_callback(func():
			_inbox_label.text = str(int(info.get("inbox", 0)) + 1)
			_inbox_label.pivot_offset = _inbox_label.size / 2
			_play("chip", 1.5))
		tw.tween_property(_inbox_label, "scale", Vector2.ONE * 1.5, 0.08)
		tw.tween_property(_inbox_label, "scale", Vector2.ONE, 0.18).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
		tw.tween_interval(0.25)
	tw.tween_callback(func(): finished.emit())


func _marks_in_pixels() -> Array:
	var s := Vector2(current_image().get_size())
	var out := []
	for m in marks:
		var p := {"type": m.type, "x": roundi(m.x * s.x), "y": roundi(m.y * s.y)}
		if m.type == "box":
			p.w = maxi(roundi(m.w * s.x), 1)
			p.h = maxi(roundi(m.h * s.y), 1)
		out.append(p)
	return out


func _cancel() -> void:
	if not _busy:
		_busy = true
		_play("swish")
		cancelled.emit()


func _play(sfx_name: String, pitch := 1.0) -> void:
	if sfx:
		sfx.play(sfx_name, pitch)


# --- Keyboard: marking is mouse, everything else is one key -------------------------

func _on_window_input(event: InputEvent) -> void:
	var key := event as InputEventKey
	if key == null or not key.pressed or key.echo or _busy:
		return
	var mod := key.ctrl_pressed or key.meta_pressed
	if key.keycode == KEY_ESCAPE:
		_cancel()
	elif mod and key.keycode in [KEY_ENTER, KEY_KP_ENTER]:
		submit()
	elif mod and key.keycode == KEY_Z:
		undo_mark()
	elif _note.has_focus():
		return
	elif key.keycode >= KEY_1 and key.keycode <= KEY_5 and not mod:
		var b := _stamps[key.keycode - KEY_1]
		b.button_pressed = not b.button_pressed
		_play("chip")
	elif key.keycode == KEY_LEFT:
		set_frame(_frames.size() - 1 if frame_index < 0 else maxi(frame_index - 1, 0))
	elif key.keycode == KEY_RIGHT:
		set_frame(-1 if frame_index >= _frames.size() - 1 else frame_index + 1)
	elif key.keycode in [KEY_ENTER, KEY_TAB]:
		_note.grab_focus()
	elif key.unicode >= 32 and not mod:
		_note.grab_focus()  # typing anywhere starts the note; this key lands in it
		return
	else:
		return
	set_input_as_handled()


# --- Layout -------------------------------------------------------------------------

func _build() -> void:
	var bg := ColorRect.new()
	bg.color = Brand.GROUND
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(bg)

	var margin := MarginContainer.new()
	margin.set_anchors_preset(Control.PRESET_FULL_RECT)
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 20 if side != "top" else 14)
	add_child(margin)

	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 10)
	margin.add_child(col)

	# Masthead: the mark, the name, a mono dateline, and the scoreboard.
	var head := HBoxContainer.new()
	head.add_theme_constant_override("separation", 12)
	col.add_child(head)
	var logo := TextureRect.new()
	logo.texture = Brand.mark(int(64 * content_scale_factor))
	logo.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	logo.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	logo.custom_minimum_size = Vector2(32, 32)
	head.add_child(logo)
	var name_col := VBoxContainer.new()
	name_col.add_theme_constant_override("separation", -2)
	name_col.alignment = BoxContainer.ALIGNMENT_CENTER
	head.add_child(name_col)
	name_col.add_child(_label("PLAYMARK", Brand.heebo(900), 26, Brand.PAPER))
	name_col.add_child(_label(_dateline(), Brand.mono(), 11, Brand.INK_2))
	var spacer := Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(spacer)
	head.add_child(_stat("THIS SESSION", str(int(info.get("session", 0)) + 1), Brand.PAPER))
	var inbox_stat := _stat("INBOX", str(info.get("inbox", 0)), Brand.ORANGE)
	_inbox_label = inbox_stat.get_child(0)
	head.add_child(inbox_stat)
	head.add_child(_stat("FIXED", str(info.get("fixed", 0)), Brand.BLUE))

	col.add_child(Rule.new())

	_stage = Stage.new()
	_stage.overlay = self
	_stage.size_flags_vertical = Control.SIZE_EXPAND_FILL
	col.add_child(_stage)

	_scrub = Scrubber.new()
	_scrub.overlay = self
	_scrub.custom_minimum_size = Vector2(0, 30)
	col.add_child(_scrub)

	var deck := HBoxContainer.new()
	deck.add_theme_constant_override("separation", 16)
	col.add_child(deck)
	var left := VBoxContainer.new()
	left.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	left.add_theme_constant_override("separation", 8)
	deck.add_child(left)
	var stamps := HBoxContainer.new()
	stamps.add_theme_constant_override("separation", 6)
	left.add_child(stamps)
	for i in CATEGORIES.size():
		var b := Button.new()
		b.text = "%d  %s" % [i + 1, CATEGORIES[i][1]]
		b.toggle_mode = true
		b.focus_mode = Control.FOCUS_NONE
		b.toggled.connect(func(on: bool):
			if on:
				for other in _stamps:
					if other != b:
						other.set_pressed_no_signal(false)
			_stage.queue_redraw())
		b.pressed.connect(func(): _play("chip"))
		stamps.add_child(b)
		_stamps.append(b)
	_note = TextEdit.new()
	_note.placeholder_text = "What did you notice?"
	_note.custom_minimum_size = Vector2(0, 74)
	_note.wrap_mode = TextEdit.LINE_WRAPPING_BOUNDARY
	left.add_child(_note)

	var right := VBoxContainer.new()
	right.alignment = BoxContainer.ALIGNMENT_END
	right.add_theme_constant_override("separation", 6)
	deck.add_child(right)
	var save := Button.new()
	save.theme_type_variation = "PrimaryButton"
	save.text = "SAVE MARK  %s↵" % ("⌘" if OS.get_name() == "macOS" else "Ctrl+")
	save.focus_mode = Control.FOCUS_NONE
	save.custom_minimum_size = Vector2(196, 50)
	save.pressed.connect(submit)
	right.add_child(save)
	save_button = save
	var cancel := Button.new()
	cancel.theme_type_variation = "GhostButton"
	cancel.text = "ESC  CANCEL"
	cancel.focus_mode = Control.FOCUS_NONE
	cancel.pressed.connect(_cancel)
	right.add_child(cancel)

	_hint = _label("", Brand.mono(), 11, Brand.INK_2)
	col.add_child(_hint)
	_update_hint()


func _dateline() -> String:
	var scene := str(info.get("scene", "")).get_file().get_basename().to_upper()
	var t := Time.get_time_dict_from_system()
	var parts := ["MARK #%d" % info.get("seq", 0), "%02d:%02d" % [t.hour, t.minute]]
	if not scene.is_empty():
		parts.insert(1, scene)
	return "   ".join(parts)


func _stat(caption: String, value: String, color: Color) -> VBoxContainer:
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", -4)
	box.custom_minimum_size = Vector2(64, 0)
	var v := _label(value, Brand.heebo(900), 26, color)
	v.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	box.add_child(v)
	var c := _label(caption, Brand.mono(), 10, Brand.INK_2)
	c.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	box.add_child(c)
	return box


func _label(text: String, font: Font, font_size: int, color: Color) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_override("font", font)
	l.add_theme_font_size_override("font_size", font_size)
	l.add_theme_color_override("font_color", color)
	return l


func _update_hint() -> void:
	if _hint:
		var rewind := "   ←→ REWIND" if not _frames.is_empty() else ""
		_hint.text = "CLICK PIN   DRAG BOX   %sZ UNDO%s   1-5 STAMP   TYPE TO WRITE   %d/%d MARKS" % [
			"⌘" if OS.get_name() == "macOS" else "CTRL+", rewind, marks.size(), MAX_MARKS]


## The masthead's double rule: 2px over 1px.
class Rule:
	extends Control

	func _init() -> void:
		custom_minimum_size = Vector2(0, 6)

	func _draw() -> void:
		draw_rect(Rect2(0, 0, size.x, 2), Brand.PAPER)
		draw_rect(Rect2(0, 4, size.x, 1), Brand.PAPER)


## The frame on a blueprint grid, with marks, the stamp and the juice.
class Stage:
	extends Control

	var overlay: Window
	var flash := 0.0
	var zoom := 1.0
	var shake := 0.0
	var stamp_t := -1.0
	var stamp_text := ""
	var stamp_sub := ""
	var eject := 0.0
	var _pops := {}
	var _drag_from = null
	var _drag_to := Vector2.ZERO
	var _t := 0.0

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_STOP
		clip_contents = true
		texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
		mouse_default_cursor_shape = Control.CURSOR_CROSS

	func pop(i: int) -> void:
		_pops[i] = 0.0

	func _process(delta: float) -> void:
		_t += delta
		shake = maxf(shake - delta * 4.0, 0.0)
		for i in _pops.keys():
			_pops[i] += delta / 0.22
			if _pops[i] >= 1.0:
				_pops.erase(i)
		queue_redraw()

	func frame_rect() -> Rect2:
		var img := Vector2(overlay.current_image().get_size())
		var room := size - Vector2(36, 60)  # room above for the FREEZE tag
		var s := minf(room.x / img.x, room.y / img.y)
		var shown := img * s
		return Rect2((size - shown) / 2 + Vector2(0, 12), shown)

	func _shown_rect() -> Rect2:
		var r := frame_rect()
		var c := r.get_center()
		var z := zoom * lerpf(1.0, 0.08, eject)
		r = Rect2(c - r.size * z / 2, r.size * z)
		if eject > 0.0:
			r.position += Vector2(size.x * 0.48, -size.y * 0.62) * eject
		if shake > 0.0:
			r.position += Vector2(sin(_t * 91.0), cos(_t * 73.0)) * 7.0 * shake * shake
		return r

	func to_norm(p: Vector2) -> Vector2:
		var r := frame_rect()
		return ((p - r.position) / r.size).clamp(Vector2.ZERO, Vector2.ONE)

	func to_screen(n: Vector2) -> Vector2:
		var r := _shown_rect()
		return r.position + n * r.size

	func _gui_input(event: InputEvent) -> void:
		if overlay._busy:
			return
		var mb := event as InputEventMouseButton
		if mb and mb.button_index == MOUSE_BUTTON_LEFT:
			overlay._note.release_focus()
			if mb.pressed:
				_drag_from = to_norm(mb.position)
				_drag_to = _drag_from
			elif _drag_from != null:
				var a: Vector2 = _drag_from
				var b := to_norm(mb.position)
				_drag_from = null
				var px := Vector2(overlay.current_image().get_size())
				if to_screen(a).distance_to(to_screen(b)) < 8:
					overlay.add_mark({"type": "pin", "x": a.x * px.x, "y": a.y * px.y})
				else:
					var r := Rect2(a, Vector2.ZERO).expand(b)
					overlay.add_mark({"type": "box", "x": r.position.x * px.x, "y": r.position.y * px.y, "w": r.size.x * px.x, "h": r.size.y * px.y})
		elif mb and mb.pressed and mb.button_index == MOUSE_BUTTON_RIGHT:
			overlay.undo_mark()
		elif event is InputEventMouseMotion and _drag_from != null:
			_drag_to = to_norm(event.position)

	func _draw() -> void:
		# Blueprint ground: a faint dot grid.
		var dot := Color(Brand.BLUE, 0.16)
		for y in range(8, int(size.y), 18):
			for x in range(8, int(size.x), 18):
				draw_rect(Rect2(x, y, 1.5, 1.5), dot)

		var r := _shown_rect()
		var fade := 1.0 - eject
		draw_texture_rect(overlay.current_texture(), r, false, Color(1, 1, 1, fade))
		draw_rect(r.grow(1), Color(Brand.PAPER, 0.55 * fade), false, 1.0)
		_crop_marks(r.grow(8), Color(Brand.ORANGE, fade))

		# Which frame: FREEZE, or how far back the rewind went.
		var tag := "FREEZE" if overlay.frame_index < 0 else "%.2f S" % overlay._offsets[overlay.frame_index]
		_tag(r.position + Vector2(0, -24), tag, Brand.PAPER if overlay.frame_index < 0 else Brand.BLUE, Brand.INK, fade)

		for i in overlay.marks.size():
			var m: Dictionary = overlay.marks[i]
			var s := 1.0
			if _pops.has(i):
				var t: float = _pops[i]
				s = 1.0 + sin(t * PI) * 0.45 * (1.0 - t)
			if m.type == "box":
				_box(m, i + 1, s, fade)
			else:
				_pin(to_screen(Vector2(m.x, m.y)), i + 1, s, fade)

		if _drag_from != null:
			var a := to_screen(_drag_from)
			var b := to_screen(_drag_to)
			var rr := Rect2(a, Vector2.ZERO).expand(b)
			_dashed_rect(rr, Brand.BLUE)
			var px: Vector2 = Vector2(overlay.current_image().get_size()) * (_drag_to - _drag_from).abs()
			_mono(rr.position + Vector2(0, -6), "%d × %d" % [px.x, px.y], Brand.BLUE, 11)

		if stamp_t >= 0.0:
			_stamp(r)
		if flash > 0.0:
			draw_rect(Rect2(Vector2.ZERO, size), Color(Brand.PAPER, flash * 0.9))

	func _pin(p: Vector2, n: int, s: float, fade: float) -> void:
		var bob := sin(_t * 3.0 + n) * 1.5
		draw_arc(p, 14 * s, 0, TAU, 48, Color(Brand.INK, fade), 6, true)
		draw_arc(p, 14 * s, 0, TAU, 48, Color(Brand.ORANGE, fade), 3, true)
		draw_circle(p, 3 * s, Color(Brand.ORANGE, fade))
		var at := p + Vector2(15, -38 + bob) * s
		draw_line(p + Vector2(8, -10) * s, at + Vector2(0, 22) * s, Color(Brand.ORANGE, fade), 1.0)
		_number(at, n, Brand.ORANGE, s, fade)

	func _box(m: Dictionary, n: int, s: float, fade: float) -> void:
		var a := to_screen(Vector2(m.x, m.y))
		var b := to_screen(Vector2(m.x + m.w, m.y + m.h))
		var rr := Rect2(a, b - a)
		rr = Rect2(rr.get_center() - rr.size * s / 2, rr.size * s)
		draw_rect(rr, Color(Brand.INK, 0.8 * fade), false, 5.0)
		draw_rect(rr, Color(Brand.BLUE, fade), false, 2.0)
		# Blueprint dimension line above the box.
		var y := rr.position.y - 9
		var c := Color(Brand.BLUE, fade)
		draw_line(Vector2(rr.position.x, y), Vector2(rr.end.x, y), c, 1.0)
		draw_line(Vector2(rr.position.x, y - 4), Vector2(rr.position.x, y + 4), c, 1.0)
		draw_line(Vector2(rr.end.x, y - 4), Vector2(rr.end.x, y + 4), c, 1.0)
		var px := Vector2(overlay.current_image().get_size())
		var label := "%d × %d" % [roundi(m.w * px.x), roundi(m.h * px.y)]
		var w := Brand.mono().get_string_size(label, HORIZONTAL_ALIGNMENT_LEFT, -1, 11).x
		var mid := Vector2((rr.position.x + rr.end.x - w) / 2, y)
		draw_rect(Rect2(mid + Vector2(-4, -7), Vector2(w + 8, 13)), Color(Brand.GROUND, fade))
		_mono(mid + Vector2(0, 4), label, c, 11)
		_number(rr.position + Vector2(-2, 2), n, Brand.BLUE, s, fade)

	func _number(at: Vector2, n: int, bg: Color, s: float, fade: float) -> void:
		var box := Rect2(at, Vector2(24, 24) * s)
		draw_rect(box.grow(1.5), Color(Brand.INK, fade))
		draw_rect(box, Color(bg, fade))
		draw_string(Brand.heebo(900), at + Vector2(7, 19) * s, str(n), HORIZONTAL_ALIGNMENT_LEFT, -1, int(17 * s), Color(Brand.INK, fade))

	func _tag(at: Vector2, text: String, bg: Color, fg: Color, fade: float) -> void:
		var font := Brand.mono(true)
		var w := font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, 11).x
		draw_rect(Rect2(at, Vector2(w + 12, 17)), Color(bg, fade))
		draw_string(font, at + Vector2(6, 13), text, HORIZONTAL_ALIGNMENT_LEFT, -1, 11, Color(fg, fade))

	func _mono(at: Vector2, text: String, c: Color, font_size: int) -> void:
		draw_string(Brand.mono(), at, text, HORIZONTAL_ALIGNMENT_LEFT, -1, font_size, c)

	func _crop_marks(r: Rect2, c: Color) -> void:
		var l := 14.0
		for corner: Vector2 in [r.position, Vector2(r.end.x, r.position.y), r.end, Vector2(r.position.x, r.end.y)]:
			var sx := 1.0 if corner.x <= r.position.x else -1.0
			var sy := 1.0 if corner.y <= r.position.y else -1.0
			draw_line(corner, corner + Vector2(l * sx, 0), c, 2.0)
			draw_line(corner, corner + Vector2(0, l * sy), c, 2.0)

	func _dashed_rect(r: Rect2, c: Color) -> void:
		var pts := [r.position, Vector2(r.end.x, r.position.y), r.end, Vector2(r.position.x, r.end.y), r.position]
		for i in 4:
			draw_dashed_line(pts[i], pts[i + 1], c, 2.0, 6.0)

	func _stamp(frame: Rect2) -> void:
		var t := clampf(stamp_t, 0.0, 1.0)
		# Ease out back: lands, overshoots a touch, settles.
		var e := 1.0 + 2.7 * pow(t - 1.0, 3) + 1.7 * pow(t - 1.0, 2)
		var sc := lerpf(2.6, 1.0, e)
		var alpha := clampf(t * 3.0, 0.0, 1.0) * (1.0 - eject)
		var font := Brand.heebo(900)
		var fs := int(54 * sc)
		var w := font.get_string_size(stamp_text, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
		var plate := Vector2(w + 56 * sc, 104 * sc)
		var c := frame.get_center()
		var r := Rect2(c - plate / 2, plate)
		draw_rect(r, Color(Brand.GROUND, 0.88 * alpha))
		draw_rect(r, Color(Brand.ORANGE, alpha), false, 4.0 * sc)
		draw_rect(r.grow(-8 * sc), Color(Brand.ORANGE, alpha), false, 1.5 * sc)
		draw_string(font, Vector2(c.x - w / 2, c.y + 10 * sc), stamp_text, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, Color(Brand.ORANGE, alpha))
		var sub_font := Brand.mono(true)
		var sw := sub_font.get_string_size(stamp_sub, HORIZONTAL_ALIGNMENT_LEFT, -1, int(13 * sc)).x
		draw_string(sub_font, Vector2(c.x - sw / 2, c.y + 34 * sc), stamp_sub, HORIZONTAL_ALIGNMENT_LEFT, -1, int(13 * sc), Color(Brand.PAPER, alpha))


## Rewind: one tick per clip frame, FREEZE at the end. Click or drag to pick the frame.
class Scrubber:
	extends Control

	var overlay: Window

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_STOP

	func _slot_x(i: int, n: int) -> float:
		var left := 92.0
		var right := size.x - 90.0
		return left + (right - left) * (float(i) / maxf(n, 1))

	func _gui_input(event: InputEvent) -> void:
		var n: int = overlay._frames.size()
		if n == 0:
			return
		var pressed: bool = (event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT) \
			or (event is InputEventMouseMotion and event.button_mask & MOUSE_BUTTON_MASK_LEFT)
		if pressed:
			var best := n
			var best_d := INF
			for i in n + 1:
				var d := absf(_slot_x(i, n) - event.position.x)
				if d < best_d:
					best_d = d
					best = i
			overlay.set_frame(-1 if best >= n else best)

	func _draw() -> void:
		var n: int = overlay._frames.size()
		var mid := size.y / 2
		draw_string(Brand.mono(true), Vector2(0, mid + 4), "REWIND", HORIZONTAL_ALIGNMENT_LEFT, -1, 11, Brand.INK_2 if n else Color(Brand.INK_2, 0.4))
		if n == 0:
			draw_string(Brand.mono(), Vector2(92, mid + 4), "NO CLIP YET", HORIZONTAL_ALIGNMENT_LEFT, -1, 11, Color(Brand.INK_2, 0.5))
			return
		draw_line(Vector2(_slot_x(0, n), mid), Vector2(_slot_x(n, n), mid), Brand.RULE, 1.0)
		var offsets: Array = overlay._offsets
		var last_second := 999
		for i in n + 1:
			var x := _slot_x(i, n)
			var whole := 0 if i >= n else int(floor(offsets[i]))
			var tall := i == n or whole != last_second
			last_second = whole
			draw_line(Vector2(x, mid - (7 if tall else 3)), Vector2(x, mid + (7 if tall else 3)), Brand.INK_2 if tall else Brand.RULE, 1.0)
		var sel: int = n if overlay.frame_index < 0 else overlay.frame_index
		var sx := _slot_x(sel, n)
		draw_rect(Rect2(sx - 1.5, mid - 12, 3, 24), Brand.ORANGE)
		draw_colored_polygon(PackedVector2Array([Vector2(sx - 6, mid - 15), Vector2(sx + 6, mid - 15), Vector2(sx, mid - 9)]), Brand.ORANGE)
		var label := "FREEZE" if overlay.frame_index < 0 else "%.2f S" % offsets[overlay.frame_index]
		draw_string(Brand.mono(true), Vector2(size.x - 80, mid + 4), label, HORIZONTAL_ALIGNMENT_LEFT, -1, 11, Brand.PAPER)
