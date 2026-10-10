extends Node2D
## Ghost marks: past marks drawn back into the world where they were made, like messages
## left on the floor. Orange: open. Pulsing blue: Claude is on it. Blue outline with a
## check: fixed (go retest it). Walk up to one, or hover it, to read the note.
##
## Drawn in screen space (positions come from the world through the camera), so sizes are
## whole pixels at any zoom and the pixel digits stay crisp.

signal near_changed(mark: Dictionary)

const Brand := preload("res://addons/playmark/brand.gd")
const Images := preload("res://addons/playmark/images.gd")

## [{seq, id, status, category, note, resolution, world: [x, y]}] for the current scene.
var marks: Array = []
## Optional: the node whose distance decides "near" (the player). The mouse otherwise.
var anchor: Node2D

var _near_id := ""
var _t := 0.0


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS


func _process(delta: float) -> void:
	_t += delta
	queue_redraw()
	var near := {}
	if visible and not marks.is_empty():
		var vp := get_viewport()
		var from := vp.get_canvas_transform() * anchor.global_position if is_instance_valid(anchor) else vp.get_mouse_position()
		var u := _unit()
		var best := INF
		for m in marks:
			var d := from.distance_to(_screen(m) + Vector2(0, -8 * u))
			if d < 26.0 * u and d < best:
				best = d
				near = m
	var id: String = near.get("id", "")
	if id != _near_id:
		_near_id = id
		near_changed.emit(near)


## One ghost "pixel" in viewport pixels: 1 at 270p, 2 at 540p, 4 at 1080p.
func _unit() -> float:
	return maxf(roundf(get_viewport().get_visible_rect().size.y / 270.0), 1.0)


func _screen(m: Dictionary) -> Vector2:
	return (get_viewport().get_canvas_transform() * Vector2(m.world[0], m.world[1])).round()


func _draw() -> void:
	var u := _unit()
	for m in marks:
		var status: String = m.get("status", "new")
		var near: bool = m.get("id", "") == _near_id
		var r := (9.0 if near else 7.0) * u
		var lit := Brand.ORANGE if status == "new" else Brand.BLUE
		# The marker floats above the spot on a stem, so it never hides inside what it marks.
		var base := _screen(m)
		var p := (base + Vector2(0, -16 * u + roundf(sin(_t * 2.2 + float(m.seq)) * 1.5) * u)).round()
		# A soft glow on the floor.
		draw_set_transform(base + Vector2(0, 2 * u), 0, Vector2(1, 0.35))
		draw_circle(Vector2.ZERO, r * 1.6, Color(lit, 0.18))
		draw_set_transform(Vector2.ZERO)
		draw_line(base, p + Vector2(0, r), Color(Brand.PAPER if status != "fixed" else Brand.BLUE, 0.6), u)
		draw_rect(Rect2(base - Vector2(u, u), Vector2(2 * u, 2 * u)), lit)
		var diamond := PackedVector2Array([p + Vector2(0, -r), p + Vector2(r, 0), p + Vector2(0, r), p + Vector2(-r, 0)])
		var outline := diamond.duplicate()
		outline.append(diamond[0])
		match status:
			"fixed":
				draw_colored_polygon(diamond, Color(Brand.INK, 0.6))
				draw_polyline(outline, Brand.BLUE, u)
				draw_polyline(PackedVector2Array([p + Vector2(-3, 0) * u, p + Vector2(-1, 2) * u, p + Vector2(3, -2) * u]), Brand.BLUE, u)
			"working":
				draw_colored_polygon(diamond, Color(Brand.BLUE, 0.55 + 0.45 * sin(_t * 6.0)))
				draw_polyline(outline, Brand.INK, u)
			_:
				draw_colored_polygon(diamond, Brand.ORANGE)
				draw_polyline(outline, Brand.INK, u)
		_digits(p + Vector2(r + 2 * u, -r - 3 * u), int(m.seq), u, Brand.PAPER if status != "fixed" else Brand.BLUE)


## The pixel digits from images.gd, so the number reads in pixel-art games too.
func _digits(at: Vector2, n: int, u: float, c: Color) -> void:
	var text := str(n)
	at = at.round()
	draw_rect(Rect2(at - Vector2(u, u), Vector2(text.length() * 4 * u + u, 7 * u)), Color(Brand.INK, 0.75))
	for ci in text.length():
		var glyph: String = Images.DIGITS[int(text[ci])]
		for row in 5:
			for col in 3:
				if glyph[row * 3 + col] == "1":
					draw_rect(Rect2(at + Vector2((ci * 4 + col) * u, row * u), Vector2(u, u)), c)
