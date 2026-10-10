extends Window
## A small native window pinned to the game window's top-right corner, for toasts
## ("FIXED #14") and the card of the ghost you're standing next to. Native so the text is
## sharp at any game resolution; unfocusable so it never takes input from the game.

const Brand := preload("res://addons/playmark/brand.gd")
const W := 380
const H := 96

## Show even when the game window isn't focused (tests, recordings).
var always := false

var _queue: Array = []
var _current := {}
var _card := {}
var _until := 0.0
var _slide := 0.0
var _clock := 0.0  # process time, so toasts last the same under fixed-step recording
var _body: Body


func _init() -> void:
	visible = false
	force_native = true
	borderless = true
	always_on_top = true
	unfocusable = true
	transient = false
	unresizable = true
	wrap_controls = false
	theme = Brand.theme()
	_body = Body.new()
	_body.hud = self
	_body.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(_body)


## kind: ready, saved, working, fixed, error, warp. Colors the accent.
func toast(kind: String, title_text: String, body: String, meta := "", seconds := 4.0) -> void:
	_queue.append({"kind": kind, "title": title_text, "body": body, "meta": meta, "seconds": seconds})


## The ghost card stays while the player is near it. Empty dictionary hides it.
func card(data: Dictionary) -> void:
	_card = data


func _process(delta: float) -> void:
	_clock += delta
	var now := _clock
	if not _current.is_empty() and now >= _until:
		_current = {}
	if _current.is_empty() and not _queue.is_empty():
		_current = _queue.pop_front()
		_until = now + float(_current.seconds)
		_slide = 1.0
	var showing: Dictionary = _current if not _current.is_empty() else _card
	if showing.is_empty() or not (always or get_tree().root.has_focus()):
		if visible:
			hide()
		return
	_body.data = showing
	_slide = maxf(_slide - delta * 6.0, 0.0)
	var k := DisplayServer.screen_get_scale(DisplayServer.window_get_current_screen())
	content_scale_factor = k
	size = Vector2i(int(W * k), int(H * k))
	var game_pos := DisplayServer.window_get_position()
	var game_size := DisplayServer.window_get_size()
	var eased := _slide * _slide
	position = game_pos + Vector2i(game_size.x - size.x - int(14 * k) + int(36 * k * eased), int(14 * k))
	if not visible:
		show()
	_body.queue_redraw()


class Body:
	extends Control

	var hud: Window
	var data := {}

	func _draw() -> void:
		draw_rect(Rect2(Vector2.ZERO, size), Brand.GROUND)
		draw_rect(Rect2(Vector2.ZERO, size), Brand.RULE, false, 1.0)
		var accent := {"fixed": Brand.BLUE, "working": Brand.BLUE, "warp": Brand.BLUE, "ready": Brand.PAPER}.get(data.get("kind"), Brand.ORANGE)
		var bar := accent
		if data.get("kind") == "working":
			bar = Color(accent, 0.35 + 0.65 * absf(sin(Time.get_ticks_msec() / 220.0)))
		draw_rect(Rect2(0, 0, 6, size.y), bar)
		var x := 22.0
		draw_string(Brand.mono(true), Vector2(x, 22), str(data.get("kicker", _kicker())), HORIZONTAL_ALIGNMENT_LEFT, -1, 10, accent)
		var w := size.x - x - 44
		draw_string(Brand.heebo(900), Vector2(x, 46), _fit(str(data.get("title", "")), Brand.heebo(900), 20, w), HORIZONTAL_ALIGNMENT_LEFT, -1, 20, Brand.PAPER)
		draw_string(Brand.heebo(500), Vector2(x, 67), _fit(str(data.get("body", "")), Brand.heebo(500), 14, size.x - x - 14), HORIZONTAL_ALIGNMENT_LEFT, -1, 14, Brand.PAPER)
		draw_string(Brand.mono(), Vector2(x, 86), str(data.get("meta", "")), HORIZONTAL_ALIGNMENT_LEFT, size.x - x - 14, 10, Brand.INK_2)
		var logo := Brand.mark(64)
		if logo:
			draw_texture_rect(logo, Rect2(size.x - 34, 10, 22, 22), false, Color(1, 1, 1, 0.9))

	## Shortens text with an ellipsis until it fits the width.
	func _fit(text: String, font: Font, font_size: int, width: float) -> String:
		if font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, font_size).x <= width:
			return text
		var lo := 0
		var hi := text.length()
		while lo < hi:
			var mid := (lo + hi + 1) / 2
			if font.get_string_size(text.substr(0, mid) + "…", HORIZONTAL_ALIGNMENT_LEFT, -1, font_size).x <= width:
				lo = mid
			else:
				hi = mid - 1
		return text.substr(0, lo).strip_edges() + "…"

	func _kicker() -> String:
		return {"ready": "PLAYMARK", "saved": "MARK SAVED", "working": "CLAUDE IS ON IT", "fixed": "FIXED BY CLAUDE",
			"error": "CAUGHT AN ERROR", "warp": "WARPED", "ghost": "MARK"}.get(data.get("kind"), "PLAYMARK")
