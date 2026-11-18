import ForceGraph3D from '3d-force-graph';
import * as THREE from 'three';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { forceX, forceY, forceZ } from 'd3-force-3d';
import { TYPES, PICKABLE, typeOf, glyphSVG, glyphInner } from './devices.js';
import { initControl, renderControlTab, bindControlTab, openPalette, closePalette, paletteOpen, openContextMenu, closeContextMenu, contextOpen, toast } from './control.js';

// ------------------------------------------------------------------------------------
// Look & layout
// ------------------------------------------------------------------------------------

const COLORS = {
  core: '#ffffff', entertainment: '#f1e3c0', assistants: '#dce5f2', personal: '#ececea',
  security: '#efd29a', home: '#d2e8d5', unknown: '#e05a52', ble: '#7f8998', internet: '#b7a679',
};
const TRACKER = '#d9846b';

const ANCHORS = {
  core: [0, 0, 0], entertainment: [165, 70, -30], assistants: [-40, 165, 50], personal: [-175, -10, 70],
  security: [50, -160, -70], home: [140, -70, 135], unknown: [-110, -130, -120], ble: [-200, 90, -120],
};
const EXT_RADIUS = 400;     // internet shell
const HOME_RADIUS = 292;    // the bubble that encloses the house
const OVERVIEW = { x: 290, y: 175, z: 1000 };

const LAYERS = [
  ['arp', 'ARP'], ['rdns', 'rDNS'], ['mdns', 'mDNS'], ['ssdp', 'SSDP'], ['ble', 'BLE'],
  ['multicast', 'MULTICAST'], ['dns', 'DNS'], ['laptop', 'LAPTOP'],
];

const state = {
  enabled: new Set(LAYERS.map(([k]) => k)),
  showExternal: true,
  focus: null,          // node id
  tab: 'overview',      // panel tab
  editing: false,       // overview edit form open
  listFilter: 'all',    // device list: all / online / new / offline
  maxDevW: 1,           // busiest device's outbound traffic
  query: '',
  meta: {},
  clusters: [],
  maxW: 1,
  lastUpdate: 0,
  idleSince: performance.now(),
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hash = (s) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; };

function anchor(n) {
  if (n.kind === 'external') {
    const u = hash(n.id), v = hash(n.id + '#');
    const theta = 2 * Math.PI * u, phi = Math.acos(2 * v - 1);
    return [EXT_RADIUS * Math.sin(phi) * Math.cos(theta), EXT_RADIUS * Math.sin(phi) * Math.sin(theta), EXT_RADIUS * Math.cos(phi)];
  }
  return ANCHORS[n.cluster] || ANCHORS.unknown;
}

function nodeColor(n) {
  if (n.kind === 'external') return n.tracker ? TRACKER : COLORS.internet;
  return COLORS[n.cluster] || COLORS.unknown;
}

// soft round glow texture shared by every node halo
const GLOW = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.18, 'rgba(255,255,255,.55)');
  grd.addColorStop(0.45, 'rgba(255,255,255,.12)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const SPHERE = new THREE.SphereGeometry(1, 16, 12);

function nodeRadius(n) {
  if (n.kind === 'gateway') return 4.6;
  if (n.is_self) return 3.4;
  if (n.kind === 'ble') return 1.3;
  if (n.kind === 'external') return 1.3 + Math.min(2.4, Math.log1p(n._w || 0) * 0.4);
  return 2.3 + Math.min(1.6, Math.log1p(n._w || 0) * 0.25);
}

// ------------------------------------------------------------------------------------
// Graph
// ------------------------------------------------------------------------------------

const el = document.getElementById('graph');
const Graph = new ForceGraph3D(el, { controlType: 'orbit' })
  .backgroundColor('#141416')
  .showNavInfo(false)
  .nodeId('id')
  .nodeThreeObject((n) => {
    const group = new THREE.Group();
    const color = new THREE.Color(nodeColor(n));
    const r = nodeRadius(n);
    const core = new THREE.Mesh(SPHERE, new THREE.MeshBasicMaterial({ color, transparent: true }));
    core.scale.setScalar(r);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.scale.setScalar(r * (n.kind === 'gateway' ? 6.5 : 4.2));
    group.add(halo, core);
    n.__core = core; n.__halo = halo;
    return group;
  })
  .nodeLabel((n) => tooltip(n))
  .nodeVisibility((n) => nodeVisible(n))
  .linkVisibility((l) => linkVisible(l))
  .linkWidth((l) => linkWidth(l))
  .linkMaterial((l) => {
    const m = linkWidth(l) > 0
      ? new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false })
      : new THREE.LineBasicMaterial({ transparent: true, depthWrite: false });
    l.__mat = m; styleLink(l); return m;
  })
  .linkDirectionalParticles((l) => (l.kind === 'seeks' ? 1 : l.kind === 'flow' && chat(l) > 0.35 ? Math.min(3, Math.ceil(chat(l) * 3)) : 0))
  .linkDirectionalParticleSpeed((l) => 0.0025 + Math.min(0.006, (l.weight || 0) / 4000))
  .linkDirectionalParticleWidth((l) => (chat(l) > 0.75 ? 1.3 : 0.8))
  .linkDirectionalParticleColor((l) => linkTint(l))
  .onNodeClick((n) => focusNode(n.id))
  .onBackgroundClick(() => { closeContextMenu(); focusNode(null); })
  .onNodeRightClick((n, e) => openContextMenu(n, e.clientX, e.clientY))
  .onNodeHover((n) => { el.style.cursor = n ? 'pointer' : 'default'; })
  .d3AlphaDecay(0.025)
  .d3VelocityDecay(0.35)
  .warmupTicks(60)
  .cooldownTime(8000);

Graph.d3Force('x', forceX((n) => anchor(n)[0]).strength((n) => (n.kind === 'external' ? 0.09 : 0.14)));
Graph.d3Force('y', forceY((n) => anchor(n)[1]).strength((n) => (n.kind === 'external' ? 0.09 : 0.14)));
Graph.d3Force('z', forceZ((n) => anchor(n)[2]).strength((n) => (n.kind === 'external' ? 0.09 : 0.14)));
Graph.d3Force('charge').strength(-34).distanceMax(220);
Graph.d3Force('link').distance((l) => (l.kind === 'flow' ? 190 : l.kind === 'lan' ? 110 : 70)).strength((l) => (l.kind === 'flow' ? 0.004 : l.kind === 'lan' ? 0.01 : 0.03));

// bloom: the soft "lit from within" look
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.7, 0.45, 0.32);
Graph.postProcessingComposer().addPass(bloom);
Graph.postProcessingComposer().addPass(new OutputPass());
Graph.scene().background = new THREE.Color('#141416');   // opaque bg so bloom doesn't haze the canvas   // keeps the near-black background (color-space correct)

// drifting dust field behind everything
const dust = (() => {
  const N = 2200, pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const r = 140 + Math.pow(Math.random(), 0.6) * 380, th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
    pos[i * 3] = r * Math.sin(ph) * Math.cos(th) * 1.15; pos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th) * 0.9; pos[i * 3 + 2] = r * Math.cos(ph);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x8c8a84, size: 1.1, transparent: true, opacity: 0.32, depthWrite: false }));
  Graph.scene().add(p); return p;
})();

