extends SceneTree
## Headless unit checks for the addon (no window needed). Run from the demo project:
##   godot --headless --path demo --script "$PWD/tests/unit.gd"
## Prints "unit: N passed" or the failures, and exits 1 on any failure.

const Images := preload("res://addons/playmark/images.gd")
const Snapshot := preload("res://addons/playmark/snapshot.gd")
const Settings := preload("res://addons/playmark/settings.gd")
const Brand := preload("res://addons/playmark/brand.gd")
const FileSink := preload("res://addons/playmark/sinks/file_sink.gd")

var _fails: PackedStringArray = []
var _passed := 0


func _init() -> void:
	_images()
	_plain()
	_settings()
	_brand()
	_sink()
	if _fails.is_empty():
		print("unit: %d passed" % _passed)
		quit(0)
	else:
		print("unit: FAILED\n  " + "\n  ".join(_fails))
		quit(1)


func check(cond: bool, what: String) -> void:
	if cond:
		_passed += 1
	else:
		_fails.append(what)


func _images() -> void:
	var shot := Image.create_empty(480, 270, false, Image.FORMAT_RGBA8)
	shot.fill(Color.DIM_GRAY)
	var marks := [{"type": "pin", "x": 100, "y": 100}, {"type": "box", "x": 200, "y": 50, "w": 80, "h": 60}]
	var a := Images.annotate(shot, marks)
	check(a.get_width() == 960 and a.get_height() == 540, "annotate upscales 480 to 960 by a whole factor")
	check(a.get_pixel(200 * 2 + 1, 50 * 2 + 1).is_equal_approx(Images.BLUE), "box outline is blueprint blue")
	check(Images.color_name(marks[0]) == "orange" and Images.color_name(marks[1]) == "blue", "color names by mark type")
	var frames := []
	for i in 20:
		var f := Image.create_empty(64, 36, false, Image.FORMAT_RGBA8)
		f.fill(Color(i / 20.0, 0, 0))
		frames.append(f)
	var sheet := Images.contact_sheet(frames)
	check(sheet != null and sheet.get_width() == 4 * 64 + 5 * 4, "contact sheet is 4 columns")
	check(sheet.get_height() == 3 * 36 + 4 * 4, "contact sheet keeps 12 frames in 3 rows")
	check(Images.contact_sheet([]) == null, "no frames, no sheet")


func _plain() -> void:
	var p = Snapshot._plain({"v": Vector2(1.234, 5), "c": Color.RED, "n": [Vector3i(1, 2, 3)], "s": &"x", "f": 1.23456})
	check(p.v == [1.23, 5.0], "Vector2 to array, floats snapped")
	check(p.c == "#ff0000", "Color to hex")
	check(p.n == [[1, 2, 3]], "nested Vector3i")
	check(p.s == "x" and p.f == 1.23, "StringName and float")
	check(JSON.parse_string(JSON.stringify(p)) != null, "result is JSON-safe")


func _settings() -> void:
	check(Settings.value("general/shortcut") == "Ctrl+Shift+M", "default shortcut")
	check(Settings.value("capture/clip_fps") == 8, "default clip fps")
	check(Settings.DEFAULTS.has("ghosts/shortcut"), "ghost shortcut setting exists")


func _brand() -> void:
	check(Brand.heebo(900) != null and Brand.mono() != null, "fonts load (or fall back)")
	check(Brand.mark(64) != null, "B mark rasterizes")
	check(Brand.theme().has_stylebox("normal", "PrimaryButton"), "theme has the primary button")


func _sink() -> void:
	var dir := OS.get_temp_dir().path_join("playmark-unit-%d" % Time.get_ticks_usec())
	var sink := FileSink.new(dir)
	var img := Image.create_empty(8, 8, false, Image.FORMAT_RGBA8)
	var loc := sink.send({"id": "20260101-000000-abcd", "seq": 1}, {"screenshot.png": img, "clip/000.png": img}, "log line")
	check(FileAccess.file_exists(loc.path_join("mark.json")), "sink writes mark.json")
	check(FileAccess.file_exists(loc.path_join("clip/000.png")), "sink writes clip frames")
	check(FileAccess.get_file_as_string(dir.path_join(".gitignore")).contains("*"), "sink keeps marks out of git")
	check(FileAccess.file_exists(dir.path_join(".gdignore")), "sink hides marks from the Godot importer")
