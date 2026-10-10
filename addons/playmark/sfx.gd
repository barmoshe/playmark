extends Node
## Small UI sounds, synthesized at startup: no audio files to ship.
## shutter (open), pop (pin), tick (box), chip (category), stamp (save), swish (cancel),
## fixed (a mark came back fixed). Each is a few layers (a tone with its own pitch and decay,
## band-passed noise for the attack) and the longer ones get a short room. Its own seeded RNG:
## the sounds are the same every run and the game's global random state is left alone.

const RATE := 44100

var _players := {}
var _rng := RandomNumberGenerator.new()
var _task := -1


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	# About 0.2 s of maths: on a worker thread, so the game's first frames don't wait for it.
	# A sound asked for before it is ready just doesn't play.
	_task = WorkerThreadPool.add_task(func() -> void: _install.call_deferred(_synthesize()))


func _exit_tree() -> void:
	if _task >= 0:
		WorkerThreadPool.wait_for_task_completion(_task)
		_task = -1


func _synthesize() -> Dictionary:
	_rng.seed = 7
	return {
		"shutter": _shutter(), "pop": _pop(), "tick": _tick(), "chip": _chip(),
		"stamp": _stamp(), "swish": _swish(), "fixed": _fixed(),
	}


func _install(sounds: Dictionary) -> void:
	for sfx_name in sounds:
		_add(sfx_name, sounds[sfx_name])


func play(sfx_name: String, pitch := 1.0) -> void:
	var p: AudioStreamPlayer = _players.get(sfx_name)
	if p:
		p.pitch_scale = pitch
		p.play()


## Peak-normalised to `peak`, so the per-sound levels live in one place: the calls in _ready.
func _add(sfx_name: String, samples: PackedFloat32Array, peak := 0.7) -> void:
	var top := 0.0
	for s in samples:
		top = maxf(top, absf(s))
	var g := peak / top if top > 0.0 else 1.0
	_fade_end(samples, 0.004)
	var wav := AudioStreamWAV.new()
	wav.format = AudioStreamWAV.FORMAT_16_BITS
	wav.mix_rate = RATE
	var bytes := PackedByteArray()
	bytes.resize(samples.size() * 2)
	for i in samples.size():
		bytes.encode_s16(i * 2, int(clampf(samples[i] * g, -1.0, 1.0) * 32767.0))
	wav.data = bytes
	var p := AudioStreamPlayer.new()
	p.stream = wav
	p.volume_db = -8.0
	add_child(p)
	_players[sfx_name] = p


# --- The sounds -----------------------------------------------------------------------

func _shutter() -> PackedFloat32Array:
	# A camera shutter: a bright blade click, a lower second click as it closes, a little body.
	var out := _buf(0.16)
	_mix(out, _noise_band(0.03, 4200.0, 1.6, 160.0), 0.0, 0.9)
	_mix(out, _tone(240.0, 0.0, 0.05, 70.0, 0.001), 0.0, 0.35)
	_mix(out, _noise_band(0.04, 2600.0, 1.4, 130.0), 0.058, 0.6)
	_mix(out, _tone(180.0, 0.0, 0.05, 80.0, 0.001), 0.058, 0.25)
	return out


func _pop() -> PackedFloat32Array:
	# A soft marimba-like pluck: the pitch drops into the note, a woody overtone dies first.
	var out := _buf(0.24)
	_mix(out, _tone(740.0, 0.5, 0.24, 22.0, 0.002, 140.0), 0.0, 1.0)
	_mix(out, _tone(740.0 * 3.93, 0.0, 0.06, 90.0, 0.001), 0.0, 0.18)
	_mix(out, _noise_band(0.008, 5200.0, 2.0, 600.0), 0.0, 0.25)
	return out


func _tick() -> PackedFloat32Array:
	# A dry wooden tick.
	var out := _buf(0.06)
	_mix(out, _tone(1650.0, 0.15, 0.06, 95.0, 0.0005, 300.0), 0.0, 0.8)
	_mix(out, _noise_band(0.015, 3000.0, 2.5, 320.0), 0.0, 0.5)
	return out


func _chip() -> PackedFloat32Array:
	# A small glassy tap: a two-operator bell whose brightness falls fast.
	var out := _buf(0.12)
	var fc := 1480.0
	for i in out.size():
		var t := float(i) / RATE
		var index := 2.2 * exp(-t * 60.0)
		var env := minf(1.0, t / 0.0008) * exp(-t * 34.0)
		out[i] = sin(TAU * fc * t + index * sin(TAU * fc * 2.0 * t)) * env
	return out


func _stamp() -> PackedFloat32Array:
	# A rubber stamp: a felt thump, the slap of the paper, a short room behind it.
	var out := _buf(0.42)
	_mix(out, _tone(70.0, 1.2, 0.3, 13.0, 0.002, 45.0), 0.0, 1.0)
	_mix(out, _tone(150.0, 0.6, 0.12, 30.0, 0.001, 60.0), 0.0, 0.35)
	_mix(out, _noise_band(0.08, 1300.0, 0.9, 55.0), 0.0, 0.55)
	_mix(out, _noise_band(0.02, 3600.0, 1.5, 200.0), 0.004, 0.25)
	return _room(out, 0.18)