// the home bubble: a thin glowing membrane around everything inside the house
const bubble = (() => {
  const group = new THREE.Group();
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vP = position; vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `uniform float uTime; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main() {
        float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float rim = pow(f, 4.2);
        float sh = 0.5 + 0.5 * sin(vP.y * 0.03 + uTime * 0.35) * sin(vP.x * 0.024 - uTime * 0.27 + vP.z * 0.01);
        vec3 col = mix(vec3(0.50, 0.60, 0.80), vec3(0.86, 0.76, 0.58), sh);
        gl_FragColor = vec4(col, rim * 0.16);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  group.add(new THREE.Mesh(new THREE.SphereGeometry(HOME_RADIUS, 96, 64), mat));
  // faint specks sitting on the membrane give it surface
  const N = 1400, pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1), r = HOME_RADIUS * (0.995 + Math.random() * 0.01);
    pos[i * 3] = r * Math.sin(ph) * Math.cos(th); pos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th); pos[i * 3 + 2] = r * Math.cos(ph);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  group.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xb9c3d6, size: 0.9, transparent: true, opacity: 0.28, depthWrite: false })));
  group.__mat = mat;
  Graph.scene().add(group); return group;
})();

// space nebula: soft clumped haze in the shell outside the bubble, where the internet lives
const nebula = (() => {
  const group = new THREE.Group();
  const tints = [[0.42, 0.50, 0.72], [0.56, 0.46, 0.70], [0.72, 0.64, 0.46], [0.40, 0.58, 0.62]].map((c) => new THREE.Color(...c));
  const seeds = Array.from({ length: 18 }, () => {
    const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
    return { dir: new THREE.Vector3(Math.sin(ph) * Math.cos(th), Math.sin(ph) * Math.sin(th), Math.cos(ph)), tint: tints[Math.floor(Math.random() * tints.length)] };
  });
  const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
  const layer = (n, size, opacity, spread) => {
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const s = seeds[i % seeds.length];
      const d = s.dir.clone().add(new THREE.Vector3(gauss(), gauss(), gauss()).multiplyScalar(spread)).normalize();
      const r = HOME_RADIUS + 40 + Math.pow(Math.random(), 0.8) * 230;
      pos.set([d.x * r, d.y * r, d.z * r], i * 3);
      const c = s.tint.clone().lerp(tints[i % tints.length], 0.25); col.set([c.r, c.g, c.b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    group.add(new THREE.Points(g, new THREE.PointsMaterial({ map: GLOW, size, vertexColors: true, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending })));
  };
  layer(320, 150, 0.05, 0.35);
  layer(700, 55, 0.07, 0.22);
  layer(1600, 4, 0.5, 0.5);     // pinprick stars mixed into the haze
  Graph.scene().add(group); return group;
})();

const controls = Graph.controls();
controls.autoRotate = true; controls.autoRotateSpeed = 0.35; controls.enableDamping = true;
controls.addEventListener('start', () => { controls.autoRotate = false; state.idleSince = performance.now(); });
controls.addEventListener('end', () => { state.idleSince = performance.now(); });
Graph.cameraPosition(OVERVIEW);

window.addEventListener('resize', () => { Graph.width(window.innerWidth).height(window.innerHeight); bloom.setSize(window.innerWidth, window.innerHeight); });

// ------------------------------------------------------------------------------------
// Visibility, chattiness, styling
// ------------------------------------------------------------------------------------

const idOf = (x) => (typeof x === 'object' ? x.id : x);
const byId = new Map();
let adjacency = new Map();

function nodeVisible(n) {
  if (n.kind === 'external' && !state.showExternal) return false;
  if (n.kind === 'gateway' || n.is_self) return true;
  return (n.layers || []).some((k) => state.enabled.has(k));
}
function linkVisible(l) {
  const s = byId.get(idOf(l.source)), t = byId.get(idOf(l.target));
  return !!s && !!t && nodeVisible(s) && nodeVisible(t) && (l.layers || []).some((k) => state.enabled.has(k));
}
// 0..1 chattiness relative to the busiest link in the house
const chat = (l) => Math.log1p(l.weight || 0) / Math.log1p(state.maxW || 1);
function linkWidth(l) {
  const c = chat(l);
  return (l.kind === 'flow' || l.kind === 'lan') && c > 0.78 ? 0.2 + 0.9 * (c - 0.78) / 0.22 : 0;
}
function linkTint(l) {
  const s = byId.get(idOf(l.source)), t = byId.get(idOf(l.target));
  if (s?.cluster === 'unknown' || t?.cluster === 'unknown') return COLORS.unknown;
  if (t?.tracker) return TRACKER;
  return '#f4efe4';
}
function linkBaseOpacity(l) {
  const c = chat(l);
  const base = l.kind === 'flow' ? 0.035 + 0.42 * Math.pow(c, 2.2) : l.kind === 'lan' ? 0.06 + 0.2 * Math.pow(c, 2)
    : l.kind === 'seeks' ? 0.16 : l.kind === 'ble' ? 0.05 : 0.09;
  return Math.min(0.6, base);
}
function styleLink(l) {
  if (!l.__mat) return;
  l.__mat.color = new THREE.Color(linkTint(l));
  let o = linkBaseOpacity(l);
  if (state.focus) o = (idOf(l.source) === state.focus || idOf(l.target) === state.focus) ? Math.min(0.5, Math.max(0.3, o * 2)) : o * 0.12;
  if (state.query && !matchesLink(l)) o *= 0.15;
  l.__mat.opacity = o;
}
function styleNode(n) {
  if (!n.__core) return;
  let o = n.stale ? 0.35 : 1;
  if (state.focus) o = n.id === state.focus || adjacency.get(state.focus)?.has(n.id) ? 1 : 0.12;
  if (state.query && !matches(n)) o = Math.min(o, 0.1);
  n.__core.material.opacity = o; n.__halo.material.opacity = o < 0.5 ? 0 : o * (n.kind === 'external' ? 0.3 : 0.45);
  const big = n.id === state.focus ? 1.25 : 1;
  n.__core.scale.setScalar(nodeRadius(n) * big);
}
function restyle() {
  const { nodes, links } = Graph.graphData();
  nodes.forEach(styleNode); links.forEach(styleLink);
}

function matches(n) {
  const q = state.query;
  return [n.label, n.auto_label, n.ip, n.mac, n.vendor, n.model, n.hostname, n.guess, n.user?.room, ...(n.user?.tags || []),
    n.kind !== 'external' && TYPES[typeOf(n)]?.label, ...(n.names || []), ...(n._domains || [])]
    .some((v) => v && String(v).toLowerCase().includes(q));
}
function matchesLink(l) {
  const s = byId.get(idOf(l.source)), t = byId.get(idOf(l.target));
  return (s && matches(s)) || (t && matches(t));
}

// ------------------------------------------------------------------------------------
// Status, privacy, type
// ------------------------------------------------------------------------------------

// online = seen in the last few scans · away = missed recent scans · offline = gone 10+ minutes
function statusOf(n) {
  if (!n || n.kind === 'external') return null;
  const now = (state.meta.generated_at || Date.now() / 1000) + (Date.now() - state.lastUpdate) / 1000;
  const age = n.last_seen ? Math.max(0, now - n.last_seen) : Infinity;
  const iv = state.meta.interval || 20;
  if (age <= iv * 2.5 + 8) return { k: 'online', age, text: 'ONLINE' };
  if (age < 600) return { k: 'away', age, text: 'AWAY' };
  return { k: 'offline', age, text: 'OFFLINE' };
}
const fmtAge = (s) => (!isFinite(s) ? 'never' : s < 90 ? `${Math.round(s)}s` : s < 5400 ? `${Math.round(s / 60)}m` : s < 172800 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`);

function flowsOf(n) {
  return Graph.graphData().links.filter((l) => l.kind === 'flow' && idOf(l.source) === n.id)
    .map((l) => ({ l, other: byId.get(idOf(l.target)) })).filter((x) => x.other);
}

// a rough privacy grade from what we can see leaving the house
function privacyOf(n) {
  const f = flowsOf(n);
  if (!f.length) return null;
  const total = f.reduce((s, x) => s + (x.l.weight || 0), 0);
  const tr = f.filter((x) => x.other.tracker), trW = tr.reduce((s, x) => s + (x.l.weight || 0), 0);
  const share = total ? trW / total : 0;
  const chatty = Math.log1p(total) / Math.log1p(state.maxDevW || 1);
  const parts = [
    ['Trackers contacted', Math.min(40, tr.length * 10), `${tr.length}`],
    ['Traffic to trackers', share * 35, `${Math.round(share * 100)}%`],
    ['Distinct destinations', Math.min(20, Math.max(0, f.length - 3) * 2.5), `${f.length}`],
    ['Chattiness', chatty * 12, `${Math.round(chatty * 100)}%`],
  ];
  const score = Math.max(0, Math.round(100 - parts.reduce((s, p) => s + p[1], 0)));
  const grade = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'F';
  return { score, grade, parts, dests: f.length, trackers: tr.length, share };
}

const TYPE_CLUSTER = {
  phone: 'personal', tablet: 'personal', laptop: 'personal', watch: 'personal', headphones: 'personal', tag: 'personal',
  tv: 'entertainment', streamer: 'entertainment', speaker: 'entertainment', assistant: 'assistants',
  camera: 'security', doorbell: 'security', lock: 'security', garage: 'security',
  thermostat: 'home', light: 'home', plug: 'home', hub: 'home', vacuum: 'home', sensor: 'home', printer: 'home', chip: 'home', car: 'home',
  router: 'core',
};

// ------------------------------------------------------------------------------------
// Tooltip
// ------------------------------------------------------------------------------------

function tooltip(n) {
  const lines = [`<b>${esc(n.label)}</b>`];
  if (n.kind === 'external') {
    lines.push(`<span class="k">${esc(n.category)}${n.tracker ? ' · tracker / ads' : ''}</span>`);
    lines.push(`<span class="k">talked to by</span> ${adjacency.get(n.id)?.size || 0} devices`);
  } else {
    const st = statusOf(n);
    lines.push(`<span class="k">${esc(TYPES[typeOf(n)].label)}${n.user?.room ? ' · ' + esc(n.user.room) : ''}</span>`);
    if (st) lines.push(`<span class="st-${st.k}">● ${st.text}</span> <span class="k">${st.k === 'online' ? '' : fmtAge(st.age) + ' ago'}</span>`);
    if (n.ip) lines.push(`<span class="k">ip</span> ${esc(n.ip)}`);
    if (n.rssi != null) lines.push(`<span class="k">signal</span> ${esc(n.rssi)} dBm`);
    lines.push('<span class="k">right-click for actions</span>');
  }
  return `<div class="tip ${n.cluster === 'unknown' ? 'unknown' : ''}">${lines.join('<br>')}</div>`;
}

// ------------------------------------------------------------------------------------
// Panel
// ------------------------------------------------------------------------------------

const panel = document.getElementById('panel'), body = document.getElementById('panel-body');
document.getElementById('close').onclick = () => resetView();

// back out to the whole house: clear selection and fly the camera to the overview
function resetView() {
  focusNode(null);
  Graph.cameraPosition(OVERVIEW, { x: 0, y: 0, z: 0 }, 1100);
  state.idleSince = performance.now();
  setTimeout(() => { if (!state.focus) controls.autoRotate = true; }, 1300);
}

function row(k, v) { return v == null || v === '' || (Array.isArray(v) && !v.length) ? '' : `<div class="row"><span class="k">${esc(k)}</span><span class="v">${esc(Array.isArray(v) ? v.join(', ') : v)}</span></div>`; }
const ago = (t) => (t ? `${fmtAge(Math.max(0, Date.now() / 1000 - t))} ago` : null);
const fmtDate = (t) => (t ? new Date(t * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');

// the porthole: the device's glyph floating in its own patch of space
function porthole(n, type, color, st) {
  const off = st && st.k !== 'online', seed = n.id;
  const stars = Array.from({ length: 46 }, (_, i) => {
    const x = hash(seed + 'x' + i) * 320, y = hash(seed + 'y' + i) * 150, r = 0.3 + hash(seed + 'r' + i) * 0.9;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" fill="#cfd6e4" opacity="${(0.15 + hash(seed + 'o' + i) * 0.5).toFixed(2)}"/>`;
  }).join('');
  const flows = n.kind === 'external' ? [] : flowsOf(n).sort((a, b) => (b.l.weight || 0) - (a.l.weight || 0)).slice(0, 5);
  const streams = flows.map((x, i) => {
    const ang = (-0.5 + i / Math.max(1, flows.length - 1 || 1)) * 1.1 + (i % 2 ? Math.PI : 0);
    const ex = 160 + Math.cos(ang) * 190, ey = 75 + Math.sin(ang) * 90, c = x.other.tracker ? '#e0907a' : '#f4efe4';
    const path = `M160,75 L${ex.toFixed(0)},${ey.toFixed(0)}`;
    return `<path d="${path}" stroke="${c}" stroke-width=".5" opacity=".18"/>` + [0, 1].map((k) =>
      `<circle r="1.3" fill="${c}"><animateMotion dur="${(2.4 + i * 0.4).toFixed(1)}s" begin="${(k * 1.2 + i * 0.3).toFixed(1)}s" repeatCount="indefinite" path="${path}"/><animate attributeName="opacity" values="0;1;0" dur="${(2.4 + i * 0.4).toFixed(1)}s" begin="${(k * 1.2 + i * 0.3).toFixed(1)}s" repeatCount="indefinite"/></circle>`).join('');
  }).join('');
  const pulse = off ? '' : [0, 1.3].map((b) => `<circle cx="160" cy="75" r="30" fill="none" stroke="${color}" stroke-width=".8"><animate attributeName="r" values="30;62" dur="2.6s" begin="${b}s" repeatCount="indefinite"/><animate attributeName="opacity" values=".5;0" dur="2.6s" begin="${b}s" repeatCount="indefinite"/></circle>`).join('');
  return `<svg viewBox="0 0 320 150" preserveAspectRatio="xMidYMid slice" class="port-svg">
    <defs>
      <radialGradient id="pg" cx="50%" cy="50%" r="65%"><stop offset="0" stop-color="${color}" stop-opacity=".16"/><stop offset=".55" stop-color="#1b1c22" stop-opacity=".2"/><stop offset="1" stop-color="#0c0c0f" stop-opacity="0"/></radialGradient>
      <filter id="pglow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <rect width="320" height="150" fill="url(#pg)"/>${stars}${streams}
    <g transform="rotate(-11 160 75)" opacity="${off ? 0.25 : 0.55}">
      <ellipse cx="160" cy="75" rx="104" ry="24" fill="none" stroke="${color}" stroke-width=".5" stroke-dasharray="${off ? '2 4' : '0'}" opacity=".5"/>
      ${off ? '' : `<circle r="2" fill="${color}"><animateMotion dur="11s" repeatCount="indefinite" path="M56,75 a104,24 0 1,0 208,0 a104,24 0 1,0 -208,0"/></circle>`}
    </g>${pulse}
    <g opacity="${off ? 0.4 : 1}"><g><animateTransform attributeName="transform" type="translate" values="0 0;0 -3;0 0" dur="5s" repeatCount="indefinite"/>
      <g transform="translate(124 39) scale(1.5)" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" filter="url(#pglow)">${glyphInner(type)}</g>
    </g></g>
  </svg>
  <span class="port-tl">${esc(TYPES[type].label.toUpperCase())}</span>
  <span class="port-br">${esc(n.ip || (n.rssi != null ? n.rssi + ' dBm' : n.category || ''))}</span>`;
}

function headText(n, type, st) {
  const conf = n.confidence ? `<span class="conf ${esc(n.confidence)}">${esc(n.confidence.toUpperCase())}</span>` : '';
  const sub = n.kind === 'external' ? `${esc(n.category)}${n.tracker ? ' · tracker / ads' : ''}` : `${esc(TYPES[type].label)}${n.user?.room ? ' · ' + esc(n.user.room) : ''}${conf}`;
  const stLine = st ? `<div class="pstatus st-${st.k}"><span class="sd"></span>${st.text}<span class="k">${st.k === 'online' ? `seen ${fmtAge(st.age)} ago` : `last seen ${fmtAge(st.age)} ago`}</span>${n.is_new ? '<span class="newb">NEW</span>' : ''}</div>` : '';
  return `<h2 style="${n.cluster === 'unknown' ? 'color:var(--red)' : ''}">${esc(n.label)}</h2><div class="guess">${sub}</div>${stLine}`;
}

function presenceStrip(n, big) {
  const p = n.presence || '';
  if (!p) return '<div class="empty">no samples yet</div>';
  const up = Math.round((100 * [...p].filter((c) => c === '1').length) / p.length);
  const iv = state.meta.interval || 20, span = fmtAge(p.length * iv);
  return `<div class="pres ${big ? 'big' : ''}">${[...p].map((c) => `<i class="${c === '1' ? 'on' : ''}"></i>`).join('')}</div>
    <div class="pres-k"><span>${span} ago</span><span>${up}% online · ${p.length} scans</span><span>now</span></div>`;
}

function privacyCard(n, full) {
  const p = privacyOf(n);
  const live = state.meta.mode === 'live';
  if (!p) {
    return `<div class="pcard none"><span class="grade">—</span><div><div>No traffic seen for this device.</div>
      <div class="k">${live && !n.is_self ? 'The DNS layer is off, so only this laptop’s own traffic is visible. See the README to turn it on.' : 'Nothing has left the house yet.'}</div></div></div>`;
  }
  const gc = { A: '#cfe8c9', B: '#d8e6c0', C: '#efd49b', D: '#e8ae8a', F: '#e05a52' }[p.grade];
  return `<div class="pcard"><span class="grade" style="color:${gc};text-shadow:0 0 14px ${gc}">${p.grade}</span><div>
      <div>${p.dests} destinations · <span style="color:${p.trackers ? '#e0907a' : 'inherit'}">${p.trackers} tracker${p.trackers === 1 ? '' : 's'}</span></div>
      <div class="k">privacy score ${p.score} / 100${live && !n.is_self ? ' · based on DNS only' : ''}</div></div></div>
    ${full ? `<div class="pbreak">${p.parts.map(([k, v, raw]) => `<div class="pb-row"><span class="k">${k}</span><span class="pb-bar"><i style="width:${Math.max(2, (v / 40) * 100)}%"></i></span><span>${raw}</span><span class="k">−${Math.round(v)}</span></div>`).join('')}</div>` : ''}`;
}

function tabsFor(n) {
  return n.kind === 'external' ? [['overview', 'OVERVIEW'], ['data', 'DATA']]
    : [['overview', 'OVERVIEW'], ['control', 'CONTROL'], ['network', 'NETWORK'], ['data', 'DATA'], ['history', 'HISTORY']];
}

function connList(n) {
  const { links } = Graph.graphData();
  const mine = links.filter((l) => idOf(l.source) === n.id || idOf(l.target) === n.id)
    .map((l) => ({ l, other: byId.get(idOf(l.source) === n.id ? idOf(l.target) : idOf(l.source)) }))
    .filter((x) => x.other).sort((a, b) => (b.l.weight || 0) - (a.l.weight || 0));
  return { flows: mine.filter((x) => x.l.kind === 'flow'), local: mine.filter((x) => x.l.kind !== 'flow') };
}
function conn(x, isFlow, maxF) {
  return `<div class="conn ${x.other.tracker ? 'tracker' : ''}" data-id="${esc(x.other.id)}">
    <div class="top"><span class="name">${esc(x.other.label)}</span><span class="w">${isFlow ? esc(Math.round(x.l.weight)) : esc(x.l.kind.toUpperCase())}</span></div>
    ${isFlow ? `<div class="bar ${x.other.tracker ? 'tracker' : ''}" style="width:${Math.max(4, (100 * (x.l.weight || 0)) / maxF)}%"></div>` : ''}
    ${x.l.domains?.length ? `<div class="d">${esc(x.l.domains.join('  '))}</div>` : ''}
    ${x.l.processes?.length ? `<div class="d">via ${esc(x.l.processes.join(', '))}</div>` : ''}
    ${!isFlow && x.l.label ? `<div class="d">${esc(x.l.label)}</div>` : ''}</div>`;
}

function editForm(n, type) {
  const rooms = [...new Set([...byId.values()].map((x) => x.user?.room).filter(Boolean))].sort();
  const u = n.user || {};
  return `<form class="edit" id="edit">
    <label><span class="k">Name</span><input name="name" maxlength="60" value="${esc(u.name || '')}" placeholder="${esc(n.auto_label || n.label)}"></label>
    <label><span class="k">Room</span><input name="room" maxlength="60" list="rooms" value="${esc(u.room || '')}" placeholder="Living room"></label>
    <datalist id="rooms">${rooms.map((r) => `<option value="${esc(r)}">`).join('')}</datalist>
    <label><span class="k">Type</span><select name="type"><option value="">Auto · ${esc(TYPES[typeOfAuto(n)].label)}</option>${PICKABLE.map((k) => `<option value="${k}" ${u.type === k ? 'selected' : ''}>${esc(TYPES[k].label)}</option>`).join('')}</select></label>
    <label><span class="k">Tags</span><input name="tags" maxlength="200" value="${esc((u.tags || []).join(', '))}" placeholder="kids, guest, work"></label>
    <div class="edit-b"><button type="button" class="cbtn" id="edit-cancel"><span class="t">Cancel</span></button><button type="submit" class="cbtn primary"><span class="t">Save</span></button></div>
  </form>`;
}
const typeOfAuto = (n) => typeOf({ ...n, user: { ...(n.user || {}), type: '' } });

function tabBody(n, type, st) {
  const { flows, local } = connList(n);
  const maxF = Math.max(1, ...flows.map((x) => x.l.weight || 0));
  if (n.kind === 'external') {
    if (state.tab === 'data') return `<h3>DEVICES TALKING TO IT</h3>${flows.length ? flows.map((x) => conn(x, true, maxF)).join('') : '<div class="empty">—</div>'}`;
    return `<h3>DESTINATION</h3>${row('company', n.label)}${row('category', n.category)}${row('tracker', n.tracker ? 'yes · ads / tracking' : 'no')}${row('devices', `${adjacency.get(n.id)?.size || 0} in the house`)}`;
  }
  switch (state.tab) {
    case 'control': return renderControlTab(n, type);
    case 'network': return `
      <h3>IDENTITY</h3>
      ${row('cluster', (state.clusters.find((c) => c.id === n.cluster) || {}).title)}
      ${row('ip', n.ip)}${row('mac', n.mac ? n.mac + (n.randomized_mac ? '  (private)' : '') : null)}
      ${row('vendor', n.vendor)}${row('model', n.model)}${row('hostname', n.hostname)}
      ${row('names', (n.names || []).filter((x) => x !== n.label))}
      ${row('address', n.address)}${row('signal', n.rssi != null ? n.rssi + ' dBm' : null)}
      ${row('upnp', n.upnp && Object.keys(n.upnp).length ? Object.values(n.upnp) : null)}
      <h3>SEEN BY</h3>${(n.layers || []).map((k) => `<span class="chip">${esc(k.toUpperCase())}</span>`).join('') || '<span class="empty">—</span>'}
      ${n.services?.length ? `<h3>ADVERTISES</h3>${n.services.map((s) => `<span class="chip">${esc(s.replace('.local.', ''))}</span>`).join('')}` : ''}
      ${n.searching_for?.length ? `<h3>SEARCHING FOR</h3>${n.searching_for.map((s) => `<span class="chip">${esc(s.replace('.local', ''))}</span>`).join('')}` : ''}
      ${local.length ? `<h3>INSIDE THE HOUSE</h3>${local.map((x) => conn(x, false, maxF)).join('')}` : ''}`;
    case 'data': return `
      <h3>PRIVACY</h3>${privacyCard(n, true)}
      <h3>DATA LEAVING THE HOUSE</h3>
      ${flows.length ? flows.map((x) => conn(x, true, maxF)).join('') : `<div class="empty">no destinations observed yet${state.meta.mode === 'live' && !n.is_self ? ' (needs the DNS logger for devices other than this laptop)' : ''}</div>`}`;
    case 'history': return `
      <h3>PRESENCE</h3>${presenceStrip(n, true)}
      <div class="gnote">One bar per scan, every ${state.meta.interval || 20}s, since the server started.</div>
      <h3>TIMELINE</h3>
      ${row('status', st ? `${st.text.toLowerCase()} · ${st.k === 'online' ? 'seen' : 'last seen'} ${fmtAge(st.age)} ago` : null)}
      ${row('first seen', n.first_seen ? `${fmtDate(n.first_seen)} · ${ago(n.first_seen)}` : null)}
      ${row('last seen', n.last_seen ? `${fmtDate(n.last_seen)} · ${ago(n.last_seen)}` : null)}
      ${n.is_new ? `<div class="callout new"><b>New device.</b> It first joined the network ${ago(n.first_seen)}. If you don’t recognise it, check the Network tab and consider quarantining it from Control.</div>` : ''}`;
    default: {
      const u = n.user || {};
      if (state.editing) return editForm(n, type);
      return `
        ${n.cluster === 'unknown' ? '<div class="callout unk"><b>Unidentified.</b> Give it a name and type below so it leaves the red cluster.</div>' : ''}
        ${n.is_new ? `<div class="callout new"><b>New on the network</b> · joined ${ago(n.first_seen)}.</div>` : ''}
        <div class="facts">
          <div><span class="k">ROOM</span><span>${esc(u.room || '—')}</span></div>
          <div><span class="k">TYPE</span><span>${esc(TYPES[type].label)}<span class="k">${u.type ? ' · set by you' : ' · auto'}</span></span></div>
          <div><span class="k">ADDRESS</span><span>${esc(n.ip || n.address || '—')}</span></div>
          <div><span class="k">MAKER</span><span>${esc(n.vendor || '—')}</span></div>
        </div>
        ${u.tags?.length ? `<div class="tags">${u.tags.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>` : ''}
        ${u.name ? `<div class="gnote">Detected as “${esc(n.auto_label)}”.</div>` : ''}
        <button class="cbtn ghost" id="edit-open"><span class="t">Edit name, room, type, tags</span></button>
        <h3>PRESENCE</h3>${presenceStrip(n, false)}
        <h3>PRIVACY</h3><div class="pclick" data-tab="data">${privacyCard(n, false)}</div>`;
    }
  }
}

// full = rebuild the porthole too (focus / type / status changed); otherwise only text and tab body
function renderPanel(n, { full = false } = {}) {
  const type = typeOf(n), color = nodeColor(n), st = statusOf(n);
  const tabs = tabsFor(n);
  if (!tabs.some(([k]) => k === state.tab)) state.tab = 'overview';
  const key = `${n.id}|${type}|${color}|${st?.k}|${flowsOf(n).length}`;
  if (full || !body.querySelector('.porthole') || body.dataset.key !== key) {
    body.dataset.key = key;
    body.innerHTML = `<div class="porthole">${porthole(n, type, color, st)}</div><div class="phead"></div><nav class="tabs"></nav><div class="tabbody"></div>`;
  }
  body.querySelector('.phead').innerHTML = headText(n, type, st);
  body.querySelector('.tabs').innerHTML = tabs.map(([k, t]) => `<button data-tab="${k}" class="${state.tab === k ? 'on' : ''}">${t}</button>`).join('');
  const tb = body.querySelector('.tabbody');
  tb.innerHTML = tabBody(n, type, st);
  body.querySelectorAll('.tabs button, .pclick').forEach((b) => (b.onclick = () => { state.tab = b.dataset.tab; state.editing = false; renderPanel(n); panel.scrollTop = 0; }));
  tb.querySelectorAll('.conn').forEach((c) => (c.onclick = () => focusNode(c.dataset.id)));
  if (state.tab === 'control') bindControlTab(tb, n, type);
  const eo = tb.querySelector('#edit-open'); if (eo) eo.onclick = () => { state.editing = true; renderPanel(n); tb.querySelector('input')?.focus(); };
  const form = tb.querySelector('#edit');
  if (form) {
    tb.querySelector('#edit-cancel').onclick = () => { state.editing = false; renderPanel(n); };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const payload = { id: n.id, name: f.get('name'), room: f.get('room'), type: f.get('type'), tags: String(f.get('tags') || '').split(',') };
      try {
        const r = await fetch('/api/device', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
        if (!r.ok) throw new Error((await r.json()).error || r.status);
        state.editing = false; toast(`<b>${esc(payload.name || n.label)}</b> <span class="k">· details saved</span>`, 'info');
      } catch (err) { toast(`Could not save: ${esc(err.message)}`, 'warn'); }
    };
  }
}

// skip refreshing the panel while someone is typing, holding, or confirming in it
function panelBusy() {
  const a = document.activeElement;
  return state.editing || (a && panel.contains(a) && /INPUT|SELECT|TEXTAREA/.test(a.tagName)) ||
    !!panel.querySelector('.cbtn.armed, .cbtn.holding, .crow.pending') || panel.matches(':active');
}

function focusNode(id) {
  const changed = id !== state.focus;
  state.focus = id;
  if (changed) state.editing = false;
  restyle();
  renderDevices();
  setFocusGlyph(id ? byId.get(id) : null);
  if (!id) { panel.classList.remove('open'); return; }
  const n = byId.get(id);
  if (!n) return;
  renderPanel(n, { full: true });
  panel.classList.add('open');
  if (changed) panel.scrollTop = 0;
  dlist.querySelector('.dev.on')?.scrollIntoView({ block: 'nearest' });
  controls.autoRotate = false; state.idleSince = performance.now();
  if (!changed) return;
  // fly to a point outside the node (away from the center) so its connections fan out in view
  const d = n.kind === 'external' ? 300 : 340, r = Math.hypot(n.x || 1, n.y || 1, n.z || 1);
  Graph.cameraPosition({ x: (n.x || 1) * (1 + d / r), y: (n.y || 1) * (1 + d / r) + 40, z: (n.z || 1) * (1 + d / r) }, n, 1200);
}

function openControls(id, ctrlId) {
  state.tab = 'control'; state.editing = false;
  if (state.focus !== id) focusNode(id); else renderPanel(byId.get(id), { full: true });
  if (ctrlId) {
    const r = panel.querySelector(`.crow[data-c="${CSS.escape(ctrlId)}"]`);
    if (r) { r.scrollIntoView({ block: 'center' }); r.classList.add('flash'); setTimeout(() => r.classList.remove('flash'), 1800); }
  }
}

// ------------------------------------------------------------------------------------
// 3D marker on the focused node: its type glyph floating above it, and a slow halo ring
// ------------------------------------------------------------------------------------

const glyphTex = new Map();
function glyphTexture(type, color) {
  const key = type + color;
  if (glyphTex.has(key)) return glyphTex.get(key);
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const img = new Image();
  img.onload = () => {
    const g = c.getContext('2d');
    g.filter = 'blur(7px)'; g.globalAlpha = 0.8; g.drawImage(img, 32, 32, 192, 192);
    g.filter = 'none'; g.globalAlpha = 1; g.drawImage(img, 32, 32, 192, 192);
    tex.needsUpdate = true;
  };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 48 48" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${glyphInner(type)}</svg>`);
  glyphTex.set(key, tex);
  return tex;
}
const deco = { group: null, sprite: null, ring: null, node: null };
function setFocusGlyph(n) {
  if (deco.group) { deco.group.parent?.remove(deco.group); deco.group = null; }
  deco.node = n || null;
  const parent = n?.__core?.parent;
  if (!n || !parent) return;
  const color = nodeColor(n), r = nodeRadius(n);
  const group = new THREE.Group();
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glyphTexture(typeOf(n), color), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.95 }));
  sprite.scale.setScalar(18); sprite.position.set(0, r + 14, 0);
  const ring = new THREE.Mesh(new THREE.RingGeometry(r * 2.6, r * 2.6 + 0.35, 72),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  const tick = new THREE.Mesh(new THREE.CircleGeometry(0.7, 12), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
  tick.position.set(r * 2.6 + 0.2, 0, 0); ring.add(tick);
  group.add(sprite, ring);
  parent.add(group);
  Object.assign(deco, { group, sprite, ring });
}
function updateDeco() {
  if (!deco.group) return;
  if (deco.node && deco.group.parent !== deco.node.__core?.parent) return setFocusGlyph(deco.node); // node object was rebuilt
  const t = performance.now() / 1000;
  deco.ring.quaternion.copy(Graph.camera().quaternion);
  deco.ring.rotateZ(t * 0.6);
  deco.sprite.position.y = nodeRadius(deco.node) + 14 + Math.sin(t * 1.3) * 1.2;
}

// ------------------------------------------------------------------------------------
// Keyboard & search
// ------------------------------------------------------------------------------------

const typing = () => /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || '');
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); paletteOpen() ? closePalette() : openPalette(); return; }
  if (e.key === 'Escape') {
    if (paletteOpen()) { closePalette(); return; }
    if (contextOpen()) { closeContextMenu(); return; }
    if (typing() && document.activeElement !== q) { if (state.editing) { state.editing = false; renderPanel(byId.get(state.focus)); } document.activeElement.blur(); return; }
    if (document.activeElement === q && q.value) { q.value = ''; state.query = ''; restyle(); renderDevices(); }
    q.blur(); resetView();
    return;
  }
  if (typing()) return;
  if (e.key === '/') { e.preventDefault(); q.focus(); }
});
const q = document.getElementById('q');
q.addEventListener('input', () => { state.query = q.value.trim().toLowerCase(); restyle(); renderDevices(); });
q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const first = dlist.querySelector('.dev'); if (first) { focusNode(first.dataset.id); q.blur(); } } });

