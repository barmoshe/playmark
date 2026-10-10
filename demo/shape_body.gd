extends Node2D
## The drawn shape: fill, outline, a highlight and a face.

var owner_shape: Area2D


func _draw() -> void:
	var s := owner_shape
	var pts: PackedVector2Array = s.points()
	var c: Color = s.color
	draw_colored_polygon(pts, c.darkened(0.38))
	var inner := PackedVector2Array()
	for p in pts:
		inner.append(p * 0.9)
	draw_colored_polygon(inner, c)
	var closed := pts.duplicate()
	closed.append(pts[0])
	draw_polyline(closed, c.darkened(0.45), 4.0, true)
	# Highlight: a soft lighter blob up-left.
	draw_set_transform(Vector2(-s.radius * 0.3, -s.radius * 0.36), -0.5, Vector2(1, 0.55))
	draw_circle(Vector2.ZERO, s.radius * 0.28, Color(1, 1, 1, 0.28))
	draw_set_transform(Vector2.ZERO)
	# Face.
	var ink := Color("1d1030")
	var eye_y := -6.0 if s.kind != "triangle" else 10.0
	for x in [-18.0, 18.0]:
		if s.blinking():
			draw_line(Vector2(x - 7, eye_y), Vector2(x + 7, eye_y), ink, 4.0, true)
		else:
			draw_circle(Vector2(x, eye_y), 8.0, ink)
			draw_circle(Vector2(x + 2.5, eye_y - 3), 2.6, Color.WHITE)
	draw_arc(Vector2(0, eye_y + 14), 10.0, 0.25, PI - 0.25, 16, ink, 4.0, true)
	draw_circle(Vector2(-30, eye_y + 12), 6.0, Color(1, 0.4, 0.5, 0.35))
	draw_circle(Vector2(30, eye_y + 12), 6.0, Color(1, 0.4, 0.5, 0.35))
