// Copy buttons, the hero video's pause control, and the live GitHub star count.
(() => {
  const HE = document.documentElement.lang === "he";

  // The language toggle remembers the choice; a first visit from a Hebrew browser lands on /he.
  const store = { get: () => { try { return localStorage.getItem("playmark-lang"); } catch { return null; } },
    set: (v) => { try { localStorage.setItem("playmark-lang", v); } catch { /* private mode */ } } };
  for (const a of document.querySelectorAll("[data-lang]")) a.addEventListener("click", () => store.set(a.dataset.lang));
  if (!HE && !store.get() && /^he\b|^iw\b/i.test(navigator.language || "") && !location.hash) location.replace("/he");
  const L = HE ? { copy: "העתקה", copied: "הועתק", select: "לסמן ידנית", play: "הפעלה", pause: "השהיה" }
    : { copy: "Copy", copied: "Copied", select: "Select it", play: "Play", pause: "Pause" };
  for (const b of document.querySelectorAll("[data-copy]")) {
    b.addEventListener("click", async () => {
      const text = b.parentElement.querySelector("[data-cmd]").textContent;
      try {
        await navigator.clipboard.writeText(text);
        b.textContent = L.copied;
        b.classList.add("done");
        setTimeout(() => { b.textContent = L.copy; b.classList.remove("done"); }, 1600);
      } catch {
        b.textContent = L.select;
      }
    });
  }

  const video = document.getElementById("hero-video");
  const toggle = document.querySelector("[data-video-toggle]");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const sync = () => {
    toggle.textContent = video.paused ? L.play : L.pause;
    toggle.setAttribute("aria-pressed", String(video.paused));
  };
  const respect = () => {
    if (reduced.matches) video.pause();
    else video.play().catch(() => {});
    sync();
  };
  if (video && toggle) {
    toggle.addEventListener("click", () => { video.paused ? video.play().catch(() => {}) : video.pause(); sync(); });
    video.addEventListener("play", sync);
    video.addEventListener("pause", sync);
    reduced.addEventListener("change", respect);
    respect();
  }

  // Below-the-fold videos load and play only when seen (and not under reduced motion).
  for (const v of document.querySelectorAll("[data-lazy-video]")) {
    const t = v.parentElement.querySelector("[data-lazy-toggle]");
    const show = () => { t.textContent = v.paused ? L.play : L.pause; t.setAttribute("aria-pressed", String(v.paused)); };
    t.addEventListener("click", () => { v.paused ? v.play().catch(() => {}) : v.pause(); show(); });
    v.addEventListener("play", show); v.addEventListener("pause", show);
    new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !reduced.matches) v.play().catch(() => {});
      else if (!e.isIntersecting) v.pause();
    }, { threshold: 0.4 }).observe(v);
  }

  // The version follows the latest GitHub release, so a release updates the site by itself.
  const version = document.querySelectorAll("[data-version]");
  if (version.length) {
    fetch("https://api.github.com/repos/barmoshe/playmark/releases/latest")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && /^v\d/.test(d.tag_name)) version.forEach((el) => (el.textContent = d.tag_name)); })
      .catch(() => {});
  }

  const stars = document.querySelector("[data-stars]");
  if (stars) {
    fetch("https://api.github.com/repos/barmoshe/playmark")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && typeof d.stargazers_count === "number" && d.stargazers_count > 0) {
          stars.textContent = d.stargazers_count;
          stars.hidden = false;
        }
      })
      .catch(() => {});
  }
})();