el.addEventListener('contextmenu', (e) => e.preventDefault());

// ------------------------------------------------------------------------------------
// Device list
// ------------------------------------------------------------------------------------

const devicesEl = document.getElementById('devices'), dlist = document.getElementById('dlist'), dcount = document.getElementById('dcount');
const dfilters = document.getElementById('dfilters');
try { if (localStorage.getItem('atlas.devices.collapsed') === '1') devicesEl.classList.add('collapsed'); } catch (e) { /* storage unavailable */ }
document.getElementById('dhead').onclick = () => {
  devicesEl.classList.toggle('collapsed');
  try { localStorage.setItem('atlas.devices.collapsed', devicesEl.classList.contains('collapsed') ? '1' : '0'); } catch (e) { /* storage unavailable */ }
};
dlist.onclick = (e) => { const d = e.target.closest('.dev'); if (d) focusNode(d.dataset.id); };
dlist.oncontextmenu = (e) => { const d = e.target.closest('.dev'); if (d) { e.preventDefault(); openContextMenu(byId.get(d.dataset.id), e.clientX, e.clientY); } };
dfilters.onclick = (e) => { const b = e.target.closest('[data-f]'); if (b) setListFilter(b.dataset.f); };

function setListFilter(f) {
  state.listFilter = f;
  devicesEl.classList.remove('collapsed');
  renderDevices();
}

