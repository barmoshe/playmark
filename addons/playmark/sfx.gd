extends Node
## Tiny UI sounds, synthesized at startup: no audio files to ship.
## shutter (open), pop (pin), tick (box), chip (category), stamp (save), swish (cancel).

const RATE := 22050

var _players := {}


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	_add("shutter", _shutter())
	_add("pop", _chirp(660.0, 1320.0, 0.07, 0.5))
	_add("tick", _chirp(1200.0, 900.0, 0.04, 0.35))
	_add("chip", _chirp(900.0, 1100.0, 0.03, 0.3))
	_add("stamp", _stamp())
	_add("swish", _swish())
	_add("fixed", _arp([784.0, 1047.0, 1568.0], 0.07))


func play(sfx_name: String, pitch := 1.0) -> void:
	var p: AudioStreamPlayer = _players.get(sfx_name)
	if p:
		p.pitch_scale = pitch
		p.play()


func _add(sfx_name: String, samples: PackedFloat32Array) -> void:
	var wav := AudioStreamWAV.new()
	wav.format = AudioStreamWAV.FORMAT_16_BITS
	wav.mix_rate = RATE
	var bytes := PackedByteArray()
	bytes.resize(samples.size() * 2)
	for i in samples.size():
		bytes.encode_s16(i * 2, int(clampf(samples[i], -1.0, 1.0) * 32767.0))
	wav.data = bytes
	var p := AudioStreamPlayer.new()
	p.stream = wav
	p.volume_db = -8.0
	add_child(p)
	_players[sfx_name] = p


func _chirp(f0: float, f1: float, dur: float, amp: float) -> PackedFloat32Array:
	var n := int(dur * RATE)
	var out := PackedFloat32Array()
	out.resize(n)
	var phase := 0.0
	for i in n:
		var t := float(i) / n
		phase += TAU * lerpf(f0, f1, t) / RATE
		out[i] = sin(phase) * amp * (1.0 - t) * minf(1.0, i / 40.0)
	return out


func _arp(notes: Array, step: float) -> PackedFloat32Array:
	var out := PackedFloat32Array()
	for i in notes.size():
		var tone := _chirp(notes[i], notes[i], step * (2.5 if i == notes.size() - 1 else 1.0), 0.32)
		out.append_array(tone)
	return out


func _shutter() -> PackedFloat32Array:
	# Two clicks of filtered noise: the curtain opening and closing.
	var n := int(0.11 * RATE)
	var out := PackedFloat32Array()
	out.resize(n)
	var lp := 0.0
	for i in n:
		var t := float(i) / RATE
		var env := exp(-t * 90.0) + 0.7 * exp(-maxf(t - 0.055, 0.0) * 120.0) * float(t > 0.055)
		lp = lerpf(lp, randf_range(-1.0, 1.0), 0.6)
		out[i] = lp * env * 0.6
	return out


func _stamp() -> PackedFloat32Array:
	# A low thump with a paper slap on top.
	var n := int(0.22 * RATE)
	var out := PackedFloat32Array()
	out.resize(n)
	var phase := 0.0
	for i in n:
		var t := float(i) / RATE
		phase += TAU * lerpf(150.0, 60.0, minf(t / 0.12, 1.0)) / RATE
		out[i] = sin(phase) * exp(-t * 18.0) * 0.8 + randf_range(-1.0, 1.0) * exp(-t * 60.0) * 0.35
	return out


func _swish() -> PackedFloat32Array:
	var n := int(0.16 * RATE)
	var out := PackedFloat32Array()
	out.resize(n)
	var lp := 0.0
	for i in n:
		var t := float(i) / n
		lp = lerpf(lp, randf_range(-1.0, 1.0), lerpf(0.05, 0.4, t))
		out[i] = lp * sin(t * PI) * 0.5
	return out
