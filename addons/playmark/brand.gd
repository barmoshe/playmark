extends RefCounted
## Bar Builds newsprint brand, dark plate: paper on ink, blueprint blue and print orange.
## Square corners, rules instead of boxes, no shadows. Heebo for display and UI,
## Cascadia Mono for meta. Fonts are SIL OFL (see fonts/OFL.txt).

const GROUND := Color("111111")
const GROUND_2 := Color("1b1b1b")
const PAPER := Color("f2efe6")
const INK_2 := Color("b3b0a8")
const RULE := Color(0.95, 0.94, 0.9, 0.22)
const BLUE := Color("6faef2")
const BLUE_DEEP := Color("1f5fae")
const ORANGE := Color("f2621b")
const INK := Color("111111")

const DIR := "res://addons/playmark/"

static var _cache := {}


## Heebo at a weight (100-900), with the Hebrew subset as fallback.
static func heebo(weight := 800) -> Font:
	var key := "heebo%d" % weight
	if not _cache.has(key):
		var base := _font_file("fonts/heebo-latin.woff2", ["Heebo", "Helvetica Neue", "Arial"])
		var hebrew := _font_file("fonts/heebo-hebrew.woff2", ["Heebo", "Arial Hebrew"])
		var v := FontVariation.new()
		v.base_font = base
		var ts := TextServerManager.get_primary_interface()
		v.variation_opentype = {ts.name_to_tag("weight"): weight}
		v.fallbacks = [hebrew] as Array[Font]
		_cache[key] = v
	return _cache[key]


static func mono(bold := false) -> Font:
	var key := "mono%s" % bold
	if not _cache.has(key):
		_cache[key] = _font_file("fonts/cascadia-mono-%s.woff2" % ("600" if bold else "400"), ["Cascadia Mono", "SF Mono", "Menlo", "Consolas"])
	return _cache[key]


## The small B mark (halftone column + solid B), rasterized at a pixel height.
static func mark(height_px: int) -> Texture2D:
	var key := "mark%d" % height_px
	if not _cache.has(key):
		var svg := FileAccess.get_file_as_string(DIR + "brand/b-mark.svg")
		var img := Image.new()
		if svg.is_empty() or img.load_svg_from_string(svg, height_px / 290.0) != OK:
			return null
		_cache[key] = ImageTexture.create_from_image(img)
	return _cache[key]


static func theme() -> Theme:
	if _cache.has("theme"):
		return _cache.theme
	var t := Theme.new()
	t.default_font = heebo(600)
	t.default_font_size = 15

	t.set_color("font_color", "Label", PAPER)

	# Buttons: outlined paper; pressed (a chosen stamp) is solid orange.
	t.set_font("font", "Button", heebo(800))
	t.set_font_size("font_size", "Button", 14)
	t.set_stylebox("normal", "Button", _flat(Color(0, 0, 0, 0), RULE))
	t.set_stylebox("hover", "Button", _flat(Color(PAPER, 0.08), PAPER))
	t.set_stylebox("pressed", "Button", _flat(ORANGE, ORANGE))
	t.set_stylebox("hover_pressed", "Button", _flat(ORANGE, PAPER))
	t.set_stylebox("focus", "Button", StyleBoxEmpty.new())
	t.set_color("font_color", "Button", PAPER)
	t.set_color("font_hover_color", "Button", PAPER)
	t.set_color("font_pressed_color", "Button", INK)
	t.set_color("font_hover_pressed_color", "Button", INK)

	# The primary action: solid paper, ink text (the site's primary CTA, negative plate).
	t.add_type("PrimaryButton")
	t.set_type_variation("PrimaryButton", "Button")
	t.set_stylebox("normal", "PrimaryButton", _flat(PAPER, PAPER, 2, Vector2(18, 10)))
	t.set_stylebox("hover", "PrimaryButton", _flat(ORANGE, ORANGE, 2, Vector2(18, 10)))
	t.set_stylebox("pressed", "PrimaryButton", _flat(ORANGE, PAPER, 2, Vector2(18, 10)))
	t.set_color("font_color", "PrimaryButton", INK)
	t.set_color("font_hover_color", "PrimaryButton", INK)
	t.set_color("font_pressed_color", "PrimaryButton", INK)
	t.set_font_size("font_size", "PrimaryButton", 16)

	t.add_type("GhostButton")
	t.set_type_variation("GhostButton", "Button")
	t.set_stylebox("normal", "GhostButton", StyleBoxEmpty.new())
	t.set_stylebox("hover", "GhostButton", StyleBoxEmpty.new())
	t.set_stylebox("pressed", "GhostButton", StyleBoxEmpty.new())
	t.set_color("font_color", "GhostButton", INK_2)
	t.set_color("font_hover_color", "GhostButton", PAPER)
	t.set_font("font", "GhostButton", mono())
	t.set_font_size("font_size", "GhostButton", 12)

	t.set_font("font", "TextEdit", heebo(500))
	t.set_font_size("font_size", "TextEdit", 17)
	t.set_stylebox("normal", "TextEdit", _flat(GROUND_2, RULE, 1, Vector2(12, 10)))
	t.set_stylebox("focus", "TextEdit", _flat(GROUND_2, ORANGE, 2, Vector2(12, 10)))
	t.set_color("font_color", "TextEdit", PAPER)
	t.set_color("font_placeholder_color", "TextEdit", Color(INK_2, 0.7))
	t.set_color("caret_color", "TextEdit", ORANGE)
	t.set_color("selection_color", "TextEdit", Color(BLUE_DEEP, 0.8))
	t.set_color("background_color", "TextEdit", GROUND_2)
	_cache.theme = t
	return t


## "⌃⇧M" on macOS, "Ctrl+Shift+M" elsewhere.
static func keys(shortcut: String) -> String:
	if OS.get_name() != "macOS":
		return shortcut
	var map := {"ctrl": "⌃", "control": "⌃", "shift": "⇧", "alt": "⌥", "option": "⌥", "cmd": "⌘", "meta": "⌘", "command": "⌘"}
	var out := ""
	for part in shortcut.split("+", false):
		out += map.get(part.strip_edges().to_lower(), part.strip_edges().to_upper())
	return out


static func _flat(bg: Color, border: Color, width := 2, pad := Vector2(14, 8)) -> StyleBoxFlat:
	var s := StyleBoxFlat.new()
	s.bg_color = bg
	s.border_color = border
	s.set_border_width_all(width)
	s.content_margin_left = pad.x
	s.content_margin_right = pad.x
	s.content_margin_top = pad.y
	s.content_margin_bottom = pad.y
	s.anti_aliasing = false
	return s


static func _font_file(rel: String, system_names: PackedStringArray) -> Font:
	var path := DIR + rel
	if ResourceLoader.exists(path):
		var f = load(path)
		if f is Font:
			return f
	# Not imported yet (a fresh install run without the editor): read the file directly.
	var abs_path := ProjectSettings.globalize_path(path)
	if FileAccess.file_exists(abs_path):
		var ff := FontFile.new()
		if ff.load_dynamic_font(abs_path) == OK:
			return ff
	var sf := SystemFont.new()
	sf.font_names = system_names
	return sf
