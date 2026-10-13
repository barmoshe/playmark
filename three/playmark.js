// Playmark for three.js. One ES module, no build step, no dependency but the game's own `three`.
// The game hands it the renderer, scene and camera; it watches for the shortcut, keeps the last
// seconds of play, freezes the game for the overlay, and sends each mark to the sink
// (node <plugin>/scripts/sink.mjs), which writes .playmark/ exactly like the other engines.
// Polls the sink so a fix shows as a toast.
//
//   import { Playmark } from './playmark/playmark.js';
//   Playmark.attach({ renderer, scene, camera });     // before renderer.setAnimationLoop(...)
//   Playmark.addContext('player', () => ({ hp }));    // game state on every mark
//
// It starts only on pages served from localhost (the sink answers only those). Import it in
// development only: there is no debug flag in three.js to drop it from a release build.
import * as THREE from 'three';

export const PLAYMARK_VERSION = '0.4.0';

const settings = {
    enabled: true,
    shortcut: 'Ctrl+Shift+M',
    ghostsShortcut: 'Ctrl+Shift+G',
    clipSeconds: 5,
    /** Frames per second kept for the clip. 0 turns the clip off. */
    clipFps: 8,
    /** Clip frames are scaled down to this width (they live in memory as canvases). */
    clipMaxWidth: 480,
    autoOnError: true,
    logLines: 200,
    ghostsVisible: true,
    /** Fixed marks stay visible this long, so you can retest them. -1: forever. */
    ghostsFixedHours: 72,
    /** Where the sink listens. ?playmark_sink=http://127.0.0.1:7478 overrides it. */
    sink: 'http://127.0.0.1:7477',
    project: { name: '', version: '' },
};

const contexts = new Map();
let scopeFn = null;
let host = null;

export const Playmark = {
    settings,
    /**
     * Starts Playmark on this renderer. `scene` and `camera` are what a pin is raycast against
     * (call attach again when the game switches camera). Optional: `onPause` / `onResume` freeze
     * the game while the overlay is open; without them, a loop started with
     * renderer.setAnimationLoop after attach is stopped instead. `anyHost: true` starts it on
     * pages not served from localhost too.
     */
    attach({ renderer, scene, camera, onPause = null, onResume = null, anyHost = false }) {
        if (!renderer || !scene || !camera) throw new Error('Playmark.attach needs { renderer, scene, camera }');
        if (host) { Object.assign(host, { scene, camera }); return; }
        const q = new URLSearchParams(location.search).get('playmark');
        if (!settings.enabled || q === '0') return;
        // Only on this machine by default: the sink listens on 127.0.0.1 and answers localhost pages only.
        if (!anyHost && ['localhost', '127.0.0.1', '[::1]', '::1'].indexOf(location.hostname) === -1) return;
        host = new Host(renderer, scene, camera, onPause, onResume);
    },
    addContext(name, fn) { contexts.set(name, fn); },
    removeContext(name) { contexts.delete(name); },
    setScope(fn) { scopeFn = fn; },
    /** Opens the overlay as if the shortcut was pressed. */
    open() { host?.requestOpen(); },
};

// --- The overlay: photo mode for feedback --------------------------------------------------
// Drawn in the page's DOM over the game canvas: the frame on a dark stage, a rewind strip,
// category stamps and a note. Same keys as the Godot addon:
//   click pin · drag box · right-click undo · 1-5 category · ← → rewind ·
//   Ctrl/Cmd+Enter save · Esc cancel · typing anywhere starts the note.

const CATEGORIES = ['bug', 'feel', 'art', 'balance', 'idea'];
const MAX_MARKS = 9;

const BRAND = {
    ground: '#111111', ground2: '#1b1b1b', paper: '#f2efe6', ink2: '#b3b0a8',
    rule: 'rgba(242,239,230,0.22)', blue: '#6faef2', orange: '#f2621b', ink: '#111111',
    mono: 'ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace',
    sans: 'Heebo, system-ui, -apple-system, "Segoe UI", sans-serif',
};

// Marks are {box, x, y, w, h} in 0..1 of the frame, top-left origin.
// Clip frames are {canvas, offset}.

class Overlay {
    constructor(shot, frames, info) {
        this.shot = shot;
        this.frames = frames;
        this.info = info;
        this.marks = [];
        this.frameIndex = -1;
        this.category = -1;
        this.onSubmit = null;
        this.onClose = null;
        this.stamps = [];
        this.busy = false;
        this.drag = null;
        this.dragTo = { x: 0, y: 0, px: 0, py: 0 };
        this.keyHandler = (e) => this.onKey(e);
        this.stopKey = (e) => e.stopPropagation();
        this.draw = () => this.redraw();
        this.root = document.createElement('div');
        this.root.setAttribute('data-playmark', 'overlay');
        Object.assign(this.root.style, {
            position: 'fixed', inset: '0', zIndex: '2147483646', background: BRAND.ground, color: BRAND.paper,
            display: 'flex', flexDirection: 'column', font: `13px ${BRAND.sans}`, userSelect: 'none', touchAction: 'none',
        });
        this.build();
        document.body.appendChild(this.root);
        // Capture phase on window: the game's own key listeners never see a key typed here.
        window.addEventListener('keydown', this.keyHandler, true);
        window.addEventListener('keyup', this.stopKey, true);
        window.addEventListener('resize', this.draw);
        this.draw();
    }

    // --- API (the host drives these) -------------------------------------------------------

    addMark(m) {
        if (this.marks.length >= MAX_MARKS || this.busy) return;
        this.marks.push(m);
        this.draw();
    }

    undoMark() {
        if (this.busy) return;
        this.marks.pop();
        this.draw();
    }

    setFrame(i) {
        this.frameIndex = Math.max(-1, Math.min(i, this.frames.length - 1));
        this.draw();
    }

    submit() {
        if (this.busy) return;
        this.busy = true;
        this.showBanner('SAVING', BRAND.paper);
        this.onSubmit?.({ note: this.note.value.trim(), category: this.category >= 0 ? CATEGORIES[this.category] : '', marks: this.marks.slice(), frameIndex: this.frameIndex });
    }

