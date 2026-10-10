@tool
extends RefCounted
## Playmark's project settings, under playmark/ in Project Settings.

const PREFIX := "playmark/"
const DEFAULTS := {
	"general/enabled": true,
	## Key combo that opens the overlay. Modifiers: Ctrl, Shift, Alt, Cmd (Meta).
	"general/shortcut": "Ctrl+Shift+M",
	## Also run in release exports. Off by default: feedback is a dev tool.
	"general/release_builds": false,
	"capture/clip_seconds": 5.0,
	## Frames per second kept for the clip. 0 turns the clip off.
	"capture/clip_fps": 8,
	"capture/clip_max_width": 640,
	## The first script error of its kind becomes a bug mark by itself (3 per session at most).
	"capture/auto_on_error": true,
	"capture/log_lines": 200,
	"ghosts/visible": true,
	"ghosts/shortcut": "Ctrl+Shift+G",
	## Fixed marks stay visible as ghosts this long, so you can retest them. -1: forever.
	"ghosts/fixed_hours": 72.0,
	## Where marks are saved when running from the editor. Exports use user://playmark.
	"output/dir": "res://.playmark",
}


static func value(key: String) -> Variant:
	return ProjectSettings.get_setting(PREFIX + key, DEFAULTS[key])


static func register() -> void:
	for key: String in DEFAULTS:
		var name := PREFIX + key
		if not ProjectSettings.has_setting(name):
			ProjectSettings.set_setting(name, DEFAULTS[key])
		ProjectSettings.set_initial_value(name, DEFAULTS[key])
		ProjectSettings.set_as_basic(name, true)
