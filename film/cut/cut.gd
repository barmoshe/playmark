extends Node2D
## Plays an edit list (JSON) as a 1920x1080 video under Godot's movie writer:
##   godot --path film/cut --write-movie out.avi --fixed-fps 30 -- --edit=<edit.json>
## Segments: "card" (title text on ink), "clip" (a frame sequence from film/capture.gd, with its
## audio), "split" (two stills side by side, before and after). Captions are Hebrew-ready
## (Heebo, right to left). A music bed can run under everything.

const W := 1920.0
const H := 1080.0
const INK := Color("111111")
const PAPER := Color("f2efe6")
const ORANGE := Color("f2621b")
const BLUE := Color("6faef2")
const FADE := 0.22

var edit: Dictionary
var segs: Array = []
var seg_i := -1
var seg_t := 0.0
var total_t := 0.0
var tex := ImageTexture.new()
var tex_b := ImageTexture.new()
var _loaded_frame := -1
var _voice: AudioStreamPlayer
var _music: AudioStreamPlayer
var _heebo: Font
var _heebo_light: Font
var _mono: Font
var _rtl: bool


func _ready() -> void:
	var path := ""
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--edit="):
			path = a.trim_prefix("--edit=")
	edit = JSON.parse_string(FileAccess.get_file_as_string(path))
	segs = edit.segments
	_rtl = edit.get("rtl", true)
	var fonts: String = edit.get("fonts", "")
	_heebo = _font(fonts, 900)
	_heebo_light = _font(fonts, 600)
	_mono = _load(fonts.path_join("cascadia-mono-600.woff2"))
	_voice = AudioStreamPlayer.new()
	add_child(_voice)
	_music = AudioStreamPlayer.new()
	add_child(_music)
	if edit.has("music"):
		var m = AudioStreamOggVorbis.load_from_file(edit.music.path)
		m.loop = true
		_music.stream = m
		_music.volume_db = float(edit.music.get("db", -16))
		_music.play()
	_next()


func _font(dir: String, weight: int) -> Font:
	var v := FontVariation.new()
	v.base_font = _load(dir.path_join("heebo-latin.woff2"))
	v.fallbacks = [_load(dir.path_join("heebo-hebrew.woff2"))] as Array[Font]
	v.variation_opentype = {TextServerManager.get_primary_interface().name_to_tag("weight"): weight}
	return v


func _load(p: String) -> FontFile:
	var f := FontFile.new()
	f.load_dynamic_font(p)
	return f


func _next() -> void:
	seg_i += 1
	seg_t = 0.0
	_loaded_frame = -1
	_voice.stop()
	if seg_i >= segs.size():
		get_tree().quit()
		return
	var s: Dictionary = segs[seg_i]
	if s.type == "clip" and s.has("audio"):
		_voice.stream = AudioStreamWAV.load_from_file(s.audio)
		_voice.volume_db = float(s.get("db", 0))
		_voice.play(float(s.get("audio_offset", 0.0)) + float(s.from) / 30.0)
		_voice.pitch_scale = float(s.get("speed", 1.0))
	if s.type == "split":
		tex.set_image(Image.load_from_file(s.left))
		tex_b.set_image(Image.load_from_file(s.right))


func _dur(s: Dictionary) -> float:
	if s.type == "clip":
		return (float(s.to) - float(s.from)) / 30.0 / float(s.get("speed", 1.0))
	return float(s.dur)


func _process(delta: float) -> void:
	if seg_i >= segs.size():
		return
	seg_t += delta
	total_t += delta
	var s: Dictionary = segs[seg_i]
	if seg_t >= _dur(s):
		_next()
		if seg_i >= segs.size():
			return
		s = segs[seg_i]
	if s.type == "clip":
		var f := int(float(s.from) + seg_t * 30.0 * float(s.get("speed", 1.0)))
		f = mini(f, int(s.to) - 1)
		if f != _loaded_frame:
			_loaded_frame = f
			var img := Image.load_from_file(str(s.dir).path_join("%05d.png" % f))
			if img:
				tex.set_image(img)
	queue_redraw()


func _draw() -> void:
	draw_rect(Rect2(0, 0, W, H), INK)
	if seg_i >= segs.size():
		return
	var s: Dictionary = segs[seg_i]
	var d := _dur(s)
	match s.type:
		"card":
			_card(s)
		"clip":
			_clip(s)
		"split":
			_split(s)
	if s.has("caption"):
		_caption(str(s.caption), str(s.get("cap", "bottom")))
	if s.has("kicker"):
		_kicker(str(s.kicker), str(s.get("label", "")))
	# Fade through ink at both ends of every segment.
	var a := 0.0
	if seg_t < FADE and seg_i > 0:
		a = 1.0 - seg_t / FADE
	elif d - seg_t < FADE and seg_i < segs.size() - 1:
		a = 1.0 - (d - seg_t) / FADE
	if a > 0.0:
		draw_rect(Rect2(0, 0, W, H), Color(INK, a))


