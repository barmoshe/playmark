extends Logger
## Keeps the last lines Godot printed (messages, warnings, errors) for the next mark.
## Godot calls this from any thread, so every access is behind the mutex.

var _lines := PackedStringArray()
var _max: int
var _mutex := Mutex.new()
var _pending_error := ""


func _init(max_lines: int) -> void:
	_max = maxi(max_lines, 1)


func _log_message(message: String, error: bool) -> void:
	_push(("[stderr] " if error else "") + message.strip_edges(false, true))


func _log_error(function: String, file: String, line: int, code: String, rationale: String, _editor_notify: bool, error_type: int, script_backtraces: Array[ScriptBacktrace]) -> void:
	# Prefer the GDScript frame over the engine's C++ location.
	for bt in script_backtraces:
		if bt and bt.get_frame_count() > 0:
			file = bt.get_frame_file(0)
			line = bt.get_frame_line(0)
			function = bt.get_frame_function(0)
			break
	var kinds := ["ERROR", "WARNING", "SCRIPT ERROR", "SHADER ERROR"]
	var what := rationale if not rationale.is_empty() else code
	_push("%s: %s (%s:%d @ %s)" % [kinds[clampi(error_type, 0, 3)], what, file, line, function])
	if error_type in [ERROR_TYPE_ERROR, ERROR_TYPE_SCRIPT] and not what.begins_with("Playmark"):
		_mutex.lock()
		if _pending_error.is_empty():
			_pending_error = "%s (%s:%d)" % [what, file.get_file(), line]
		_mutex.unlock()


func _push(line: String) -> void:
	_mutex.lock()
	_lines.append(line)
	if _lines.size() > _max:
		_lines = _lines.slice(_lines.size() - _max)
	_mutex.unlock()


## The first error since the last call, or "". Read on the main thread.
func take_error() -> String:
	_mutex.lock()
	var e := _pending_error
	_pending_error = ""
	_mutex.unlock()
	return e


func dump() -> String:
	_mutex.lock()
	var text := "\n".join(_lines)
	_mutex.unlock()
	return text
