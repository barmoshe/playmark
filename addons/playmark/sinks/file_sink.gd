extends "res://addons/playmark/sinks/sink.gd"
## Writes each mark to <root>/inbox/<id>/: mark.json, PNGs, clip frames, log.txt.

var root: String


func _init(root_dir: String) -> void:
	root = root_dir


func send(data: Dictionary, images: Dictionary, log_text: String) -> String:
	var folder := root.path_join("inbox").path_join(data.id)
	if DirAccess.make_dir_recursive_absolute(folder.path_join("clip")) != OK:
		push_error("Playmark: can't create %s" % folder)
		return ""
	_write_once(root.path_join(".gitignore"), "# Playmark marks stay local by default.\n*\n")
	_write_once(root.path_join(".gdignore"), "")
	for file_name: String in images:
		var image: Image = images[file_name]
		if image and image.save_png(folder.path_join(file_name)) != OK:
			push_error("Playmark: can't write %s" % file_name)
	_write(folder.path_join("log.txt"), log_text + "\n")
	# mark.json last: a folder with mark.json is complete.
	_write(folder.path_join("mark.json"), JSON.stringify(data, "  ", false) + "\n")
	return folder


func _write(path: String, text: String) -> void:
	var f := FileAccess.open(path, FileAccess.WRITE)
	if f:
		f.store_string(text)


func _write_once(path: String, text: String) -> void:
	if not FileAccess.file_exists(path):
		_write(path, text)
