@tool
extends EditorPlugin
## Adds the Playmark autoload and its project settings when the plugin is enabled.

const AUTOLOAD_NAME := "Playmark"
const AUTOLOAD_PATH := "res://addons/playmark/playmark.gd"
const Settings := preload("res://addons/playmark/settings.gd")


func _enter_tree() -> void:
	Settings.register()


func _enable_plugin() -> void:
	add_autoload_singleton(AUTOLOAD_NAME, AUTOLOAD_PATH)
	Settings.register()
	ProjectSettings.save()


func _disable_plugin() -> void:
	remove_autoload_singleton(AUTOLOAD_NAME)
