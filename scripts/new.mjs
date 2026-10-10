#!/usr/bin/env node
// Starts a blank Godot game with Playmark wired in from the first run.
//   new.mjs <folder> [--name "My Game"]
// Creates a Godot 4.5+ project with one playable scene (a square you move with WASD or the
// arrows, in an empty room), installs the addon, writes a CLAUDE.md that teaches the
// build -> playtest -> mark -> fix loop, and makes the first git commit.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const folder = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--name");
const nameAt = args.indexOf("--name");
if (!folder) {
  console.error('Usage: new.mjs <folder> [--name "My Game"]');
  process.exit(1);
}
const dir = path.resolve(folder);
const name = nameAt !== -1 ? args[nameAt + 1] : path.basename(dir).replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
if (fs.existsSync(dir) && fs.readdirSync(dir).length) {
  console.error(`${dir} exists and is not empty. Pick a new folder.`);
  process.exit(1);
}
fs.mkdirSync(dir, { recursive: true });
const write = (f, text) => fs.writeFileSync(path.join(dir, f), text);

write("project.godot", `; Engine configuration file.
config_version=5

[application]

config/name="${name.replace(/"/g, "")}"
config/version="0.1.0"
run/main_scene="res://main.tscn"
config/features=PackedStringArray("4.5")

[display]

window/size/viewport_width=640
window/size/viewport_height=360
window/size/window_width_override=1280
window/size/window_height_override=720
window/stretch/mode="canvas_items"

[rendering]

anti_aliasing/quality/msaa_2d=2
`);

write("main.tscn", `[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://main.gd" id="1"]

[node name="Main" type="Node2D"]
script = ExtResource("1")
`);

write("main.gd", `extends Node2D
## The starting point: an empty room and a square you move with WASD or the arrow keys.
## Build the game from here. Press Ctrl+Shift+M while playing to leave Claude a mark.

const SPEED := 180.0
const ROOM := Rect2(40, 40, 560, 280)

var player: Node2D


func _ready() -> void:
	var cam := Camera2D.new()
	cam.position = Vector2(320, 180)
	add_child(cam)
	player = Node2D.new()
	player.name = "Player"
	player.position = ROOM.get_center()
	player.set_script(preload("res://player.gd"))
	add_child(player)
	if has_node("/root/Playmark"):
		Playmark.set_player(player)
		Playmark.add_context("player", func(): return {"position": player.position})


func _process(delta: float) -> void:
	var dir := Input.get_vector("ui_left", "ui_right", "ui_up", "ui_down")
	for k in [[KEY_A, Vector2.LEFT], [KEY_D, Vector2.RIGHT], [KEY_W, Vector2.UP], [KEY_S, Vector2.DOWN]]:
		if Input.is_physical_key_pressed(k[0]):
			dir += k[1]
	player.position = (player.position + dir.limit_length(1.0) * SPEED * delta).clamp(ROOM.position + Vector2(12, 12), ROOM.end - Vector2(12, 12))
	queue_redraw()


func _draw() -> void:
	draw_rect(Rect2(0, 0, 640, 360), Color("1c1a2a"))
	draw_rect(ROOM, Color("2a2740"))
	draw_rect(ROOM, Color("4b4670"), false, 2.0)
`);

write("player.gd", `extends Node2D
## The player: a square for now.


func _draw() -> void:
	draw_rect(Rect2(-10, -10, 20, 20), Color("f2621b"))
	draw_rect(Rect2(-10, -10, 20, 20), Color("111111"), false, 2.0)


func _process(_delta: float) -> void:
	queue_redraw()
`);

write(".gitignore", `.godot/
*.import
/export/
`);

write("CLAUDE.md", `# ${name}

A Godot 4.5+ game, started blank with Playmark (https://github.com/barmoshe/playmark).

## The loop

1. Build a small step of the game (one mechanic, one enemy, one screen at a time).
2. Ask the player to playtest: run the game from Godot (or \`godot --path .\`).
3. While playing they press **Ctrl+Shift+M**, pin or box what they mean and write a note.
   Marks land in \`.playmark/inbox/\`, and the next prompt mentions them.
4. Run \`/playmark:triage\`: read each mark's \`annotated.png\` and \`clip_sheet.png\`, find the code
   from the nodes under each pin, propose fixes, apply the ones the player picks, then
   \`inbox.mjs resolve <id> --note "..."\`. The running game shows "Fixed #N".
5. Repeat. Commit after each step that works.

## Conventions

- \`main.tscn\` / \`main.gd\` is the entry scene. Keep scripts typed GDScript.
- Register state worth seeing in every mark: \`Playmark.add_context("name", func(): return {...})\`.
- Rooms or levels in one scene: \`Playmark.set_scope(func(): return "level/%d" % level)\` keeps ghosts in place.
- \`.playmark/\` stays out of git.
`);

write("README.md", `# ${name}

A Godot game in progress, built with [Playmark](https://github.com/barmoshe/playmark): play it,
press Ctrl+Shift+M on anything that's off, and Claude Code picks it up.

\`\`\`bash
godot --path .
\`\`\`
`);

execFileSync("node", [path.join(here, "install.mjs"), dir], { stdio: "inherit" });
try {
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", `${name}: a blank Godot game with Playmark`], { cwd: dir });
} catch {
  console.log("(git not available: skipped the first commit)");
}
console.log(`\n${name} is ready in ${dir}`);
console.log("Open it in Godot (or run `godot --path " + folder + "`), move with WASD, and press Ctrl+Shift+M to mark.");