func _clip(s: Dictionary) -> void:
	# Optional slow push-in toward a point: zoom [cx, cy, scale_from, scale_to] in 1920x1080 px.
	if s.has("zoom"):
		var z: Array = s.zoom
		var k := clampf(seg_t / _dur(s), 0.0, 1.0)
		var e := k * k * (3.0 - 2.0 * k)
		var sc := lerpf(float(z[2]), float(z[3]), e)
		var src_size := Vector2(W, H) / sc
		var c := Vector2(z[0], z[1])
		var src := Rect2(c - src_size / 2, src_size)
		src.position = src.position.clamp(Vector2.ZERO, Vector2(W, H) - src_size)
		draw_texture_rect_region(tex, Rect2(0, 0, W, H), src)
	else:
		draw_texture_rect(tex, Rect2(0, 0, W, H), false)


func _split(s: Dictionary) -> void:
	var half := Rect2(0, 0, W / 2 - 6, H)
	_fit(tex, half)
	_fit(tex_b, Rect2(W / 2 + 6, 0, W / 2 - 6, H))
	draw_rect(Rect2(W / 2 - 3, 0, 6, H), PAPER)
	var labels: Array = s.get("labels", ["", ""])
	_tag(Vector2(60, 60), str(labels[0]), PAPER, INK)
	_tag(Vector2(W / 2 + 66, 60), str(labels[1]), BLUE, INK)


func _fit(t: Texture2D, r: Rect2) -> void:
	var ts := Vector2(t.get_size())
	var k := minf(r.size.x / ts.x, r.size.y / ts.y)
	var sz := ts * k
	draw_texture_rect(t, Rect2(r.position + (r.size - sz) / 2, sz), false)


func _card(s: Dictionary) -> void:
	var k := clampf(seg_t / 0.5, 0.0, 1.0)
	var rise := (1.0 - k) * 24.0
	var title := str(s.get("title", ""))
	var sub := str(s.get("sub", ""))
	var fs := int(s.get("size", 120))
	var tw := _heebo.get_string_size(title, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
	draw_string(_heebo, Vector2((W - tw) / 2, H / 2 + rise), title, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, Color(PAPER, k))
	if not sub.is_empty():
		var sw := _heebo_light.get_string_size(sub, HORIZONTAL_ALIGNMENT_LEFT, -1, 48).x
		draw_string(_heebo_light, Vector2((W - sw) / 2, H / 2 + 90 + rise), sub, HORIZONTAL_ALIGNMENT_LEFT, -1, 48, Color(PAPER.darkened(0.25), k))
	if s.has("note"):
		var note := str(s.note)
		var nw := _mono.get_string_size(note, HORIZONTAL_ALIGNMENT_LEFT, -1, 34).x
		draw_string(_mono, Vector2((W - nw) / 2, H / 2 + 180 + rise), note, HORIZONTAL_ALIGNMENT_LEFT, -1, 34, Color(ORANGE, k))
	# The double rule under the masthead, the brand's signature.
	var rw := 520.0 * k
	draw_rect(Rect2((W - rw) / 2, H / 2 - fs - 30, rw, 4), Color(PAPER, k))
	draw_rect(Rect2((W - rw) / 2, H / 2 - fs - 20, rw, 2), Color(PAPER, k))


func _caption(text: String, where: String) -> void:
	var fs := 52
	var tw := _heebo.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
	var pad := Vector2(34, 22)
	var y := 150.0 if where == "top" else H - 150.0
	var box := Rect2((W - tw) / 2 - pad.x, y, tw + pad.x * 2, fs + pad.y * 2)
	draw_rect(box, Color(INK, 0.86))
	draw_rect(Rect2(box.position.x, box.end.y - 6, box.size.x, 6), ORANGE)
	draw_string(_heebo, Vector2((W - tw) / 2, box.position.y + pad.y + fs * 0.82), text, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, PAPER)


func _kicker(num: String, label: String) -> void:
	# Top corner on the reading side: a number tag and a label.
	var fs := 40
	var lw := _heebo.get_string_size(label, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
	var x := W - 70.0 - lw - 130.0 if _rtl else 60.0
	draw_rect(Rect2(x, 50, 90, 70), ORANGE)
	var nw := _heebo.get_string_size(num, HORIZONTAL_ALIGNMENT_LEFT, -1, 44).x
	draw_string(_heebo, Vector2(x + (90 - nw) / 2, 101), num, HORIZONTAL_ALIGNMENT_LEFT, -1, 44, INK)
	draw_rect(Rect2(x + 90, 50, lw + 40, 70), Color(INK, 0.86))
	draw_string(_heebo, Vector2(x + 110, 99), label, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, PAPER)


func _tag(at: Vector2, text: String, bg: Color, fg: Color) -> void:
	var tw := _heebo.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, 44).x
	draw_rect(Rect2(at, Vector2(tw + 44, 72)), bg)
	draw_string(_heebo, at + Vector2(22, 52), text, HORIZONTAL_ALIGNMENT_LEFT, -1, 44, fg)