func _swish() -> PackedFloat32Array:
	# Air going away: band-passed noise sweeping down, swelling and fading.
	var out := _buf(0.2)
	var low := 0.0
	var band := 0.0
	for i in out.size():
		var u := float(i) / out.size()
		var k := 2.0 * sin(PI * lerpf(3200.0, 520.0, u * u) / RATE)
		var high := _rng.randf_range(-1.0, 1.0) - low - 0.4 * band
		band += k * high
		low += k * band
		out[i] = band * pow(sin(u * PI), 1.6)
	return out


func _fixed() -> PackedFloat32Array:
	# A rising bell arpeggio (G5 C6 E6 G6), each note ringing into the next, in a small room.
	var notes := [783.99, 1046.5, 1318.5, 1567.98]
	var step := 0.075
	var out := _buf(step * (notes.size() - 1) + 2.0)
	for i in notes.size():
		var last: bool = i == notes.size() - 1
		_mix(out, _bell(notes[i], 1.0 if last else 0.7), step * i, 1.0 if last else 0.75)
	return _room(out, 0.22)


# --- Building blocks ------------------------------------------------------------------

## A raised-cosine fade over the last `secs`, so nothing ends on a click.
func _fade_end(buf: PackedFloat32Array, secs: float) -> void:
	var n := mini(int(secs * RATE), buf.size())
	for i in n:
		buf[buf.size() - n + i] *= 0.5 + 0.5 * cos(PI * float(i) / n)


func _buf(dur: float) -> PackedFloat32Array:
	var out := PackedFloat32Array()
	out.resize(int(dur * RATE))
	return out


## Adds `src` into `dst` at `at` seconds, scaled by `gain`.
func _mix(dst: PackedFloat32Array, src: PackedFloat32Array, at: float, gain: float) -> void:
	var o := int(at * RATE)
	for i in mini(src.size(), dst.size() - o):
		dst[o + i] += src[i] * gain


## A sine at `f` that starts `bend` higher (0.5 = half again) and falls to `f` at `bend_rate`
## per second, with an attack of `attack` s and an exponential decay of `decay` per second.
func _tone(f: float, bend: float, dur: float, decay: float, attack: float, bend_rate := 60.0) -> PackedFloat32Array:
	var out := _buf(dur)
	var phase := 0.0
	for i in out.size():
		var t := float(i) / RATE
		phase += TAU * f * (1.0 + bend * exp(-t * bend_rate)) / RATE
		out[i] = sin(phase) * minf(1.0, t / attack) * exp(-t * decay)
	_fade_end(out, dur * 0.15)
	return out


## White noise through a band-pass (state-variable filter) at `f` with damping `q`
## (lower is narrower), decaying `decay` per second.
func _noise_band(dur: float, f: float, q: float, decay: float) -> PackedFloat32Array:
	var out := _buf(dur)
	var k := 2.0 * sin(PI * minf(f, RATE / 6.0) / RATE)
	var low := 0.0
	var band := 0.0
	for i in out.size():
		var t := float(i) / RATE
		var high := _rng.randf_range(-1.0, 1.0) - low - q * band
		band += k * high
		low += k * band
		out[i] = band * minf(1.0, t / 0.0004) * exp(-t * decay)
	return out


## A struck bell: inharmonic partials, the high ones dying first.
func _bell(f: float, length: float) -> PackedFloat32Array:
	var partials := [[1.0, 1.0, 3.2], [2.0, 0.32, 5.5], [3.01, 0.12, 8.0], [4.17, 0.07, 12.0], [5.43, 0.03, 16.0]]
	var out := _buf(2.0 * length)
	for p in partials:
		var w: float = TAU * f * p[0] / RATE
		var amp: float = p[1]
		var decay: float = p[2] / length
		for i in out.size():
			var t := float(i) / RATE
			out[i] += sin(w * i) * amp * minf(1.0, t / 0.002) * exp(-t * decay)
	_fade_end(out, 0.5 * length)
	return out


## A small room: four damped combs into two all-passes (Schroeder), mixed in at `wet`.
func _room(dry: PackedFloat32Array, wet: float) -> PackedFloat32Array:
	var n := dry.size() + int(0.35 * RATE)
	var acc := PackedFloat32Array()
	acc.resize(n)
	for d in [1116, 1188, 1277, 1356]:
		var line := PackedFloat32Array()
		line.resize(d)
		var pos := 0
		var lp := 0.0
		for i in n:
			var y := line[pos]
			lp = lerpf(y, lp, 0.3)
			line[pos] = (dry[i] if i < dry.size() else 0.0) + lp * 0.72
			pos = (pos + 1) % d
			acc[i] += y * 0.25
	for d in [556, 441]:
		var line := PackedFloat32Array()
		line.resize(d)
		var pos := 0
		for i in n:
			var b := line[pos]
			var x := acc[i]
			line[pos] = x + b * 0.5
			acc[i] = b - x * 0.5
			pos = (pos + 1) % d
	var out := PackedFloat32Array()
	out.resize(n)
	for i in n:
		out[i] = (dry[i] if i < dry.size() else 0.0) + acc[i] * wet
	return out