    /** The host calls this once the mark is on disk, or failed to get there. */
    finish(saved, seq, error = '') {
        this.showBanner(saved ? `SAVED #${seq}` : 'NOT SAVED', saved ? BRAND.orange : '#e5484d', error);
        setTimeout(() => this.close(), saved ? 550 : 2600);
    }

    cancel() {
        if (!this.busy) this.close();
    }

    close() {
        window.removeEventListener('keydown', this.keyHandler, true);
        window.removeEventListener('keyup', this.stopKey, true);
        window.removeEventListener('resize', this.draw);
        this.root.remove();
        this.onClose?.();
    }

    // --- Layout ---------------------------------------------------------------------------

    el(tag, parent, style = {}, text = '') {
        const e = document.createElement(tag);
        Object.assign(e.style, style);
        if (text) e.textContent = text;
        parent.appendChild(e);
        return e;
    }

    build() {
        const head = this.el('div', this.root, { display: 'flex', alignItems: 'flex-end', gap: '18px', padding: '10px 18px 8px', borderBottom: `1px solid ${BRAND.rule}` });
        const title = this.el('div', head, { flex: '1', minWidth: '0' });
        this.el('div', title, { font: `900 24px ${BRAND.sans}`, letterSpacing: '0.02em' }, 'PLAYMARK');
        const parts = [`#${this.info.seq}`, this.info.scene, `${this.info.fps} FPS`, this.info.frozen ? 'GAME FROZEN' : 'GAME STILL RUNNING'].filter(Boolean);
        this.el('div', title, { font: `11px ${BRAND.mono}`, color: BRAND.ink2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, parts.join('  ·  '));
        const stat = (caption, value, color) => {
            const s = this.el('div', head, { textAlign: 'right' });
            this.el('div', s, { font: `900 22px ${BRAND.sans}`, color }, String(value));
            this.el('div', s, { font: `10px ${BRAND.mono}`, color: BRAND.ink2 }, caption);
        };
        stat('FIXED', this.info.fixed, BRAND.blue);
        stat('INBOX', this.info.inbox, BRAND.orange);
        stat('THIS SESSION', this.info.session + 1, BRAND.paper);

        this.stage = this.el('div', this.root, { flex: '1', position: 'relative', minHeight: '0', background: BRAND.ground2, cursor: 'crosshair' });
        this.view = this.el('canvas', this.stage, { position: 'absolute' });
        this.layer = this.el('div', this.stage, { position: 'absolute', pointerEvents: 'none' });
        this.banner = this.el('div', this.stage, { position: 'absolute', inset: '0', display: 'none', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', background: 'rgba(17,17,17,0.55)', font: `900 34px ${BRAND.sans}`, letterSpacing: '0.04em', pointerEvents: 'none' });
        this.stage.addEventListener('pointerdown', (e) => this.onDown(e));
        this.stage.addEventListener('pointermove', (e) => this.onMove(e));
        this.stage.addEventListener('pointerup', (e) => this.onUp(e));
        this.stage.addEventListener('contextmenu', (e) => { e.preventDefault(); this.undoMark(); });

        const scrub = this.el('div', this.root, { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 18px', font: `11px ${BRAND.mono}`, color: BRAND.ink2 });
        const step = (label, d) => {
            const b = this.button(scrub, label);
            b.disabled = this.frames.length === 0;
            b.onclick = () => this.setFrame(this.frameIndex < 0 ? (d < 0 ? this.frames.length - 1 : -1) : this.frameIndex + d >= this.frames.length ? -1 : this.frameIndex + d);
        };
        step('←', -1);
        step('→', 1);
        this.scrubLabel = this.el('span', scrub, { flex: '1' }, this.frames.length ? '← → REWIND' : 'NO CLIP');
        this.scrubRight = this.el('span', scrub, {}, 'FREEZE FRAME');

        const deck = this.el('div', this.root, { display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '8px 18px', borderTop: `1px solid ${BRAND.rule}` });
        CATEGORIES.forEach((c, i) => {
            const b = this.button(deck, `${i + 1}  ${c.toUpperCase()}`);
            b.onclick = () => this.setCategory(i);
            this.stamps.push(b);
        });
        this.note = this.el('textarea', deck, { flex: '1 1 260px', minHeight: '38px', maxHeight: '90px', resize: 'none', background: BRAND.ground2, color: BRAND.paper, border: `1px solid ${BRAND.rule}`, borderRadius: '4px', padding: '8px', font: `14px ${BRAND.sans}`, userSelect: 'text' });
        this.note.placeholder = 'What do you see? One line is enough.';
        const undo = this.button(deck, 'UNDO');
        undo.onclick = () => this.undoMark();
        const cancel = this.button(deck, 'CANCEL');
        cancel.onclick = () => this.cancel();
        const save = this.button(deck, 'SAVE MARK');
        Object.assign(save.style, { background: BRAND.orange, color: BRAND.ink, borderColor: BRAND.orange, fontWeight: '900' });
        save.onclick = () => this.submit();

        const touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
        this.el('div', this.root, { padding: '0 18px 8px', font: `11px ${BRAND.mono}`, color: BRAND.ink2 },
            touch ? 'TAP TO PIN  ·  DRAG TO BOX' : 'CLICK PIN  ·  DRAG BOX  ·  RIGHT-CLICK UNDO  ·  1-5 CATEGORY  ·  ← → REWIND  ·  CTRL+ENTER SAVE  ·  ESC CANCEL');
    }

    button(parent, label) {
        const b = this.el('button', parent, { background: 'transparent', color: BRAND.paper, border: `1px solid ${BRAND.rule}`, borderRadius: '4px', padding: '7px 10px', font: `700 12px ${BRAND.mono}`, cursor: 'pointer' }, label);
        b.type = 'button';
        return b;
    }

    setCategory(i) {
        this.category = this.category === i ? -1 : i;
        this.stamps.forEach((b, j) => Object.assign(b.style, j === this.category ? { background: BRAND.paper, color: BRAND.ink } : { background: 'transparent', color: BRAND.paper }));
    }

    showBanner(text, color, detail = '') {
        this.banner.style.display = 'flex';
        this.banner.style.color = color;
        this.banner.textContent = text;
        if (detail) this.el('div', this.banner, { font: `12px ${BRAND.mono}`, color: BRAND.paper, marginTop: '10px', maxWidth: '80%', textAlign: 'center' }, detail);
    }

    frameRect() {
        const src = this.current();
        const r = this.stage.getBoundingClientRect();
        const k = Math.min(r.width / src.width, r.height / src.height);
        const w = src.width * k, h = src.height * k;
        return { x: (r.width - w) / 2, y: (r.height - h) / 2, w, h, left: r.left, top: r.top };
    }

    current() {
        return this.frameIndex < 0 ? this.shot : this.frames[this.frameIndex].canvas;
    }

    redraw() {
        const f = this.frameRect();
        const src = this.current();
        // Sharp at any size: the visible canvas has as many pixels as the screen shows.
        const dpr = window.devicePixelRatio || 1;
        this.view.width = Math.max(1, Math.round(f.w * dpr));
        this.view.height = Math.max(1, Math.round(f.h * dpr));
        Object.assign(this.view.style, { left: `${f.x}px`, top: `${f.y}px`, width: `${f.w}px`, height: `${f.h}px` });
        Object.assign(this.layer.style, { left: `${f.x}px`, top: `${f.y}px`, width: `${f.w}px`, height: `${f.h}px` });
        const g = this.view.getContext('2d');
        g.imageSmoothingEnabled = f.w < src.width;
        g.drawImage(src, 0, 0, this.view.width, this.view.height);
        this.layer.textContent = '';
        this.marks.forEach((m, i) => this.drawMark(m, i + 1));
        if (this.drag) this.drawMark(this.dragMark(), this.marks.length + 1, true);
        if (this.frameIndex >= 0) {
            this.scrubRight.textContent = `${this.frames[this.frameIndex].offset.toFixed(2)} s`;
            this.scrubLabel.textContent = `REWOUND ${this.frames[this.frameIndex].offset.toFixed(2)} s  ·  MARKING THIS FRAME`;
            this.scrubLabel.style.color = BRAND.blue;
        } else {
            this.scrubRight.textContent = 'FREEZE FRAME';
            this.scrubLabel.textContent = this.frames.length ? '← → REWIND' : 'NO CLIP';
            this.scrubLabel.style.color = BRAND.ink2;
        }
    }

    drawMark(m, n, ghost = false) {
        const color = m.box ? BRAND.blue : BRAND.orange;
        const shape = this.el('div', this.layer, { position: 'absolute', boxSizing: 'border-box', opacity: ghost ? '0.6' : '1' });
        if (m.box) {
            Object.assign(shape.style, { left: `${m.x * 100}%`, top: `${m.y * 100}%`, width: `${m.w * 100}%`, height: `${m.h * 100}%`, border: `3px solid ${color}`, boxShadow: `0 0 0 1px ${BRAND.ink}` });
        } else {
            Object.assign(shape.style, { left: `calc(${m.x * 100}% - 14px)`, top: `calc(${m.y * 100}% - 14px)`, width: '28px', height: '28px', borderRadius: '50%', border: `3px solid ${color}`, boxShadow: `0 0 0 1px ${BRAND.ink}` });
        }
        this.el('div', shape, { position: 'absolute', left: m.box ? '-3px' : '24px', top: m.box ? '-26px' : '-22px', minWidth: '20px', padding: '0 5px', background: color, color: BRAND.ink, font: `900 15px/22px ${BRAND.sans}`, textAlign: 'center', borderRadius: '3px' }, String(n));
    }

    // --- Input ----------------------------------------------------------------------------

    norm(e) {
        const f = this.frameRect();
        return { x: Math.min(1, Math.max(0, (e.clientX - f.left - f.x) / f.w)), y: Math.min(1, Math.max(0, (e.clientY - f.top - f.y) / f.h)), px: e.clientX, py: e.clientY };
    }

    dragMark() {
        const d = this.drag;
        const x = Math.min(d.x, this.dragTo.x), y = Math.min(d.y, this.dragTo.y);
        return { box: true, x, y, w: Math.abs(this.dragTo.x - d.x), h: Math.abs(this.dragTo.y - d.y) };
    }

    onDown(e) {
        if (e.button !== 0 || this.busy) return;
        const p = this.norm(e);
        this.drag = p;
        this.dragTo = p;
        this.stage.setPointerCapture(e.pointerId);
    }

    onMove(e) {
        if (!this.drag) return;
        this.dragTo = this.norm(e);
        if (Math.hypot(this.dragTo.px - this.drag.px, this.dragTo.py - this.drag.py) > 6) this.draw();
    }

    onUp(e) {
        if (!this.drag) return;
        this.dragTo = this.norm(e);
        const moved = Math.hypot(this.dragTo.px - this.drag.px, this.dragTo.py - this.drag.py) > 6;
        const m = moved ? this.dragMark() : { box: false, x: this.drag.x, y: this.drag.y, w: 0, h: 0 };
        this.drag = null;
        this.addMark(m);
        this.draw();
    }

    onKey(e) {
        e.stopPropagation();
        if (this.busy) { e.preventDefault(); return; }
        const inNote = document.activeElement === this.note;
        if (e.key === 'Escape') { e.preventDefault(); this.cancel(); return; }
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.submit(); return; }
        if (inNote) return;
        if (e.key >= '1' && e.key <= '5' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); this.setCategory(Number(e.key) - 1); return; }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            if (!this.frames.length) return;
            const d = e.key === 'ArrowLeft' ? -1 : 1;
            const i = this.frameIndex < 0 ? (d < 0 ? this.frames.length - 1 : -1) : this.frameIndex + d;
            this.setFrame(i >= this.frames.length ? -1 : i);
            return;
        }
        if ((e.key === 'Backspace' || e.key === 'Delete') && this.marks.length) { e.preventDefault(); this.undoMark(); return; }
        // Typing anywhere starts the note.
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            this.note.focus();
            this.note.value += e.key;
        }
    }
}

// --- Small helpers ------------------------------------------------------------------------

const MAX_AUTO_MARKS = 3;
const POLL_MS = 1500;
/** Without a sink, ask rarely: every failed fetch is a red line in the browser's console. */
const POLL_IDLE_MS = 20000;
/** A game that renders only on change may not draw again: after this long, Playmark draws once itself. */
const OPEN_WAIT_MS = 250;
const _v = new THREE.Vector3();
const r1 = (n) => Math.round(n * 10) / 10;
const r3 = (n) => Math.round(n * 1000) / 1000;
const pad = (n, w = 2) => String(n).padStart(w, '0');
const localTime = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const xyz = (v) => [r1(v.x), r1(v.y), r1(v.z)];

function parseShortcut(text) {
    const parts = text.toLowerCase().split('+').map((p) => p.trim());
    const has = (k) => parts.indexOf(k) !== -1;
    return { ctrl: has('ctrl'), shift: has('shift'), alt: has('alt'), meta: has('cmd') || has('meta'), key: parts[parts.length - 1] };
}

function matches(e, s) {
    return e.ctrlKey === s.ctrl && e.shiftKey === s.shift && e.altKey === s.alt && e.metaKey === s.meta && e.key.toLowerCase() === s.key;
}

function plain(v) {
    try { return JSON.parse(JSON.stringify(v ?? null)); } catch { return String(v); }
}

function canvasOf(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
}

function blob64(c) {
    // toBlob copies the pixels when called, so the clip ring can keep running.
    return new Promise((resolve, reject) => c.toBlob((b) => {
        if (!b) { reject(new Error('the browser could not encode a PNG')); return; }
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result).replace(/^data:[^,]*,/, ''));
        fr.onerror = () => reject(fr.error);
        fr.readAsDataURL(b);
    }, 'image/png'));
}