const LIST_FILTERS = {
  all: () => true,
  online: (n) => statusOf(n)?.k === 'online',
  new: (n) => n.is_new,
  offline: (n) => statusOf(n)?.k !== 'online',
};

function renderDevices() {
  const devs = Graph.graphData().nodes.filter((n) => n.kind !== 'external');
  const counts = Object.fromEntries(Object.entries(LIST_FILTERS).map(([k, f]) => [k, devs.filter(f).length]));
  dfilters.innerHTML = [['all', 'ALL'], ['online', 'ONLINE'], ['new', 'NEW'], ['offline', 'OFFLINE']]
    .map(([k, t]) => `<button data-f="${k}" class="${state.listFilter === k ? 'on' : ''} ${k === 'new' && counts.new ? 'hot' : ''}">${t}<span>${counts[k]}</span></button>`).join('');
  const order = new Map(state.clusters.map((c, i) => [c.id, i]));
  const shown = devs.filter(LIST_FILTERS[state.listFilter] || LIST_FILTERS.all).filter((n) => !state.query || matches(n)).sort((a, b) =>
    (order.get(a.cluster) ?? 99) - (order.get(b.cluster) ?? 99) ||
    (b.kind === 'gateway') - (a.kind === 'gateway') ||
    String(a.label).localeCompare(String(b.label)));
  dcount.textContent = shown.length === devs.length ? String(devs.length) : `${shown.length} / ${devs.length}`;
  let html = '', cur;
  for (const n of shown) {
    if (n.cluster !== cur) {
      cur = n.cluster;
      html += `<div class="grp">${esc((state.clusters.find((c) => c.id === cur) || {}).title || String(cur).toUpperCase())}</div>`;
    }
    const type = typeOf(n), st = statusOf(n), c = nodeColor(n);
    const ext = [...(adjacency.get(n.id) || [])].map((id) => byId.get(id)).filter((o) => o?.kind === 'external');
    const tr = ext.filter((o) => o.tracker).length;
    const where = n.kind === 'ble' ? `bluetooth${n.rssi != null ? ` ${n.rssi} dBm` : ''}` : n.ip;
    const sub = [n.user?.room, where, TYPES[type].label].filter(Boolean).join(' · ');
    const tip = [`${TYPES[type].label}`, st && `${st.text.toLowerCase()}${st.k === 'online' ? '' : ` · ${fmtAge(st.age)} ago`}`, ext.length && `${ext.length} destinations${tr ? `, ${tr} trackers` : ''}`].filter(Boolean).join(' · ');
    html += `<div class="dev${n.cluster === 'unknown' ? ' unknown' : ''}${n.id === state.focus ? ' on' : ''}${!nodeVisible(n) ? ' dim' : ''} s-${st?.k}" data-id="${esc(n.id)}" title="${esc(tip)}">
      <span class="gl">${glyphSVG(type, c, 15)}<i class="sd"></i></span>
      <div class="txt"><div class="nm">${esc(n.label)}${n.is_new ? '<span class="newb">NEW</span>' : ''}</div><div class="sub">${esc(sub)}</div></div>
      <span class="m">${ext.length ? `${ext.length}${tr ? `<span class="tr"> · ${tr}</span>` : ''}` : ''}</span>
    </div>`;
  }
  dlist.innerHTML = html || `<div class="empty">${state.listFilter === 'new' ? 'no new devices in the last day' : 'no matches'}</div>`;
}

