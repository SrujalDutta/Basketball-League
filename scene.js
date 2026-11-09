/* =====================================================================
   HOOP READY — 3D arena fly-through (three.js r147, no build step)
   Rendering: HDR scene → bloom → cinematic grade (ACES, vignette, grain)
   The camera follows window.__hrT (0 → 7), set by the page script from
   scroll position. Each whole number = one chapter on the page.
   ===================================================================== */
(function () {
  'use strict';
  const ORANGE = '#ff5a1f';
  const canvas = document.getElementById('scene');
  const done = () => window.__hrReady && window.__hrReady();

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (e) {
    document.documentElement.classList.add('no-webgl');
    done();
    return;
  }

  const isMobile = matchMedia('(max-width: 900px)').matches;
  // LITE mode: no glow post-processing, fewer people, no shadows.
  // Used automatically on software/basic GPUs or after a GPU crash; force it with ?lite, or force full with ?full.
  const params = new URLSearchParams(location.search);
  let gpuName = '';
  try { const gl = renderer.getContext(), dbg = gl.getExtension('WEBGL_debug_renderer_info'); gpuName = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : ''; } catch (e) { /* ignore */ }
  let crashed = false; try { crashed = sessionStorage.getItem('hr-lite') === '1'; } catch (e) { /* ignore */ }
  const hashMode = (location.hash || '').toLowerCase();
  const LITE = !params.has('full') && hashMode !== '#full' && (params.has('lite') || hashMode === '#lite' || crashed || /swiftshader|basic render|llvmpipe|software/i.test(gpuName));
  const LOW = isMobile || LITE;
  window.__hrMode = LITE ? 'lite' : 'full';
  // if the GPU drops the context (driver reset), come back in lite mode instead of a black screen
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); document.documentElement.classList.add('no-webgl'); try { sessionStorage.setItem('hr-lite', '1'); } catch (er) { /* ignore */ } }, false);
  canvas.addEventListener('webglcontextrestored', () => location.reload(), false);
  renderer.setPixelRatio(Math.min(devicePixelRatio, LITE ? 1 : isMobile ? 1.5 : 1.75));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; // replaced by the final grade pass when post-processing is on
  renderer.toneMappingExposure = 1.2;
  renderer.shadowMap.enabled = !LOW;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x060606);
  scene.fog = new THREE.FogExp2(0x070707, 0.026);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 220);
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const U_TIME = { value: 0 };           // shared clock for every animated shader
  const BEAMS = [];                      // every visible light cone (dust uses these to sparkle)
  let ribbonTex = null, phoneGlow = null;

  /* ---------------- helpers ---------------- */
  function tex(w, h, draw, opts = {}) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    draw(g, w, h);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = maxAniso;
    if (opts.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    return t;
  }
  function scaleUV(geo, sx, sy) {
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * sx, uv.getY(i) * sy);
    return geo;
  }
  function mesh(geo, mat, x = 0, y = 0, z = 0, parent = scene) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }
  const box = (w, h, d, mat, x, y, z, parent) => mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z, parent);
  const std = (o) => new THREE.MeshStandardMaterial(o);
  // unlit material; k > 1 pushes it above white so the bloom pass makes it glow
  const glow = (o, k = 1) => { const m = new THREE.MeshBasicMaterial(Object.assign({ toneMapped: false }, o)); if (k !== 1) m.color.multiplyScalar(k); return m; };
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  function spaced(g, text, x, y, spacing) {
    if ('letterSpacing' in g) { g.letterSpacing = spacing + 'px'; g.fillText(text, x, y); g.letterSpacing = '0px'; return; }
    g.fillText(text.split('').join(String.fromCharCode(8202)), x, y);
  }

  /* logo: italic "HR" monogram + wordmark */
  function drawLogo(g, cx, cy, s, withText = true, light = '#ececec') {
    g.save();
    g.font = `italic 800 ${s}px "Barlow Condensed", Impact, sans-serif`;
    g.textBaseline = 'alphabetic';
    g.textAlign = 'left';
    const wH = g.measureText('H').width, wR = g.measureText('R').width;
    const x = cx - (wH + wR - s * 0.08) / 2;
    const grd = g.createLinearGradient(0, cy - s * 0.72, 0, cy);
    grd.addColorStop(0, light); grd.addColorStop(1, '#8d8d8d');
    g.fillStyle = grd; g.fillText('H', x, cy);
    g.fillStyle = ORANGE; g.fillText('R', x + wH - s * 0.08, cy);
    if (withText) {
      g.textAlign = 'center';
      g.font = `italic 700 ${s * 0.2}px "Barlow Condensed", sans-serif`;
      const t1 = 'HOOP ', t2 = 'READY';
      const w1 = g.measureText(t1).width + s * 0.04 * 5, w2 = g.measureText(t2).width + s * 0.04 * 5;
      const sx = cx - (w1 + w2) / 2;
      g.textAlign = 'left';
      g.fillStyle = light; spaced(g, t1, sx, cy + s * 0.32, s * 0.04);
      g.fillStyle = ORANGE; spaced(g, t2, sx + w1, cy + s * 0.32, s * 0.04);
    }
    g.restore();
  }

  /* ---------------- shared textures & materials ---------------- */
  const concreteTex = tex(512, 512, (g, w, h) => {
    g.fillStyle = '#2c2c2c'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
      const v = (Math.random() * 70) | 0;
      g.fillStyle = `rgba(${v},${v},${v},${Math.random() * 0.22})`;
      g.fillRect(Math.random() * w, Math.random() * h, rnd(1, 4), rnd(1, 4));
    }
    for (let i = 0; i < 16; i++) {
      const x = Math.random() * w, y = Math.random() * h, r = rnd(40, 160);
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(0,0,0,.28)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }, { repeat: true });

  const wallMat = std({ map: concreteTex, color: 0x6d6d6d, roughness: 0.95 });
  const darkWallMat = std({ map: concreteTex, color: 0x3a3a3a, roughness: 0.95 });
  const floorMat = std({ map: concreteTex, color: 0x4a4a4a, roughness: 0.42, metalness: 0.35 });
  const metalMat = std({ color: 0x222222, roughness: 0.4, metalness: 0.8 });
  const blackMat = std({ color: 0x0d0d0d, roughness: 0.6 });
  const orangeMat = std({ color: 0xff5a1f, roughness: 0.5 });
  const whiteMat = std({ color: 0xe8e8e8, roughness: 0.5 });

  const fadeTex = tex(64, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  const radialTex = tex(256, 256, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });

  /* ---------------- volumetric light beams ----------------
     A soft cone of light: bright at the fixture, fading toward the floor,
     soft at the edges, with slowly drifting haze inside it. */
  const NOISE_GLSL = `
    float hash3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
    float vnoise(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x), mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
                 mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x), mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z); }`;
  const fixtureMat = std({ color: 0x1a1a1a, roughness: 0.35, metalness: 0.85 });
  function beam(from, to, radius, color, intensity = 1, opts = {}) {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
    const dir = b.clone().sub(a); const len = dir.length(); dir.normalize();
    const r0 = opts.r0 !== undefined ? opts.r0 : Math.max(0.07, radius * 0.07);
    const geo = new THREE.CylinderGeometry(r0, radius, len, 48, 1, true);
    geo.translate(0, -len / 2, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: U_TIME, uColor: { value: new THREE.Color(color) }, uInt: { value: intensity }, uLen: { value: len }, uFog: { value: scene.fog.density } },
      vertexShader: `
        uniform float uLen; varying vec3 vN; varying vec3 vW; varying vec3 vV; varying float vT;
        void main(){
          vT = clamp(-position.y / uLen, 0.0, 1.0);
          vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
          vN = normalize(mat3(modelMatrix) * normal); vV = cameraPosition - w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: NOISE_GLSL + `
        uniform vec3 uColor; uniform float uInt; uniform float uTime; uniform float uFog;
        varying vec3 vN; varying vec3 vW; varying vec3 vV; varying float vT;
        void main(){
          float d = length(vV); vec3 v = vV / d;
          float edge = pow(abs(dot(normalize(vN), v)), 3.2);                     // soft sides
          float along = smoothstep(0.0, 0.04, vT) * mix(1.0, 0.16, pow(vT, 0.7)) // bright at source
                      * smoothstep(1.0, 0.86, vT);                                // fade into the floor
          float n = vnoise(vW * 0.42 + vec3(0.0, -uTime * 0.16, uTime * 0.06)) * 0.62
                  + vnoise(vW * 1.35 + vec3(uTime * 0.05, uTime * 0.03, 0.0)) * 0.38;
          n = 0.5 + 0.8 * n;                                                      // drifting haze
          float near = smoothstep(0.4, 3.2, d);                                   // no glare when the camera is inside
          float fog = exp(-uFog * uFog * d * d * 0.5);
          gl_FragColor = vec4(uColor * (edge * along * n * near * fog * uInt), 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(a);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
    m.renderOrder = 5;
    if (opts.cone !== false) scene.add(m); // cone: false = lamp head / floor pool only, no visible beam
    if (opts.pool !== false) { // soft pool of light where the beam lands
      const pc = new THREE.Color(color).multiplyScalar(intensity * (opts.poolK || 0.16));
      const pool = mesh(new THREE.PlaneGeometry(radius * 2.7, radius * 2.7), new THREE.MeshBasicMaterial({ color: pc, map: radialTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), b.x, opts.poolY || 0.022, b.z);
      pool.rotation.x = -Math.PI / 2; pool.renderOrder = 4;
    }
    if (opts.fixture) { // the lamp head the beam comes out of
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
      const head = mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.5, 20), fixtureMat, a.x - dir.x * 0.25, a.y - dir.y * 0.25, a.z - dir.z * 0.25);
      head.quaternion.copy(q);
      const lens = mesh(new THREE.CircleGeometry(0.22, 24), glow({ color }, 9), a.x, a.y, a.z);
      lens.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
    }
    if (opts.cone !== false) BEAMS.push({ a, dir, len, r0, r1: radius });
    return m;
  }
  // vertical beam (kept for the original call sites)
  function lightBeam(x, y, z, length, radius, color, opacity = 0.07) {
    return beam([x, y, z], [x, y - length, z], radius, color, opacity * 10);
  }
  function spot(color, intensity, distance, angle, penumbra, pos, target, shadow = false) {
    const l = new THREE.SpotLight(color, intensity, distance, angle, penumbra, 1.4);
    l.position.set(...pos);
    l.target.position.set(...target);
    scene.add(l, l.target);
    if (shadow && renderer.shadowMap.enabled) {
      l.castShadow = true;
      l.shadow.mapSize.set(1024, 1024);
      l.shadow.bias = -0.0004;
      l.shadow.camera.near = 1; l.shadow.camera.far = distance;
    }
    return l;
  }

  /* ---------------- crowd helpers ---------------- */
  function mergeGeos(geos, extra) {
    const list = geos.map(g => (g.index ? g.toNonIndexed() : g));
    let n = 0; list.forEach(g => { n += g.attributes.position.count; });
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
    const ex = {}; if (extra) Object.keys(extra).forEach(k => { ex[k] = new Float32Array(n); });
    let o = 0;
    list.forEach((g, gi) => {
      pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3);
      const c = g.attributes.position.count;
      if (extra) Object.keys(extra).forEach(k => ex[k].fill(extra[k][gi], o, o + c));
      o += c;
    });
    for (let i = 0; i < nor.length; i += 3) { // a zero/NaN normal would light as NaN
      const l = Math.hypot(nor[i], nor[i + 1], nor[i + 2]);
      if (!(l > 1e-6)) { nor[i] = 0; nor[i + 1] = 1; nor[i + 2] = 0; }
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    Object.keys(ex).forEach(k => out.setAttribute(k, new THREE.BufferAttribute(ex[k], 1)));
    return out;
  }
  const V3 = (a) => new THREE.Vector3(...a);
  function capsule(r, a, b, seg = 7) {
    const A = V3(a), B = V3(b), d = B.clone().sub(A);
    const g = new THREE.CapsuleGeometry(r, Math.max(0.001, d.length()), 2, seg);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
    const m = A.add(B).multiplyScalar(0.5); g.translate(m.x, m.y, m.z);
    return g;
  }
  // part: 0 skin, 1 shirt, 2 pants, 3 hair, 4 shoes    limb: 0 body, 1 left arm, 2 right arm
  function personGeometry(standing) {
    const G = [], part = [], limb = [];
    const add = (g, p, l = 0) => { G.push(g); part.push(p); limb.push(l); };
    const y0 = standing ? 0.4 : -0.03;               // torso base (origin = seat surface)
    const torso = new THREE.LatheGeometry([[0, 0], [0.125, 0.02], [0.145, 0.12], [0.14, 0.25], [0.155, 0.38], [0.178, 0.47], [0.165, 0.53], [0.09, 0.575], [0, 0.585]].map(([x, y]) => new THREE.Vector2(x, y)), 12);
    torso.scale(1, 1, 0.66); if (!standing) torso.rotateX(0.07); torso.translate(0, y0, 0);
    add(torso, 1);
    const sh = y0 + 0.5, hy = y0 + 0.77;
    add(capsule(0.045, [0, sh + 0.06, 0.02], [0, sh + 0.15, 0.02], 6), 0);
    const head = new THREE.SphereGeometry(0.1, 12, 9); head.scale(0.9, 1.1, 0.98); head.translate(0, hy, 0.035); add(head, 0);
    const hair = new THREE.SphereGeometry(0.107, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.52); hair.scale(0.93, 1.06, 1.02); hair.rotateX(-0.28); hair.translate(0, hy + 0.012, 0.02); add(hair, 3);
    [-1, 1].forEach(sx => {
      const x = sx * 0.1;
      if (standing) {
        add(capsule(0.074, [x, 0.42, 0], [x, 0.02, 0.01]), 2);
        add(capsule(0.058, [x, 0.0, 0.01], [x, -0.36, 0.0]), 2);
        add(new THREE.BoxGeometry(0.1, 0.075, 0.24).translate(x, -0.385, 0.05), 4);
      } else {
        add(capsule(0.076, [x, 0.06, -0.02], [x * 1.05, 0.1, 0.4]), 2);
        add(capsule(0.058, [x * 1.05, 0.08, 0.42], [x * 1.05, -0.36, 0.46]), 2);
        add(new THREE.BoxGeometry(0.1, 0.075, 0.24).translate(x * 1.05, -0.385, 0.52), 4);
      }
      const L = sx < 0 ? 1 : 2;
      const S = [sx * 0.19, sh, 0.03];
      const E = standing ? [sx * 0.23, sh - 0.24, 0.02] : [sx * 0.22, sh - 0.23, 0.09];
      const Wr = standing ? [sx * 0.24, sh - 0.46, 0.07] : [sx * 0.14, sh - 0.33, 0.3];
      add(capsule(0.05, S, E), 1, L);                                   // sleeve
      add(capsule(0.04, E, Wr), 0, L);                                  // forearm
      add(new THREE.SphereGeometry(0.043, 8, 6).translate(...Wr), 0, L); // hand
    });
    return { geo: mergeGeos(G, { part, limb }), pivotY: sh, hand: standing ? [0.24, sh - 0.48, 0.08] : [0.14, sh - 0.35, 0.33] };
  }
  // world position of a raised right hand (matches the shader's arm rotation)
  function handWorld(c, P, raise) {
    const piv = new THREE.Vector3(0.19, P.pivotY, 0.03);
    const q = V3(P.hand).sub(piv);
    const ax = -raise * 2.75, az = -raise * 0.5;
    let y = q.y * Math.cos(ax) - q.z * Math.sin(ax), z = q.y * Math.sin(ax) + q.z * Math.cos(ax); q.y = y; q.z = z;
    const x = q.x * Math.cos(az) - q.y * Math.sin(az); y = q.x * Math.sin(az) + q.y * Math.cos(az); q.x = x; q.y = y;
    const p = piv.add(q).add(new THREE.Vector3(0, 0, 0.06)).multiplyScalar(c.s);
    p.applyAxisAngle(new THREE.Vector3(0, 1, 0), c.rotY);
    return p.add(new THREE.Vector3(c.x, c.y + 0.42, c.z));
  }
  function crowdMaterial(pivotY) {
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0.0 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = U_TIME;
      sh.uniforms.uPivotY = { value: pivotY };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float part; attribute float limb;
          attribute vec3 iSkin; attribute vec3 iShirt; attribute vec3 iPants; attribute vec3 iHair; attribute vec4 iData;
          uniform float uTime; uniform float uPivotY; varying vec3 vCrowd;
          vec3 rotX(vec3 v, float a){ float c = cos(a), s = sin(a); return vec3(v.x, v.y * c - v.z * s, v.y * s + v.z * c); }
          vec3 rotZ(vec3 v, float a){ float c = cos(a), s = sin(a); return vec3(v.x * c - v.y * s, v.x * s + v.y * c, v.z); }`)
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
          float ph = iData.x;
          float wave = 0.5 + 0.5 * sin(uTime * 2.4 + ph);
          float up = iData.y * smoothstep(0.3, 0.6, wave);
          float side = limb < 1.5 ? -1.0 : 1.0;
          float raise = limb > 1.5 ? max(up, iData.z) : up;
          if (limb > 0.5) objectNormal = rotZ(rotX(objectNormal, -raise * 2.75), -side * raise * 0.5);
          vCrowd = part < 0.5 ? iSkin : part < 1.5 ? iShirt : part < 2.5 ? iPants : part < 3.5 ? iHair
                 : mix(vec3(0.85), vec3(0.06), step(0.5, fract(iData.w * 7.0)));`)
        .replace('#include <begin_vertex>', `vec3 transformed = vec3(position);
          if (limb > 0.5) {
            vec3 piv = vec3(side * 0.19, uPivotY, 0.03);
            transformed = piv + rotZ(rotX(transformed - piv, -raise * 2.75), -side * raise * 0.5);
          }
          float body = smoothstep(-0.05, 0.25, position.y);
          transformed.y += (sin(uTime * 1.7 + ph * 3.0) * 0.01 + up * 0.05) * body;
          transformed.x += sin(uTime * 0.6 + ph) * 0.015 * max(position.y, 0.0);`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vCrowd;')
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( diffuse * vCrowd, opacity );');
    };
    return mat;
  }

  function build() {
    /* =============== FLOOR (one big slab) =============== */
    const floor = mesh(scaleUV(new THREE.PlaneGeometry(120, 160), 24, 32), floorMat, 0, 0, -40);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;

    scene.add(new THREE.HemisphereLight(0x9aa6b8, 0x0a0a0a, 0.28));
    // soft studio reflections for glossy things (court varnish, metal, trophy)
    let envTex = null;
    try { const pm = new THREE.PMREMGenerator(renderer); envTex = pm.fromScene(new THREE.RoomEnvironment(), 0.04).texture; pm.dispose(); } catch (e) { /* optional */ }
    const shine = (m, k) => { if (envTex) { m.envMap = envTex; m.envMapIntensity = k; } return m; };
    shine(metalMat, 0.35);

    /* =============== EXTERIOR WALL + ENTRANCE =============== */
    const ext = new THREE.Group(); scene.add(ext);
    const extMat = std({ map: concreteTex, color: 0x4a4a4a, roughness: 0.9 });
    const g1 = scaleUV(new THREE.BoxGeometry(18.8, 12, 0.5), 5, 3);
    mesh(g1, extMat, -10.6, 6, -0.25, ext);
    mesh(g1.clone(), extMat, 10.6, 6, -0.25, ext);
    mesh(scaleUV(new THREE.BoxGeometry(2.4, 8.9, 0.5), 1, 2.5), extMat, 0, 7.55, -0.25, ext);

    // door frame glow
    const frameGlow = glow({ color: 0x9a5a2a });
    box(0.06, 3.15, 0.08, frameGlow, -1.23, 1.55, 0.02, ext);
    box(0.06, 3.15, 0.08, frameGlow, 1.23, 1.55, 0.02, ext);
    box(2.52, 0.06, 0.08, frameGlow, 0, 3.12, 0.02, ext);

    // doors (open inward as the camera approaches)
    const doorMat = shine(std({ color: 0x1b1b1b, roughness: 0.35, metalness: 0.7 }), 0.3);
    const windowMat = glow({ color: 0xc98a52 }, 2.6);
    function makeDoor(side) {
      const pivot = new THREE.Group();
      pivot.position.set(side * -1.2, 0, -0.1);
      ext.add(pivot);
      const leaf = box(1.18, 3.08, 0.07, doorMat, side * 0.6, 1.54, 0, pivot);
      leaf.castShadow = true;
      box(0.12, 0.9, 0.08, windowMat, side * 0.9, 1.95, 0, pivot);
      box(0.04, 0.5, 0.1, metalMat, side * 1.05, 1.35, 0.06, pivot);
      return pivot;
    }
    const doorL = makeDoor(1), doorR = makeDoor(-1);

    // sign above entrance
    const signTex = tex(1024, 400, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, '#2a2a2a'); gr.addColorStop(1, '#141414');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.03})`; g.fillRect(0, Math.random() * h, w, 1); }
      drawLogo(g, w / 2, h * 0.62, 230);
    });
    const sign = mesh(new THREE.PlaneGeometry(6, 2.35), std({ map: signTex, roughness: 0.5, metalness: 0.4, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 0.18 }), 0, 4.75, 0.04, ext);
    box(6.2, 0.08, 0.3, metalMat, 0, 6, 0.1, ext);
    [-1.6, 1.6].forEach(x => { box(0.25, 0.12, 0.25, glow({ color: 0xfff0dc }, 6), x, 6.1, 0.35, ext); });
    spot(0xfff0dc, 3.2, 16, 0.55, 0.7, [0, 8.5, 4.5], [0, 4.4, 0]);
    beam([-1.6, 6.05, 0.4], [-1.1, 0, 3.2], 1.5, 0xffe7c2, 0.22);
    beam([1.6, 6.05, 0.4], [1.1, 0, 3.2], 1.5, 0xffe7c2, 0.22);

    // warm light spilling out of the door
    const spill = new THREE.PointLight(0xff9a50, 1.8, 11, 1.8);
    spill.position.set(0, 1.9, -1.4); scene.add(spill);
    const spillPlane = mesh(new THREE.PlaneGeometry(3.2, 9), new THREE.MeshBasicMaterial({ color: 0xff9a50, alphaMap: fadeTex, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), 0, 0.015, 4.5);
    spillPlane.rotation.x = -Math.PI / 2;
    spillPlane.rotation.z = Math.PI;

    /* =============== TUNNEL (z 0 → -24) =============== */
    const tunnelWall = std({ map: concreteTex, color: 0x5a5a5a, roughness: 0.9 });
    const tw = scaleUV(new THREE.PlaneGeometry(24, 4), 6, 1);
    const tl = mesh(tw, tunnelWall, -3, 2, -12); tl.rotation.y = Math.PI / 2;
    const tr = mesh(tw.clone(), tunnelWall, 3, 2, -12); tr.rotation.y = -Math.PI / 2;
    const tc = mesh(new THREE.PlaneGeometry(6, 24), darkWallMat, 0, 4, -12); tc.rotation.x = Math.PI / 2;
    [-4, -10, -16, -22].forEach(z => {
      box(1.6, 0.05, 0.12, glow({ color: 0xfff3e2 }, 4), 0, 3.96, z);
      const p = new THREE.PointLight(0xffe6c8, 0.9, 8, 1.5);
      p.position.set(0, 3.6, z); scene.add(p);
    });

    // posters on the right wall
    function poster(draw, z) {
      const t = tex(512, 720, draw);
      const m = mesh(new THREE.PlaneGeometry(1.5, 2.1), std({ map: t, roughness: 0.6, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.12 }), 2.97, 1.95, z);
      m.rotation.y = -Math.PI / 2;
    }
    function drawShooter(g, x, y, s, col) {
      g.fillStyle = col;
      g.beginPath(); g.arc(x, y - s * 1.65, s * 0.16, 0, 7); g.fill();               // head
      g.save(); g.translate(x, y - s * 1.1); g.rotate(-0.08); g.fillRect(-s * 0.2, -s * 0.38, s * 0.4, s * 0.8); g.restore(); // torso
      g.lineCap = 'round'; g.strokeStyle = col; g.lineWidth = s * 0.12;
      g.beginPath(); g.moveTo(x - s * 0.12, y - s * 1.4); g.lineTo(x - s * 0.05, y - s * 2.15); g.stroke(); // arm up
      g.beginPath(); g.moveTo(x + s * 0.12, y - s * 1.4); g.lineTo(x + s * 0.25, y - s * 2.1); g.stroke();
      g.lineWidth = s * 0.15;
      g.beginPath(); g.moveTo(x - s * 0.1, y - s * 0.75); g.lineTo(x - s * 0.22, y); g.stroke();
      g.beginPath(); g.moveTo(x + s * 0.1, y - s * 0.75); g.lineTo(x + s * 0.3, y - s * 0.1); g.stroke();
      g.fillStyle = ORANGE; g.beginPath(); g.arc(x + s * 0.05, y - s * 2.3, s * 0.17, 0, 7); g.fill();
    }
    poster((g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#ff5a1f'); gr.addColorStop(1, '#5a1505');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      drawShooter(g, w * 0.5, h * 0.82, 220, '#1a0a03');
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.font = '800 92px "Barlow Condensed"'; g.fillText('CITY FINALS', w / 2, 110);
      g.font = '600 36px "Barlow Condensed"'; spaced(g, 'BLACKTOP KINGS vs STORM', w / 2, 160, 3);
    }, -8);
    poster((g, w, h) => {
      g.fillStyle = '#16121f'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#ffb21a'; g.lineWidth = 10; g.strokeRect(24, 24, w - 48, h - 48);
      g.fillStyle = '#ffb21a'; g.textAlign = 'center'; g.font = '800 120px "Barlow Condensed"'; g.fillText('TITLE', w / 2, 250); g.fillText('NIGHT', w / 2, 370);
      g.fillStyle = '#fff'; g.font = '600 40px "Barlow Condensed"'; spaced(g, 'CHAMPIONSHIP SUNDAY', w / 2, 450, 3);
      g.font = '800 64px "Barlow Condensed"'; g.fillText('MAR 16', w / 2, 600);
    }, -13);
    poster((g, w, h) => {
      g.fillStyle = '#e9e5dc'; g.fillRect(0, 0, w, h);
      drawShooter(g, w * 0.5, h * 0.9, 210, '#111');
      g.fillStyle = '#111'; g.textAlign = 'center'; g.font = '800 140px "Barlow Condensed"'; g.fillText('#23', w / 2, 160);
      g.font = '600 34px "Barlow Condensed"'; spaced(g, 'TOURNAMENT MVP', w / 2, 210, 4);
    }, -18);

    // neon on the left wall
    const neonTex = tex(1024, 256, (g, w, h) => {
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = 'italic 800 150px "Barlow Condensed"';
      g.shadowColor = '#ffb21a'; g.shadowBlur = 30; g.fillStyle = '#ffe2a0';
      g.fillText('BALL IS LIFE', w / 2, h / 2); g.shadowBlur = 12; g.fillText('BALL IS LIFE', w / 2, h / 2);
    });
    const neon = mesh(new THREE.PlaneGeometry(3.2, 0.8), glow({ map: neonTex, transparent: true, depthWrite: false }, 3), -2.96, 2.7, -11);
    neon.rotation.y = Math.PI / 2;
    const neonLight = new THREE.PointLight(0xffb21a, 1.2, 5, 2); neonLight.position.set(-2.4, 2.7, -11); scene.add(neonLight);

    /* =============== ARENA SHELL (x ±30, z -24 → -88, h 16) =============== */
    const H = 16;
    const front = scaleUV(new THREE.BoxGeometry(27, H, 0.4), 6, 4);
    mesh(front, darkWallMat, -16.5, H / 2, -24.2);
    mesh(front.clone(), darkWallMat, 16.5, H / 2, -24.2);
    mesh(new THREE.BoxGeometry(6, H - 4, 0.4), darkWallMat, 0, 4 + (H - 4) / 2, -24.2);
    const side = scaleUV(new THREE.PlaneGeometry(64, H), 14, 4);
    const sl = mesh(side, darkWallMat, -30, H / 2, -56); sl.rotation.y = Math.PI / 2;
    const sr = mesh(side.clone(), darkWallMat, 30, H / 2, -56); sr.rotation.y = -Math.PI / 2;
    mesh(scaleUV(new THREE.PlaneGeometry(60, H), 14, 4), darkWallMat, 0, H / 2, -88);
    const ceil = mesh(new THREE.PlaneGeometry(60, 64), blackMat, 0, H, -56); ceil.rotation.x = Math.PI / 2;
    for (let z = -30; z >= -82; z -= 8) box(60, 0.5, 0.5, metalMat, 0, H - 1.2, z);

    /* =============== COURT =============== */
    const CW = 15, CL = 28, CZ = -54, PX = 68;
    const courtTex = tex(CW * PX, CL * PX, (g, w, h) => {
      const m = (v) => v * PX;
      g.fillStyle = '#b8783f'; g.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 9) {
        const v = rnd(-18, 18);
        g.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 220 : 0},${v > 0 ? 170 : 0},${Math.abs(v) / 160})`;
        g.fillRect(x, 0, 9, h);
        for (let y = rnd(0, 300); y < h; y += rnd(160, 420)) { g.fillStyle = 'rgba(60,30,10,.35)'; g.fillRect(x, y, 9, 2); }
        g.fillStyle = 'rgba(70,35,10,.25)'; g.fillRect(x, 0, 1, h);
      }
      const keyW = m(4.9), keyL = m(5.8), bx = w / 2;
      // painted keys + centre circle
      g.fillStyle = 'rgba(214,82,24,.92)';
      g.fillRect(bx - keyW / 2, 0, keyW, keyL); g.fillRect(bx - keyW / 2, h - keyL, keyW, keyL);
      g.beginPath(); g.arc(bx, h / 2, m(1.8), 0, 7); g.fill();
      g.strokeStyle = '#dcd5c8'; g.lineWidth = 5;
      g.strokeRect(3, 3, w - 6, h - 6);
      g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
      g.beginPath(); g.arc(bx, h / 2, m(1.8), 0, 7); g.stroke();
      [[0, 1], [h, -1]].forEach(([base, d]) => {
        const by = base + d * m(1.575);
        g.strokeRect(bx - keyW / 2, d > 0 ? 0 : h - keyL, keyW, keyL);
        g.beginPath(); g.arc(bx, base + d * keyL, m(1.8), 0, 7); g.stroke();
        g.beginPath(); g.arc(bx, by, m(1.25), d > 0 ? 0 : Math.PI, d > 0 ? Math.PI : Math.PI * 2); g.stroke();
        // three-point line
        const cx = m(6.6), r = m(6.75);
        const yMeet = by + d * Math.sqrt(r * r - cx * cx);
        g.beginPath(); g.moveTo(bx - cx, base); g.lineTo(bx - cx, yMeet); g.stroke();
        g.beginPath(); g.moveTo(bx + cx, base); g.lineTo(bx + cx, yMeet); g.stroke();
        const a = Math.acos(cx / r);
        g.beginPath();
        if (d > 0) g.arc(bx, by, r, a, Math.PI - a); else g.arc(bx, by, r, Math.PI + a, Math.PI * 2 - a);
        g.stroke();
      });
      drawLogo(g, bx, h / 2 + m(0.35), m(1.6), false, '#f4f0e8');
      // sideline wordmarks
      g.save(); g.translate(m(0.55), h / 2); g.rotate(-Math.PI / 2);
      g.fillStyle = 'rgba(20,10,4,.55)'; g.textAlign = 'center'; g.font = `italic 800 ${m(0.7)}px "Barlow Condensed"`; spaced(g, 'HOOP READY', 0, m(0.25), 12); g.restore();
    });
    const court = mesh(new THREE.PlaneGeometry(CW, CL), std({ map: courtTex, roughness: 0.34, metalness: 0.05 }), 0, 0.012, CZ);
    court.rotation.x = -Math.PI / 2; court.receiveShadow = true;
    const apron = mesh(new THREE.PlaneGeometry(CW + 4, CL + 5), std({ color: 0x1c130d, roughness: 0.5 }), 0, 0.008, CZ);
    apron.rotation.x = -Math.PI / 2; apron.receiveShadow = true;

    // court lights (what actually lights the floor)
    [[-4, -46], [4, -46], [-4, -62], [4, -62]].forEach(([x, z], i) => {
      spot(0xfff2e0, 2.1, 42, 0.45, 0.85, [x * 1.4, 15, z], [x * 0.6, 0, z], i === 1 || i === 2);
    });
    // soft fill on the stands so the crowd reads
    [-1, 1].forEach(sx => spot(0xffe0c0, 1.6, 34, 0.95, 1, [sx * 4, 14.5, CZ], [sx * 15, 2.5, CZ]));

    // lighting rig: trusses over the sidelines, fixtures throwing visible cones onto the court
    const trussMat = std({ color: 0x262626, roughness: 0.45, metalness: 0.85 });
    [-8.6, 8.6].forEach(tx => {
      [[-0.22, 14.45], [0.22, 14.45], [-0.22, 14.0], [0.22, 14.0]].forEach(([dx, y]) => box(0.06, 0.06, 35, trussMat, tx + dx, y, CZ));
      for (let z = CZ - 17; z <= CZ + 17; z += 0.9) box(0.03, 0.5, 0.03, trussMat, tx + (Math.round(z) % 2 ? 0.22 : -0.22), 14.22, z);
      box(0.04, H - 14.4, 0.04, trussMat, tx, (H + 14.4) / 2, CZ - 12); box(0.04, H - 14.4, 0.04, trussMat, tx, (H + 14.4) / 2, CZ + 12);
    });
    [CZ - 17.5, CZ + 17.5].forEach(z => [[14.45], [14.0]].forEach(([y]) => box(17.6, 0.06, 0.06, trussMat, 0, y, z)));
    for (let k = 0; k < 6; k++) {
      const z = CZ - 12.5 + k * 5;
      [-1, 1].forEach(sx => {
        const show = k === 1 || k === 4;              // visible cones only over centre court
        const warm = !(k === 4 && sx > 0);            // one orange accent beam
        beam([sx * 8.6, 13.75, z], [-sx * (1.5 + (k % 3) * 1.6), 0, z + (k % 2 ? 2.5 : -2.5)], 2.5, warm ? 0xfff1dc : 0xff7a3a, 0.16,
             show ? { fixture: true, poolK: 0.35 } : { fixture: true, cone: false, pool: false });
      });
    }
    // straight-down key lights over each basket and centre court
    [CZ - 10.5, CZ, CZ + 10.5].forEach(z => {
      box(1.0, 0.25, 1.0, fixtureMat, 0, 15.6, z);
      const l = mesh(new THREE.PlaneGeometry(0.9, 0.9), glow({ color: 0xfff6ea }, 7), 0, 15.46, z); l.rotation.x = Math.PI / 2;
    });

    /* hoops */
    const boardTex = tex(256, 150, (g, w, h) => {
      g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#fff'; g.lineWidth = 8; g.strokeRect(4, 4, w - 8, h - 8);
      g.lineWidth = 6; g.strokeRect(w * 0.34, h * 0.42, w * 0.32, h * 0.45);
    });
    const boardMat = new THREE.MeshStandardMaterial({ map: boardTex, transparent: true, roughness: 0.4, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false });
    const rimMat = std({ color: 0xff4a12, roughness: 0.4, metalness: 0.5 });
    const netMat = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.75 });
    const padMat = std({ color: 0x151515, roughness: 0.7 });
    function hoop(zBase, d, opts = {}) {
      const { x = 0, rotY = 0, board = 1.2, stanchion = true } = opts;
      const grp = new THREE.Group(); scene.add(grp);
      grp.position.set(x, 0, zBase); grp.rotation.y = rotY;
      box(1.8, 1.05, 0.05, boardMat, 0, 3.4, d * board, grp);
      const rim = mesh(new THREE.TorusGeometry(0.23, 0.018, 8, 32), rimMat, 0, 3.05, d * (board + 0.38), grp);
      rim.rotation.x = Math.PI / 2;
      mesh(new THREE.CylinderGeometry(0.23, 0.14, 0.42, 12, 3, true), netMat, 0, 2.84, d * (board + 0.38), grp);
      if (stanchion) {
        const base = box(1.2, 1.1, 1.8, padMat, 0, 0.55, -d * 1.4, grp); base.castShadow = true;
        box(1.22, 0.12, 1.82, orangeMat, 0, 0.9, -d * 1.4, grp);
        box(0.18, 3.1, 0.18, metalMat, 0, 2.6, -d * 1.4, grp);
        box(0.14, 0.14, 2.6, metalMat, 0, 3.6, -d * 0.1, grp);
      }
      return grp;
    }
    hoop(CZ + CL / 2, -1);
    hoop(CZ - CL / 2, 1);

    /* center-hung scoreboard */
    const sbTex = tex(512, 300, (g, w, h) => {
      g.fillStyle = '#050505'; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,255,255,.04)';
      for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1);
      g.textAlign = 'center';
      g.fillStyle = '#9a9a9a'; g.font = '600 34px "Barlow Condensed"'; g.fillText('HOME', w * 0.22, 60); g.fillText('AWAY', w * 0.78, 60);
      g.fillStyle = ORANGE; g.font = '800 130px "Barlow Condensed"'; g.fillText('77', w * 0.22, 190);
      g.fillStyle = '#ffffff'; g.fillText('74', w * 0.78, 190);
      g.fillStyle = '#ffb21a'; g.font = '700 56px "Barlow Condensed"'; g.fillText('Q4', w / 2, 120); g.fillText('0:42', w / 2, 180);
      g.fillStyle = '#d0d0d0'; g.font = '600 26px "Barlow Condensed"'; spaced(g, 'HOOP READY · CHAMPIONSHIP', w / 2, 262, 3);
    });
    const sbScreen = glow({ map: sbTex }, 2.2);
    const sbSide = std({ color: 0x111111, roughness: 0.5, metalness: 0.6 });
    const sb = mesh(new THREE.BoxGeometry(4.6, 2.7, 4.6), [sbScreen, sbScreen, sbSide, sbSide, sbScreen, sbScreen], 0, 10.4, CZ);
    const ringTex = tex(1024, 64, (g, w, h) => {
      g.fillStyle = '#ff5a1f'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#140600'; g.font = 'italic 800 48px "Barlow Condensed"'; g.textBaseline = 'middle';
      for (let x = 0; x < w; x += 340) spaced(g, 'HOOP READY  ●', x + 10, h / 2 + 2, 4);
    });
    box(4.8, 0.32, 4.8, glow({ map: ringTex }, 2.2), 0, 8.9, CZ);
    [-1.8, 1.8].forEach(x => [-1.8, 1.8].forEach(z => box(0.03, 4.3, 0.03, metalMat, x, 13.8, CZ + z)));
    const sbLight = new THREE.PointLight(0xff7a3a, 1.1, 12, 2); sbLight.position.set(0, 8.2, CZ); scene.add(sbLight);

    /* =============== STANDS, SEATS + CROWD =============== */
    const stepMat = std({ map: concreteTex, color: 0x2a2a2a, roughness: 0.85 });
    const crowd = [], seats = [];
    function stand(cfg) {
      const { x0, z0, len, dirX, dirZ, rows } = cfg; // dirX/dirZ: direction the stand rises away from the court
      const along = dirX !== 0;
      const rotY = along ? -dirX * Math.PI / 2 : (dirZ < 0 ? 0 : Math.PI);
      for (let r = 0; r < rows; r++) {
        const top = (r + 1) * 0.45, off = r * 0.9 + 0.45;
        const cx = x0 + dirX * off, cz = z0 + dirZ * off;
        box(along ? 0.9 : len, top, along ? len : 0.9, stepMat, cx, top / 2, cz);
        const n = Math.floor(len / 0.56);
        for (let i = 0; i < n; i++) {
          const t = -len / 2 + 0.28 + i * 0.56;
          const sx = along ? cx + dirX * 0.1 : cx + t, sz = along ? cz + t : cz + dirZ * 0.1;
          seats.push({ x: sx, y: top, z: sz, rotY, row: r });
          if (Math.random() < (LOW ? 0.5 : 0.12)) continue; // empty seat
          crowd.push({ x: sx + rnd(-0.03, 0.03), y: top, z: sz, rotY: rotY + rnd(-0.22, 0.22), s: rnd(0.92, 1.08),
                       standing: Math.random() < (r < 2 ? 0.5 : 0.16) });
        }
      }
      // LED ribbon board along the front of the stand
      const L = len, geo = scaleUV(new THREE.PlaneGeometry(L, 0.42), L / 9, 1);
      const rb = mesh(geo, ribbonMat, along ? x0 - dirX * 0.01 : x0, 0.23, along ? z0 : z0 - dirZ * 0.01);
      rb.rotation.y = rotY;
    }
    ribbonTex = tex(2048, 96, (g, w, h) => {
      const segs = [['#ff5a1f', '#140600', 'HOOP READY'], ['#0b0b0b', '#ffffff', 'CHAMPIONSHIP 2027'], ['#0b0b0b', '#ff5a1f', 'GET TICKETS'], ['#f2f2f2', '#111111', 'HOOP READY']];
      segs.forEach(([bg, fg, txt], i) => {
        const x = (w / segs.length) * i, sw = w / segs.length;
        g.fillStyle = bg; g.fillRect(x, 0, sw, h);
        g.fillStyle = fg; g.font = 'italic 800 64px "Barlow Condensed"'; g.textAlign = 'center'; g.textBaseline = 'middle';
        spaced(g, txt, x + sw / 2, h / 2 + 3, 6);
      });
      g.fillStyle = 'rgba(0,0,0,.35)'; for (let x = 0; x < w; x += 4) g.fillRect(x, 0, 1, h); // LED pixel grid
    }, { repeat: true });
    const ribbonMat = glow({ map: ribbonTex }, 1.8);
    stand({ x0: 9.6, z0: CZ, len: 30, dirX: 1, dirZ: 0, rows: 11 });
    stand({ x0: -9.6, z0: CZ, len: 30, dirX: -1, dirZ: 0, rows: 11 });
    stand({ x0: 0, z0: CZ - 17.5, len: 18, dirX: 0, dirZ: -1, rows: 10 });

    // seats (instanced)
    const seatGeo = mergeGeos([
      new THREE.BoxGeometry(0.46, 0.06, 0.4).translate(0, 0.39, 0.02),
      new THREE.BoxGeometry(0.46, 0.4, 0.05).translate(0, 0.6, -0.19),
      new THREE.BoxGeometry(0.08, 0.36, 0.26).translate(0, 0.18, -0.05)
    ]);
    const seatMesh = new THREE.InstancedMesh(seatGeo, std({ roughness: 0.6, metalness: 0.1 }), seats.length);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3(), C = new THREE.Color(), YAX = new THREE.Vector3(0, 1, 0);
    seats.forEach((st, i) => {
      Q.setFromAxisAngle(YAX, st.rotY); P.set(st.x, st.y, st.z); S.set(1, 1, 1);
      M.compose(P, Q, S); seatMesh.setMatrixAt(i, M);
      seatMesh.setColorAt(i, C.set(st.row === 0 ? '#c2410c' : (st.row % 4 === 3 ? '#3a1a0c' : '#202020')));
    });
    seatMesh.receiveShadow = false; scene.add(seatMesh);

    /* people: one merged body per pose, coloured + animated per instance in the shader */
    const personSeated = personGeometry(false), personStanding = personGeometry(true);
    const SKIN = ['#3b2417', '#4e3020', '#6b432b', '#8a5a3c', '#a8774f', '#c48d63', '#dcae88', '#ebc6a5'];
    const SHIRT = ['#141414', '#1c1c1c', '#262626', '#333333', '#e9e9e9', '#d4d4d4', '#ff5a1f', '#ff6a2a', '#e04e14', '#1f2d4d', '#22314f', '#5a1a1a', '#6e1212', '#29402a', '#b8941f', '#575757', '#0f3a66', '#4a2a6b', '#ff5a1f', '#ffffff'];
    const PANTS = ['#1b1d24', '#22252e', '#2a3550', '#343a46', '#121212', '#4a3f33', '#5d6470', '#1f2a40'];
    const HAIR = ['#0b0807', '#120c09', '#1c130d', '#2e1d12', '#4a2f1b', '#7a5a33', '#a89f95', '#0b0807', '#0b0807'];
    function crowdLayer(geo, list, pivotY) {
      const n = list.length;
      const mat = crowdMaterial(pivotY);
      const im = new THREE.InstancedMesh(geo, mat, n);
      const aSkin = new Float32Array(n * 3), aShirt = new Float32Array(n * 3), aPants = new Float32Array(n * 3), aHair = new Float32Array(n * 3), aData = new Float32Array(n * 4);
      list.forEach((c, i) => {
        Q.setFromAxisAngle(YAX, c.rotY); P.set(c.x, c.y + 0.42, c.z); S.set(c.s * rnd(0.94, 1.08), c.s, c.s);
        M.compose(P, Q, S); im.setMatrixAt(i, M);
        const v = rnd(0.85, 1.1);
        C.set(pick(SKIN)).multiplyScalar(v).toArray(aSkin, i * 3);
        C.set(pick(SHIRT)).multiplyScalar(v).toArray(aShirt, i * 3);
        C.set(pick(PANTS)).toArray(aPants, i * 3);
        C.set(pick(HAIR)).toArray(aHair, i * 3);
        aData.set([rnd(0, 6.28), c.cheer, c.phone, Math.random()], i * 4);
      });
      geo = im.geometry;
      geo.setAttribute('iSkin', new THREE.InstancedBufferAttribute(aSkin, 3));
      geo.setAttribute('iShirt', new THREE.InstancedBufferAttribute(aShirt, 3));
      geo.setAttribute('iPants', new THREE.InstancedBufferAttribute(aPants, 3));
      geo.setAttribute('iHair', new THREE.InstancedBufferAttribute(aHair, 3));
      geo.setAttribute('iData', new THREE.InstancedBufferAttribute(aData, 4));
      im.frustumCulled = false;
      scene.add(im);
      return im;
    }
    crowd.forEach(c => {
      c.cheer = Math.random() < (c.standing ? 0.55 : 0.18) ? rnd(0.7, 1) : 0;
      c.phone = !c.cheer && Math.random() < 0.09 ? rnd(0.36, 0.46) : 0;
    });
    const seatedList = crowd.filter(c => !c.standing), standingList = crowd.filter(c => c.standing);
    crowdLayer(personSeated.geo, seatedList, personSeated.pivotY);
    crowdLayer(personStanding.geo, standingList, personStanding.pivotY);

    // phones held up (steady screen glow)
    const phonePts = [];
    crowd.forEach(c => { if (c.phone) phonePts.push(...handWorld(c, c.standing ? personStanding : personSeated, c.phone).toArray()); });
    const phoneGeo = new THREE.BufferGeometry(); phoneGeo.setAttribute('position', new THREE.Float32BufferAttribute(phonePts, 3));
    const pgm = new THREE.PointsMaterial({ size: 0.09, map: radialTex, color: 0xcfe0ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    pgm.color.multiplyScalar(3.5);
    phoneGlow = new THREE.Points(phoneGeo, pgm); scene.add(phoneGlow);

    // phone flashes in the crowd
    const flashN = 160, flashPos = new Float32Array(flashN * 3), flashCol = new Float32Array(flashN * 3);
    for (let i = 0; i < flashN; i++) {
      const c = pick(crowd);
      flashPos.set([c.x, c.y + (c.standing ? 1.75 : 1.3), c.z], i * 3);
    }
    const flashGeo = new THREE.BufferGeometry();
    flashGeo.setAttribute('position', new THREE.BufferAttribute(flashPos, 3));
    flashGeo.setAttribute('color', new THREE.BufferAttribute(flashCol, 3));
    const flashMat = new THREE.PointsMaterial({ size: 0.22, map: radialTex, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    flashMat.color.setScalar(6);
    const flashes = new THREE.Points(flashGeo, flashMat);
    scene.add(flashes);

    // championship banners on the back wall
    ['2023', '2024', '2025', '2026'].forEach((yr, i) => {
      const t = tex(256, 560, (g, w, h) => {
        g.fillStyle = i % 2 ? '#141414' : '#ff5a1f'; g.fillRect(0, 0, w, h);
        g.fillStyle = i % 2 ? '#ff5a1f' : '#140600'; g.fillRect(0, h - 70, w, 70);
        g.fillStyle = i % 2 ? '#ffffff' : '#140600'; g.textAlign = 'center';
        drawLogo(g, w / 2, 150, 110, false, i % 2 ? '#e8e8e8' : '#140600');
        g.font = '700 40px "Barlow Condensed"'; spaced(g, 'CHAMPIONS', w / 2, 270, 4);
        g.font = '800 100px "Barlow Condensed"'; g.fillText(yr, w / 2, 390);
      });
      mesh(new THREE.PlaneGeometry(2.2, 4.8), std({ map: t, roughness: 0.8, side: THREE.DoubleSide, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.1 }), -7.5 + i * 5, 11.5, -87.7);
    });

    /* =============== PLAYERS (far end) =============== */
    const players = [];
    const skinPal = ['#5b3a24', '#8a5a3a', '#3e2516', '#c48d63', '#6d4228'];
    const numTexCache = {};
    function numberTex(num, col) {
      const k = num + col;
      if (!numTexCache[k]) numTexCache[k] = tex(128, 128, (g, w, h) => { g.fillStyle = col; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '800 104px "Barlow Condensed"'; g.fillText(num, w / 2, h / 2 + 6); });
      return numTexCache[k];
    }
    function player(jersey, trim, x, z, lookX, lookZ, pose, num = String(1 + ((Math.random() * 34) | 0))) {
      const grp = new THREE.Group(); scene.add(grp);
      const skin = std({ color: pick(skinPal), roughness: 0.55 });
      const jm = std({ color: jersey, roughness: 0.7 });
      const tm = std({ color: trim, roughness: 0.55 });
      const sock = std({ color: 0xf2f2f2, roughness: 0.8 });
      const hairM = std({ color: pick(['#0b0807', '#120c09', '#1c130d']), roughness: 0.9 });
      const cast = (m) => { m.castShadow = true; return m; };
      [-0.11, 0.11].forEach(lx => {
        const shoe = cast(mesh(new THREE.CapsuleGeometry(0.056, 0.17, 4, 10), tm, lx, 0.058, 0.04, grp)); shoe.rotation.x = Math.PI / 2;
        cast(box(0.12, 0.025, 0.29, sock, lx, 0.012, 0.04, grp));
        cast(mesh(new THREE.CylinderGeometry(0.056, 0.052, 0.16, 12), sock, lx, 0.18, 0, grp));
        cast(mesh(capsule(0.062, [lx, 0.24, 0], [lx, 0.5, 0.01]), skin, 0, 0, 0, grp));
        cast(mesh(capsule(0.086, [lx, 0.52, 0.01], [lx, 0.86, 0]), skin, 0, 0, 0, grp));
        cast(mesh(new THREE.CylinderGeometry(0.125, 0.135, 0.3, 14, 1, true), jm, lx * 1.05, 0.74, 0, grp)).material.side = THREE.DoubleSide;
      });
      cast(mesh(new THREE.CylinderGeometry(0.215, 0.235, 0.22, 16), jm, 0, 0.92, 0, grp));
      const jersey3d = new THREE.LatheGeometry([[0, 0], [0.18, 0], [0.19, 0.15], [0.182, 0.3], [0.2, 0.44], [0.215, 0.53], [0.19, 0.59], [0.09, 0.625], [0, 0.635]].map(([a, b]) => new THREE.Vector2(a, b)), 18);
      jersey3d.scale(1, 1, 0.62);
      cast(mesh(jersey3d, jm, 0, 0.94, 0, grp));
      const nt = numberTex(num, trim);
      [1, -1].forEach(f => { const n = mesh(new THREE.PlaneGeometry(0.2, 0.2), new THREE.MeshStandardMaterial({ map: nt, transparent: true, roughness: 0.7, depthWrite: false }), 0, 1.24, f * 0.122, grp); if (f < 0) n.rotation.y = Math.PI; });
      [-1, 1].forEach(sx => cast(mesh(new THREE.SphereGeometry(0.07, 12, 10), skin, sx * 0.215, 1.47, 0, grp)));
      cast(mesh(capsule(0.05, [0, 1.56, 0.01], [0, 1.66, 0.02], 8), skin, 0, 0, 0, grp));
      const head = cast(mesh(new THREE.SphereGeometry(0.112, 18, 14), skin, 0, 1.765, 0.02, grp)); head.scale.set(0.88, 1.08, 0.98);
      const hair = mesh(new THREE.SphereGeometry(0.118, 18, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), hairM, 0, 1.775, 0.008, grp); hair.scale.set(0.9, 1.0, 1.0); hair.rotation.x = -0.25;
      if (Math.random() < 0.5) { const hb = mesh(new THREE.TorusGeometry(0.1, 0.014, 6, 24), tm, 0, 1.8, 0.015, grp); hb.rotation.x = Math.PI / 2 - 0.2; hb.scale.set(0.92, 1, 1); }
      const arms = [-1, 1].map(sx => {
        const sh = new THREE.Group(); sh.position.set(sx * 0.25, 1.46, 0); grp.add(sh);
        cast(mesh(capsule(0.058, [0, 0, 0], [0, -0.3, 0]), skin, 0, 0, 0, sh));
        const el = new THREE.Group(); el.position.set(0, -0.31, 0); sh.add(el);
        cast(mesh(capsule(0.049, [0, 0, 0], [0, -0.26, 0]), skin, 0, 0, 0, el));
        cast(mesh(new THREE.SphereGeometry(0.052, 10, 8), skin, 0, -0.31, 0.01, el));
        sh.userData.elbow = el;
        return sh;
      });
      const elbow = (i, a) => { arms[i].userData.elbow.rotation.x = a; };
      grp.position.set(x, 0, z);
      grp.rotation.y = Math.atan2(lookX - x, lookZ - z);
      const p = { grp, arms, pose, phase: Math.random() * 6, baseY: 0 };
      if (pose === 'dribble') {
        p.ball = null; // set later
        arms[1].rotation.x = -0.35; arms[1].rotation.z = 0.2; elbow(1, -0.7);
        arms[0].rotation.x = -0.75; arms[0].rotation.z = -0.35; elbow(0, -0.9);
      } else if (pose === 'defend') {
        arms[0].rotation.z = -1.05; arms[1].rotation.z = 1.05;
        arms[0].rotation.x = -0.4; arms[1].rotation.x = -0.4; elbow(0, -0.5); elbow(1, -0.5);
        p.baseY = -0.07;
      } else {
        arms[0].rotation.z = -0.12; arms[1].rotation.z = 0.12; elbow(0, -0.25); elbow(1, -0.35);
      }
      players.push(p);
      return p;
    }
    const hoopZ = CZ - CL / 2 + 1.575;
    const dribbler = player('#ff5a1f', '#111111', 1.6, -59.6, 0.2, hoopZ, 'dribble');
    player('#eeeeee', '#ff5a1f', 1.2, -61.1, 1.6, -59.6, 'defend');
    player('#ff5a1f', '#111111', -1.4, -65.2, 0, -60, 'idle');
    player('#eeeeee', '#ff5a1f', -0.8, -66.1, -1.4, -65.2, 'defend');
    player('#ff5a1f', '#111111', 5.2, -64.2, 0, -60, 'idle');
    player('#eeeeee', '#ff5a1f', 4.4, -65.0, 5.2, -64.2, 'defend');

    /* basketball */
    const ballTex = tex(1024, 512, (g, w, h) => {
      g.fillStyle = '#d4601f'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 26000; i++) { g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,.12)' : 'rgba(255,190,120,.10)'; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
      g.strokeStyle = '#1a0c05'; g.lineWidth = 9;
      g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
      [0, w / 2, w].forEach(x => { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); });
      [0.25, 0.75].forEach(k => [-1, 1].forEach(sd => {
        g.beginPath();
        for (let v = 0; v <= 1.001; v += 0.02) {
          const x = w * k + sd * w * 0.11 * Math.sin(Math.PI * v);
          v === 0 ? g.moveTo(x, v * h) : g.lineTo(x, v * h);
        }
        g.stroke();
      }));
    });
    const ballMat = std({ map: ballTex, roughness: 0.65 });
    const ballGeo = new THREE.SphereGeometry(0.12, 32, 20);
    const gameBall = mesh(ballGeo, ballMat, 0, 0.12, 0); gameBall.castShadow = true;
    dribbler.ball = gameBall;

    /* =============== TRAINING AREA (x 14 → 28, z -26 → -38) =============== */
    const mat = mesh(new THREE.PlaneGeometry(11, 11), std({ color: 0x141414, roughness: 0.95 }), 21, 0.01, -32);
    mat.rotation.x = -Math.PI / 2; mat.receiveShadow = true;
    // ball racks
    function rack(x, z) {
      const grp = new THREE.Group(); grp.position.set(x, 0, z); scene.add(grp);
      [-0.95, 0.95].forEach(dz => { box(0.05, 1.2, 0.05, metalMat, -0.25, 0.6, dz, grp); box(0.05, 1.2, 0.05, metalMat, 0.25, 0.6, dz, grp); });
      [0.28, 0.66, 1.04].forEach((y, row) => {
        box(0.04, 0.04, 1.95, metalMat, -0.18, y, 0, grp); box(0.04, 0.04, 1.95, metalMat, 0.18, y, 0, grp);
        for (let i = 0; i < 6; i++) {
          const b = mesh(ballGeo, ballMat, rnd(-0.01, 0.01), y + 0.12, -0.75 + i * 0.3, grp);
          b.rotation.set(rnd(0, 6), rnd(0, 6), 0); b.castShadow = true;
        }
      });
      grp.rotation.y = 0.12;
    }
    rack(17.2, -29.8); rack(17.2, -34.2);
    // wall hoop
    hoop(-32, 1, { x: 29.95, rotY: -Math.PI / 2, board: 0.35, stanchion: false });
    box(0.25, 0.12, 0.12, metalMat, 29.8, 3.4, -32);
    // cones + agility ladder
    const coneMat = std({ color: 0xff6a1f, roughness: 0.6 });
    [[22, -28.5], [24, -30], [22, -31.5], [24, -33], [22, -34.5], [24, -36]].forEach(([x, z]) => {
      const c = mesh(new THREE.ConeGeometry(0.11, 0.3, 14), coneMat, x, 0.15, z); c.castShadow = true;
    });
    for (let i = 0; i < 8; i++) box(0.6, 0.02, 0.04, std({ color: 0xffd21a, roughness: 0.6 }), 19.6, 0.02, -28.4 - i * 0.5);
    [19.3, 19.9].forEach(x => box(0.03, 0.02, 3.7, std({ color: 0xffd21a }), x, 0.02, -30.15));
    // hanging industrial lamps
    const shadeMat = std({ color: 0x2a2a2a, roughness: 0.4, metalness: 0.7, side: THREE.DoubleSide });
    [-29, -32, -35].forEach(z => {
      box(0.015, 9.5, 0.015, metalMat, 20.5, H - 4.75, z);
      const sh = mesh(new THREE.ConeGeometry(0.45, 0.4, 24, 1, true), shadeMat, 20.5, 6.4, z);
      const bulb = mesh(new THREE.CircleGeometry(0.3, 20), glow({ color: 0xffd9a0 }, 7), 20.5, 6.22, z);
      bulb.rotation.x = Math.PI / 2;
      beam([20.5, 6.2, z], [20.5, 0, z], 1.6, 0xffd2a0, 0.4, { cone: false, poolK: 0.3 });
    });
    spot(0xffd2a0, 4.5, 20, 0.75, 0.8, [20.5, 6.6, -32], [20.5, 0, -32], true);
    // wall slogan
    const workTex = tex(1024, 256, (g, w, h) => {
      g.fillStyle = 'rgba(255,255,255,.75)'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = 'italic 800 170px "Barlow Condensed"'; g.fillText('PUT IN THE WORK', w / 2, h / 2);
    });
    const work = mesh(new THREE.PlaneGeometry(9, 2.25), new THREE.MeshStandardMaterial({ map: workTex, transparent: true, roughness: 0.9 }), 29.95, 8, -32);
    work.rotation.y = -Math.PI / 2;

    /* =============== JERSEY WALL (x = -30, z -26 → -38) =============== */
    const jerseys = [
      ['#ff5a1f', '#111', '23', 'ELITE'], ['#f0f0f0', '#ff5a1f', '7', 'KINGS'], ['#111111', '#ffb21a', '1', 'STORM'],
      ['#1d3b8a', '#ffffff', '11', 'METRO'], ['#7a0f12', '#ffffff', '30', 'HEAT']
    ];
    jerseys.forEach(([col, trim, num, name], i) => {
      const z = -27.4 - i * 2.2;
      const t = tex(512, 640, (g, w, h) => {
        g.fillStyle = '#0e0e0e'; g.fillRect(0, 0, w, h);
        g.fillStyle = '#1a1a1a'; g.fillRect(26, 26, w - 52, h - 52);
        const cx = w / 2;
        g.beginPath();
        g.moveTo(cx - 70, 90); g.quadraticCurveTo(cx, 165, cx + 70, 90);
        g.lineTo(cx + 125, 90); g.quadraticCurveTo(cx + 132, 200, cx + 188, 238);
        g.lineTo(cx + 178, 572); g.lineTo(cx - 178, 572); g.lineTo(cx - 188, 238);
        g.quadraticCurveTo(cx - 132, 200, cx - 125, 90); g.closePath();
        g.fillStyle = col; g.fill(); g.lineWidth = 12; g.strokeStyle = trim; g.stroke();
        g.fillStyle = trim; g.textAlign = 'center';
        g.font = '700 46px "Barlow Condensed"'; spaced(g, name, cx, 270, 6);
        g.font = '800 210px "Barlow Condensed"'; g.fillText(num, cx, 480);
      });
      const frame = box(0.08, 1.95, 1.6, std({ color: 0x0a0a0a, roughness: 0.4, metalness: 0.5 }), -29.92, 2.7, z);
      const pic = mesh(new THREE.PlaneGeometry(1.45, 1.8), std({ map: t, roughness: 0.35, metalness: 0.1 }), -29.86, 2.7, z);
      pic.rotation.y = Math.PI / 2;
      box(0.14, 0.1, 0.22, metalMat, -29.75, 4.1, z);
      const lens = mesh(new THREE.CircleGeometry(0.07, 16), glow({ color: 0xfff6e8 }, 8), -29.75, 4.045, z); lens.rotation.x = Math.PI / 2;
      const wash = mesh(new THREE.PlaneGeometry(1.7, 1.5), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff1df).multiplyScalar(0.16), map: radialTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), -29.84, 3.45, z);
      wash.rotation.y = Math.PI / 2; wash.renderOrder = 4; // picture-light wash on the wall
    });
    spot(0xffffff, 3.2, 18, 0.7, 0.6, [-24.5, 7.5, -31.8], [-29.8, 2.6, -31.8], false);
    // trophy on a plinth
    box(0.7, 1.1, 0.7, std({ color: 0x0f0f0f, roughness: 0.4 }), -28.4, 0.55, -31.8);
    const gold = shine(std({ color: 0xc9971a, roughness: 0.3, metalness: 0.9 }), 0.55);
    const cupPts = [[0, 0], [0.16, 0], [0.16, 0.05], [0.06, 0.08], [0.04, 0.25], [0.1, 0.3], [0.2, 0.45], [0.22, 0.62], [0.2, 0.63], [0.0, 0.5]].map(([x, y]) => new THREE.Vector2(x, y));
    const cup = mesh(new THREE.LatheGeometry(cupPts, 32), gold, -28.4, 1.1, -31.8); cup.castShadow = true;
    mesh(new THREE.SphereGeometry(0.12, 24, 16), ballMat, -28.4, 1.85, -31.8);
    const tl2 = new THREE.PointLight(0xffd88a, 0.8, 4, 2); tl2.position.set(-27.6, 2.4, -31.2); scene.add(tl2);

    /* =============== LOCKER BENCH + PHONE (signup) =============== */
    const BX = 6.2, BZ = -30.6;
    const woodTex = tex(512, 128, (g, w, h) => {
      g.fillStyle = '#a06a3a'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 90; i++) { g.strokeStyle = `rgba(60,30,10,${rnd(0.08, 0.3)})`; g.lineWidth = rnd(1, 3); g.beginPath(); const y = rnd(0, h); g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + rnd(-8, 8), w * 0.6, y + rnd(-8, 8), w, y + rnd(-6, 6)); g.stroke(); }
    });
    const woodMat = std({ map: woodTex, roughness: 0.55 });
    [-0.17, 0, 0.17].forEach(dz => { const p = box(2.6, 0.05, 0.15, woodMat, BX, 0.5, BZ + dz); p.castShadow = p.receiveShadow = true; });
    [-1.1, 1.1].forEach(dx => {
      box(0.05, 0.48, 0.05, metalMat, BX + dx, 0.24, BZ - 0.2); box(0.05, 0.48, 0.05, metalMat, BX + dx, 0.24, BZ + 0.2);
      box(0.05, 0.05, 0.45, metalMat, BX + dx, 0.06, BZ);
    });
    const bball = mesh(ballGeo, ballMat, BX + 0.5, 0.645, BZ - 0.04); bball.scale.setScalar(1); bball.castShadow = true; bball.rotation.set(0.4, 1.2, 0);
    const towel = box(0.42, 0.035, 0.3, std({ color: 0xdedede, roughness: 1 }), BX + 1.0, 0.542, BZ + 0.02); towel.rotation.y = 0.2; towel.castShadow = true;
    const bottle = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 16), std({ color: 0x111111, roughness: 0.35, metalness: 0.6 }), BX - 0.9, 0.635, BZ - 0.1); bottle.castShadow = true;
    mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.035, 16), orangeMat, BX - 0.9, 0.762, BZ - 0.1);
    // phone
    const phoneTex = tex(360, 740, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#141414'); gr.addColorStop(1, '#050505');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.fillStyle = '#bbb'; g.font = '600 18px Barlow'; g.fillText('9:41', 24, 34);
      drawLogo(g, w / 2, 320, 110);
      g.fillStyle = '#9a9a9a'; g.textAlign = 'center'; g.font = '600 15px "Barlow Condensed"'; spaced(g, 'THE BASKETBALL TOURNAMENT PLATFORM', w / 2, 420, 2);
      g.fillStyle = ORANGE; g.fillRect(28, 560, w - 56, 52);
      g.fillStyle = '#140600'; g.font = '700 22px "Barlow Condensed"'; spaced(g, 'REGISTER TEAM', w / 2, 594, 3);
      g.strokeStyle = '#555'; g.lineWidth = 2; g.strokeRect(28, 628, (w - 66) / 2, 46); g.strokeRect(w / 2 + 5, 628, (w - 66) / 2, 46);
      g.fillStyle = '#ddd'; g.font = '600 18px "Barlow Condensed"'; spaced(g, 'SCHEDULE', 28 + (w - 66) / 4, 657, 2); spaced(g, 'BRACKETS', w / 2 + 5 + (w - 66) / 4, 657, 2);
    });
    const phone = new THREE.Group(); phone.position.set(BX + 0.12, 0.528, BZ + 0.02); phone.rotation.y = 0.45; scene.add(phone);
    box(0.09, 0.009, 0.185, std({ color: 0x0b0b0b, roughness: 0.35, metalness: 0.8 }), 0, 0, 0, phone).castShadow = true;
    const scr = mesh(new THREE.PlaneGeometry(0.082, 0.172), glow({ map: phoneTex }, 1.5), 0, 0.0052, 0, phone);
    scr.rotation.x = -Math.PI / 2;
    spot(0xe6eeff, 4, 10, 0.4, 0.85, [BX, 5.5, BZ + 0.6], [BX, 0.5, BZ], true);
    beam([BX, 5.4, BZ + 0.6], [BX, 0.5, BZ], 1.25, 0xe6eeff, 0.15, { poolY: 0.53, poolK: 0.12 });

    /* =============== DUST (glitters where it crosses a light beam) =============== */
    const dustN = LOW ? 2200 : 5200, dp = new Float32Array(dustN * 3), seed = new Float32Array(dustN);
    for (let i = 0; i < dustN; i++) {
      const zone = Math.random();
      if (zone < 0.14) dp.set([rnd(-5, 5), rnd(0, 7), rnd(-1, 8)], i * 3);
      else if (zone < 0.26) dp.set([rnd(-3, 3), rnd(0, 4), rnd(-24, 0)], i * 3);
      else if (zone < 0.72) dp.set([rnd(-10, 10), rnd(0, 15), rnd(-72, -36)], i * 3);
      else dp.set([rnd(-30, 30), rnd(0, 12), rnd(-40, -24)], i * 3);
      seed[i] = Math.random();
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dp, 3));
    dustGeo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const NB = 32, bA = [], bD = [], bP = [];
    for (let i = 0; i < NB; i++) {
      const b = BEAMS[i];
      bA.push(b ? b.a : new THREE.Vector3(0, -999, 0)); bD.push(b ? b.dir : new THREE.Vector3(0, -1, 0)); bP.push(b ? new THREE.Vector3(b.len, b.r0, b.r1) : new THREE.Vector3(0, 0, 0));
    }
    const dust = new THREE.Points(dustGeo, new THREE.ShaderMaterial({
      defines: { NB },
      uniforms: { uTime: U_TIME, uMap: { value: radialTex }, bA: { value: bA }, bD: { value: bD }, bP: { value: bP }, uScale: { value: renderer.getPixelRatio() } },
      vertexShader: `
        attribute float aSeed; uniform float uTime; uniform float uScale;
        uniform vec3 bA[NB]; uniform vec3 bD[NB]; uniform vec3 bP[NB];
        varying float vLit; varying float vA;
        void main(){
          vec3 p = position;
          p += vec3(sin(uTime * 0.13 + aSeed * 6.28), sin(uTime * 0.09 + aSeed * 12.0), cos(uTime * 0.11 + aSeed * 9.0)) * 0.4;
          float lit = 0.0;
          for (int i = 0; i < NB; i++) {
            vec3 d = p - bA[i]; float t = dot(d, bD[i]);
            if (t > 0.0 && t < bP[i].x) {
              float r = length(d - bD[i] * t); float R = mix(bP[i].y, bP[i].z, t / bP[i].x);
              lit += smoothstep(R, R * 0.25, r) * (1.0 - 0.65 * t / bP[i].x);
            }
          }
          vLit = min(lit, 1.6);
          float tw = 0.6 + 0.4 * sin(uTime * (1.5 + aSeed * 3.0) + aSeed * 40.0);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = uScale * (0.02 + 0.03 * aSeed) * (0.7 + vLit) * (420.0 / -mv.z);
          vA = smoothstep(0.25, 1.8, -mv.z) * tw;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D uMap; varying float vLit; varying float vA;
        void main(){
          float m = texture2D(uMap, gl_PointCoord).a;
          gl_FragColor = vec4(vec3(1.0, 0.93, 0.82) * (0.05 + vLit * 2.2) * m * vA, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    }));
    dust.frustumCulled = false;
    scene.add(dust);

    return { doorL, doorR, players, dribbler, flashes, flashCol, flashN, dust };
  }

  /* =====================================================================
     CAMERA PATH — t = chapter number. pos / look target / horizontal
     view offset (pushes the subject right so the copy on the left is clear)
     ===================================================================== */
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const KEYS = [
    { t: 0.00, p: V(0, 1.75, 13.5), l: V(0, 2.7, 0), o: 0.0 },        // 00 entrance
    { t: 0.45, p: V(0, 1.7, 3.2), l: V(0, 1.7, -8), o: 0.02 },
    { t: 0.75, p: V(0, 1.7, -2.5), l: V(0.6, 1.75, -12), o: 0.06 },
    { t: 1.00, p: V(-1.2, 1.7, -4.5), l: V(1.5, 1.85, -15), o: 0.12 }, // 01 tunnel
    { t: 1.45, p: V(0, 2.0, -19), l: V(0, 1.6, -34), o: 0.08 },
    { t: 1.70, p: V(-1, 2.6, -26.5), l: V(-2, 1.8, -42), o: 0.1 },
    { t: 2.00, p: V(-12, 6.8, -33), l: V(-1, 0.4, -51), o: 0.15 },    // 02 the court
    { t: 2.50, p: V(-9, 3.4, -48), l: V(0, 1.2, -60), o: 0.14 },
    { t: 3.00, p: V(-5.2, 1.65, -55.6), l: V(1.6, 1.3, -62.6), o: 0.15 }, // 03 matchups
    { t: 3.50, p: V(2, 3.2, -44), l: V(14, 1.6, -36), o: 0.12 },
    { t: 4.00, p: V(11.2, 1.8, -27.6), l: V(21.5, 1.4, -33.2), o: 0.13 }, // 04 training
    { t: 4.50, p: V(-4, 2.8, -27.4), l: V(-20, 2.2, -31), o: 0.1 },
    { t: 5.00, p: V(-21.5, 2.3, -28.3), l: V(-29.6, 2.4, -32.2), o: 0.13 }, // 05 teams (jersey wall)
    { t: 5.50, p: V(-10, 8.5, -26.2), l: V(-2, 3, -50), o: 0.1 },
    { t: 6.00, p: V(0, 12.5, -25.4), l: V(0, 4.2, -57), o: 0.1 },     // 06 events
    { t: 6.50, p: V(5, 4.6, -26.6), l: V(6.2, 0.6, -30.8), o: 0.15 },
    { t: 7.00, p: V(5.75, 1.4, -29.2), l: V(6.45, 0.5, -30.62), o: 0.17 } // 07 who it's for
  ];
  function cr(p0, p1, p2, p3, s, out) {
    const s2 = s * s, s3 = s2 * s;
    return out.set(
      0.5 * (2 * p1.x + (-p0.x + p2.x) * s + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * s2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * s3),
      0.5 * (2 * p1.y + (-p0.y + p2.y) * s + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * s2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * s3),
      0.5 * (2 * p1.z + (-p0.z + p2.z) * s + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * s2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * s3)
    );
  }
  const _p = V(0, 0, 0), _l = V(0, 0, 0);
  function sample(t) {
    t = Math.max(0, Math.min(KEYS[KEYS.length - 1].t, t));
    let j = 0;
    while (j < KEYS.length - 2 && t > KEYS[j + 1].t) j++;
    const a = KEYS[Math.max(0, j - 1)], b = KEYS[j], c = KEYS[j + 1], d = KEYS[Math.min(KEYS.length - 1, j + 2)];
    const s = (t - b.t) / (c.t - b.t);
    cr(a.p, b.p, c.p, d.p, s, _p);
    cr(a.l, b.l, c.l, d.l, s, _l);
    return { p: _p, l: _l, o: b.o + (c.o - b.o) * s };
  }

  /* ---------------- resize ---------------- */
  let W = 0, Hh = 0;
  let composer = null, bloom = null, gradePass = null;
  const GRADE_SHADER = {
    uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uExposure: { value: 1.05 }, uRes: { value: new THREE.Vector2(1, 1) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform float uTime; uniform float uExposure; uniform vec2 uRes; varying vec2 vUv;
      vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
      vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
      void main(){
        vec2 d = vUv - 0.5; float ca = dot(d, d) * 0.012;
        vec3 col = vec3(texture2D(tDiffuse, vUv - d * ca).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv + d * ca).b);
        col = aces(col * uExposure);
        float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = mix(col, col * vec3(0.9, 0.97, 1.08), (1.0 - l) * 0.3);   // cool shadows
        col = mix(col, col * vec3(1.06, 1.0, 0.92), l * 0.25);          // warm highlights
        col = toSRGB(col);
        col *= mix(0.62, 1.0, smoothstep(0.9, 0.3, length(d * vec2(1.0, 0.85))));
        float g = fract(sin(dot(vUv * uRes + fract(uTime) * 91.7, vec2(12.9898, 78.233))) * 43758.5453);
        col += (g - 0.5) * 0.03;
        gl_FragColor = vec4(col, 1.0);
      }`
  };
  const SANITIZE_SHADER = { // replaces NaN / infinite pixels so the glow blur can't smear them into black blocks
    uniforms: { tDiffuse: { value: null } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform sampler2D tDiffuse; varying vec2 vUv;
      void main(){
        vec3 c = texture2D(tDiffuse, vUv).rgb;
        #if __VERSION__ >= 300
          if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
        #else
          if (!(c.r == c.r) || !(c.g == c.g) || !(c.b == c.b)) c = vec3(0.0);
        #endif
        gl_FragColor = vec4(clamp(c, 0.0, 24.0), 1.0);
      }`
  };
  function framebufferOK(t) {
    const gl = renderer.getContext();
    while (gl.getError() !== gl.NO_ERROR) { /* clear old errors */ }
    renderer.setRenderTarget(t); renderer.clear();
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE && gl.getError() === gl.NO_ERROR;
    renderer.setRenderTarget(null);
    return ok;
  }
  function setupPost() {
    try {
      if (LITE || !THREE.EffectComposer || !THREE.UnrealBloomPass) return;
      const gl2 = renderer.capabilities.isWebGL2, ext = renderer.extensions;
      const canHalf = gl2 ? (ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float'))
                          : (ext.has('OES_texture_half_float') && ext.has('EXT_color_buffer_half_float'));
      if (!canHalf) return; // GPU can't render HDR targets → keep the plain renderer
      let rt = null;
      for (const samples of (gl2 ? [4, 0] : [0])) {
        const t = new THREE.WebGLRenderTarget(64, 64, { type: THREE.HalfFloatType, stencilBuffer: true /* 24-bit depth */, samples });
        if (framebufferOK(t)) { rt = t; break; }
        t.dispose();
      }
      if (!rt) return;
      composer = new THREE.EffectComposer(renderer, rt);
      composer.addPass(new THREE.RenderPass(scene, camera));
      composer.addPass(new THREE.ShaderPass(SANITIZE_SHADER));
      bloom = new THREE.UnrealBloomPass(new THREE.Vector2(256, 256), 0.85, 0.6, 1.45);
      composer.addPass(bloom);
      gradePass = new THREE.ShaderPass(GRADE_SHADER);
      composer.addPass(gradePass);
      renderer.toneMapping = THREE.NoToneMapping; // the grade pass does tone mapping
      // make sure the bloom's own buffers work too; otherwise drop back to the plain renderer
      resize(); composer.render(0.016);
      const gl = renderer.getContext();
      if (gl.getError() !== gl.NO_ERROR) throw new Error('post-processing failed on this GPU');
    } catch (e) {
      composer = null; bloom = null; gradePass = null;
      renderer.setRenderTarget(null);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
    }
    window.__hrMode = composer ? 'full' : (LITE ? 'lite' : 'basic');
  }
  function resize() {
    W = innerWidth; Hh = innerHeight;
    renderer.setSize(W, Hh, false);
    if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(W, Hh); gradePass.uniforms.uRes.value.set(W, Hh); }
    camera.aspect = W / Hh;
    camera.fov = W / Hh < 0.8 ? 64 : 50;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);

  /* ---------------- start ---------------- */
  const fontLoads = ['italic 800 100px "Barlow Condensed"', '800 100px "Barlow Condensed"', '700 100px "Barlow Condensed"', '600 100px "Barlow Condensed"', 'italic 700 100px "Barlow Condensed"']
    .map(f => document.fonts ? document.fonts.load(f) : Promise.resolve());
  const timeout = new Promise(r => setTimeout(r, 3000));

  Promise.race([Promise.all(fontLoads), timeout]).then(() => {
    const W0 = build();
    setupPost();
    resize();
    let cur = window.__hrT || 0;
    let last = performance.now();
    const clock = new THREE.Clock();
    let flashTimer = 0, perfFrames = 0, perfTime = -1, quality = window.__hrSnap ? 0 : 2;

    function frame(now) {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const time = clock.getElapsedTime();
      U_TIME.value = time;
      if (ribbonTex) ribbonTex.offset.x = (time * 0.035) % 1;
      const target = window.__hrT || 0;
      cur += (target - cur) * Math.min(1, dt * 3.2);
      if (window.__hrSnap) cur = target; // testing: jump straight to the scroll position
      if (Math.abs(target - cur) < 0.0005) cur = target;

      const s = sample(cur);
      // subtle handheld drift + mouse parallax
      const mx = (window.__hrMouseX || 0), my = (window.__hrMouseY || 0);
      camera.position.set(s.p.x + Math.sin(time * 0.35) * 0.04 + mx * 0.12, s.p.y + Math.sin(time * 0.5) * 0.03 - my * 0.06, s.p.z);
      camera.lookAt(s.l.x + mx * 0.25, s.l.y - my * 0.15, s.l.z);
      const off = W > 900 ? s.o : 0;
      if (off) camera.setViewOffset(W, Hh, -W * off, 0, W, Hh); else camera.clearViewOffset();

      // doors open as camera approaches
      const open = Math.min(1, Math.max(0, (9 - s.p.z) / 6.5));
      const e = open * open * (3 - 2 * open);
      W0.doorL.rotation.y = e * 1.45;
      W0.doorR.rotation.y = -e * 1.45;

      // players
      W0.players.forEach(p => {
        const k = time * 2 + p.phase;
        if (p.pose === 'dribble') {
          const b = Math.abs(Math.sin(time * 4.6));
          p.grp.position.y = Math.sin(time * 9.2) * 0.012;
          p.arms[1].rotation.x = -0.25 - b * 0.3; p.arms[1].userData.elbow.rotation.x = -0.5 - b * 0.4;
          const local = new THREE.Vector3(0.33, 0.12 + b * 0.7, 0.3);
          p.grp.localToWorld(local);
          p.ball.position.copy(local);
          p.ball.rotation.x += dt * 4;
        } else if (p.pose === 'defend') {
          p.grp.position.y = p.baseY + Math.sin(k * 2) * 0.02;
          p.arms[0].rotation.z = -1.0 - Math.sin(k) * 0.12;
          p.arms[1].rotation.z = 1.0 + Math.sin(k + 1) * 0.12;
        } else {
          p.grp.position.y = Math.sin(k) * 0.01;
          p.arms[0].rotation.x = Math.sin(k * 0.7) * 0.1;
        }
      });

      // crowd phone flashes
      flashTimer += dt;
      if (flashTimer > 0.08) {
        flashTimer = 0;
        const c = W0.flashCol;
        for (let i = 0; i < W0.flashN; i++) {
          const v = Math.random() < 0.025 ? 1 : c[i * 3] * 0.6;
          c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = v;
        }
        W0.flashes.geometry.attributes.color.needsUpdate = true;
      }
      if (composer) { gradePass.uniforms.uTime.value = time; composer.render(dt); }
      else renderer.render(scene, camera);

      // adaptive quality: if the device struggles, render fewer pixels / drop shadows
      perfFrames++; perfTime += dt;
      if (perfTime > 2 && quality > 0) {
        const fps = perfFrames / perfTime; perfFrames = 0; perfTime = 0;
        if (fps < 40 && quality === 2) { quality = 1; renderer.setPixelRatio(1); resize(); }
        else if (fps < 26 && quality === 1) {
          quality = 0; renderer.shadowMap.enabled = false;
          if (bloom) bloom.strength = 0.6, bloom.resolution.set(128, 128);
          scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => m.needsUpdate = true); });
        }
      }
      if (window.__hrSnap) setTimeout(() => requestAnimationFrame(frame), 2500); // testing only: slow software renderers
      else requestAnimationFrame(frame);
    }
    renderer.compile(scene, camera);
    requestAnimationFrame((t) => { last = t; frame(t); done(); });
  });
})();