// --- Logs: the last lines, and the first error of each kind -------------------------------

class LogRing {
    constructor() {
        this.lines = [];
        this.errors = [];
        /** Set while Playmark itself works: what it logs then never becomes an automatic mark. */
        this.mute = false;
        this.seen = new Set();
    }

    add(level, message, stack = '') {
        const head = level === 'Log' ? message : `${level.toUpperCase()}: ${message}`;
        for (const l of head.split('\n')) this.push(l);
        if (level === 'Error' && stack) for (const l of stack.trim().split('\n')) this.push('    ' + l.trim());
        if (level === 'Error' && !this.mute && !message.startsWith('Playmark')) {
            const first = message.split('\n')[0].slice(0, 200);
            if (!this.seen.has(first)) { this.seen.add(first); this.errors.push(first); }
        }
    }

    push(line) {
        this.lines.push(line);
        if (this.lines.length > settings.logLines) this.lines.splice(0, this.lines.length - settings.logLines);
    }
}

function hookLogs(log) {
    const one = (a) => (typeof a === 'string' ? a : a instanceof Error ? a.message : (() => { try { return JSON.stringify(a); } catch { return String(a); } })());
    // console's own %s / %d / %o substitution.
    const text = (args) => {
        if (typeof args[0] === 'string' && /%[sdifoO]/.test(args[0])) {
            let i = 1;
            const head = args[0].replace(/%[sdifoO]/g, (m) => (i < args.length ? one(args[i++]) : m));
            return [head, ...args.slice(i).map(one)].join(' ');
        }
        return args.map(one).join(' ');
    };
    const wrap = (name, level) => {
        const original = console[name].bind(console);
        console[name] = (...args) => {
            try {
                const err = args.find((a) => a instanceof Error);
                log.add(level, text(args), err?.stack ?? '');
            } catch { /* logging must never throw */ }
            original(...args);
        };
    };
    wrap('log', 'Log'); wrap('info', 'Log'); wrap('debug', 'Log'); wrap('warn', 'Warning'); wrap('error', 'Error');
    window.addEventListener('error', (e) => log.add('Error', e.message || String(e.error), e.error?.stack ?? `at ${e.filename}:${e.lineno}:${e.colno}`));
    window.addEventListener('unhandledrejection', (e) => log.add('Error', `Unhandled rejection: ${e.reason?.message ?? e.reason}`, e.reason?.stack ?? ''));
}