// ------------------------------------------------------------------------------------
// Filters, labels, gizmo
// ------------------------------------------------------------------------------------

const filters = document.getElementById('filters');
function renderFilters() {
  const { nodes } = Graph.graphData();
  const { links } = Graph.graphData();
  const count = (k) => (k === 'dns' || k === 'laptop')
    ? links.filter((l) => l.kind === 'flow' && (l.layers || []).includes(k)).length
    : nodes.filter((n) => n.kind !== 'external' && (n.layers || []).includes(k)).length;
  const ext = nodes.filter((n) => n.kind === 'external').length;
  filters.innerHTML = `<span class="lbl">LAYERS</span>` +
    LAYERS.map(([k, name]) => `<span class="tog ${state.enabled.has(k) ? '' : 'off'}" data-k="${k}">${name}<span class="n">${count(k)}</span></span>`).join('') +
    `<span class="lbl">·</span><span class="tog ${state.showExternal ? '' : 'off'}" data-k="__ext">INTERNET<span class="n">${ext}</span></span>`;
  filters.querySelectorAll('.tog').forEach((t) => (t.onclick = () => {
    const k = t.dataset.k;
    if (k === '__ext') state.showExternal = !state.showExternal;
    else state.enabled.has(k) ? state.enabled.delete(k) : state.enabled.add(k);
    Graph.nodeVisibility(Graph.nodeVisibility()).linkVisibility(Graph.linkVisibility());
    nebula.visible = state.showExternal;
    renderFilters(); renderDevices();
  }));
}

