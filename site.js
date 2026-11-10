/* =====================================================================
   IBPL — shared site behaviour (every page)
   Menu, detail panels, fixtures screen, player registration (+ swish),
   enquiry forms, announcements and gallery. Every block checks that its
   elements exist, so pages only include the markup they need.
   ===================================================================== */
const IBPL = {
  REGISTRATION_OPEN: true,          // EDIT: false shows "Coming soon" instead of the player form
  DOB_CUTOFF: '2010-09-02',         // EDIT: earliest date of birth (under 16 on Sep 1, 2026)
  CONTACT_EMAIL: 'info@example.com' // EDIT: official email
};

(() => {
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const root = document.documentElement, body = document.body;
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  $$('[data-year]').forEach(el => { el.textContent = new Date().getFullYear(); });

  /* ---------------- storage: the Claude link's shared database, if this page has one ---------------- */
  const hasRuntime = () => window.claude && typeof window.claude.use === 'function';
  const dbReady = (async () => { try { return hasRuntime() ? await window.claude.use('db') : null; } catch (e) { return null; } })();
  const uidReady = (async () => { try { const u = hasRuntime() ? await window.claude.use('user') : null; return u ? await u.id() : null; } catch (e) { return null; } })();

  /* ---------------- menu (small screens) ---------------- */
  const menuBtn = $('#menuBtn');
  if (menuBtn) {
    const setMenu = (open) => { body.classList.toggle('menu-open', open); menuBtn.setAttribute('aria-expanded', String(open)); menuBtn.textContent = open ? 'Close' : 'Menu'; };
    menuBtn.addEventListener('click', () => setMenu(!body.classList.contains('menu-open')));
    $$('.hdr a').forEach(a => a.addEventListener('click', () => setMenu(false)));
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && body.classList.contains('menu-open')) { setMenu(false); menuBtn.focus(); } });
  }

  /* ---------------- detail drawer (keeps keyboard focus inside while open) ---------------- */
  const drawer = $('#drawer');
  let drawerFocus = null;
  function openDrawer(id) {
    if (!drawer) return;
    const panel = document.getElementById('panel-' + id), tpl = document.getElementById(id);
    if (!panel && !tpl) return;
    drawerFocus = document.activeElement;
    $$('.drawer-panel').forEach(pn => { pn.hidden = pn !== panel; });
    $('#drawerBody').hidden = !!panel;
    if (!panel) $('#drawerBody').innerHTML = tpl.innerHTML;
    const h = panel ? $('h3', panel) : $('h3', $('#drawerBody')); drawer.setAttribute('aria-label', h ? h.textContent : 'Details');
    body.classList.add('drawer-open'); drawer.setAttribute('aria-hidden', 'false');
    drawer.scrollTop = 0;
    setTimeout(() => $('#drawerX').focus(), 50);
  }
  function closeDrawer() {
    if (!body.classList.contains('drawer-open')) return;
    body.classList.remove('drawer-open'); drawer.setAttribute('aria-hidden', 'true');
    if (drawerFocus && drawerFocus.focus) drawerFocus.focus();
  }
  if (drawer) {
    document.addEventListener('click', (e) => { const b = e.target.closest('[data-more]'); if (b) { e.preventDefault(); openDrawer(b.dataset.more); } });
    $('#scrim').addEventListener('click', closeDrawer);
    $('#drawerX').addEventListener('click', closeDrawer);
    addEventListener('keydown', (e) => {
      if (!body.classList.contains('drawer-open')) return;
      if (e.key === 'Escape') { closeDrawer(); return; }
      if (e.key === 'Tab') {
        const f = $$('button, a[href], summary, input, select, textarea', drawer).filter(el => el.offsetParent !== null);
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    });
    // "Send a message"-style buttons open the contact panel with a topic picked
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-contact]'); if (!b) return;
      const sel = $('#panel-contact select[name="topic"]'); if (sel) sel.value = b.dataset.contact;
      openDrawer('contact');
    });
  }
  window.__hrOpenDrawer = openDrawer;

  /* ---------------- fixtures: coming soon ---------------- */
  const fx = $('#fx');
  if (fx) {
    let fxFocus = null, prevHash = '';
    const open = () => {
      if (body.classList.contains('fx-open')) return;
      fxFocus = document.activeElement;
      body.classList.add('fx-open'); fx.setAttribute('aria-hidden', 'false'); root.style.overflow = 'hidden';
      setTimeout(() => $('#fxClose').focus(), 60);
      prevHash = location.hash === '#fixtures' ? '' : location.hash;
      try { history.replaceState(null, '', '#fixtures'); } catch (e) { /* ignore */ }
    };
    const close = (restore = true) => {
      if (!body.classList.contains('fx-open')) return;
      body.classList.remove('fx-open'); fx.setAttribute('aria-hidden', 'true'); root.style.overflow = '';
      try { if (location.hash === '#fixtures') history.replaceState(null, '', prevHash || (location.pathname + location.search)); } catch (e) { /* ignore */ }
      if (restore && fxFocus && fxFocus.focus) fxFocus.focus();
    };
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-fixtures]')) { e.preventDefault(); open(); return; }
      if (e.target.closest('#fxClose')) { close(); return; }
      if (e.target.closest('#fx [data-fx-close], #fx [data-more]')) close(false);
    });
    addEventListener('keydown', (e) => {
      if (!body.classList.contains('fx-open')) return;
      if (e.key === 'Escape') { close(); return; }
      if (e.key === 'Tab') {
        const f = $$('button, a[href]', fx).filter(el => el.offsetParent !== null);
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    });
    window.__hrFixtures = { open, close };
    if (location.hash === '#fixtures' && !$('#loader')) open();
  }

  /* ---------------- shared form helpers ---------------- */
  const okEmail = (v) => /^\S+@\S+\.\S+$/.test(v);
  const listJoin = (a) => a.join(', ').replace(/, ([^,]*)$/, ' and $1');
  function clearOnEdit(form) {
    form.addEventListener('change', (e) => { const fs = e.target.closest('fieldset, .field'); if (fs) fs.classList.remove('bad'); });
    form.addEventListener('input', (e) => { const fl = e.target.closest('.field'); if (fl) fl.classList.remove('bad'); });
  }

  /* ---------------- registration open / coming soon ---------------- */
  $$('[data-reg-open]').forEach(el => { el.hidden = !IBPL.REGISTRATION_OPEN; });
  $$('[data-reg-closed]').forEach(el => { el.hidden = IBPL.REGISTRATION_OPEN; });

  /* ---------------- player registration: one player per email ----------------
     On the Claude link, registrations go to the page's shared database:
       emails/<fingerprint>                             claim marker (no personal data)
       registrations/<viewer id>/players/<fingerprint>  the registration, readable by the submitter and the owner
     Elsewhere (localhost) there is no shared database, so the check covers this browser only.
     A public launch connects this to the site's hosting backend. */
  const regForm = $('#regForm');
  if (regForm) {
    const msg = $('#formMsg'), submitBtn = $('button[type="submit"]', regForm);
    const holder = 'reg-' + Math.random().toString(36).slice(2);
    async function fingerprint(email) {
      const norm = email.trim().toLowerCase();
      try {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('ibpl:' + norm));
        return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
      } catch (e) {
        let h1 = 0x811c9dc5, h2 = 0x01000193;
        for (const ch of norm) { h1 = Math.imul(h1 ^ ch.charCodeAt(0), 16777619); h2 = Math.imul(h2 + ch.charCodeAt(0), 2246822507); }
        return 'f' + (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16);
      }
    }
    const local = {
      read() { try { return JSON.parse(localStorage.getItem('ibpl-registered-emails') || '[]'); } catch (e) { return []; } },
      write(list) { try { localStorage.setItem('ibpl-registered-emails', JSON.stringify(list)); } catch (e) { /* storage blocked */ } }
    };
    async function register(rec) {
      const key = await fingerprint(rec.email);
      const db = await dbReady;
      if (!db) {
        const list = local.read();
        if (list.includes(key)) return 'taken';
        list.push(key); local.write(list);
        return 'ok';
      }
      const claim = db.doc('emails/' + key);
      const lease = await claim.acquire({ holder, ttlMs: 10000 });
      if (!lease.acquired) return 'taken';
      const snap = await claim.get();
      if (snap.exists && (snap.data() || {}).claimed) return 'taken';
      const uid = await uidReady;
      if (!uid) throw new Error('no viewer id');
      const at = new Date().toISOString();
      await db.collection('registrations/' + uid + '/players').doc(key).set({ name: rec.name, dob: rec.dob, position: rec.position, email: rec.email.trim().toLowerCase(), registeredAt: at });
      await claim.set({ claimed: true, at });
      await db.doc('registrations/' + uid).set({ lastAt: at });
      return 'ok';
    }
    clearOnEdit(regForm);
    regForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (submitBtn.disabled) return;
      const name = regForm.name.value.trim(), dob = regForm.dob.value, position = regForm.position.value, email = regForm.email.value.trim();
      const missing = [];
      $('#nameField').classList.toggle('bad', !name); if (!name) missing.push("the player's name");
      $('#dobField').classList.toggle('bad', !dob); if (!dob) missing.push('a date of birth');
      $('#posSet').classList.toggle('bad', !position); if (!position) missing.push('a position');
      $('#emailField').classList.toggle('bad', !okEmail(email)); if (!okEmail(email)) missing.push('a valid email');
      msg.classList.remove('ok');
      if (missing.length) { msg.textContent = 'Add ' + listJoin(missing) + ' to register.'; return; }
      if (dob < IBPL.DOB_CUTOFF) {
        $('#dobField').classList.add('bad');
        msg.textContent = 'IBPL Season 1 is for players under 16 on September 1, 2026, so the player must be born on or after September 2, 2010.';
        return;
      }
      const label = submitBtn.textContent;
      submitBtn.disabled = true; submitBtn.textContent = 'Registering…'; msg.textContent = '';
      try {
        const result = await register({ name, dob, position, email });
        if (result === 'taken') {
          $('#emailField').classList.add('bad');
          msg.textContent = `${email} has already been used to register a player. Each email can register one player only, so use a different email.`;
          return;
        }
        regForm.reset();
        msg.classList.add('ok');
        msg.textContent = `${name.split(' ')[0]} is registered and in the player auction pool.`;
        celebrate(name.split(' ')[0], email);
      } catch (err) {
        msg.textContent = "We couldn't save the registration just now. Check your connection and try again.";
      } finally { submitBtn.disabled = false; submitBtn.textContent = label; }
    });
  }

  /* ---------------- success: the ball swishes through the hoop ---------------- */
  const sw = $('#swish');
  let celebrate = () => {};
  if (sw) {
    const swBall = $('#swBall'), swNet = $('#swNet'), swWord = $('#swWord'), swSparks = $('#swSparks'), swCopy = $('#swishCopy');
    (() => {
      const top = i => [443 + i * 12, 161], bot = i => [462 + i * (46 / 7), 232];
      const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      let d = '';
      for (let i = 0; i < 7; i++) {
        const a1 = lerp(top(i), bot(i), 0), m1 = lerp(top(i + 1), bot(i + 1), 0.33), a2 = lerp(top(i), bot(i), 0.66), b = lerp(top(i + 1), bot(i + 1), 1);
        const c1 = lerp(top(i + 1), bot(i + 1), 0), n1 = lerp(top(i), bot(i), 0.33), c2 = lerp(top(i + 1), bot(i + 1), 0.66), e = lerp(top(i), bot(i), 1);
        d += `M${a1} L${m1} L${a2} L${b} M${c1} L${n1} L${c2} L${e} `;
      }
      swNet.setAttribute('d', (d + 'M462 232 L508 232').replace(/,/g, ' '));
    })();
    let swFocus = null, swTimers = [], swRaf = 0;
    const later = (fn, ms) => swTimers.push(setTimeout(fn, ms));
    const placeBall = (x, y, rot, op = 1) => { swBall.setAttribute('transform', `translate(${x} ${y}) rotate(${rot})`); swBall.style.opacity = op; };
    const sparks = () => {
      swSparks.innerHTML = '';
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + Math.random() * 0.4, r = 40 + Math.random() * 45;
        const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        c.setAttribute('cx', 485); c.setAttribute('cy', 160); c.setAttribute('r', 2.2 + Math.random() * 2.2);
        c.setAttribute('class', 'spark'); c.style.setProperty('--dx', Math.cos(a) * r + 'px'); c.style.setProperty('--dy', Math.sin(a) * r * 0.7 + 'px');
        swSparks.appendChild(c);
        requestAnimationFrame(() => c.classList.add('go'));
      }
    };
    celebrate = (first, email) => {
      const m = $('#swishMsg'); m.innerHTML = '';
      m.append(`${first}, you're in the IBPL player auction pool. The auction date and next steps are on their way to `);
      const b = document.createElement('b'); b.textContent = email; m.append(b, '.');
      swFocus = document.activeElement;
      swTimers.forEach(clearTimeout); swTimers = []; cancelAnimationFrame(swRaf);
      swNet.classList.remove('go'); swWord.classList.remove('go'); swCopy.classList.remove('on'); swSparks.innerHTML = '';
      sw.hidden = false; requestAnimationFrame(() => sw.classList.add('on'));
      root.style.overflow = 'hidden';
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) { placeBall(485, 300, 0, 0); swCopy.classList.add('on'); $('#swishDone').focus(); return; }
      const P0 = [70, 360], P1 = [280, -190], P2 = [485, 150], FLY = 1050, DROP = 420;
      let t0 = 0;
      placeBall(...P0, 0);
      const step = (now) => {
        if (!t0) t0 = now;
        const e = now - t0;
        if (e < FLY) {
          const t = e / FLY, u = 1 - t;
          placeBall(u * u * P0[0] + 2 * u * t * P1[0] + t * t * P2[0], u * u * P0[1] + 2 * u * t * P1[1] + t * t * P2[1], t * 600);
        } else if (e < FLY + DROP) {
          const t = (e - FLY) / DROP;
          placeBall(485, 150 + 160 * t * t + 30 * t, 600 + t * 90, t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4);
        } else { placeBall(485, 340, 690, 0); return; }
        swRaf = requestAnimationFrame(step);
      };
      swRaf = requestAnimationFrame(step);
      later(() => { swNet.classList.add('go'); sparks(); swWord.classList.add('go'); }, FLY + 40);
      later(() => { swCopy.classList.add('on'); $('#swishDone').focus(); }, FLY + 900);
    };
    const closeSwish = () => {
      if (sw.hidden) return;
      swTimers.forEach(clearTimeout); cancelAnimationFrame(swRaf);
      sw.classList.remove('on'); root.style.overflow = '';
      setTimeout(() => { sw.hidden = true; }, 350);
      if (swFocus && swFocus.focus) swFocus.focus();
    };
    $('#swishDone').addEventListener('click', closeSwish);
    addEventListener('keydown', (e) => {
      if (sw.hidden) return;
      if (e.key === 'Escape') closeSwish();
      if (e.key === 'Tab') { e.preventDefault(); $('#swishDone').focus(); }
    });
  }

  /* ---------------- enquiry forms (contact, franchise, sponsorship, school) ----------------
     <form class="form enq" data-type="Franchise enquiry"> … fields with data-req are required.
     Saved to enquiries/<viewer id>/messages on the Claude link. */
  $$('form.enq').forEach(form => {
    const msg = $('.msg', form), btn = $('button[type="submit"]', form);
    clearOnEdit(form);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (btn.disabled) return;
      const missing = [];
      $$('[data-req]', form).forEach(el => {
        const v = (el.value || '').trim(), bad = !v || (el.type === 'email' && !okEmail(v));
        const fl = el.closest('.field'); if (fl) fl.classList.toggle('bad', bad);
        if (bad) missing.push(el.dataset.req);
      });
      msg.classList.remove('ok');
      if (missing.length) { msg.textContent = 'Add ' + listJoin(missing) + ' to send this.'; return; }
      const data = { type: form.dataset.type || 'Enquiry' };
      new FormData(form).forEach((v, k) => { data[k] = String(v).trim().slice(0, 4000); });
      if (data.email) data.email = data.email.toLowerCase();
      const db = await dbReady, uid = await uidReady;
      if (!db || !uid) { msg.textContent = `This preview can't send messages yet. Please email ${IBPL.CONTACT_EMAIL} instead.`; return; }
      const label = btn.textContent; btn.disabled = true; btn.textContent = 'Sending…'; msg.textContent = '';
      try {
        const at = new Date().toISOString();
        await db.collection('enquiries/' + uid + '/messages').doc(String(Date.now())).set(Object.assign(data, { sentAt: at }));
        await db.doc('enquiries/' + uid).set({ lastAt: at });
        const first = (data.name || '').split(' ')[0];
        form.reset(); msg.classList.add('ok');
        msg.textContent = `Thanks${first ? ', ' + first : ''}. Your ${data.type.toLowerCase()} has reached the league team, and we'll reply to ${data.email}.`;
      } catch (err) {
        msg.textContent = "We couldn't send this just now. Check your connection and try again.";
      } finally { btn.disabled = false; btn.textContent = label; }
    });
  });

  /* ---------------- Register Now hub: one dropdown, four pathways ---------------- */
  const path = $('#pathSelect');
  if (path) {
    const show = (v) => {
      $$('[data-path]').forEach(p => { p.hidden = p.dataset.path !== v; });
      path.value = v;
    };
    path.addEventListener('change', () => { show(path.value); try { history.replaceState(null, '', '#' + path.value); } catch (e) { /* ignore */ } });
    const fromHash = () => { const h = location.hash.slice(1); if ($(`[data-path="${h}"]`)) show(h); };
    addEventListener('hashchange', fromHash);
    show(path.value); fromHash();
  }

  /* ---------------- inner pages: blocks fade up on scroll; "On this page" follows along ---------------- */
  const blks = $$('.blk');
  if (blks.length && 'IntersectionObserver' in window) {
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      blks.forEach(b => { if (b.getBoundingClientRect().top > innerHeight * 0.9) b.classList.add('pre'); });
      const rev = new IntersectionObserver((es) => es.forEach(e => { if (e.isIntersecting) { e.target.classList.remove('pre'); rev.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
      blks.forEach(b => { if (b.classList.contains('pre')) rev.observe(b); });
      // a jump link (#format, #enquire…) shows its target straight away
      const showHash = () => { const t = location.hash && document.getElementById(location.hash.slice(1)); if (t) { const b = t.closest('.blk'); if (b) b.classList.remove('pre'); } };
      addEventListener('hashchange', showHash); showHash();
    }
    const toc = $$('.toc a');
    if (toc.length) {
      const bar = $('.toc');
      const setCur = (id) => toc.forEach(a => {
        if (a.getAttribute('href') === '#' + id) {
          a.setAttribute('aria-current', 'true');
          bar.scrollTo({ left: a.offsetLeft - 16, behavior: 'smooth' });
        } else a.removeAttribute('aria-current');
      });
      const spy = new IntersectionObserver((es) => es.forEach(e => { if (e.isIntersecting) setCur(e.target.id); }), { rootMargin: '-30% 0px -60% 0px' });
      blks.forEach(b => spy.observe(b));
    }
  }

  /* ---------------- CONTENT: announcements + gallery ----------------
     Edit content/news.json and content/gallery.json (the CMS will write these files).
     The defaults below are used if those files can't be loaded. */
  const DEFAULT_NEWS = [
    { date: '2026-11-10', tag: 'Registration', title: 'Player registration is open', text: 'Under-16 boys can register for Season 1 and enter the player auction pool.', link: 'register.html#player' },
    { date: '2026-11-10', tag: 'Franchises', title: 'Sixteen franchise slots open for enquiry', text: 'Franchise enquiries for Season 1 are now being accepted.', link: 'franchises.html' },
    { date: '', tag: 'Auction', title: 'Player auction date to be announced', text: 'Registered players will hear first, by email.', link: '' }
  ];
  const CATS = ['Official IBPL Events', 'Behind the Scenes', 'Training & Preparation', 'Official Announcements', 'Videos & Reels', 'Season 1 Highlights'];
  const load = async (url, fallback) => { try { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw 0; return await r.json(); } catch (e) { return fallback; } };
  const fmtDate = (d) => { if (!d) return 'Coming soon'; const x = new Date(d + 'T00:00:00'); return isNaN(x) ? d : x.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); };

  const newsEls = $$('[data-news]');
  if (newsEls.length) load('content/news.json', DEFAULT_NEWS).then(items => {
    newsEls.forEach(el => {
      const lim = +el.dataset.news || items.length;
      el.innerHTML = items.slice(0, lim).map(n => `<li class="news-item">
        <span class="news-meta"><b>${esc(n.tag || 'News')}</b><span>${esc(fmtDate(n.date))}</span></span>
        <span class="news-body"><b>${esc(n.title)}</b><span>${esc(n.text || '')}</span></span>
        ${n.link ? `<a class="more" href="${esc(n.link)}">Read</a>` : ''}</li>`).join('');
    });
  });

  const gal = $('[data-gallery]');
  if (gal) load('content/gallery.json', []).then(items => {
    const lim = +gal.dataset.gallery || 0;
    const filters = $('[data-gallery-filter]');
    const frame = (title, note, src) => `<figure class="frame${src ? ' photo' : ''}">${src ? `<img src="${esc(src)}" alt="${esc(title)}" loading="lazy">` : ''}<b>${esc(title)}</b><span>${esc(note)}</span></figure>`;
    const render = (cat) => {
      const list = items.filter(g => !cat || g.category === cat);
      if (list.length) gal.innerHTML = (lim ? list.slice(0, lim) : list).map(g => frame(g.title || '', g.category || '', g.src)).join('');
      else gal.innerHTML = (cat ? [cat] : CATS).slice(0, lim || 6).map(c => frame(c, 'Coming soon')).join('');
    };
    if (filters) {
      filters.innerHTML = ['All', ...CATS].map((c, i) => `<button type="button" class="chip-btn" aria-pressed="${i === 0}" data-cat="${i ? esc(c) : ''}">${esc(c)}</button>`).join('');
      filters.addEventListener('click', (e) => {
        const b = e.target.closest('[data-cat]'); if (!b) return;
        $$('[data-cat]', filters).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        render(b.dataset.cat);
      });
    }
    render('');
  });
})();