// --- What is under a mark -----------------------------------------------------------------

/** Raycaster ignores `visible`: a hidden object, or one under a hidden parent, isn't on screen. */
function shown(o) {
    for (let p = o; p; p = p.parent) if (!p.visible) return false;
    return true;
}

/** Names up the parent chain, below the scene; an unnamed object shows as its type. */
function objectPath(o) {
    const parts = [];
    for (let p = o; p && p.parent; p = p.parent) parts.unshift(p.name || p.type);
    return parts.join('/');
}

function describe(o, extra = {}) {
    const e = { path: objectPath(o), class: o.type, position: xyz(o.getWorldPosition(_v)) };
    const mats = (Array.isArray(o.material) ? o.material : o.material ? [o.material] : []).map((m) => m.name || m.type);
    if (mats.length) e.material = mats.length === 1 ? mats[0] : mats;
    if (o.geometry) e.geometry = o.geometry.name || o.geometry.type;
    const keys = Object.keys(o.userData ?? {});
    if (keys.length) e.user_data = keys;
    return { ...e, ...extra };
}

/** World-space bounds of one object (not its children), or null if it draws nothing. */
function boundsOf(o) {
    if (o.isInstancedMesh) {
        if (!o.boundingBox) o.computeBoundingBox?.();
        return o.boundingBox ? o.boundingBox.clone().applyMatrix4(o.matrixWorld) : null;
    }
    const g = o.geometry;
    if (!g) return null;
    if (!g.boundingBox) g.computeBoundingBox();
    return g.boundingBox.clone().applyMatrix4(o.matrixWorld);
}