const labelsEl = document.getElementById('labels');
const labelDivs = new Map();
function updateLabels() {
  const { nodes } = Graph.graphData();
  const groups = new Map();
  for (const n of nodes) {
    if (!nodeVisible(n) || n.x == null) continue;
    const g = groups.get(n.cluster) || { x: 0, y: 0, z: 0, c: 0, hub: null };
    g.x += n.x; g.y += n.y; g.z += n.z; g.c++;
    if (!g.hub || (n._w || 0) > (g.hub._w || 0) || n.kind === 'gateway') g.hub = g.hub?.kind === 'gateway' ? g.hub : n;
    groups.set(n.cluster, g);
  }
  const cam = Graph.camera();
  for (const c of state.clusters) {
    let div = labelDivs.get(c.id);
    if (!div) {
      div = document.createElement('div'); div.className = 'clabel' + (c.id === 'unknown' ? ' unknown' : '');
      labelsEl.appendChild(div); labelDivs.set(c.id, div);
    }
    const g = groups.get(c.id);
    if (!g || !g.c) { div.style.opacity = 0; continue; }
    const p = c.id === 'internet' ? new THREE.Vector3(0, EXT_RADIUS * 1.12, 0) : new THREE.Vector3(g.x / g.c, g.y / g.c, g.z / g.c);
    const v = p.clone().project(cam);
    if (v.z > 1) { div.style.opacity = 0; continue; }
    const { x, y } = Graph.graph2ScreenCoords(p.x, p.y, p.z);
    const W = window.innerWidth - (panel.classList.contains('open') ? 400 : 0);
    const L = devicesEl.classList.contains('collapsed') ? 20 : 300;
    if (y < 110 || y > window.innerHeight - 90 || x < L + 70 || x > W - 70) { div.style.opacity = 0; continue; }
    div.style.left = `${x}px`; div.style.top = `${y}px`;
    div.style.opacity = state.focus ? 0.25 : 1;
    const txt = `<div class="t">${esc(c.title)}</div><div class="s">${esc(c.subtitle)}<span class="c">${g.c}</span></div>`;
    if (div.__txt !== txt) { div.innerHTML = txt; div.__txt = txt; }
  }
}

