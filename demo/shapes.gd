extends Node2D
## Playmark's demo toy: a colorful room with four shapes moving in place.
## Press Ctrl+Shift+M to mark one and tell Claude what to change. The look lives in look.gd.

const Look := preload("res://look.gd")
const W := 960.0
const H := 540.0

var shapes: Array[Area2D] = []
var _t := 0.0
var _blobs := []
var _sparks := []


func _ready() -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = 7
	for i in 6:
		_blobs.append({"p": Vector2(rng.randf_range(0, W), rng.randf_range(0, H)), "r": rng.randf_range(120, 260),
			"c": [Color("4cc9f0"), Color("f72585"), Color("ffd166"), Color("7b2ff7")][i % 4], "v": rng.randf_range(0.15, 0.35)})
	for i in 40:
		_sparks.append({"p": Vector2(rng.randf_range(0, W), rng.randf_range(0, H * 0.75)), "ph": rng.randf() * TAU})
	for i in Look.SHAPES.size():
		var s := Area2D.new()
		s.set_script(preload("res://shape.gd"))
		s.setup(Look.SHAPES[i], i)
		s.position = Vector2(165 + i * 210, 268)
		add_child(s)
		shapes.append(s)
	var cam := Camera2D.new()
	cam.position = Vector2(W, H) / 2
	add_child(cam)
	Playmark.add_context("look", func(): return Look.SHAPES)
	print("shapes: ready")


func _process(delta: float) -> void:
	_t += delta
	queue_redraw()


func _draw() -> void:
	# A three-stop gradient sky.
	var top := Color("3a1c71")
	var mid := Color("d76d77")
	var bot := Color("ffaf7b")
	var bands := 60
	for i in bands:
		var t := float(i) / bands
		var c := top.lerp(mid, t * 2.0) if t < 0.5 else mid.lerp(bot, (t - 0.5) * 2.0)
		draw_rect(Rect2(0, H * t, W, H / bands + 1), c)
	# Drifting soft blobs.
	for b in _blobs:
		var p: Vector2 = b.p + Vector2(sin(_t * b.v + b.r), cos(_t * b.v * 0.8 + b.r)) * 40.0
		for k in 4:
			draw_circle(p, b.r * (1.0 - k * 0.2), Color(b.c, 0.05))
	# Twinkles.
	for s in _sparks:
		var a := 0.35 + 0.35 * sin(_t * 2.0 + s.ph)
		draw_circle(s.p, 1.6, Color(1, 1, 1, a))
	# The floor.
	draw_rect(Rect2(0, 372, W, H - 372), Color(0.16, 0.05, 0.22, 0.35))
	draw_line(Vector2(0, 372), Vector2(W, 372), Color(1, 1, 1, 0.25), 2.0)
