extends Area2D
## One toy shape: drawn in code, moving in place, with a face. Its look comes from look.gd.

var kind := "circle"
var color := Color.WHITE
var motion := "pulse"
var radius := 62.0
var phase := 0.0

var _t := 0.0
var _blink := 0.0
var _body := Node2D.new()


func setup(def: Dictionary, i: int) -> void:
	name = def.name
	kind = def.kind
	color = Color(def.color)
	motion = def.motion
	phase = i * 1.3
	var col := CollisionShape2D.new()
	var c := CircleShape2D.new()
	c.radius = radius
	col.shape = c
	add_child(col)
	_body.set_script(preload("res://shape_body.gd"))
	_body.owner_shape = self
	add_child(_body)


func _process(delta: float) -> void:
	_t += delta
	_blink -= delta
	if _blink < -3.2 - phase * 0.4:
		_blink = 0.12
	var s := _t + phase
	var off := Vector2.ZERO
	var rot := 0.0
	var sc := Vector2.ONE
	match motion:
		"pulse":
			sc = Vector2.ONE * (1.0 + 0.07 * sin(s * 3.2))
		"wobble":
			rot = deg_to_rad(11.0) * sin(s * 2.6)
		"bob":
			off.y = -12.0 * sin(s * 2.4)
		"spin":
			rot = s * 1.4
		"hop":
			var h := absf(sin(s * 3.0))
			off.y = -58.0 * h
			var squash := clampf(1.0 - h * 4.0, 0.0, 1.0)
			sc = Vector2(1.0 + 0.16 * squash, 1.0 - 0.16 * squash)
	_body.position = off
	_body.rotation = rot
	_body.scale = sc
	_body.queue_redraw()
	queue_redraw()


func _draw() -> void:
	# The shadow on the floor shrinks as the shape lifts.
	var lift := clampf(-_body.position.y / 60.0, 0.0, 1.0)
	draw_set_transform(Vector2(0, radius + 22), 0, Vector2(1, 0.22))
	draw_circle(Vector2.ZERO, radius * (0.95 - 0.35 * lift), Color(0.08, 0.02, 0.15, 0.28 - 0.12 * lift))
	draw_set_transform(Vector2.ZERO)


func blinking() -> bool:
	return _blink > 0.0


func points() -> PackedVector2Array:
	var r := radius
	match kind:
		"square":
			return _rounded([Vector2(-r, -r), Vector2(r, -r), Vector2(r, r), Vector2(-r, r)].map(func(p): return p * 0.86), 14.0)
		"triangle":
			return _rounded([Vector2(0, -r * 1.1), Vector2(r * 1.05, r * 0.8), Vector2(-r * 1.05, r * 0.8)], 12.0)
		"hexagon":
			var h := []
			for i in 6:
				h.append(Vector2.from_angle(TAU * i / 6.0 + PI / 6.0) * r)
			return _rounded(h, 10.0)
		"star":
			var st := []
			for i in 10:
				st.append(Vector2.from_angle(TAU * i / 10.0 - PI / 2.0) * (r * 1.12 if i % 2 == 0 else r * 0.5))
			return _rounded(st, 5.0)
	var c := PackedVector2Array()
	for i in 64:
		c.append(Vector2.from_angle(TAU * i / 64.0) * r)
	return c


## Corners cut into small arcs, for a soft toy look.
func _rounded(corners: Array, k: float) -> PackedVector2Array:
	var out := PackedVector2Array()
	var n := corners.size()
	for i in n:
		var p: Vector2 = corners[i]
		var a: Vector2 = corners[(i - 1 + n) % n]
		var b: Vector2 = corners[(i + 1) % n]
		var pa := p + (a - p).normalized() * minf(k, (a - p).length() / 2)
		var pb := p + (b - p).normalized() * minf(k, (b - p).length() / 2)
		for j in 7:
			var t := j / 6.0
			out.append(pa.lerp(p, t).lerp(p.lerp(pb, t), t))
	return out