const gizmo = document.getElementById('gizmo');
function updateGizmo() {
  const qinv = Graph.camera().quaternion.clone().invert();
  const axes = [['x', new THREE.Vector3(1, 0, 0)], ['y', new THREE.Vector3(0, 1, 0)], ['z', new THREE.Vector3(0, 0, 1)]];
  gizmo.innerHTML = `<circle r="26" fill="none" stroke="rgba(255,255,255,.18)" stroke-width=".8"/>` + axes.map(([k, v]) => {
    const p = v.clone().applyQuaternion(qinv);
    const x = p.x * 34, y = -p.y * 34;
    return `<line x1="0" y1="0" x2="${x}" y2="${y}" stroke="rgba(255,255,255,.45)" stroke-width=".8"/>
            <text x="${x * 1.18}" y="${y * 1.18 + 3}" fill="rgba(255,255,255,.55)" font-size="8" font-family="monospace" text-anchor="middle">${k}</text>`;
  }).join('');
}

// ------------------------------------------------------------------------------------
// Data
// ------------------------------------------------------------------------------------

const subtitle = document.getElementById('subtitle'), statusEl = document.getElementById('status');

function applyGraph(data) {
  document.getElementById('boot').style.display = 'none';
  state.meta = data.meta || {}; state.clusters = data.clusters || []; state.lastUpdate = Date.now();
  const old = new Map(Graph.graphData().nodes.map((n) => [n.id, n]));
  const oldLinks = new Map(Graph.graphData().links.map((l) => [l.id, l]));

  // node weights = total traffic touching them (drives external node size)
  const w = new Map(), domains = new Map();
  for (const l of data.links) {
    for (const end of [l.source, l.target]) w.set(end, (w.get(end) || 0) + (l.kind === 'flow' ? l.weight : 0));
    if (l.domains) domains.set(l.source, [...(domains.get(l.source) || []), ...l.domains]);
  }
  let needsRebuild = false;
  const nodes = data.nodes.map((n) => {
    const prev = old.get(n.id);
    if (n.user?.type && TYPE_CLUSTER[n.user.type]) n.cluster = TYPE_CLUSTER[n.user.type];   // the user's word beats the guess
    n._w = w.get(n.id) || 0; n._domains = domains.get(n.id) || [];
    if (prev) {
      const sizeChanged = Math.abs(nodeRadius(prev) - nodeRadius(n)) > 0.25 || prev.cluster !== n.cluster || prev.tracker !== n.tracker;
      if (sizeChanged) needsRebuild = true;
      for (const k of Object.keys(prev)) if (!k.startsWith('__') && !['x', 'y', 'z', 'vx', 'vy', 'vz', 'index'].includes(k)) delete prev[k];
      return Object.assign(prev, n);
    }
    const [ax, ay, az] = anchor(n);
    return Object.assign(n, { x: ax + (Math.random() - 0.5) * 40, y: ay + (Math.random() - 0.5) * 40, z: az + (Math.random() - 0.5) * 40 });
  });
  byId.clear(); nodes.forEach((n) => byId.set(n.id, n));
  const outW = new Map();
  for (const l of data.links) if (l.kind === 'flow') outW.set(l.source, (outW.get(l.source) || 0) + (l.weight || 0));
  state.maxDevW = Math.max(1, ...outW.values());
  state.maxW = Math.max(1, ...data.links.filter((l) => l.kind === 'flow' || l.kind === 'lan').map((l) => l.weight || 0));

  const links = data.links.map((l) => {
    const prev = oldLinks.get(l.id);
    if (prev) { Object.assign(prev, { ...l, source: prev.source, target: prev.target }); return prev; }
    return l;
  });
  adjacency = new Map();
  for (const l of links) {
    const s = idOf(l.source), t = idOf(l.target);
    if (!adjacency.has(s)) adjacency.set(s, new Set()); if (!adjacency.has(t)) adjacency.set(t, new Set());
    adjacency.get(s).add(t); adjacency.get(t).add(s);
  }

  const structural = nodes.length !== old.size || links.length !== oldLinks.size || nodes.some((n) => !old.has(n.id)) || links.some((l) => !oldLinks.has(l.id));
  if (structural) Graph.graphData({ nodes, links });
  else if (needsRebuild) Graph.nodeThreeObject(Graph.nodeThreeObject());
  Graph.linkWidth(Graph.linkWidth());   // re-evaluate thick vs thin as chattiness shifts
  restyle();
  renderFilters();
  renderDevices();
  if (state.focus && byId.has(state.focus)) {
    const f = byId.get(state.focus);
    if (panelBusy() || state.tab === 'control') body.querySelector('.phead').innerHTML = headText(f, typeOf(f), statusOf(f));
    else renderPanel(f);
  }

  const devs = nodes.filter((n) => n.kind === 'device' || n.kind === 'gateway').length;
  const unk = nodes.filter((n) => n.cluster === 'unknown').length;
  const ble = nodes.filter((n) => n.kind === 'ble').length;
  const ext = nodes.filter((n) => n.kind === 'external').length;
  const fresh = nodes.filter((n) => n.is_new).length;
  const off = nodes.filter((n) => (n.kind === 'device' || n.kind === 'gateway') && statusOf(n)?.k !== 'online').length;
  subtitle.textContent = `${state.meta.mode === 'demo' ? (state.meta.subtitle || 'synthetic demo household') : 'live · ' + (state.meta.subnet || '')}  ·  ${devs} devices  ·  ${ble} bluetooth  ·  ${ext} destinations${unk ? `  ·  ${unk} unidentified` : ''}${fresh ? `  ·  ${fresh} new` : ''}${off ? `  ·  ${off} away` : ''}`;
  document.querySelector('#title .dot').classList.toggle('live', true);
  document.querySelector('#title .dot').style.background = unk ? 'var(--red)' : 'var(--ink)';
  document.querySelector('#title .dot').style.boxShadow = unk ? '0 0 10px var(--red)' : '0 0 10px var(--ink)';
  const st = state.meta.status || {};
  statusEl.textContent = Object.entries(st).map(([k, v]) => `${k.toUpperCase()} ${v}`).join('   ·   ');
}