/**
 * Per mark: the objects under it, nearest first, and where it is in the world. A pin is raycast
 * from the camera; a box lists objects whose projected bounding-box center is inside it.
 * three.js has no UI or physics of its own: `ui` and `physics` stay empty.
 */
function underMarks(marks, scene, camera) {
    scene.updateMatrixWorld();
    camera.updateMatrixWorld();
    const ray = new THREE.Raycaster();
    ray.layers.mask = camera.layers.mask; // only what this camera draws
    // The defaults (1 world unit) put a grid or a line under every pin.
    ray.params.Line.threshold = 0.02;
    ray.params.Points.threshold = 0.02;
    const camPos = camera.getWorldPosition(new THREE.Vector3());
    let drawn = null;

    return marks.map((m, i) => {
        const out = { mark: i + 1, physics: [], nodes: [], ui: [] };
        const hits = [];
        if (m.box) {
            if (!drawn) {
                drawn = [];
                scene.traverseVisible((o) => { if ((o.isMesh || o.isSprite || o.isPoints || o.isLine) && o.layers.test(camera.layers)) drawn.push(o); });
            }
            for (const o of drawn) {
                const b = boundsOf(o);
                if (!b || b.isEmpty()) continue;
                const c = b.getCenter(new THREE.Vector3());
                const s = c.clone().project(camera);
                if (s.z < -1 || s.z > 1) continue; // behind the camera or past its far plane
                const sx = (s.x + 1) / 2, sy = (1 - s.y) / 2;
                if (sx < m.x || sx > m.x + m.w || sy < m.y || sy > m.y + m.h) continue;
                const d = camPos.distanceTo(c);
                hits.push({ d, p: c, e: describe(o, { distance: r1(d) }) });
            }
        } else {
            ray.setFromCamera(new THREE.Vector2(m.x * 2 - 1, 1 - m.y * 2), camera);
            const seen = new Set();
            for (const h of ray.intersectObject(scene, true)) {
                const key = `${h.object.uuid}:${h.instanceId ?? ''}`;
                if (seen.has(key) || !shown(h.object)) continue;
                seen.add(key);
                const extra = { distance: r1(h.distance), world: xyz(h.point) };
                if (h.instanceId !== undefined) extra.instance = h.instanceId;
                hits.push({ d: h.distance, p: h.point, e: describe(h.object, extra) });
            }
        }
        hits.sort((a, b) => a.d - b.d);
        out.nodes = hits.slice(0, 10).map((x) => x.e);
        if (hits.length) out.world = xyz(hits[0].p);
        return out;
    });
}

// --- Images: annotated frame and contact sheet, as in the other engines -------------------

function annotate(shot, marks) {
    const k = Math.max(1, Math.ceil(960 / shot.width));
    const c = canvasOf(shot.width * k, shot.height * k);
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(shot, 0, 0, c.width, c.height);
    const u = Math.max(1, c.width / 960);
    const t = Math.round(3 * u), radius = Math.round(14 * u);
    g.font = `900 ${Math.round(30 * u)}px ${BRAND.sans}`;
    g.textBaseline = 'bottom';
    marks.forEach((m, i) => {
        const color = m.box ? BRAND.blue : BRAND.orange;
        let ax, ay;
        if (m.box) {
            const x = m.x * c.width, y = m.y * c.height, w = m.w * c.width, h = m.h * c.height;
            g.lineWidth = t + 2; g.strokeStyle = BRAND.ink; g.strokeRect(x, y, w, h);
            g.lineWidth = t; g.strokeStyle = color; g.strokeRect(x, y, w, h);
            ax = x - t; ay = y - t - 2;
        } else {
            const x = m.x * c.width, y = m.y * c.height;
            g.lineWidth = t + 2; g.strokeStyle = BRAND.ink; g.beginPath(); g.arc(x, y, radius + 1, 0, Math.PI * 2); g.stroke();
            g.lineWidth = t; g.strokeStyle = color; g.beginPath(); g.arc(x, y, radius, 0, Math.PI * 2); g.stroke();
            g.fillStyle = color; g.fillRect(x - 1.5 * u, y - 1.5 * u, 3 * u, 3 * u);
            ax = x + radius; ay = y - radius;
        }
        g.lineWidth = Math.max(2, u * 3); g.strokeStyle = BRAND.ink; g.strokeText(String(i + 1), ax, ay);
        g.fillStyle = color; g.fillText(String(i + 1), ax, ay);
    });
    return c;
}

/** Up to 12 frames, evenly sampled, oldest first, 4 to a row. */
function contactSheet(frames, max = 12, cols = 4) {
    const n = Math.min(frames.length, max);
    const picked = Array.from({ length: n }, (_, i) => frames[Math.round(i * (frames.length - 1) / Math.max(n - 1, 1))]);
    const fw = picked[0].width, fh = picked[0].height, gap = 4;
    cols = Math.min(cols, n);
    const rows = Math.ceil(n / cols);
    const c = canvasOf(cols * fw + gap * (cols + 1), rows * fh + gap * (rows + 1));
    const g = c.getContext('2d');
    g.fillStyle = BRAND.ink; g.fillRect(0, 0, c.width, c.height);
    g.font = `900 16px ${BRAND.sans}`; g.textAlign = 'right'; g.textBaseline = 'bottom';
    picked.forEach((f, i) => {
        const x = gap + (i % cols) * (fw + gap), y = gap + Math.floor(i / cols) * (fh + gap);
        g.drawImage(f, x, y, fw, fh);
        g.lineWidth = 3; g.strokeStyle = BRAND.ink; g.strokeText(String(i + 1), x + fw - 6, y + fh - 4);
        g.fillStyle = '#ffffff'; g.fillText(String(i + 1), x + fw - 6, y + fh - 4);
    });
    return c;
}

// --- The host -----------------------------------------------------------------------------

