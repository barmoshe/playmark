extends RefCounted
## Image work for a mark: the annotated screenshot and the clip contact sheet.
## Drawn straight into Image pixels, so it needs no renderer and no font.

## Brand spot inks: pins print orange, boxes are blueprint blue. Numbers tell marks apart.
const ORANGE := Color("f2621b")
const BLUE := Color("6faef2")
const INK := Color("111111")

## 3x5 digits, row by row.
const DIGITS := [
	"111101101101111", "010110010010111", "111001111100111", "111001111001111", "101101111001001",
	"111100111001111", "111100111101111", "111001001001001", "111101111101111", "111101111001111",
]


static func color_for(m: Dictionary) -> Color:
	return BLUE if m.type == "box" else ORANGE


static func color_name(m: Dictionary) -> String:
	return "blue" if m.type == "box" else "orange"


## The screenshot upscaled (nearest, whole factor) to at least min_width, with every
## mark drawn on it and numbered from 1. Marks are in screenshot pixels.
static func annotate(shot: Image, marks: Array, min_width := 960) -> Image:
	var k := maxi(1, ceili(float(min_width) / shot.get_width()))
	var img := shot.duplicate() as Image
	img.convert(Image.FORMAT_RGBA8)
	if k > 1:
		img.resize(shot.get_width() * k, shot.get_height() * k, Image.INTERPOLATE_NEAREST)
	var u := maxf(1.0, img.get_width() / 960.0)  # marks grow with the image
	var t := roundi(3 * u)
	var radius := roundi(14 * u)
	var label_scale := roundi(4 * u)
	for i in marks.size():
		var m: Dictionary = marks[i]
		var c := color_for(m)
		var anchor: Vector2i
		if m.type == "box":
			var r := Rect2i(int(m.x * k), int(m.y * k), int(m.w * k), int(m.h * k))
			_outline(img, r.grow(t), t, INK)
			_outline(img, r, t, c)
			anchor = r.position + Vector2i(-t, -t - 7 * label_scale)
		else:
			var p := Vector2i(int(m.x * k + k / 2), int(m.y * k + k / 2))
			_ring(img, p, radius + 1, t + 2, INK)
			_ring(img, p, radius, t, c)
			img.fill_rect(_clip(img, Rect2i(p - Vector2i(2, 2), Vector2i(5, 5))), INK)
			img.fill_rect(_clip(img, Rect2i(p - Vector2i(1, 1), Vector2i(3, 3))), c)
			anchor = p + Vector2i(radius, -radius - 6 * label_scale)
		_label(img, anchor, i + 1, c, label_scale)
	return img


## Up to max_frames frames, evenly sampled, oldest first, in a grid.
static func contact_sheet(frames: Array, max_frames := 12, cols := 4) -> Image:
	if frames.is_empty():
		return null
	var picked: Array[Image] = []
	var n := mini(frames.size(), max_frames)
	for i in n:
		picked.append(frames[int(round(float(i) * (frames.size() - 1) / maxf(n - 1, 1)))])
	var size: Vector2i = picked[0].get_size()
	var gap := 4
	cols = mini(cols, n)
	var rows := ceili(float(n) / cols)
	var sheet := Image.create_empty(cols * size.x + gap * (cols + 1), rows * size.y + gap * (rows + 1), false, Image.FORMAT_RGBA8)
	sheet.fill(INK)
	for i in n:
		var f := picked[i]
		if f.get_format() != Image.FORMAT_RGBA8:
			f = f.duplicate()
			f.convert(Image.FORMAT_RGBA8)
		var at := Vector2i(gap + (i % cols) * (size.x + gap), gap + (i / cols) * (size.y + gap))
		sheet.blit_rect(f, Rect2i(Vector2i.ZERO, size), at)
		_label(sheet, at + size - Vector2i(20, 18), i + 1, Color.WHITE, 2)
	return sheet


static func _outline(img: Image, r: Rect2i, t: int, c: Color) -> void:
	img.fill_rect(_clip(img, Rect2i(r.position.x, r.position.y, r.size.x, t)), c)
	img.fill_rect(_clip(img, Rect2i(r.position.x, r.end.y - t, r.size.x, t)), c)
	img.fill_rect(_clip(img, Rect2i(r.position.x, r.position.y, t, r.size.y)), c)
	img.fill_rect(_clip(img, Rect2i(r.end.x - t, r.position.y, t, r.size.y)), c)


static func _ring(img: Image, p: Vector2i, radius: int, t: int, c: Color) -> void:
	var w := img.get_width()
	var h := img.get_height()
	for y in range(p.y - radius, p.y + radius + 1):
		for x in range(p.x - radius, p.x + radius + 1):
			if x < 0 or y < 0 or x >= w or y >= h:
				continue
			var d := Vector2(x - p.x, y - p.y).length()
			if d <= radius and d > radius - t:
				img.set_pixel(x, y, c)


## A number on a colored tag. Digits are 3x5 cells scaled by s.
static func _label(img: Image, at: Vector2i, number: int, bg: Color, s := 4) -> void:
	var text := str(number)
	var pad := s
	var size := Vector2i(text.length() * 4 * s - s + pad * 2, 5 * s + pad * 2)
	at.x = clampi(at.x, 0, maxi(img.get_width() - size.x, 0))
	at.y = clampi(at.y, 0, maxi(img.get_height() - size.y, 0))
	img.fill_rect(_clip(img, Rect2i(at, size)), bg)
	var fg := INK if bg.get_luminance() > 0.4 else Color.WHITE
	for ci in text.length():
		var glyph: String = DIGITS[int(text[ci])]
		for row in 5:
			for col in 3:
				if glyph[row * 3 + col] == "1":
					var px := at + Vector2i(pad + ci * 4 * s + col * s, pad + row * s)
					img.fill_rect(_clip(img, Rect2i(px, Vector2i(s, s))), fg)


static func _clip(img: Image, r: Rect2i) -> Rect2i:
	return r.intersection(Rect2i(Vector2i.ZERO, img.get_size()))