async function boot() {
  try { applyGraph(await (await fetch('/api/graph')).json()); } catch (e) { /* first scan may still be running */ }
  const connect = () => {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onmessage = (ev) => { try { const d = JSON.parse(ev.data); if (d.nodes?.length) applyGraph(d); } catch (e) { console.error(e); } };
    ws.onclose = () => setTimeout(connect, 2000);
  };
  connect();
}

// render loop extras
(function frame() {
  dust.rotation.y += 0.00025; dust.rotation.x += 0.00008;
  nebula.rotation.y -= 0.00012; nebula.rotation.z += 0.00004;
  bubble.__mat.uniforms.uTime.value = performance.now() / 1000;
  if (!controls.autoRotate && !state.focus && performance.now() - state.idleSince > 20000) controls.autoRotate = true;
  updateLabels(); updateGizmo(); updateDeco();
  requestAnimationFrame(frame);
})();

initControl({
  nodes: () => Graph.graphData().nodes.filter((n) => n.kind !== 'external'),
  typeOf, colorOf: nodeColor, focus: focusNode, openControls, resetView, setListFilter,
  refreshPanel: (id) => { if (state.focus && (!id || id === state.focus) && byId.has(state.focus)) renderPanel(byId.get(state.focus)); },
});

window.__atlas = { Graph, state, byId, statusOf, privacyOf, typeOf };
boot();
