/* =====================================================================
   IBPL — arena scroll experience (used by index.html and scroll.html)
   Turns scroll position into a camera position for scene.js (window.__hrT),
   runs the shot-clock loader, the scorebug and the tip-off countdown.
   Each <section class="chap"> is one camera stop, in order.
   ===================================================================== */
(() => {
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const TIPOFF = new Date('2027-03-14T17:00:00'); // EDIT: tournament start
  const chaps = $$('.chap');
  if (!chaps.length) return;

  /* ---- loader: shot clock runs 24 → 0 while the arena loads ---- */
  let pct = 0, ready = false;
  const loader = $('#loader'), ldClock = $('#ldClock'), ldMsg = $('#ldMsg');
  const ldTimer = setInterval(() => {
    pct = Math.min(ready ? 100 : 92, pct + (ready ? 10 : Math.max(0.5, (92 - pct) * 0.06)));
    if (ldClock) ldClock.textContent = Math.max(0, Math.ceil(24 * (1 - pct / 100)));
    if (pct >= 100) {
      clearInterval(ldTimer); if (ldMsg) ldMsg.textContent = 'Tip-off';
      setTimeout(() => { if (loader) loader.classList.add('out'); play(chaps[0]); }, 300);
    }
  }, 60);
  window.__hrReady = () => { ready = true; };
  setTimeout(() => { ready = true; }, 9000); // never get stuck on the loader
  const loaded = () => !loader || loader.classList.contains('out');

  /* ---- chapters → camera position ---- */
  let anchors = [];
  const measure = () => { anchors = chaps.map(c => c.offsetTop); };
  const ease = (s) => s * s * (3 - 2 * s);
  window.__hrT = 0;

  /* ---- scorebug: one segment per round ---- */
  const bugQ = $('#bugQ'), bugRd = $('#bugRd'), bugName = $('#bugName');
  const segs = bugQ ? chaps.map((c, i) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    const name = c.dataset.name;
    b.setAttribute('aria-label', `Round ${String(i).padStart(2, '0')}: ${name}`);
    b.title = name;
    b.innerHTML = '<i></i>';
    b.addEventListener('click', () => scrollTo({ top: anchors[i], behavior: reduce ? 'auto' : 'smooth' }));
    li.appendChild(b); bugQ.appendChild(li);
    return b;
  }) : [];
  // in-page menu links (#about, #league…) follow the scroll; links to other pages are left alone
  const navLinks = $$('#hnav a, .hdr .btn').filter(a => (a.getAttribute('href') || '').startsWith('#'));
  let lastIdx = -1;

  function play(c) { if (c && !c.dataset.played && !reduce) { c.dataset.played = '1'; c.firstElementChild.classList.add('play'); } }

  function update() {
    const y = scrollY, H = innerHeight;
    let t = 0;
    if (y >= anchors[anchors.length - 1]) t = anchors.length - 1;
    else for (let i = 0; i < anchors.length - 1; i++) {
      if (y >= anchors[i] && y < anchors[i + 1]) { t = i + ease((y - anchors[i]) / (anchors[i + 1] - anchors[i])); break; }
    }
    window.__hrT = t;

    const idx = Math.min(chaps.length - 1, Math.round(t));
    segs.forEach((b, i) => {
      const atEnd = t >= chaps.length - 1 - 1e-3;
      b.style.setProperty('--f', atEnd || i < Math.floor(t) ? 1 : i === Math.floor(t) ? Math.max(0.12, t - i) : 0);
      b.classList.toggle('now', i === idx);
      if (i === idx) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    });
    if (idx !== lastIdx) {
      lastIdx = idx;
      navLinks.forEach(a => { if (a.getAttribute('href') === '#' + chaps[idx].id) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
      if (bugRd) bugRd.textContent = String(idx).padStart(2, '0');
      if (bugName) bugName.textContent = chaps[idx].dataset.name;
    }

    // copy fades with distance from the centre of the screen; headline reveal plays once
    chaps.forEach((c) => {
      const inner = c.firstElementChild;
      const r = c.getBoundingClientRect();
      const isEnd = c.classList.contains('reg');
      const center = isEnd ? r.top + H * 0.5 : r.top + r.height / 2;
      const d = (center - H / 2) / H;
      let o = 1 - Math.max(0, Math.abs(d) - 0.12) / 0.38;
      if (isEnd && d < 0) o = 1;
      o = Math.max(0, Math.min(1, o));
      inner.style.opacity = o;
      inner.style.transform = reduce ? '' : `translateY(${d * -36}px)`;
      inner.style.pointerEvents = o > 0.3 ? '' : 'none';
      if (o > 0.15 && loaded()) play(c);
    });
    const enter = $('.enter'); if (enter) enter.style.opacity = Math.max(0, 1 - y / (H * 0.3));
  }
  let raf = 0;
  const onScroll = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; update(); }); };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', () => { measure(); update(); });
  addEventListener('load', () => { measure(); update(); });
  measure(); update();

  /* ---- tip-off countdown in the scorebug ---- */
  const bugClock = $('#bugClock');
  const pad = (n) => String(n).padStart(2, '0');
  function tick() {
    let s = Math.max(0, Math.floor((TIPOFF - Date.now()) / 1000));
    const d = Math.floor(s / 86400); s %= 86400;
    const h = Math.floor(s / 3600); s %= 3600;
    const m = Math.floor(s / 60); s %= 60;
    if (bugClock) bugClock.textContent = d > 0 ? `${d}D ${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(h)}:${pad(m)}:${pad(s)}`;
  }
  tick(); setInterval(tick, 1000);

  /* ---- mouse parallax for the 3D camera ---- */
  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    window.__hrMouseX = (e.clientX / innerWidth - 0.5) * 2;
    window.__hrMouseY = (e.clientY / innerHeight - 0.5) * 2;
  });

  /* ---- a link ending in #fixtures opens the fixtures screen once the arena has loaded ---- */
  if (location.hash === '#fixtures') { const w = setInterval(() => { if (loaded()) { clearInterval(w); if (window.__hrFixtures) window.__hrFixtures.open(); } }, 200); }
})();