class Host {
    constructor(renderer, scene, camera, onPause, onResume) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        this.onPause = onPause;
        this.onResume = onResume;
        this.canvas = renderer.domElement;
        this.log = new LogRing();
        this.ring = [];
        this.ringTimes = [];
        this.ringHead = 0;
        this.ringCount = 0;
        this.nextClip = 0;
        this.opening = false;
        this.overlay = null;
        this.busy = false;
        this.autoMarks = 0;
        this.session = 0;
        this.fps = 0;
        this.fpsFrames = 0;
        this.fpsSince = performance.now();
        this.started = performance.now();
        this.mouse = { x: 0, y: 0 };
        this.known = new Map();
        this.sinkUp = false;
        this.polled = false;
        this.queued = false;
        this.loopFn = null;
        this.loopStopped = false;
        this.ghostEls = new Map();
        this.shortcut = parseShortcut(settings.shortcut);
        this.ghostKey = parseShortcut(settings.ghostsShortcut);

        hookLogs(this.log);
        this.hud = this.layer({ left: 'calc(10px + env(safe-area-inset-left, 0px))', bottom: 'calc(10px + env(safe-area-inset-bottom, 0px))', display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-start' });
        this.ghostLayer = this.layer({ inset: '0' });
        window.addEventListener('keydown', (e) => this.onKey(e), true);
        window.addEventListener('pointermove', (e) => { this.mouse = { x: e.clientX, y: e.clientY }; }, true);
        // Phones have no keyboard: three fingers at once open the overlay.
        window.addEventListener('touchstart', (e) => { if (e.touches.length === 3) this.requestOpen(); }, true);

        // WebGL clears the drawing buffer once the page shows a frame (unless preserveDrawingBuffer).
        // A frame can take several render() calls (a HUD scene on top, post-processing), so the copy
        // waits for a microtask after the last one to the screen: still before the browser shows it.
        const render = renderer.render;
        const self = this;
        renderer.render = function (s, c) {
            render.call(this, s, c);
            if (this.getRenderTarget() !== null || self.queued) return;
            self.queued = true;
            queueMicrotask(() => { self.queued = false; self.onDraw(); });
        };
        // The game's loop, if it starts one after attach: stopped while the overlay is open.
        const setLoop = renderer.setAnimationLoop.bind(renderer);
        this.setLoop = setLoop;
        renderer.setAnimationLoop = (fn) => {
            this.loopFn = fn;
            if (!this.loopStopped) setLoop(fn);
        };
        this.loop();
    }

    layer(style) {
        const d = document.createElement('div');
        d.setAttribute('data-playmark', 'hud');
        Object.assign(d.style, { position: 'fixed', zIndex: '2147483645', pointerEvents: 'none', font: `12px ${BRAND.sans}` }, style);
        document.body.appendChild(d);
        return d;
    }

    requestOpen() {
        if (!settings.enabled || this.overlay || this.opening || this.busy) return;
        this.opening = true;
        if (!this.sinkUp) this.poll(); // the sink may have started since the last try
        // A game that renders only on change: draw once to get a frame (without its post-processing).
        setTimeout(() => { if (this.opening) this.renderer.render(this.scene, this.camera); }, OPEN_WAIT_MS);
    }

    async loop() {
        if (!document.hidden) await this.poll();
        setTimeout(() => this.loop(), this.sinkUp ? POLL_MS : POLL_IDLE_MS);
    }

    onKey(e) {
        if (this.overlay) return;
        if (matches(e, this.shortcut)) {
            e.preventDefault(); e.stopPropagation();
            this.requestOpen();
        } else if (matches(e, this.ghostKey)) {
            e.preventDefault(); e.stopPropagation();
            settings.ghostsVisible = !settings.ghostsVisible;
            this.toast('ready', settings.ghostsVisible ? 'Ghosts on' : 'Ghosts off', '', '', 1.5);
        }
    }

    // Runs right after the game drew a frame to the screen: the drawing buffer still holds it.
    onDraw() {
        const now = performance.now();
        this.fpsFrames++;
        if (now - this.fpsSince >= 1000) { this.fps = Math.round(this.fpsFrames * 1000 / (now - this.fpsSince)); this.fpsFrames = 0; this.fpsSince = now; }
        if (this.opening) { this.opening = false; this.open(); return; }
        if (this.overlay) return;
        const err = this.log.errors.shift();
        if (err && settings.autoOnError && this.sinkUp && !this.busy && this.autoMarks < MAX_AUTO_MARKS) { this.autoMark(err); return; }
        this.captureClip(now);
        this.drawGhosts();
    }

    captureClip(now) {
        if (settings.clipFps <= 0 || now < this.nextClip) return;
        this.nextClip = now + 1000 / settings.clipFps;
        const max = Math.max(1, Math.round(settings.clipSeconds * settings.clipFps));
        const k = Math.min(1, settings.clipMaxWidth / this.canvas.width);
        const w = Math.max(1, Math.round(this.canvas.width * k)), h = Math.max(1, Math.round(this.canvas.height * k));
        let c = this.ring[this.ringHead];
        if (!c || c.width !== w || c.height !== h) c = this.ring[this.ringHead] = canvasOf(w, h);
        c.getContext('2d').drawImage(this.canvas, 0, 0, w, h);
        this.ringTimes[this.ringHead] = now;
        this.ringHead = (this.ringHead + 1) % max;
        this.ringCount = Math.min(this.ringCount + 1, max);
        if (this.ring.length > max) { this.ring.length = max; this.ringTimes.length = max; this.ringHead %= max; this.ringCount = Math.min(this.ringCount, max); }
    }

    /** The clip so far, oldest first, with each frame's time before `now` (negative). */
    clip(now) {
        const n = this.ringCount, size = this.ring.length;
        const out = [];
        for (let i = 0; i < n; i++) {
            const j = (this.ringHead - n + i + size) % size;
            out.push({ canvas: this.ring[j], offset: r3((this.ringTimes[j] - now) / 1000) });
        }
        return out;
    }

    freezeFrame() {
        const shot = canvasOf(this.canvas.width, this.canvas.height);
        shot.getContext('2d').drawImage(this.canvas, 0, 0);
        return shot;
    }

    /** three.js has no global pause: the game's hook, else its animation loop, else nothing. */
    pause() {
        if (this.onPause) { try { this.onPause(); } catch (e) { console.warn('Playmark: onPause threw', e); } return true; }
        if (this.loopFn) { this.loopStopped = true; this.setLoop(null); return true; }
        return false;
    }

    resume() {
        if (this.onPause) { try { this.onResume?.(); } catch (e) { console.warn('Playmark: onResume threw', e); } return; }
        if (this.loopStopped) { this.loopStopped = false; this.setLoop(this.loopFn); }
    }

    sceneName() {
        return this.scene.name || location.pathname;
    }

    open() {
        const now = performance.now();
        const shot = this.freezeFrame();
        const frames = this.clip(now);
        const frozen = this.pause();
        if (document.pointerLockElement) document.exitPointerLock();
        this.ghostLayer.style.display = 'none';
        const counts = this.counts();
        const seq = this.nextSeq();
        const mouse = this.mouseInShot();
        const time = new Date();
        const ov = this.overlay = new Overlay(shot, frames, { seq, scene: this.sceneName(), fps: this.fps, session: this.session, inbox: counts.open, fixed: counts.fixed, frozen });
        ov.onSubmit = (s) => {
            const image = s.frameIndex < 0 ? shot : frames[s.frameIndex].canvas;
            const offset = s.frameIndex < 0 ? 0 : frames[s.frameIndex].offset;
            this.save(image, frames, s.marks, s.note, s.category, offset, 'player', mouse, time)
                .then((saved) => { this.session++; ov.finish(true, saved.seq); })
                .catch((e) => ov.finish(false, seq, this.sinkUp ? e.message : `No sink at ${this.sinkUrl()}. Start it: node <playmark>/scripts/sink.mjs`));
        };
        ov.onClose = () => {
            this.overlay = null;
            this.ghostLayer.style.display = '';
            this.nextClip = 0;
            this.resume();
        };
    }

    autoMark(err) {
        this.autoMarks++;
        const now = performance.now();
        const shot = this.freezeFrame();
        this.save(shot, this.clip(now), [], `Auto: ${err}`, 'bug', 0, 'auto-error', this.mouseInShot(), new Date())
            .then((s) => this.toast('error', `Saved as #${s.seq}`, err, 'BUG MARK · CLIP + LOG ATTACHED'))
            .catch(() => { /* the sink went away: the error is still in the console */ });
    }

    mouseInShot() {
        const r = this.canvas.getBoundingClientRect();
        return [r1((this.mouse.x - r.left) * this.canvas.width / Math.max(1, r.width)), r1((this.mouse.y - r.top) * this.canvas.height / Math.max(1, r.height))];
    }

    async save(image, frames, marks, note, category, offset, source, mouse, time) {
        this.busy = true;
        try {
            let under;
            this.log.mute = true;
            try { under = underMarks(marks, this.scene, this.camera); } finally { this.log.mute = false; }
            const markList = marks.map((m, i) => {
                const d = { type: m.box ? 'box' : 'pin', x: r1(m.x * image.width), y: r1(m.y * image.height) };
                if (m.box) { d.w = r1(m.w * image.width); d.h = r1(m.h * image.height); }
                d.number = i + 1;
                d.color = m.box ? 'blue' : 'orange';
                d.norm = m.box ? [r3(m.x), r3(m.y), r3(m.w), r3(m.h)] : [r3(m.x), r3(m.y)];
                if (under[i]?.world) d.world = under[i].world;
                return d;
            });
            const context = {};
            contexts.forEach((fn, name) => { try { context[name] = plain(fn()); } catch (e) { context[name] = `error: ${e.message}`; } });
            const files = ['screenshot.png', 'annotated.png', 'log.txt'];
            if (frames.length) files.push('clip_sheet.png');
            const sceneName = this.sceneName();
            const data = {
                playmark: PLAYMARK_VERSION,
                created_at: localTime(time),
                source, category, note,
                marks: markList,
                frame_offset_s: r3(offset),
                scope: this.scope(),
                project: { name: settings.project.name || document.title, version: settings.project.version },
                engine: { name: 'three', version: THREE.REVISION },
                os: navigator.userAgent,
                url: location.origin + location.pathname,
                scene: { path: sceneName, name: this.scene.name },
                camera: { name: this.camera.name, class: this.camera.type },
                window_size: [innerWidth, innerHeight],
                viewport_size: [this.canvas.clientWidth, this.canvas.clientHeight],
                screenshot_size: [image.width, image.height],
                device_pixel_ratio: devicePixelRatio,
                fps: this.fps,
                uptime_s: r1((performance.now() - this.started) / 1000),
                mouse,
                under_marks: under,
                context,
                files,
                clip: { frames: frames.length, fps: settings.clipFps, offsets_s: frames.map((f) => f.offset), dir: frames.length ? 'clip/' : '' },
            };
            const shapes = [
                blob64(image).then((b) => ['screenshot.png', b]),
                blob64(annotate(image, marks)).then((b) => ['annotated.png', b]),
            ];
            if (frames.length) {
                shapes.push(blob64(contactSheet(frames.map((f) => f.canvas))).then((b) => ['clip_sheet.png', b]));
                frames.forEach((f, i) => shapes.push(blob64(f.canvas).then((b) => [`clip/${pad(i, 3)}.png`, b])));
            }
            const encoded = {};
            for (const [name, b64] of await Promise.all(shapes)) encoded[name] = b64;
            const res = await fetch(`${this.sinkUrl()}/playmark/marks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data, files: encoded, log: this.log.lines.join('\n') }) });
            const body = await res.json();
            if (!res.ok) throw new Error(body.error ?? `the sink answered ${res.status}`);
            console.log(`Playmark: saved #${body.seq} ${body.id}`);
            this.known.set(body.id, { id: body.id, seq: body.seq, status: 'new', note, category, scene: sceneName, scope: String(data.scope), marks: markList, resolution: null, modified: 0 });
            return body;
        } finally {
            this.busy = false;
        }
    }

    scope() {
        try { return scopeFn?.() ?? ''; } catch { return ''; }
    }

    sinkUrl() {
        const q = new URLSearchParams(location.search).get('playmark_sink');
        return (q || settings.sink).replace(/\/$/, '');
    }

    nextSeq() {
        let top = 0;
        this.known.forEach((m) => { top = Math.max(top, Number(m.seq) || 0); });
        return top + 1;
    }

    counts() {
        let open = 0, fixed = 0;
        this.known.forEach((m) => { if (m.status === 'fixed') fixed++; else open++; });
        return { open, fixed };
    }

    // --- The loop back from the agent ---------------------------------------------------

    async poll() {
        let list;
        try {
            const res = await fetch(`${this.sinkUrl()}/playmark/status`, { cache: 'no-store' });
            list = (await res.json()).marks;
        } catch {
            if (!this.polled) this.toast('error', 'Playmark: no sink', 'Marks need the sink. In the project folder: node <playmark>/scripts/sink.mjs', `${settings.shortcut.toUpperCase()} STILL OPENS THE OVERLAY`, 8);
            this.polled = true;
            this.sinkUp = false;
            return;
        }
        // The first answer (at start, or once the sink comes up) is old news, not toasts.
        const first = !this.sinkUp;
        this.sinkUp = true;
        const seen = new Set();
        for (const m of list) {
            seen.add(m.id);
            const prev = this.known.get(m.id);
            this.known.set(m.id, m);
            if (first || !prev || prev.status === m.status) continue;
            if (m.status === 'working') this.toast('working', `On #${m.seq} now`, m.note || '(no note)', 'YOUR AGENT');
            else if (m.status === 'fixed') this.toast('fixed', `Fixed #${m.seq}`, m.resolution?.note || m.note, `RELOAD TO RETEST · ${settings.ghostsShortcut.toUpperCase()} GHOSTS`, 6);
        }
        this.known.forEach((_, id) => { if (!seen.has(id)) this.known.delete(id); });
        if (first) {
            const c = this.counts();
            this.toast('ready', 'Playmark is on', `${c.open} open · ${c.fixed} fixed`, `${settings.shortcut.toUpperCase()} MARK · ${settings.ghostsShortcut.toUpperCase()} GHOSTS`, 3.5);
        }
        this.polled = true;
    }

    toast(kind, title, body, hint, seconds = 4) {
        const color = kind === 'fixed' ? BRAND.blue : kind === 'error' ? '#e5484d' : BRAND.orange;
        const t = document.createElement('div');
        t.setAttribute('data-playmark', `toast-${kind}`);
        Object.assign(t.style, { background: BRAND.ground, color: BRAND.paper, borderLeft: `4px solid ${color}`, padding: '8px 12px', maxWidth: 'min(360px, 80vw)', boxShadow: '0 2px 10px rgba(0,0,0,0.4)', borderRadius: '3px' });
        const line = (text, style) => { if (!text) return; const d = document.createElement('div'); Object.assign(d.style, style); d.textContent = text; t.appendChild(d); };
        line(title, { font: `900 15px ${BRAND.sans}`, color });
        line(body, { marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
        line(hint, { marginTop: '4px', font: `10px ${BRAND.mono}`, color: BRAND.ink2 });
        this.hud.appendChild(t);
        setTimeout(() => t.remove(), seconds * 1000);
    }

    // --- Ghosts: past marks where they were made ----------------------------------------

    /** Past marks with a place in this scene and scope: their first mark's world position. */
    ghostMarks(scene) {
        const scope = this.scope();
        const now = Date.now();
        const out = [];
        this.known.forEach((m) => {
            if (m.scene !== scene || (m.scope ?? '') !== scope) return;
            if (m.status === 'fixed' && settings.ghostsFixedHours >= 0 && m.modified && now - m.modified > settings.ghostsFixedHours * 3600e3) return;
            const world = m.marks?.[0]?.world;
            if (Array.isArray(world) && world.length >= 2) out.push(m);
        });
        return out;
    }

    // Runs every frame, so it does nothing without ghosts and moves the same elements.
    drawGhosts() {
        const marks = settings.ghostsVisible ? this.ghostMarks(this.sceneName()) : [];
        const keep = new Set(marks.map((m) => m.id));
        this.ghostEls.forEach((el, id) => { if (!keep.has(id)) { el.remove(); this.ghostEls.delete(id); } });
        if (!marks.length) return;
        const r = this.canvas.getBoundingClientRect();
        for (const m of marks) {
            const world = m.marks[0].world;
            let el = this.ghostEls.get(m.id);
            if (!el) {
                el = document.createElement('div');
                Object.assign(el.style, { position: 'absolute', width: '22px', height: '22px', borderRadius: '50%', color: BRAND.ink, font: `900 12px/22px ${BRAND.sans}`, textAlign: 'center', opacity: '0.85', boxShadow: `0 0 0 2px ${BRAND.ink}` });
                el.textContent = String(m.seq);
                this.ghostLayer.appendChild(el);
                this.ghostEls.set(m.id, el);
            }
            const s = _v.set(world[0], world[1], world[2] ?? 0).project(this.camera);
            if (s.z < -1 || s.z > 1) { el.style.display = 'none'; continue; } // behind the camera
            el.style.display = '';
            el.style.background = m.status === 'fixed' ? BRAND.blue : BRAND.orange;
            el.style.left = `${r.left + (s.x + 1) / 2 * r.width - 11}px`;
            el.style.top = `${r.top + (1 - s.y) / 2 * r.height - 11}px`;
        }
    }
}

// For a game that wants it without importing: window.Playmark.open()
globalThis.Playmark = Playmark;
