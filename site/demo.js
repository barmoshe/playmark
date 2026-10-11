// "Try it": the Shapes toy and the Playmark flow, as a fixed guided run.
// Freeze, pin Boxy, stamp ART, save, watch Claude change one line, see Boxy turn orange.
(() => {
  const root = document.querySelector("[data-demo]");
  if (!root) return;
  const $ = (s) => root.querySelector(s);
  const canvas = $("[data-canvas]");
  const ctx = canvas.getContext("2d");
  const stage = $("[data-stage]");
  const coach = $("[data-coach]");
  const stepText = $("[data-step-text]");
  const freezeBtn = $("[data-freeze]");
  const saveBtn = $("[data-save]");
  const note = $("[data-note]");
  const deck = $("[data-deck]");
  const termBody = $("[data-term-body]");
  const chips = [...root.querySelectorAll("[data-cat]")];
  const pips = [...root.querySelectorAll("[data-pip]")];
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const W = 960, H = 540;
  const TEAL = [46, 196, 182], ORANGE = [255, 138, 31];
  const tabs = [...document.querySelectorAll("[data-scenario]")];
  const toastTitle = root.querySelector("[data-toast-title]");
  const toastBody = root.querySelector("[data-toast-body]");
  const stampSub = root.querySelector("[data-stamp-sub]");
  const CATS = ["Bug", "Feel", "Art", "Balance", "Idea"];
  // Page language: the guide speaks it; the game and the terminal stay in English.
  const HE = document.documentElement.lang === "he";
  const T = HE ? {
    placeholder: "מה לא בסדר?", waiting: "מחכה לסימון.",
    freeze: "לוחצים <kbd>M</kbd> או הקפאה כדי לעצור את הפריים.",
    pin: (n, who) => `קליק על <strong>${n}</strong>, ${who}, כדי לסמן אותו.`,
    wrong: (h, n, who) => h ? `זה ${h}. ${n} הוא <strong>${who}</strong>.` : `לסמן את <strong>${n}</strong>, ${who}.`,
    stamp: (why, k, c) => `${why}: לוחצים <kbd>${k}</kbd> בשביל <strong>${c}</strong>.`,
    save: "שמירת הסימון: <kbd>Enter</kbd>.", typing: "בדמו ההערה נכתבת לבד.",
    saved: "נשמר ב-<code>.playmark/inbox</code>. ועכשיו ב-Claude Code:",
    done: (d) => `${d} הסמן נשאר במקום הסימון, אז אפשר לבדוק את התיקון. אפשר לנסות שינוי אחר למעלה.`,
  } : {
    placeholder: "What did you notice?", waiting: "Waiting for a mark.",
    freeze: "Press <kbd>M</kbd> or Freeze to stop the frame.",
    pin: (n, who) => `Click <strong>${n}</strong>, ${who}, to pin it.`,
    wrong: (h, n, who) => h ? `That's ${h}. ${n} is <strong>${who}</strong>.` : `Pin <strong>${n}</strong>, ${who}.`,
    stamp: (why, k, c) => `${why}: press <kbd>${k}</kbd> for <strong>${c}</strong>.`,
    save: "Save the mark: <kbd>Enter</kbd>.", typing: "The note writes itself in this demo.",
    saved: "Saved to <code>.playmark/inbox</code>. Over in Claude Code:",
    done: (d) => `${d} The marker stays where you pinned it, so you can check the fix. Try another change above.`,
  };
  // Three fixed runs. Each is one mark and one line in look.gd.
  const SCENARIOS = {
    color: { target: 1, cat: 2, who: HE ? "הריבוע הטורקיז" : "the teal square", note: HE ? "Boxy צריך להיות כתום" : "Boxy should be orange", why: HE ? "זה עניין של צבע" : "It's about color",
      line: 7, del: '"color": "#2EC4B6"', add: '"color": "#FF8A1F"', body: "Boxy: #2EC4B6 → #FF8A1F in look.gd",
      done: HE ? "Boxy כתום." : "Boxy is orange." },
    shape: { target: 2, cat: 2, who: HE ? "המשולש הוורוד" : "the pink triangle", note: HE ? "לעצב מחדש את Pointy: כוכב עם חמישה קודקודים" : "Redesign Pointy: make it a five-point star.", why: HE ? "זה עניין של מראה" : "It's about the look",
      line: 8, del: '"kind": "triangle"', add: '"kind": "star"', body: "Pointy: triangle → star in look.gd",
      done: HE ? "Pointy הוא כוכב." : "Pointy is a star." },
    motion: { target: 3, cat: 1, who: HE ? "המשושה הכחול" : "the blue hexagon", note: HE ? "ש-Nutty יקפוץ במקום להסתובב" : "Make Nutty hop instead of spinning.", why: HE ? "זה עניין של תנועה" : "It's about how it moves",
      line: 9, del: '"motion": "spin"', add: '"motion": "hop"', body: "Nutty: spin → hop in look.gd",
      done: HE ? "Nutty קופץ עכשיו." : "Nutty hops now." },
  };
  let sc = SCENARIOS.color;

  const START = [
    { name: "Sunny", kind: "circle", color: [255, 210, 63], motion: "pulse", x: 165 },
    { name: "Boxy", kind: "square", color: TEAL, motion: "wobble", x: 375 },
    { name: "Pointy", kind: "triangle", color: [255, 79, 139], motion: "bob", x: 585 },
    { name: "Nutty", kind: "hexagon", color: [77, 124, 254], motion: "spin", x: 795 },
  ];
  let shapes = START.map((s) => ({ ...s, color: s.color.slice(), pop: 0 }));
  const Y = 268, R = 62;
  const target = () => shapes[sc.target];

  let t = 0, last = 0, frozen = false, step = 0, pin = null, fixedAt = -1, ghost = false, timers = [];

  // ---------- sound (tiny synth, starts on the first click) ----------
  let ac = null;
  const audio = () => (ac ||= new (window.AudioContext || window.webkitAudioContext)());
  function tone(f0, f1, dur, vol = 0.12, type = "sine", delay = 0) {
    const a = audio(), o = a.createOscillator(), g = a.createGain(), at = a.currentTime + delay;
    o.type = type; o.frequency.setValueAtTime(f0, at); o.frequency.exponentialRampToValueAtTime(f1, at + dur);
    g.gain.setValueAtTime(vol, at); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(a.destination); o.start(at); o.stop(at + dur + 0.02);
  }
  function noise(dur, vol = 0.18, delay = 0) {
    const a = audio(), n = a.createBuffer(1, a.sampleRate * dur, a.sampleRate), d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (a.sampleRate * dur * 0.18));
    const s = a.createBufferSource(), g = a.createGain(); s.buffer = n; g.gain.value = vol;
    s.connect(g).connect(a.destination); s.start(a.currentTime + delay);
  }
  const sfx = {
    shutter: () => { noise(0.05); noise(0.04, 0.13, 0.06); },
    pop: () => tone(660, 1320, 0.08, 0.1),
    chip: () => tone(900, 1100, 0.04, 0.08),
    stamp: () => { tone(150, 60, 0.22, 0.25); noise(0.06, 0.14); },
    tick: () => tone(1200, 900, 0.03, 0.04),
    fixed: () => { tone(784, 784, 0.08, 0.08); tone(1047, 1047, 0.08, 0.08, "sine", 0.08); tone(1568, 1568, 0.22, 0.08, "sine", 0.16); },
    nope: () => tone(220, 180, 0.12, 0.08, "triangle"),
  };
  const play = (n) => { try { sfx[n](); } catch { /* no audio, no problem */ } };

  // ---------- drawing ----------
  const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const dark = (c, k) => c.map((v) => Math.round(v * (1 - k)));
  const blobs = [[120, 90, 220, [76, 201, 240]], [700, 120, 260, [247, 37, 133]], [480, 420, 240, [255, 209, 102]], [880, 380, 200, [123, 47, 247]], [260, 380, 180, [247, 37, 133]], [600, 40, 160, [76, 201, 240]]];
  const sparks = Array.from({ length: 40 }, (_, i) => [((i * 263) % 960), ((i * 149) % 400), (i * 1.7) % 6.28]);

  function poly(kind) {
    const p = [];
    if (kind === "square") { const s = R * 0.86; return roundPoly([[-s, -s], [s, -s], [s, s], [-s, s]], 14); }
    if (kind === "triangle") return roundPoly([[0, -R * 1.1], [R * 1.05, R * 0.8], [-R * 1.05, R * 0.8]], 12);
    if (kind === "star") { for (let i = 0; i < 10; i++) { const a = (Math.PI * 2 * i) / 10 - Math.PI / 2, r = i % 2 ? R * 0.5 : R * 1.12; p.push([Math.cos(a) * r, Math.sin(a) * r]); } return roundPoly(p, 5); }
    if (kind === "hexagon") { for (let i = 0; i < 6; i++) { const a = (Math.PI * 2 * i) / 6 + Math.PI / 6; p.push([Math.cos(a) * R, Math.sin(a) * R]); } return roundPoly(p, 10); }
    for (let i = 0; i < 64; i++) { const a = (Math.PI * 2 * i) / 64; p.push([Math.cos(a) * R, Math.sin(a) * R]); }
    return p;
  }
  function roundPoly(c, k) {
    const out = [], n = c.length;
    for (let i = 0; i < n; i++) {
      const p = c[i], a = c[(i - 1 + n) % n], b = c[(i + 1) % n];
      const pa = toward(p, a, k), pb = toward(p, b, k);
      for (let j = 0; j <= 6; j++) { const s = j / 6; const q = lerp2(lerp2(pa, p, s), lerp2(p, pb, s), s); out.push(q); }
    }
    return out;
  }
  const toward = (p, q, k) => { const dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy); const m = Math.min(k, l / 2) / l; return [p[0] + dx * m, p[1] + dy * m]; };
  const lerp2 = (a, b, s) => [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s];
  const shapePolys = {};
  for (const k of ["circle", "square", "triangle", "hexagon", "star"]) shapePolys[k] = poly(k);

  function motion(s, i) {
    const k = t + i * 1.3;
    const m = { dx: 0, dy: 0, rot: 0, sc: 1 };
    if (s.motion === "pulse") m.sc = 1 + 0.07 * Math.sin(k * 3.2);
    if (s.motion === "wobble") m.rot = (11 * Math.PI / 180) * Math.sin(k * 2.6);
    if (s.motion === "bob") m.dy = -12 * Math.sin(k * 2.4);
    if (s.motion === "spin") m.rot = k * 1.4;
    if (s.motion === "hop") { const h = Math.abs(Math.sin(k * 3)); m.dy = -58 * h; const q = Math.max(0, 1 - h * 4); m.sx = 1 + 0.16 * q; m.sy = 1 - 0.16 * q; }
    if (s.pop > 0) m.sc *= 1 + 0.25 * Math.sin(s.pop * Math.PI);
    return m;
  }

  function draw() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#3a1c71"); g.addColorStop(0.5, "#d76d77"); g.addColorStop(1, "#ffaf7b");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    for (const [bx, by, br, bc] of blobs) {
      const x = bx + Math.sin(t * 0.25 + br) * 40, y = by + Math.cos(t * 0.2 + br) * 40;
      for (let k = 0; k < 4; k++) { ctx.fillStyle = rgb(bc, 0.05); ctx.beginPath(); ctx.arc(x, y, br * (1 - k * 0.2), 0, 7); ctx.fill(); }
    }
    for (const [x, y, ph] of sparks) { ctx.fillStyle = `rgba(255,255,255,${0.35 + 0.35 * Math.sin(t * 2 + ph)})`; ctx.beginPath(); ctx.arc(x, y, 1.6, 0, 7); ctx.fill(); }
    ctx.fillStyle = "rgba(41,13,56,0.35)"; ctx.fillRect(0, 372, W, H - 372);
    ctx.fillStyle = "rgba(255,255,255,0.25)"; ctx.fillRect(0, 371, W, 2);

    shapes.forEach((s, i) => {
      const m = motion(s, i);
      // shadow
      ctx.save(); ctx.translate(s.x, Y + R + 22); ctx.scale(1, 0.22);
      ctx.fillStyle = "rgba(20,5,38,0.28)"; ctx.beginPath(); ctx.arc(0, 0, R * 0.95, 0, 7); ctx.fill(); ctx.restore();
      ctx.save(); ctx.translate(s.x + m.dx, Y + m.dy); ctx.rotate(m.rot); ctx.scale(m.sc * (m.sx || 1), m.sc * (m.sy || 1));
      const p = shapePolys[s.kind];
      path(p, 1); ctx.fillStyle = rgb(dark(s.color, 0.38)); ctx.fill();
      path(p, 0.9); ctx.fillStyle = rgb(s.color); ctx.fill();
      path(p, 1); ctx.lineWidth = 4; ctx.strokeStyle = rgb(dark(s.color, 0.45)); ctx.stroke();
      ctx.save(); ctx.translate(-R * 0.3, -R * 0.36); ctx.rotate(-0.5); ctx.scale(1, 0.55);
      ctx.fillStyle = "rgba(255,255,255,0.28)"; ctx.beginPath(); ctx.arc(0, 0, R * 0.28, 0, 7); ctx.fill(); ctx.restore();
      face(s, i);
      ctx.restore();
    });

    if (pin) drawPin(pin.x, pin.y);
    if (ghost) drawGhost();
  }
  function path(p, k) { ctx.beginPath(); p.forEach(([x, y], i) => (i ? ctx.lineTo(x * k, y * k) : ctx.moveTo(x * k, y * k))); ctx.closePath(); }
  function face(s, i) {
    const ink = "#1d1030", ey = s.kind === "triangle" ? 10 : s.kind === "star" ? 4 : -6;
    const blink = ((t + i * 0.9) % 3.4) < 0.12;
    for (const x of [-18, 18]) {
      if (blink) { ctx.strokeStyle = ink; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x - 7, ey); ctx.lineTo(x + 7, ey); ctx.stroke(); }
      else { ctx.fillStyle = ink; ctx.beginPath(); ctx.arc(x, ey, 8, 0, 7); ctx.fill(); ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(x + 2.5, ey - 3, 2.6, 0, 7); ctx.fill(); }
    }
    ctx.strokeStyle = ink; ctx.lineWidth = 4; ctx.lineCap = "round"; ctx.beginPath(); ctx.arc(0, ey + 14, 10, 0.25, Math.PI - 0.25); ctx.stroke();
    ctx.fillStyle = "rgba(255,102,128,0.35)";
    for (const x of [-30, 30]) { ctx.beginPath(); ctx.arc(x, ey + 12, 6, 0, 7); ctx.fill(); }
  }
  function drawPin(x, y) {
    ctx.lineWidth = 6; ctx.strokeStyle = "#111"; ctx.beginPath(); ctx.arc(x, y, 15, 0, 7); ctx.stroke();
    ctx.lineWidth = 3.5; ctx.strokeStyle = "#f2621b"; ctx.beginPath(); ctx.arc(x, y, 15, 0, 7); ctx.stroke();
    ctx.fillStyle = "#f2621b"; ctx.beginPath(); ctx.arc(x, y, 3.5, 0, 7); ctx.fill();
    ctx.fillStyle = "#111"; ctx.fillRect(x + 13, y - 45, 30, 30);
    ctx.fillStyle = "#f2621b"; ctx.fillRect(x + 15, y - 43, 26, 26);
    ctx.fillStyle = "#111"; ctx.font = "900 19px Heebo, Arial"; ctx.textAlign = "center"; ctx.fillText("1", x + 28, y - 23);
    ctx.textAlign = "start";
  }
  function drawGhost() {
    const bx = target().x, base = Y, bob = Math.round(Math.sin(t * 2.2) * 2);
    const p = [bx, base - 34 + bob], r = 14;
    ctx.strokeStyle = "rgba(111,174,242,0.7)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(bx, base); ctx.lineTo(bx, p[1] + r); ctx.stroke();
    ctx.fillStyle = "#6faef2"; ctx.fillRect(bx - 3, base - 3, 6, 6);
    ctx.beginPath(); ctx.moveTo(p[0], p[1] - r); ctx.lineTo(p[0] + r, p[1]); ctx.lineTo(p[0], p[1] + r); ctx.lineTo(p[0] - r, p[1]); ctx.closePath();
    ctx.fillStyle = "rgba(17,17,17,0.65)"; ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = "#6faef2"; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(p[0] - 6, p[1]); ctx.lineTo(p[0] - 1, p[1] + 5); ctx.lineTo(p[0] + 7, p[1] - 5); ctx.stroke();
  }

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05); last = now;
    if (!frozen) t += dt;
    if (fixedAt >= 0) {
      const k = Math.min((now - fixedAt) / 700, 1), e = 1 - Math.pow(1 - k, 3);
      const s = target();
      if (sc === SCENARIOS.color) s.color = TEAL.map((v, i) => Math.round(v + (ORANGE[i] - v) * e));
      s.pop = k < 1 ? k : 0;
    }
    if (visible) draw();
    requestAnimationFrame(frame);
  }

  // Only animate while on screen.
  let visible = false;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0.05 }).observe(canvas);

  // ---------- the flow ----------
  const later = (ms, fn) => timers.push(setTimeout(fn, reduced.matches ? Math.min(ms, 60) : ms));
  const toCanvas = (ev) => { const r = canvas.getBoundingClientRect(); return [((ev.clientX - r.left) / r.width) * W, ((ev.clientY - r.top) / r.height) * H]; };
  function coachAt(x, y) { coach.style.left = (x / W) * 100 + "%"; coach.style.top = (y / H) * 100 + "%"; coach.classList.add("show"); }
  function say(html) { stepText.innerHTML = html; }
  function setStep(n) {
    step = n;
    pips.forEach((p, i) => { p.classList.toggle("done", i < n); p.classList.toggle("now", i === n); });
  }
  function term(cls, text, delay) {
    later(delay, () => {
      const p = document.createElement("p"); if (cls) p.className = cls; p.textContent = text;
      termBody.appendChild(p); play("tick");
    });
  }

  function reset() {
    timers.forEach(clearTimeout); timers = [];
    frozen = false; pin = null; ghost = false; fixedAt = -1;
    shapes = START.map((x) => ({ ...x, color: x.color.slice(), pop: 0 }));
    tabs.forEach((b) => b.setAttribute("aria-selected", String(SCENARIOS[b.dataset.scenario] === sc)));
    toastTitle.textContent = "Fixed #1"; toastBody.textContent = sc.body;
    stampSub.textContent = CATS[sc.cat];
    stage.classList.remove("frozen", "can-pin");
    coach.classList.remove("show");
    $("[data-toast]").classList.remove("show");
    $("[data-stamp]").classList.remove("go");
    chips.forEach((c) => { c.disabled = true; c.classList.remove("on", "hint"); });
    note.className = "note"; note.innerHTML = `<span class="placeholder">${T.placeholder}</span>`;
    deck.classList.remove("on");
    saveBtn.disabled = true;
    freezeBtn.disabled = false; freezeBtn.hidden = false;
    termBody.innerHTML = `<p class="term-empty">${T.waiting}</p>`;
    setStep(0);
    say(T.freeze);
  }

  function freeze() {
    if (step !== 0) return;
    frozen = true; play("shutter");
    const f = $("[data-flash]"); f.classList.remove("go"); void f.offsetWidth; if (!reduced.matches) f.classList.add("go");
    stage.classList.add("frozen", "can-pin");
    freezeBtn.disabled = true; deck.classList.add("on");
    setStep(1);
    coachAt(target().x, Y);
    say(T.pin(target().name, sc.who));
  }

  function tryPin(x, y) {
    if (step !== 1) return;
    const hit = shapes.find((s) => Math.hypot(x - s.x, y - Y) < R + 6);
    if (hit !== target()) {
      play("nope");
      say(T.wrong(hit && hit.name, target().name, sc.who));
      return;
    }
    pin = { x, y }; play("pop");
    coach.classList.remove("show"); stage.classList.remove("can-pin");
    chips.forEach((c) => (c.disabled = false)); chips[sc.cat].classList.add("hint");
    setStep(2);
    say(T.stamp(sc.why, sc.cat + 1, CATS[sc.cat].toUpperCase()));
  }

  function stampCat(i) {
    if (step !== 2) return;
    if (i !== sc.cat) { play("nope"); say(T.stamp(sc.why, sc.cat + 1, CATS[sc.cat].toUpperCase())); return; }
    chips.forEach((c, k) => { c.classList.toggle("on", k === sc.cat); c.classList.remove("hint"); c.disabled = true; });
    play("chip");
    note.classList.add("typing"); note.textContent = "";
    const caret = document.createElement("span"); caret.className = "caret";
    let n = 0;
    const type = () => {
      note.textContent = sc.note.slice(0, n); note.appendChild(caret);
      if (n++ < sc.note.length) later(45, type);
      else { saveBtn.disabled = false; setStep(3); say(T.save); saveBtn.focus({ preventScroll: true }); }
    };
    say(T.typing);
    type();
  }

  function save() {
    if (step !== 3) return;
    saveBtn.disabled = true; note.classList.remove("typing");
    const caret = note.querySelector(".caret"); if (caret) caret.remove();
    draw();
    const thumb = canvas.toDataURL("image/jpeg", 0.7);
    const st = $("[data-stamp]"); st.classList.remove("go"); void st.offsetWidth; st.classList.add("go");
    later(220, () => play("stamp"));
    setStep(4);
    say(T.saved);
    termBody.innerHTML = "";
    term("hook", `Playmark: 1 new mark from playtesting (${CATS[sc.cat].toLowerCase()}: "${sc.note}").`, 700);
    term("you", "/playmark:triage", 1300);
    later(1900, () => {
      const p = document.createElement("p"); p.textContent = "Reading mark #1, annotated.png:";
      const img = new Image(); img.src = thumb; img.alt = `The frozen frame with pin 1 on ${target().name}`;
      termBody.append(p, img); play("tick");
    });
    term("", `Under pin 1: ${target().name} (Area2D, res://shape.gd).`, 2600);
    term("", `It comes from look.gd, line ${sc.line}:`, 3200);
    term("del", "-  " + sc.del, 3700);
    term("add", "+  " + sc.add, 4000);
    term("ok", "inbox.mjs resolve 1  ✓ fixed", 4700);
    later(5200, fixed);
  }

  function fixed() {
    frozen = false; stage.classList.remove("frozen");
    pin = null; ghost = true; fixedAt = performance.now();
    const s = target();
    if (sc === SCENARIOS.shape) s.kind = "star";
    if (sc === SCENARIOS.motion) s.motion = "hop";
    $("[data-toast]").classList.add("show"); play("fixed");
    pips.forEach((p) => { p.classList.add("done"); p.classList.remove("now"); });
    step = 5;
    say(T.done(sc.done));
    later(5000, () => $("[data-toast]").classList.remove("show"));
  }

  // ---------- input ----------
  freezeBtn.addEventListener("click", freeze);
  saveBtn.addEventListener("click", save);
  chips.forEach((c, i) => c.addEventListener("click", () => stampCat(i)));
  root.querySelector("[data-restart]").addEventListener("click", reset);
  tabs.forEach((b) => b.addEventListener("click", () => { sc = SCENARIOS[b.dataset.scenario]; reset(); }));
  canvas.addEventListener("pointerdown", (ev) => { if (step === 0) { freeze(); return; } const [x, y] = toCanvas(ev); tryPin(x, y); });
  addEventListener("keydown", (ev) => {
    const r = root.getBoundingClientRect();
    const onScreen = r.bottom > 0 && r.top < innerHeight;
    if (!onScreen || ev.metaKey || ev.ctrlKey && ev.key.toLowerCase() !== "m" || ev.target.closest?.("input, textarea")) return;
    const k = ev.key.toLowerCase();
    if (k === "escape") { reset(); return; }
    if (step === 0 && (k === "m")) { ev.preventDefault(); freeze(); }
    else if (step === 1 && (k === "enter" || k === " ") && document.activeElement === canvas) { ev.preventDefault(); tryPin(target().x, Y); }
    else if (step === 2 && "12345".includes(k)) { ev.preventDefault(); stampCat(Number(k) - 1); }
    else if (step === 3 && k === "enter") { ev.preventDefault(); save(); }
  });
  // Keyboard users can pin Boxy too: the canvas takes focus once frozen.
  canvas.tabIndex = 0;

  reset();
  requestAnimationFrame((n) => { last = n; frame(n); });
})();
