// Playmark for Cocos Creator 3.8 (web and browser preview). Starts by itself in debug builds and
// the editor's browser preview. In a release build it never starts and the minifier drops it
// (one file on purpose: a second module would stay in the bundle). Nothing to add to your scenes.
// It watches for the shortcut, keeps the last seconds of play, freezes the game for the overlay,
// and sends each mark to the sink (node <plugin>/scripts/sink.mjs), which writes .playmark/
// exactly like the Godot addon and the Unity package. Polls the sink so a fix shows as a toast.
// On a phone: `sink.mjs --lan` serves the build to the Wi-Fi and marks the page (PLAYMARK_LAN);
// then it starts on that address too, talks to the sink same-origin, and shows a MARK button.
//
//   Playmark.addContext('player', () => ({ hp }));   // game state on every mark
//   Playmark.setScope(() => roomName);                // ghosts per room when one scene has many
//   Playmark.settings.clipFps = 0;                    // no clip
import { DEBUG, PREVIEW, EDITOR } from 'cc/env';
import * as cc from 'cc';
import { director, Director, game, sys, js, Node, UITransform, UIRenderer, Camera, MeshRenderer, Vec3, Vec2, geometry, VERSION } from 'cc';

export const PLAYMARK_VERSION = '0.4.0';

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
type Known = { id: string; seq: number; status: string; note: string; category: string; scene: string; scope: string; marks: any[]; resolution: any; approved?: any; modified: number };

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

const contexts = new Map<string, () => unknown>();
let scopeFn: (() => string) | null = null;

export const Playmark = {
    settings,
    addContext(name: string, fn: () => unknown) { contexts.set(name, fn); },
    removeContext(name: string) { contexts.delete(name); },
    setScope(fn: (() => string) | null) { scopeFn = fn; },
    /** Opens the overlay as if the shortcut was pressed. */
    open() { host?.requestOpen(); },
};

// --- The overlay: photo mode for feedback --------------------------------------------------
// Drawn in the page's DOM over the frozen game canvas: the frame on a dark stage, a rewind strip,
// category stamps and a note. Same keys as the Godot addon:
//   click pin · drag box · right-click undo · 1-5 category · ← → rewind ·
//   Ctrl/Cmd+Enter save · Esc cancel · typing anywhere starts the note.

const CATEGORIES = ['bug', 'feel', 'art', 'balance', 'idea'];
const MAX_MARKS = 9;
/** Served by `sink.mjs --lan`: the sink is this page's own origin. (Functions: a release build drops them.) */
const isLan = () => !!(window as any).PLAYMARK_LAN;
const isTouch = () => !!window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

const BRAND = {
    ground: '#111111', ground2: '#1b1b1b', paper: '#f2efe6', ink2: '#b3b0a8',
    rule: 'rgba(242,239,230,0.22)', blue: '#6faef2', orange: '#f2621b', ink: '#111111',
    mono: 'ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace',
    sans: 'Heebo, system-ui, -apple-system, "Segoe UI", sans-serif',
};

/** A mark in 0..1 of the frame, top-left origin. */
interface NormMark { box: boolean; x: number; y: number; w: number; h: number; }
interface ClipFrame { canvas: HTMLCanvasElement; offset: number; }
interface OverlayInfo { seq: number; scene: string; fps: number; session: number; inbox: number; fixed: number; }
interface Submission { note: string; category: string; marks: NormMark[]; frameIndex: number; }

class Overlay {
    marks: NormMark[] = [];
    frameIndex = -1;
    category = -1;
    onSubmit: ((s: Submission) => void) | null = null;
    onClose: (() => void) | null = null;

    private root: HTMLDivElement;
    private stage!: HTMLDivElement;
    private view!: HTMLCanvasElement;
    private layer!: HTMLDivElement;
    private note!: HTMLTextAreaElement;
    private scrubLabel!: HTMLSpanElement;
    private scrubRight!: HTMLSpanElement;
    private stamps: HTMLButtonElement[] = [];
    private banner!: HTMLDivElement;
    private busy = false;
    private drag: { x: number; y: number; px: number; py: number } | null = null;
    private keyHandler = (e: KeyboardEvent) => this.onKey(e);

    constructor(private shot: HTMLCanvasElement, private frames: ClipFrame[], private info: OverlayInfo) {
        this.root = document.createElement('div');
        this.root.setAttribute('data-playmark', 'overlay');
        Object.assign(this.root.style, {
            position: 'fixed', inset: '0', zIndex: '2147483646', background: BRAND.ground, color: BRAND.paper,
            display: 'flex', flexDirection: 'column', font: `13px ${BRAND.sans}`, userSelect: 'none', touchAction: 'none',
        } as Partial<CSSStyleDeclaration>);
        this.build();
        document.body.appendChild(this.root);
        window.visualViewport?.addEventListener('resize', this.fit);
        window.visualViewport?.addEventListener('scroll', this.fit);
        this.fit();
        // Capture phase on window: the game's own key listeners never see a key typed here.
        window.addEventListener('keydown', this.keyHandler, true);
        // Keyups go through: a key held when the overlay opened must still be let go in the game.
        window.addEventListener('resize', this.draw);
        this.draw();
    }

    // --- API (the host drives these) -------------------------------------------------------

    addMark(m: NormMark) {
        if (this.marks.length >= MAX_MARKS || this.busy) return;
        this.marks.push(m);
        this.draw();
    }

    undoMark() {
        if (this.busy) return;
        this.marks.pop();
        this.draw();
    }

    setFrame(i: number) {
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
    finish(saved: boolean, seq: number, error = '') {
        this.showBanner(saved ? `SAVED #${seq}` : 'NOT SAVED', saved ? BRAND.orange : '#e5484d', error);
        setTimeout(() => this.close(), saved ? 550 : 2600);
    }

    cancel() {
        if (!this.busy) this.close();
    }

    close() {
        window.removeEventListener('keydown', this.keyHandler, true);

        window.removeEventListener('resize', this.draw);
        window.visualViewport?.removeEventListener('resize', this.fit);
        window.visualViewport?.removeEventListener('scroll', this.fit);
        this.root.remove();
        this.onClose?.();
    }

    // --- Layout ---------------------------------------------------------------------------

    private el<K extends keyof HTMLElementTagNameMap>(tag: K, parent: HTMLElement, style: Partial<CSSStyleDeclaration> = {}, text = ''): HTMLElementTagNameMap[K] {
        const e = document.createElement(tag);
        Object.assign(e.style, style);
        if (text) e.textContent = text;
        parent.appendChild(e);
        return e;
    }

    /** A phone's soft keyboard shrinks the visual viewport, not the layout one: follow it. */
    private fit = () => {
        const vv = window.visualViewport;
        if (!vv) return;
        Object.assign(this.root.style, { inset: 'auto', left: `${vv.offsetLeft}px`, top: `${vv.offsetTop}px`, width: `${vv.width}px`, height: `${vv.height}px` });
        this.draw();
    };

    private build() {
        const side = isTouch() ? '10px' : '18px';
        const head = this.el('div', this.root, { display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: isTouch() ? '4px 14px' : '18px', padding: `calc(10px + env(safe-area-inset-top, 0px)) ${side} 8px`, borderBottom: `1px solid ${BRAND.rule}` });
        const title = this.el('div', head, { flex: isTouch() ? '1 1 100%' : '1', minWidth: '0' });
        this.el('div', title, { font: `900 24px ${BRAND.sans}`, letterSpacing: '0.02em' }, 'PLAYMARK');
        const parts = [`#${this.info.seq}`, this.info.scene, `${this.info.fps} FPS`, 'GAME FROZEN'].filter(Boolean);
        this.el('div', title, { font: `11px ${BRAND.mono}`, color: BRAND.ink2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, parts.join('  ·  '));
        const stat = (caption: string, value: number, color: string) => {
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

        const scrub = this.el('div', this.root, { display: 'flex', alignItems: 'center', gap: '8px', padding: `6px ${side}`, font: `11px ${BRAND.mono}`, color: BRAND.ink2 });
        const step = (label: string, d: number) => {
            const b = this.button(scrub, label);
            b.disabled = this.frames.length === 0;
            b.onclick = () => this.setFrame(this.frameIndex < 0 ? (d < 0 ? this.frames.length - 1 : -1) : this.frameIndex + d >= this.frames.length ? -1 : this.frameIndex + d);
        };
        step('←', -1);
        step('→', 1);
        this.scrubLabel = this.el('span', scrub, { flex: '1' }, this.frames.length ? '← → REWIND' : 'NO CLIP');
        this.scrubRight = this.el('span', scrub, {}, 'FREEZE FRAME');

        const deck = this.el('div', this.root, { display: 'flex', flexWrap: 'wrap', gap: isTouch() ? '6px' : '8px', padding: `8px ${side}`, borderTop: `1px solid ${BRAND.rule}` });
        CATEGORIES.forEach((c, i) => {
            const b = this.button(deck, isTouch() ? c.toUpperCase() : `${i + 1}  ${c.toUpperCase()}`);
            if (isTouch()) b.style.flex = '1 1 0';
            b.onclick = () => this.setCategory(i);
            this.stamps.push(b);
        });
        // 16 px on touch: iOS zooms the page into a smaller text field when it gets focus.
        this.note = this.el('textarea', deck, { flex: isTouch() ? '1 1 100%' : '1 1 260px', minHeight: isTouch() ? '44px' : '38px', maxHeight: '90px', resize: 'none', background: BRAND.ground2, color: BRAND.paper, border: `1px solid ${BRAND.rule}`, borderRadius: '4px', padding: '8px', font: `${isTouch() ? 16 : 14}px ${BRAND.sans}`, userSelect: 'text' });
        this.note.placeholder = 'What do you see? One line is enough.';
        const undo = this.button(deck, 'UNDO');
        undo.onclick = () => this.undoMark();
        const cancel = this.button(deck, 'CANCEL');
        cancel.onclick = () => this.cancel();
        const save = this.button(deck, 'SAVE MARK');
        Object.assign(save.style, { background: BRAND.orange, color: BRAND.ink, borderColor: BRAND.orange, fontWeight: '900' });
        if (isTouch()) { undo.style.flex = '1 1 0'; cancel.style.flex = '1 1 0'; save.style.flex = '2 1 0'; }
        save.onclick = () => this.submit();

        this.el('div', this.root, { padding: `0 ${side} calc(8px + env(safe-area-inset-bottom, 0px))`, font: `11px ${BRAND.mono}`, color: BRAND.ink2 },
            isTouch() ? 'TAP TO PIN  ·  DRAG TO BOX' : 'CLICK PIN  ·  DRAG BOX  ·  RIGHT-CLICK UNDO  ·  1-5 CATEGORY  ·  ← → REWIND  ·  CTRL+ENTER SAVE  ·  ESC CANCEL');
    }

    private button(parent: HTMLElement, label: string): HTMLButtonElement {
        const b = this.el('button', parent, { background: 'transparent', color: BRAND.paper, border: `1px solid ${BRAND.rule}`, borderRadius: '4px', padding: isTouch() ? '0 8px' : '7px 10px', minHeight: isTouch() ? '44px' : '', font: `700 12px ${BRAND.mono}`, cursor: 'pointer', touchAction: 'manipulation' }, label);
        b.type = 'button';
        return b;
    }

    private setCategory(i: number) {
        this.category = this.category === i ? -1 : i;
        this.stamps.forEach((b, j) => Object.assign(b.style, j === this.category ? { background: BRAND.paper, color: BRAND.ink } : { background: 'transparent', color: BRAND.paper }));
    }

    private showBanner(text: string, color: string, detail = '') {
        this.banner.style.display = 'flex';
        this.banner.style.color = color;
        this.banner.textContent = text;
        if (detail) this.el('div', this.banner, { font: `12px ${BRAND.mono}`, color: BRAND.paper, marginTop: '10px', maxWidth: '80%', textAlign: 'center' }, detail);
    }

    private frameRect() {
        const src = this.current();
        const r = this.stage.getBoundingClientRect();
        const k = Math.min(r.width / src.width, r.height / src.height);
        const w = src.width * k, h = src.height * k;
        return { x: (r.width - w) / 2, y: (r.height - h) / 2, w, h, left: r.left, top: r.top };
    }

    private current(): HTMLCanvasElement {
        return this.frameIndex < 0 ? this.shot : this.frames[this.frameIndex].canvas;
    }

    private draw = () => {
        const f = this.frameRect();
        const src = this.current();
        // Sharp at any size: the visible canvas has as many pixels as the screen shows.
        const dpr = window.devicePixelRatio || 1;
        this.view.width = Math.max(1, Math.round(f.w * dpr));
        this.view.height = Math.max(1, Math.round(f.h * dpr));
        Object.assign(this.view.style, { left: `${f.x}px`, top: `${f.y}px`, width: `${f.w}px`, height: `${f.h}px` });
        Object.assign(this.layer.style, { left: `${f.x}px`, top: `${f.y}px`, width: `${f.w}px`, height: `${f.h}px` });
        const g = this.view.getContext('2d')!;
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
    };

    private drawMark(m: NormMark, n: number, ghost = false) {
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

    private norm(e: PointerEvent) {
        const f = this.frameRect();
        return { x: Math.min(1, Math.max(0, (e.clientX - f.left - f.x) / f.w)), y: Math.min(1, Math.max(0, (e.clientY - f.top - f.y) / f.h)), px: e.clientX, py: e.clientY };
    }

    private dragMark(): NormMark {
        const d = this.drag!;
        const x = Math.min(d.x, this.dragTo.x), y = Math.min(d.y, this.dragTo.y);
        return { box: true, x, y, w: Math.abs(this.dragTo.x - d.x), h: Math.abs(this.dragTo.y - d.y) };
    }

    private dragTo = { x: 0, y: 0, px: 0, py: 0 };

    private onDown(e: PointerEvent) {
        if (e.button !== 0 || this.busy) return;
        const p = this.norm(e);
        this.drag = p;
        this.dragTo = p;
        this.stage.setPointerCapture(e.pointerId);
    }

    private onMove(e: PointerEvent) {
        if (!this.drag) return;
        this.dragTo = this.norm(e);
        if (Math.hypot(this.dragTo.px - this.drag.px, this.dragTo.py - this.drag.py) > 6) this.draw();
    }

    private onUp(e: PointerEvent) {
        if (!this.drag) return;
        this.dragTo = this.norm(e);
        const moved = Math.hypot(this.dragTo.px - this.drag.px, this.dragTo.py - this.drag.py) > 6;
        const m: NormMark = moved ? this.dragMark() : { box: false, x: this.drag.x, y: this.drag.y, w: 0, h: 0 };
        this.drag = null;
        this.addMark(m);
        this.draw();
    }


    private onKey(e: KeyboardEvent) {
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
/** Ghosts switched off stay off on this device, across reloads. */
const GHOSTS_KEY = 'playmark_ghosts';
const _ghostPos = new Vec3();
const _ghostScreen = new Vec3();
/** An http(s) URL on this machine: localhost, 127.x or [::1]. */
function isLoopbackUrl(u: string) {
    const m = /^https?:\/\/(\[[^\]]+\]|[^/:?#]+)(:\d+)?(\/|$)/i.exec(u.trim());
    if (!m) return false;
    const host = m[1].toLowerCase();
    return host === 'localhost' || host === '[::1]' || /^127(\.\d{1,3}){3}$/.test(host);
}
const r1 = (n: number) => Math.round(n * 10) / 10;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const pad = (n: number, w = 2) => { let s = String(n); while (s.length < w) s = '0' + s; return s; };
const localTime = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

function parseShortcut(text: string) {
    const parts = text.toLowerCase().split('+').map((p) => p.trim());
    const has = (k: string) => parts.indexOf(k) !== -1;
    return { ctrl: has('ctrl'), shift: has('shift'), alt: has('alt'), meta: has('cmd') || has('meta'), key: parts[parts.length - 1] };
}

function matches(e: KeyboardEvent, s: ReturnType<typeof parseShortcut>) {
    return e.ctrlKey === s.ctrl && e.shiftKey === s.shift && e.altKey === s.alt && e.metaKey === s.meta && e.key.toLowerCase() === s.key;
}

function plain(v: unknown): Json {
    try { return JSON.parse(JSON.stringify(v ?? null)); } catch { return String(v); }
}

function canvasOf(w: number, h: number) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
}

function blob64(c: HTMLCanvasElement): Promise<string> {
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
    lines: string[] = [];
    errors: string[] = [];
    /** Set while Playmark itself works: what it logs then never becomes an automatic mark. */
    mute = false;
    private seen = new Set<string>();

    add(level: string, message: string, stack = '') {
        const head = level === 'Log' ? message : `${level.toUpperCase()}: ${message}`;
        for (const l of head.split('\n')) this.push(l);
        if (level === 'Error' && stack) for (const l of stack.trim().split('\n')) this.push('    ' + l.trim());
        if (level === 'Error' && !this.mute && !message.startsWith('Playmark')) {
            const first = message.split('\n')[0].slice(0, 200);
            // Errors wait here until the sink is up; only a few ever become marks.
            if (!this.seen.has(first) && this.errors.length < 10) { this.seen.add(first); this.errors.push(first); }
        }
    }

    private push(line: string) {
        this.lines.push(line);
        if (this.lines.length > settings.logLines) this.lines.splice(0, this.lines.length - settings.logLines);
    }
}

function hookLogs(log: LogRing) {
    const one = (a: unknown) => (typeof a === 'string' ? a : a instanceof Error ? a.message : (() => { try { return JSON.stringify(a); } catch { return String(a); } })());
    // console's own %s / %d / %o substitution, which the engine's messages use.
    const text = (args: unknown[]) => {
        if (typeof args[0] === 'string' && /%[sdifoO]/.test(args[0])) {
            let i = 1;
            const head = args[0].replace(/%[sdifoO]/g, (m) => (i < args.length ? one(args[i++]) : m));
            return [head, ...args.slice(i).map(one)].join(' ');
        }
        return args.map(one).join(' ');
    };
    const wrap = (name: 'log' | 'info' | 'debug' | 'warn' | 'error', level: string) => {
        const original = console[name].bind(console);
        console[name] = (...args: unknown[]) => {
            try {
                const err = args.find((a) => a instanceof Error) as Error | undefined;
                log.add(level, text(args), err?.stack ?? '');
            } catch { /* logging must never throw */ }
            original(...args);
        };
    };
    wrap('log', 'Log'); wrap('info', 'Log'); wrap('debug', 'Log'); wrap('warn', 'Warning'); wrap('error', 'Error');
    // Cocos bound its own warn and error to the console at startup, before this ran. Rebinding them
    // sends the engine's messages through the wrappers too. The mode it started with isn't kept
    // (game.config is empty by now); INFO is what a debug web build starts with. Not in the public
    // typings, so it is looked up and skipped if a later engine renames it.
    const reset = (cc as unknown as Record<string, unknown>)._resetDebugSetting;
    if (typeof reset === 'function') reset(game.config.debugMode ?? cc.DebugMode.INFO);
    window.addEventListener('error', (e) => log.add('Error', e.message || String(e.error), e.error?.stack ?? `at ${e.filename}:${e.lineno}:${e.colno}`));
    window.addEventListener('unhandledrejection', (e) => log.add('Error', `Unhandled rejection: ${e.reason?.message ?? e.reason}`, e.reason?.stack ?? ''));
}

// --- What is under a mark -----------------------------------------------------------------

// A project can leave out Cocos modules (3D, 2D/UI) in Project Settings, Feature Cropping: their
// classes then import as undefined. Every check below works without them.
const isA = (c: unknown, k: unknown) => typeof k === 'function' && c instanceof (k as new () => unknown);

function nodePath(n: Node) {
    const parts: string[] = [];
    for (let p: Node | null = n; p && p.parent; p = p.parent) parts.unshift(p.name);
    return parts.join('/');
}

function describe(n: Node, extra: Record<string, Json> = {}): Record<string, Json> {
    const comps = n.components.map((c) => js.getClassName(c));
    const main = n.components.find((c) => isA(c, UIRenderer) || isA(c, MeshRenderer));
    const scripts = comps.filter((c) => c && !c.startsWith('cc.'));
    const p = n.worldPosition;
    const e: Record<string, Json> = { path: nodePath(n), class: main ? js.getClassName(main) : 'cc.Node', position: [r1(p.x), r1(p.y), r1(p.z)], components: comps };
    if (scripts.length) e.script = scripts[0];
    if (scripts.length > 1) e.other_scripts = scripts.slice(1);
    return { ...e, ...extra };
}

/** Worth naming under a pin: something drawn, something clickable, or a script of the game. */
function interesting(n: Node) {
    return n.components.some((c) => isA(c, UIRenderer) || !js.getClassName(c).startsWith('cc.') || /^cc\.(Button|Toggle|Slider|EditBox|ScrollView|PageView)$/.test(js.getClassName(c)));
}

function cameraFor(cams: Camera[], layer: number) {
    return cams.find((c) => (c.visibility & layer) !== 0) ?? null;
}

function screenRect(t: UITransform, cam: Camera) {
    const r = t.getBoundingBoxToWorld();
    const a = cam.worldToScreen(new Vec3(r.x, r.y, 0));
    const b = cam.worldToScreen(new Vec3(r.x + r.width, r.y + r.height, 0));
    return { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
}

/**
 * Per mark: the 2D and UI nodes (`ui`) and 3D renderers (`nodes`) under it, topmost or nearest
 * first, and where it is in the world. Screen points are in drawing-buffer pixels, origin bottom-left,
 * as Cocos' cameras expect.
 */
function underMarks(marks: NormMark[], w: number, h: number) {
    const scene = director.getScene();
    if (!scene) return [];
    const cams = scene.getComponentsInChildren(Camera).filter((c) => c.enabledInHierarchy).sort((a, b) => b.priority - a.priority);
    const flat: Node[] = [];
    const walk = (n: Node) => { for (const c of n.children) if (c.activeInHierarchy) { flat.push(c); walk(c); } };
    walk(scene);
    const uiNodes = UITransform ? flat.filter((n) => n.getComponent(UITransform) && interesting(n)).reverse() : []; // drawn last = on top
    const meshes = !MeshRenderer ? [] : flat.map((n) => n.getComponent(MeshRenderer)).filter((m): m is MeshRenderer => !!m && !!m.enabledInHierarchy && !!m.model?.worldBounds);

    return marks.map((m, i) => {
        const out: Record<string, Json> = { mark: i + 1, physics: [], nodes: [], ui: [] };
        const sx = (m.box ? m.x + m.w / 2 : m.x) * w, sy = (1 - (m.box ? m.y + m.h / 2 : m.y)) * h;
        const box = m.box ? { x0: m.x * w, x1: (m.x + m.w) * w, y0: (1 - m.y - m.h) * h, y1: (1 - m.y) * h } : null;
        const ui: Record<string, Json>[] = [];
        let uiWorld: Json = null;
        for (const n of uiNodes) {
            const t = n.getComponent(UITransform)!;
            const cam = cameraFor(cams, n.layer);
            if (!cam) continue;
            let hit = false;
            if (box) {
                const r = screenRect(t, cam);
                hit = r.x0 < box.x1 && r.x1 > box.x0 && r.y0 < box.y1 && r.y1 > box.y0;
            } else {
                hit = t.hitTest(new Vec2(sx, sy));
            }
            if (!hit) continue;
            ui.push(describe(n));
            if (!uiWorld) { const p = cam.screenToWorld(new Vec3(sx, sy, 0)); uiWorld = [r1(p.x), r1(p.y)]; }
            if (ui.length >= 10) break;
        }
        const hits: { d: number; e: Record<string, Json>; p: Vec3 }[] = [];
        for (const mr of meshes) {
            const cam = cameraFor(cams, mr.node.layer);
            if (!cam) continue;
            const bounds = mr.model!.worldBounds!;
            if (box) {
                const c = cam.worldToScreen(bounds.center);
                if (c.z > 1 || c.x < box.x0 || c.x > box.x1 || c.y < box.y0 || c.y > box.y1) continue;
                const d = Vec3.distance(cam.node.worldPosition, bounds.center);
                hits.push({ d, e: describe(mr.node, { distance: r1(d) }), p: bounds.center.clone() });
            } else {
                const ray = cam.screenPointToRay(sx, sy);
                const d = geometry.intersect.rayAABB(ray, bounds);
                if (d <= 0) continue;
                const p = new Vec3();
                Vec3.scaleAndAdd(p, ray.o, ray.d, d);
                hits.push({ d, e: describe(mr.node, { distance: r1(d) }), p });
            }
        }
        hits.sort((a, b) => a.d - b.d);
        out.ui = ui;
        out.nodes = hits.slice(0, 10).map((x) => x.e);
        // A pin over the 3D world sits on what it hit; over 2D or UI it sits on that plane.
        if (hits.length) out.world = [r1(hits[0].p.x), r1(hits[0].p.y), r1(hits[0].p.z)];
        else if (uiWorld) out.world = uiWorld;
        return out;
    });
}

// --- Images: annotated frame and contact sheet, as in the other engines -------------------

function annotate(shot: HTMLCanvasElement, marks: NormMark[]) {
    const k = Math.max(1, Math.ceil(960 / shot.width));
    const c = canvasOf(shot.width * k, shot.height * k);
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    g.drawImage(shot, 0, 0, c.width, c.height);
    const u = Math.max(1, c.width / 960);
    const t = Math.round(3 * u), radius = Math.round(14 * u);
    g.font = `900 ${Math.round(30 * u)}px ${BRAND.sans}`;
    g.textBaseline = 'bottom';
    marks.forEach((m, i) => {
        const color = m.box ? BRAND.blue : BRAND.orange;
        let ax: number, ay: number;
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
function contactSheet(frames: HTMLCanvasElement[], max = 12, cols = 4) {
    const n = Math.min(frames.length, max);
    const picked = Array.from({ length: n }, (_, i) => frames[Math.round(i * (frames.length - 1) / Math.max(n - 1, 1))]);
    const fw = picked[0].width, fh = picked[0].height, gap = 4;
    cols = Math.min(cols, n);
    const rows = Math.ceil(n / cols);
    const c = canvasOf(cols * fw + gap * (cols + 1), rows * fh + gap * (rows + 1));
    const g = c.getContext('2d')!;
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
    private canvas = game.canvas as HTMLCanvasElement;
    private log = new LogRing();
    private ring: HTMLCanvasElement[] = [];
    private ringTimes: number[] = [];
    private ringHead = 0;
    private ringCount = 0;
    private nextClip = 0;
    private opening = false;
    private overlay: Overlay | null = null;
    private busy = false;
    private autoMarks = 0;
    private session = 0;
    private wasPaused = false;
    private fps = 0;
    private fpsFrames = 0;
    private fpsSince = performance.now();
    private mouse = { x: 0, y: 0 };
    private known = new Map<string, Known>();
    private sinkUp = false;
    private polled = false;
    private hud: HTMLDivElement;
    private ghostLayer: HTMLDivElement;
    private shortcut = parseShortcut(settings.shortcut);
    private ghostKey = parseShortcut(settings.ghostsShortcut);

    constructor() {
        hookLogs(this.log);
        this.hud = this.layer({ left: 'calc(10px + env(safe-area-inset-left, 0px))', bottom: 'calc(10px + env(safe-area-inset-bottom, 0px))', display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-start' });
        this.ghostLayer = this.layer({ inset: '0' });
        window.addEventListener('keydown', (e) => this.onKey(e), true);
        window.addEventListener('pointermove', (e) => { this.mouse = { x: e.clientX, y: e.clientY }; }, true);
        // Phones have no keyboard: three fingers at once open the overlay.
        window.addEventListener('touchstart', (e) => { if (e.touches.length === 3) this.requestOpen(); }, true);
        // On a phone over the network, a button too: some browsers keep three fingers for themselves.
        if (isLan()) this.markButton();
        director.on(Director.EVENT_AFTER_DRAW, this.onDraw, this);
        this.loop();
    }

    private layer(style: Partial<CSSStyleDeclaration>) {
        const d = document.createElement('div');
        d.setAttribute('data-playmark', 'hud');
        Object.assign(d.style, { position: 'fixed', zIndex: '2147483645', pointerEvents: 'none', font: `12px ${BRAND.sans}` }, style);
        document.body.appendChild(d);
        return d;
    }

    private markButton() {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = 'MARK';
        b.setAttribute('data-playmark', 'mark-button');
        Object.assign(b.style, {
            position: 'fixed', zIndex: '2147483645', right: 'calc(10px + env(safe-area-inset-right, 0px))', bottom: 'calc(10px + env(safe-area-inset-bottom, 0px))',
            minWidth: '56px', height: '44px', padding: '0 12px', border: `2px solid ${BRAND.ink}`, borderRadius: '22px', background: BRAND.orange, color: BRAND.ink,
            font: `900 13px ${BRAND.sans}`, letterSpacing: '0.06em', opacity: '0.85', touchAction: 'manipulation', boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
        } as Partial<CSSStyleDeclaration>);
        // Tap: open the overlay. Hold (0.6 s): show or hide ghosts. The game must not get this touch.
        let hold = 0, held = false;
        b.addEventListener('pointerdown', (e) => {
            e.preventDefault(); e.stopPropagation();
            held = false;
            hold = window.setTimeout(() => { held = true; this.toggleGhosts(); }, 600);
        });
        b.addEventListener('pointerup', () => { clearTimeout(hold); if (!held) this.requestOpen(); });
        b.addEventListener('pointercancel', () => clearTimeout(hold));
        b.addEventListener('contextmenu', (e) => e.preventDefault());
        for (const t of ['pointerup', 'touchstart', 'touchend', 'mousedown', 'mouseup', 'click']) b.addEventListener(t, (e) => e.stopPropagation());
        document.body.appendChild(b);
    }

    requestOpen() {
        if (!settings.enabled || this.overlay || this.opening || this.busy) return;
        this.opening = true;
        if (!this.sinkUp) this.poll(); // the sink may have started since the last try
    }

    private async loop() {
        try {
            if (!document.hidden) await this.poll();
        } catch (e) {
            console.warn('Playmark: status poll failed', e);
        } finally {
            setTimeout(() => this.loop(), this.sinkUp ? POLL_MS : POLL_IDLE_MS);
        }
    }

    private onKey(e: KeyboardEvent) {
        if (this.overlay) return;
        if (matches(e, this.shortcut)) {
            e.preventDefault(); e.stopPropagation();
            this.requestOpen();
        } else if (matches(e, this.ghostKey)) {
            e.preventDefault(); e.stopPropagation();
            this.toggleGhosts();
        }
    }

    private toggleGhosts() {
        settings.ghostsVisible = !settings.ghostsVisible;
        if (!settings.ghostsVisible) { this.card?.remove(); this.card = null; }
        try { localStorage.setItem(GHOSTS_KEY, settings.ghostsVisible ? 'on' : 'off'); } catch { /* private mode */ }
        this.toast('ready', settings.ghostsVisible ? 'Ghosts on' : 'Ghosts off', settings.ghostsVisible ? '' : 'They stay off on this device until you switch them on.', isLan() ? 'HOLD MARK TO SWITCH' : `${settings.ghostsShortcut.toUpperCase()} TO SWITCH`, 1.5);
    }

    // Runs right after Cocos drew a frame: the drawing buffer still holds it, so it can be copied.
    private onDraw() {
        const now = performance.now();
        this.fpsFrames++;
        if (now - this.fpsSince >= 1000) { this.fps = Math.round(this.fpsFrames * 1000 / (now - this.fpsSince)); this.fpsFrames = 0; this.fpsSince = now; }
        if (this.opening) { this.opening = false; this.open(); return; }
        if (this.overlay) return;
        // An error waits in the queue until the sink answers and no mark is saving.
        if (this.log.errors.length && settings.autoOnError && this.sinkUp && !this.busy && this.autoMarks < MAX_AUTO_MARKS) { this.autoMark(this.log.errors.shift()!); return; }
        this.captureClip(now);
        this.drawGhosts();
    }

    private captureClip(now: number) {
        if (settings.clipFps <= 0 || now < this.nextClip) return;
        this.nextClip = now + 1000 / settings.clipFps;
        const max = Math.max(1, Math.round(settings.clipSeconds * settings.clipFps));
        const k = Math.min(1, settings.clipMaxWidth / this.canvas.width);
        const w = Math.max(1, Math.round(this.canvas.width * k)), h = Math.max(1, Math.round(this.canvas.height * k));
        let c = this.ring[this.ringHead];
        if (!c || c.width !== w || c.height !== h) c = this.ring[this.ringHead] = canvasOf(w, h);
        c.getContext('2d')!.drawImage(this.canvas, 0, 0, w, h);
        this.ringTimes[this.ringHead] = now;
        this.ringHead = (this.ringHead + 1) % max;
        this.ringCount = Math.min(this.ringCount + 1, max);
        if (this.ring.length > max) { this.ring.length = max; this.ringTimes.length = max; this.ringHead %= max; this.ringCount = Math.min(this.ringCount, max); }
    }

    /** The clip so far, oldest first, with each frame's time before `now` (negative). */
    private clip(now: number): ClipFrame[] {
        const n = this.ringCount, size = this.ring.length;
        const out: ClipFrame[] = [];
        for (let i = 0; i < n; i++) {
            const j = (this.ringHead - n + i + size) % size;
            out.push({ canvas: this.ring[j], offset: r3((this.ringTimes[j] - now) / 1000) });
        }
        return out;
    }

    private freezeFrame() {
        const shot = canvasOf(this.canvas.width, this.canvas.height);
        shot.getContext('2d')!.drawImage(this.canvas, 0, 0);
        return shot;
    }

    private open() {
        const now = performance.now();
        const shot = this.freezeFrame();
        const frames = this.clip(now);
        this.wasPaused = director.isPaused();
        director.pause();
        this.ghostLayer.style.display = 'none';
        const counts = this.counts();
        const seq = this.nextSeq();
        const mouse = this.mouseInShot();
        const time = new Date();
        const ov = this.overlay = new Overlay(shot, frames, { seq, scene: director.getScene()?.name ?? '', fps: this.fps, session: this.session, inbox: counts.open, fixed: counts.fixed });
        ov.onSubmit = (s: Submission) => {
            const image = s.frameIndex < 0 ? shot : frames[s.frameIndex].canvas;
            const offset = s.frameIndex < 0 ? 0 : frames[s.frameIndex].offset;
            this.save(image, frames, s.marks, s.note, s.category, offset, 'player', mouse, time)
                .then((saved) => { this.session++; ov.finish(true, saved.seq); })
                .catch((e: Error) => ov.finish(false, seq, this.sinkUp ? e.message : `No sink at ${this.sinkUrl() || location.origin}. Start it: node <playmark>/scripts/sink.mjs`));
        };
        ov.onClose = () => {
            this.overlay = null;
            this.ghostLayer.style.display = '';
            this.nextClip = 0;
            if (!this.wasPaused) director.resume();
        };
    }

    private autoMark(err: string) {
        this.autoMarks++;
        const now = performance.now();
        const shot = this.freezeFrame();
        this.save(shot, this.clip(now), [], `Auto: ${err}`, 'bug', 0, 'auto-error', this.mouseInShot(), new Date())
            .then((s) => this.toast('error', `Saved as #${s.seq}`, err, 'BUG MARK · CLIP + LOG ATTACHED'))
            .catch(() => { /* the sink went away: the error is still in the console */ });
    }

    private mouseInShot() {
        const r = this.canvas.getBoundingClientRect();
        return [r1((this.mouse.x - r.left) * this.canvas.width / Math.max(1, r.width)), r1((this.mouse.y - r.top) * this.canvas.height / Math.max(1, r.height))];
    }

    private async save(image: HTMLCanvasElement, frames: ClipFrame[], marks: NormMark[], note: string, category: string, offset: number,
        source: string, mouse: number[], time: Date): Promise<{ id: string; seq: number }> {
        this.busy = true;
        try {
            const W = this.canvas.width, H = this.canvas.height;
            let under: Record<string, Json>[];
            this.log.mute = true;
            // A rewound frame shows an earlier moment than the paused scene: what is under its marks now may not be
            // what was there, so nothing is listed rather than the wrong objects.
            try {
                under = offset < 0
                    ? marks.map((_, i) => ({ mark: i + 1, physics: [], nodes: [], ui: [], skipped: 'rewound frame: the scene has moved on since' }))
                    : underMarks(marks, W, H);
            } finally { this.log.mute = false; }
            const markList = marks.map((m, i) => {
                const d: Record<string, Json> = { type: m.box ? 'box' : 'pin', x: r1(m.x * image.width), y: r1(m.y * image.height) };
                if (m.box) { d.w = r1(m.w * image.width); d.h = r1(m.h * image.height); }
                d.number = i + 1;
                d.color = m.box ? 'blue' : 'orange';
                d.norm = m.box ? [r3(m.x), r3(m.y), r3(m.w), r3(m.h)] : [r3(m.x), r3(m.y)];
                if (under[i]?.world) d.world = under[i].world;
                return d;
            });
            const context: Record<string, Json> = {};
            contexts.forEach((fn, name) => { try { context[name] = plain(fn()); } catch (e) { context[name] = `error: ${(e as Error).message}`; } });
            const scene = director.getScene();
            const files = ['screenshot.png', 'annotated.png', 'log.txt'];
            if (frames.length) files.push('clip_sheet.png');
            const data: Record<string, Json> = {
                playmark: PLAYMARK_VERSION,
                created_at: localTime(time),
                source, category, note,
                marks: markList,
                frame_offset_s: r3(offset),
                scope: this.scope(),
                project: { name: settings.project.name || document.title, version: settings.project.version },
                engine: { name: 'cocos', version: VERSION },
                os: `${sys.os} ${sys.osVersion} · ${sys.browserType} ${sys.browserVersion}`.trim(),
                debug_build: DEBUG,
                preview: PREVIEW,
                url: location.origin + location.pathname,
                scene: { path: scene?.name ?? '', name: scene?.name ?? '' },
                window_size: [innerWidth, innerHeight],
                viewport_size: [this.canvas.clientWidth, this.canvas.clientHeight],
                screenshot_size: [image.width, image.height],
                device_pixel_ratio: devicePixelRatio,
                fps: this.fps,
                time_scale: director.getScheduler().getTimeScale(),
                uptime_s: r1(game.totalTime / 1000),
                mouse,
                under_marks: under,
                context,
                files,
                clip: { frames: frames.length, fps: settings.clipFps, offsets_s: frames.map((f) => f.offset), dir: frames.length ? 'clip/' : '' },
            };
            const shapes: Promise<[string, string]>[] = [
                blob64(image).then((b) => ['screenshot.png', b]),
                blob64(annotate(image, marks)).then((b) => ['annotated.png', b]),
            ];
            if (frames.length) {
                shapes.push(blob64(contactSheet(frames.map((f) => f.canvas))).then((b) => ['clip_sheet.png', b]));
                frames.forEach((f, i) => shapes.push(blob64(f.canvas).then((b) => [`clip/${pad(i, 3)}.png`, b])));
            }
            const encoded: Record<string, string> = {};
            for (const [name, b64] of await Promise.all(shapes)) encoded[name] = b64;
            const res = await fetch(`${this.sinkUrl()}/playmark/marks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data, files: encoded, log: this.log.lines.join('\n') }) });
            const body = await res.json();
            if (!res.ok) throw new Error(body.error ?? `the sink answered ${res.status}`);
            console.log(`Playmark: saved #${body.seq} ${body.id}`);
            this.known.set(body.id, { id: body.id, seq: body.seq, status: 'new', note, category, scene: scene?.name ?? '', scope: String(data.scope), marks: markList, resolution: null, modified: 0 });
            return body;
        } finally {
            this.busy = false;
        }
    }

    private scope() {
        try { return scopeFn?.() ?? ''; } catch { return ''; }
    }

    /**
     * ?playmark_sink= may only point at this machine: a link that named another host would
     * send every mark (frame, log, game state) there, starting with the first error.
     */
    private sinkUrl() {
        const q = new URLSearchParams(location.search).get('playmark_sink');
        // Served by a LAN sink: it is this page's origin (and its cookie carries the token).
        return (q && isLoopbackUrl(q) ? q : (isLan() ? '' : settings.sink)).replace(/\/$/, '');
    }

    private nextSeq() {
        let top = 0;
        this.known.forEach((m) => { top = Math.max(top, Number(m.seq) || 0); });
        return top + 1;
    }

    private counts() {
        let open = 0, fixed = 0;
        this.known.forEach((m) => { if (m.status === 'fixed') fixed++; else open++; });
        return { open, fixed };
    }

    // --- The loop back from the agent ---------------------------------------------------

    private async poll() {
        let list: Known[];
        try {
            const res = await fetch(`${this.sinkUrl()}/playmark/status`, { cache: 'no-store' });
            list = (await res.json()).marks;
            if (!Array.isArray(list)) throw new Error('not a Playmark sink');
        } catch {
            if (!this.polled) this.toast('error', 'Playmark: no sink', `Marks need the sink. In the project folder: node <playmark>/scripts/sink.mjs`, `${settings.shortcut.toUpperCase()} STILL OPENS THE OVERLAY`, 8);
            this.polled = true;
            this.sinkUp = false;
            return;
        }
        // The first answer (at start, or once the sink comes up) is old news, not toasts.
        const first = !this.sinkUp;
        this.sinkUp = true;
        const seen = new Set<string>();
        for (const m of list) {
            seen.add(m.id);
            const prev = this.known.get(m.id);
            this.known.set(m.id, m);
            if (first || !prev || prev.status === m.status) continue;
            if (m.status === 'working') this.toast('working', `On #${m.seq} now`, m.note || '(no note)', 'YOUR AGENT');
            else if (m.status === 'fixed') this.toast('fixed', `Fixed #${m.seq}`, m.resolution?.note || m.note, isTouch() ? 'RELOAD TO RETEST' : `RELOAD TO RETEST · ${settings.ghostsShortcut.toUpperCase()} GHOSTS`, 6);
        }
        this.known.forEach((_, id) => { if (!seen.has(id)) this.known.delete(id); });
        if (first) {
            const c = this.counts();
            this.toast('ready', 'Playmark is on', `${c.open} open · ${c.fixed} fixed`, isLan() ? 'MARK BUTTON OR THREE FINGERS' : isTouch() ? 'THREE FINGERS MARK' : `${settings.shortcut.toUpperCase()} MARK · ${settings.ghostsShortcut.toUpperCase()} GHOSTS`, 3.5);
        }
        this.polled = true;
    }

    private toast(kind: 'ready' | 'working' | 'fixed' | 'error', title: string, body: string, hint: string, seconds = 4) {
        const color = kind === 'fixed' ? BRAND.blue : kind === 'error' ? '#e5484d' : BRAND.orange;
        const t = document.createElement('div');
        Object.assign(t.style, { background: BRAND.ground, color: BRAND.paper, borderLeft: `4px solid ${color}`, padding: '8px 12px', maxWidth: 'min(360px, 80vw)', boxShadow: '0 2px 10px rgba(0,0,0,0.4)', borderRadius: '3px' });
        const line = (text: string, style: Partial<CSSStyleDeclaration>) => { if (!text) return; const d = document.createElement('div'); Object.assign(d.style, style); d.textContent = text; t.appendChild(d); };
        line(title, { font: `900 15px ${BRAND.sans}`, color });
        line(body, { marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
        line(hint, { marginTop: '4px', font: `10px ${BRAND.mono}`, color: BRAND.ink2 });
        this.hud.appendChild(t);
        setTimeout(() => t.remove(), seconds * 1000);
    }

    // --- Ghosts: past marks where they were made ----------------------------------------

    private ghostEls = new Map<string, HTMLDivElement>();
    private ghostCams: { ortho: Camera | null; persp: Camera | null; scene: string; at: number } = { ortho: null, persp: null, scene: '', at: 0 };

    /** Past marks with a place in this scene and scope: their first mark's world position. */
    private ghostMarks(scene: string) {
        const scope = this.scope();
        const now = Date.now();
        const out: Known[] = [];
        this.known.forEach((m) => {
            if (m.scene !== scene || (m.scope ?? '') !== scope) return;
            if (m.status === 'fixed' && m.approved) return;   // the player approved the fix: done
            if (m.status === 'fixed' && settings.ghostsFixedHours >= 0 && m.modified && now - m.modified > settings.ghostsFixedHours * 3600e3) return;
            const world = m.marks?.[0]?.world;
            if (Array.isArray(world) && world.length >= 2) out.push(m);
        });
        return out;
    }

    // Runs every frame, so it does nothing without ghosts, looks for cameras twice a second, and
    // moves the same elements instead of making new ones.
    private drawGhosts() {
        const scene = director.getScene();
        const marks = settings.ghostsVisible && scene ? this.ghostMarks(scene.name) : [];
        const keep = new Set(marks.map((m) => m.id));
        this.ghostEls.forEach((el, id) => { if (!keep.has(id)) { el.remove(); this.ghostEls.delete(id); } });
        if (!marks.length || !scene) return;
        const now = performance.now();
        if (this.ghostCams.scene !== scene.uuid || now - this.ghostCams.at > 500) {
            const cams = scene.getComponentsInChildren(Camera).filter((c) => c.enabledInHierarchy).sort((a, b) => b.priority - a.priority);
            this.ghostCams = {
                ortho: cams.find((c) => c.projection === Camera.ProjectionType.ORTHO) ?? null,
                persp: cams.find((c) => c.projection === Camera.ProjectionType.PERSPECTIVE) ?? null,
                scene: scene.uuid, at: now,
            };
        }
        const { ortho, persp } = this.ghostCams;
        const r = this.canvas.getBoundingClientRect();
        for (const m of marks) {
            const world = m.marks[0].world as number[];
            const cam = world.length === 3 ? persp ?? ortho : ortho ?? persp;
            let el = this.ghostEls.get(m.id);
            if (!el) {
                el = document.createElement('div');
                // 22 px dot in a 40 px touch target; a tap opens its card and never reaches the game
                Object.assign(el.style, { position: 'absolute', width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'auto', cursor: 'pointer', touchAction: 'manipulation' });
                const dot = document.createElement('div');
                Object.assign(dot.style, { width: '22px', height: '22px', borderRadius: '50%', color: BRAND.ink, font: `900 12px/22px ${BRAND.sans}`, textAlign: 'center', opacity: '0.85', boxShadow: `0 0 0 2px ${BRAND.ink}` });
                dot.textContent = String(m.seq);
                el.appendChild(dot);
                const id = m.id;
                el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.ghostCard(id); });
                for (const t of ['pointerup', 'touchstart', 'touchend', 'mousedown', 'mouseup', 'click']) el.addEventListener(t, (e) => e.stopPropagation());
                this.ghostLayer.appendChild(el);
                this.ghostEls.set(m.id, el);
            }
            const s = cam?.worldToScreen(_ghostPos.set(world[0], world[1], world[2] ?? 0), _ghostScreen);
            if (!s || s.z > 1) { el.style.display = 'none'; continue; } // no camera, or behind it
            el.style.display = '';
            (el.firstChild as HTMLDivElement).style.background = m.status === 'fixed' ? BRAND.blue : BRAND.orange;
            el.style.left = `${r.left + s.x * r.width / this.canvas.width - 20}px`;
            el.style.top = `${r.top + (this.canvas.height - s.y) * r.height / this.canvas.height - 20}px`;
        }
    }

    private card: HTMLDivElement | null = null;

    /** A ghost's card: what the mark said and, for a fixed one, what the agent did, with Approve and Still broken. */
    private ghostCard(id: string) {
        this.card?.remove();
        const m = this.known.get(id);
        if (!m) return;
        const fixed = m.status === 'fixed';
        const c = this.card = document.createElement('div');
        c.setAttribute('data-playmark', 'ghost-card');
        Object.assign(c.style, {
            position: 'fixed', zIndex: '2147483646', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: 'min(340px, 86vw)',
            background: BRAND.ground, color: BRAND.paper, borderTop: `4px solid ${fixed ? BRAND.blue : BRAND.orange}`, borderRadius: '6px',
            padding: '14px 16px', boxShadow: '0 6px 24px rgba(0,0,0,0.5)', font: `14px ${BRAND.sans}`,
        } as Partial<CSSStyleDeclaration>);
        for (const t of ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'mousedown', 'mouseup', 'click']) c.addEventListener(t, (e) => e.stopPropagation());
        const line = (text: string, style: Partial<CSSStyleDeclaration>) => { const d = document.createElement('div'); Object.assign(d.style, style); d.textContent = text; c.appendChild(d); };
        line(`#${m.seq} ${fixed ? 'FIXED' : m.status === 'working' ? 'BEING FIXED' : 'OPEN'}`, { font: `900 16px ${BRAND.sans}`, color: fixed ? BRAND.blue : BRAND.orange });
        line(m.note || '(no note)', { marginTop: '6px' });
        if (fixed && m.resolution?.note) line(`Fix: ${m.resolution.note}`, { marginTop: '6px', color: BRAND.ink2 });
        const row = document.createElement('div');
        Object.assign(row.style, { display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' });
        c.appendChild(row);
        const btn = (label: string, bg: string, fg: string, act: () => void) => {
            const b = document.createElement('button');
            b.type = 'button'; b.textContent = label;
            Object.assign(b.style, { flex: '1', minHeight: '40px', border: `1px solid ${BRAND.rule}`, borderRadius: '4px', background: bg, color: fg, font: `800 13px ${BRAND.sans}`, cursor: 'pointer' });
            b.addEventListener('click', act);
            row.appendChild(b);
        };
        if (fixed) {
            btn('APPROVE', BRAND.blue, BRAND.ink, () => this.verdict(m, 'approved'));
            btn('STILL BROKEN', 'transparent', BRAND.paper, () => this.verdict(m, 'reopen'));
        } else {
            if (m.status !== 'working') btn('DISMISS', 'transparent', BRAND.paper, () => this.verdict(m, 'dismiss'));   // a test, or not a problem after all
        }
        btn('CLOSE', 'transparent', BRAND.ink2, () => { c.remove(); this.card = null; });
        document.body.appendChild(c);
    }

    private async verdict(m: Known, v: 'approved' | 'reopen' | 'dismiss') {
        this.card?.remove(); this.card = null;
        try {
            const res = await fetch(`${this.sinkUrl()}/playmark/marks/${m.id}/verdict`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ verdict: v }) });
            const body = await res.json();
            if (!res.ok) throw new Error(body.error ?? `the sink answered ${res.status}`);
            // Update now; the next poll confirms it from disk.
            if (v === 'reopen') { m.status = 'new'; m.approved = null; }
            else { m.status = 'fixed'; m.approved = { at: new Date().toISOString() }; }
            const said = { approved: ['Approved', 'Its ghost is gone.'], reopen: ['Reopened', 'Back in the inbox for your agent.'], dismiss: ['Dismissed', 'Your agent will skip it.'] }[v];
            this.toast(v === 'reopen' ? 'working' : 'fixed', `${said[0]} #${m.seq}`, said[1], '', 2.5);
        } catch (e) {
            this.toast('error', `#${m.seq} not saved`, (e as Error).message, '', 4);
        }
    }
}

let host: Host | null = null;

function boot() {
    const q = new URLSearchParams(location.search).get('playmark');
    if (!settings.enabled || q === '0' || !sys.isBrowser) return;
    // Only on this machine (the sink answers localhost pages only), or on a page a LAN sink served.
    if (!isLan() && ['localhost', '127.0.0.1', '[::1]', '::1'].indexOf(location.hostname) === -1) return;
    try { if (localStorage.getItem(GHOSTS_KEY) === 'off') settings.ghostsVisible = false; } catch { /* private mode */ }
    host = new Host();
}

// Debug builds and the browser preview only: in a release build this whole file is dead code.
if (!EDITOR && (DEBUG || PREVIEW)) {
    director.once(Director.EVENT_AFTER_DRAW, boot);
}

// For a game that wants it without importing: window.Playmark.open()
if (!EDITOR && (DEBUG || PREVIEW)) (globalThis as any).Playmark = Playmark;

