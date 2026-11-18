// Control framework: risk-tiered actions, simulated device state, action log, toasts,
// command palette and right-click menu. Nothing here reaches a real device yet: every
// action is simulated and logged so the structure can be designed before integrations exist.

import { TYPES, controlGroups, integrationFor, glyphSVG } from './devices.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
};

export const RISK = {
  low: { label: 'LOW', how: 'runs at once' },
  medium: { label: 'MEDIUM', how: 'click again to confirm' },
  high: { label: 'HIGH', how: 'press and hold' },
};
const HOLD_MS = 1400, ARM_MS = 3500, LATENCY_MS = 650;

let hooks = {};
export const ctl = {
  readOnly: store.get('atlas.readonly', false),
  sim: new Map(),                         // device id -> { controlId: value }
  log: store.get('atlas.actionlog', []),  // newest first
};

export function initControl(h) {
  hooks = h;
  document.body.insertAdjacentHTML('beforeend', `
    <div id="toasts"></div>
    <div id="ctx" class="ctx" hidden></div>
    <div id="palette" hidden>
      <div class="pal">
        <div class="pal-in"><span class="pal-k">⌘K</span><input id="pal-q" placeholder="type a device or an action · “tv off”, “lock”, “goodnight”" autocomplete="off" spellcheck="false"></div>
        <div id="pal-list"></div>
        <div class="pal-foot" id="pal-foot"></div>
      </div>
    </div>`);
  renderModeChip();
  const pal = document.getElementById('palette');
  pal.addEventListener('mousedown', (e) => { if (e.target === pal) closePalette(); });
  palQ().addEventListener('input', () => { palette.sel = 0; palette.confirm = null; renderPalette(); });
  palQ().addEventListener('keydown', paletteKeys);
  document.addEventListener('mousedown', (e) => { if (!e.target.closest('#ctx')) closeContextMenu(); });
}

// ------------------------------------------------------------------------------------
// Simulated state & running actions
// ------------------------------------------------------------------------------------

export const valueOf = (id, c) => (ctl.sim.get(id) || {})[c.id] ?? c.default;
const setValue = (id, cid, v) => { const o = ctl.sim.get(id) || {}; o[cid] = v; ctl.sim.set(id, o); };

// direction-aware facts about a toggle: what it would do next and how risky that is
function toggleNext(id, c) {
  const cur = !!valueOf(id, c), next = !cur;
  const risk = (next ? c.riskOn : c.riskOff) || c.risk || 'low';
  const verb = next ? (c.onVerb || `Turn ${c.label.toLowerCase()} on`) : (c.offVerb || `Turn ${c.label.toLowerCase()} off`);
  const warn = next ? c.warnOn : c.warnOff;
  return { cur, next, risk, verb, warn };
}
const isSwitch = (c) => c.kind === 'toggle' && (c.riskOn || c.risk || 'low') === 'low' && (c.riskOff || c.risk || 'low') === 'low';

export function run(n, c, value, label, risk = 'low') {
  if (ctl.readOnly) { toast('Read-only mode is on. Turn it off at the top right to try controls.', 'warn'); return false; }
  const row = document.querySelector(`#panel .crow[data-c="${CSS.escape(c.id)}"]`);
  row?.classList.add('pending');
  setTimeout(() => {
    if (value !== undefined) setValue(n.id, c.id, value);
    ctl.log.unshift({ t: Date.now(), id: n.id, device: n.label, action: label, risk });
    ctl.log = ctl.log.slice(0, 200); store.set('atlas.actionlog', ctl.log);
    toast(`<b>${esc(label)}</b> <span class="k">· ${esc(n.label)}</span>`, 'ok');
    row?.classList.remove('pending');
    hooks.refreshPanel?.(n.id);
  }, LATENCY_MS);
  return true;
}

// ------------------------------------------------------------------------------------
// Control tab
// ------------------------------------------------------------------------------------

const ICON = {
  prev: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M7 6v12M18 6l-9 6 9 6z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  next: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M17 6v12M6 6l9 6-9 6z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  play: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M8 5l11 7-11 7z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/></svg>',
};

function renderItem(n, c) {
  const id = n.id, v = valueOf(id, c);
  const warnLine = (w, always) => (w ? `<div class="cwarn" ${always ? '' : 'hidden'}>${esc(w)}</div>` : '');
  let ctlHtml = '', warn = '', rk = c.risk || 'low';
  switch (c.kind) {
    case 'toggle': {
      if (isSwitch(c)) {
        ctlHtml = `<span class="cstate">${esc(v ? (c.onText || 'On') : (c.offText || 'Off'))}</span><button class="sw ${v ? 'on' : ''}" data-act="toggle" aria-pressed="${!!v}" aria-label="${esc(c.label)}"><i></i></button>`;
      } else {
        const t = toggleNext(id, c); rk = t.risk;
        ctlHtml = `<span class="cstate ${v ? '' : 'alt'}">${esc(v ? (c.onText || 'On') : (c.offText || 'Off'))}</span>${actionButton(t.verb, t.risk, 'toggle')}`;
        warn = warnLine(t.warn, t.risk === 'high');
      }
      break;
    }
    case 'button':
      ctlHtml = actionButton(c.label, rk, 'press');
      warn = warnLine(c.warn, rk === 'high');
      if (c.verb && rk !== 'high') warn = `<div class="chint">${esc(c.verb)}</div>` + warn;
      break;
    case 'slider':
      ctlHtml = `<input type="range" min="${c.min}" max="${c.max}" step="${c.step}" value="${esc(v)}" data-act="slide" aria-label="${esc(c.label)}"><span class="cval">${esc(v)}${esc(c.unit || '')}</span>`;
      break;
    case 'seg':
      ctlHtml = `<div class="seg">${c.options.map((o) => `<button data-act="seg" data-v="${esc(o)}" class="${o === v ? 'on' : ''}">${esc(o)}</button>`).join('')}</div>`;
      break;
    case 'stepper':
      ctlHtml = `<div class="step"><button data-act="step" data-d="-1" aria-label="lower">−</button><span class="cval">${esc(v)}${esc(c.unit || '')}</span><button data-act="step" data-d="1" aria-label="raise">+</button></div>`;
      break;
    case 'media': {
      const playing = !!valueOf(id, { id: 'playing', default: false });
      ctlHtml = `<div class="media"><button data-act="media" data-v="prev" aria-label="previous">${ICON.prev}</button><button class="big" data-act="media" data-v="${playing ? 'pause' : 'play'}" aria-label="play or pause">${playing ? ICON.pause : ICON.play}</button><button data-act="media" data-v="next" aria-label="next">${ICON.next}</button></div>`;
      break;
    }
    case 'dpad':
      ctlHtml = `<div class="dpad">${[['', ''], ['up', '▲'], ['', ''], ['left', '◀'], ['ok', 'OK'], ['right', '▶'], ['back', '↩'], ['down', '▼'], ['home', '⌂']]
        .map(([k, t]) => (k ? `<button data-act="pad" data-v="${k}" aria-label="${k}">${t}</button>` : '<span></span>')).join('')}</div>`;
      break;
    case 'readout':
      ctlHtml = `<span class="cread">${esc(c.value)}</span><span class="cnl">not linked</span>`;
      break;
  }
  const wide = ['dpad', 'media', 'slider'].includes(c.kind) || (c.kind === 'seg' && c.options.length > 3);
  return `<div class="crow ${wide ? 'wide' : ''}" data-c="${esc(c.id)}" data-risk="${rk}">
    <span class="cl">${esc(c.label)}${rk !== 'low' ? `<span class="rk ${rk}" title="${esc(RISK[rk].label)} risk · ${esc(RISK[rk].how)}"></span>` : ''}</span>
    <div class="cc">${ctlHtml}</div>${warn}</div>`;
}

function actionButton(label, risk, act) {
  const text = risk === 'high' ? `Hold · ${label}` : label;
  return `<button class="cbtn r-${risk}" data-act="${act}" data-label="${esc(text)}"><span class="fill"></span><span class="t">${esc(text)}</span></button>`;
}

export function renderControlTab(n, type) {
  const groups = controlGroups(n, type);
  const via = integrationFor(n, type);
  const recent = ctl.log.filter((e) => e.id === n.id).slice(0, 6);
  const ago = (t) => { const s = (Date.now() - t) / 1000; return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`; };
  return `
    <div class="preview ${ctl.readOnly ? 'ro' : ''}">
      <div class="pv-top"><span class="pv-tag">${ctl.readOnly ? 'READ-ONLY' : 'PREVIEW'}</span><span>Not linked. Actions are simulated and never reach the device.</span></div>
      <div class="pv-via"><span class="k">would connect via</span><span>${esc(via)}</span><button class="link" disabled title="Integrations are not built yet">LINK</button></div>
    </div>
    ${groups.length ? groups.map((g) => `<div class="cgroup"><h3>${esc(g.title.toUpperCase())}</h3>${g.note ? `<div class="gnote">${esc(g.note)}</div>` : ''}${g.items.map((c) => renderItem(n, c)).join('')}</div>`).join('')
      : `<div class="empty cnone">${n.kind === 'ble' ? 'Bluetooth-only devices have nothing to control from the network.' : 'No controls for this type yet. If the guess is wrong, set the right type in Overview.'}</div>`}
    <div class="legend"><span><i class="rk low"></i>low · runs at once</span><span><i class="rk medium"></i>medium · click twice</span><span><i class="rk high"></i>high · hold to confirm</span></div>
    <h3>RECENT ACTIONS</h3>
    ${recent.length ? recent.map((e) => `<div class="logrow"><span class="rk ${e.risk}"></span><span>${esc(e.action)}</span><span class="k">${ago(e.t)} · simulated</span></div>`).join('') : '<div class="empty">nothing yet</div>'}`;
}

// wire up every control inside the panel body for node n
export function bindControlTab(root, n, type) {
  const groups = controlGroups(n, type);
  const spec = new Map(groups.flatMap((g) => g.items).map((c) => [c.id, c]));
  root.querySelectorAll('.crow').forEach((row) => {
    const c = spec.get(row.dataset.c); if (!c) return;
    row.querySelectorAll('[data-act]').forEach((b) => {
      const act = b.dataset.act;
      if (act === 'slide') {
        b.addEventListener('input', () => { row.querySelector('.cval').textContent = b.value + (c.unit || ''); });
        b.addEventListener('change', () => { if (!run(n, c, Number(b.value), `${c.label} ${b.value}${c.unit || ''}`)) b.value = valueOf(n.id, c); });
        return;
      }
      if (act === 'toggle' && isSwitch(c)) { b.onclick = () => { const t = toggleNext(n.id, c); run(n, c, t.next, t.verb); }; return; }
      if (act === 'toggle' || act === 'press') {
        const fire = () => {
          if (act === 'toggle') { const t = toggleNext(n.id, c); run(n, c, t.next, t.verb, t.risk); }
          else run(n, c, undefined, c.verb || c.label, c.risk || 'low');
        };
        const risk = act === 'toggle' ? toggleNext(n.id, c).risk : (c.risk || 'low');
        guard(b, row, risk, fire);
        return;
      }
      b.onclick = () => {
        if (act === 'seg') run(n, c, b.dataset.v, `${c.label}: ${b.dataset.v}`);
        if (act === 'step') {
          const v = Math.min(c.max, Math.max(c.min, Number(valueOf(n.id, c)) + Number(b.dataset.d) * c.step));
          run(n, c, v, `${c.label} ${v}${c.unit || ''}`);
        }
        if (act === 'media') {
          const v = b.dataset.v, playing = { id: 'playing', default: false };
          if (v === 'play' || v === 'pause') run(n, playing, v === 'play', v === 'play' ? 'Play' : 'Pause');
          else run(n, c, undefined, v === 'next' ? 'Next track' : 'Previous track');
        }
        if (act === 'pad') run(n, c, undefined, `Remote: ${b.dataset.v}`);
      };
    });
  });
}

// apply the risk tier to a button: low fires, medium arms then fires, high must be held
function guard(b, row, risk, fire) {
  const label = b.querySelector('.t'), warn = row.querySelector('.cwarn');
  if (risk === 'low') { b.onclick = fire; return; }
  if (risk === 'medium') {
    let timer = null;
    b.onclick = () => {
      if (ctl.readOnly) return fire();
      if (b.classList.contains('armed')) { clearTimeout(timer); b.classList.remove('armed'); label.textContent = b.dataset.label; if (warn) warn.hidden = true; return fire(); }
      b.classList.add('armed'); label.textContent = `Confirm · ${b.dataset.label}`; if (warn) warn.hidden = false;
      timer = setTimeout(() => { b.classList.remove('armed'); label.textContent = b.dataset.label; if (warn) warn.hidden = true; }, ARM_MS);
    };
    return;
  }
  // high: press and hold (pointer or Space/Enter); releasing early cancels
  let timer = null;
  const start = () => {
    if (ctl.readOnly) return fire();
    if (timer) return;
    b.classList.add('holding'); b.style.setProperty('--hold', `${HOLD_MS}ms`);
    timer = setTimeout(() => { timer = null; b.classList.remove('holding'); fire(); }, HOLD_MS);
  };
  const stop = () => { if (!timer) return; clearTimeout(timer); timer = null; b.classList.remove('holding'); toastOnce('Keep holding to confirm a high-risk action.'); };
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); start(); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, stop));
  b.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); start(); } });
  b.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') stop(); });
}

// ------------------------------------------------------------------------------------
// Read-only switch, toasts
// ------------------------------------------------------------------------------------

function renderModeChip() {
  const el = document.getElementById('mode'); if (!el) return;
  el.innerHTML = `<span class="k">CONTROLS</span><span>${ctl.readOnly ? 'READ-ONLY' : 'SIMULATED'}</span><button class="sw sm ${ctl.readOnly ? 'on' : ''}" aria-label="read-only mode" title="Read-only mode blocks every action"><i></i></button><span class="k">⌘K</span>`;
  el.querySelector('button').onclick = toggleReadOnly;
}
export function toggleReadOnly() {
  ctl.readOnly = !ctl.readOnly; store.set('atlas.readonly', ctl.readOnly);
  renderModeChip(); hooks.refreshPanel?.();
  toast(ctl.readOnly ? 'Read-only mode on. Every action is blocked.' : 'Read-only mode off. Actions are simulated.', ctl.readOnly ? 'warn' : 'ok');
}

export function toast(html, kind = 'ok') {
  const box = document.getElementById('toasts'); if (!box) return;
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.innerHTML = `<span class="tg">${{ warn: '!', info: 'SAVED', ok: 'SIMULATED' }[kind] || ''}</span>${html}`;
  box.appendChild(t);
  while (box.children.length > 4) box.firstChild.remove();
  requestAnimationFrame(() => t.classList.add('in'));
  setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 300); }, 3200);
}
let lastHint = 0;
function toastOnce(msg) { if (Date.now() - lastHint > 4000) { lastHint = Date.now(); toast(esc(msg), 'warn'); } }

// ------------------------------------------------------------------------------------
// Commands (shared by the palette and the right-click menu)
// ------------------------------------------------------------------------------------

function deviceCommands(n) {
  const type = hooks.typeOf(n), groups = controlGroups(n, type), out = [];
  const base = { device: n, type };
  for (const g of groups) for (const c of g.items) {
    if (c.kind === 'button') out.push({ ...base, title: c.verb && c.verb.length < 28 ? c.verb : c.label, risk: c.risk || 'low', ctrl: c, warn: c.warn, exec: () => run(n, c, undefined, c.verb || c.label, c.risk || 'low') });
    else if (c.kind === 'toggle') {
      const t = toggleNext(n.id, c);
      out.push({ ...base, title: t.verb, risk: t.risk, ctrl: c, warn: t.warn, exec: () => run(n, c, t.next, t.verb, t.risk) });
    } else if (c.kind === 'seg') {
      for (const o of c.options) if (o !== valueOf(n.id, c)) out.push({ ...base, title: `${c.label}: ${o}`, risk: 'low', ctrl: c, exec: () => run(n, c, o, `${c.label}: ${o}`) });
    } else if (c.kind === 'media') {
      out.push({ ...base, title: 'Play / pause', risk: 'low', ctrl: c, exec: () => { const p = { id: 'playing', default: false }; const v = !valueOf(n.id, p); run(n, p, v, v ? 'Play' : 'Pause'); } });
      out.push({ ...base, title: 'Next track', risk: 'low', ctrl: c, exec: () => run(n, c, undefined, 'Next track') });
    } else if (c.kind !== 'readout') {
      out.push({ ...base, title: `Adjust ${c.label.toLowerCase()}…`, risk: 'low', ctrl: c, nav: true, exec: () => hooks.openControls(n.id, c.id) });
    }
  }
  return out;
}

// scenes only ever move things toward the safe state: they lock and close, never unlock or open
const SCENES = [
  { title: 'Goodnight', sub: 'lock doors · close garage · screens and lights off', steps: [
    ['lock', 'locked', true], ['car', 'locked', true], ['garage', 'closed', true], ['tv', 'power', false], ['streamer', 'power', false], ['light', 'power', false]] },
  { title: 'Leaving home', sub: 'lock up · cameras recording · thermostat eco', steps: [
    ['lock', 'locked', true], ['garage', 'closed', true], ['camera', 'privacy', true], ['doorbell', 'privacy', true], ['thermostat', 'eco', true], ['light', 'power', false], ['tv', 'power', false]] },
  { title: 'Movie time', sub: 'lights to 20% warm · TV on', steps: [['light', 'brightness', 20], ['light', 'tone', 'Warm'], ['tv', 'power', true]] },
];

function sceneCommand(s) {
  const steps = [];
  for (const n of hooks.nodes()) {
    const type = hooks.typeOf(n);
    for (const [t, cid, v] of s.steps) {
      if (t !== type) continue;
      const c = controlGroups(n, type).flatMap((g) => g.items).find((x) => x.id === cid);
      if (c) steps.push({ n, c, v });
    }
  }
  const risk = steps.some(({ c, v }) => c.kind === 'toggle' && ((v ? c.riskOn : c.riskOff) || c.risk) === 'medium') ? 'medium' : 'low';
  return {
    title: `Scene · ${s.title}`, sub: `${s.sub} · ${steps.length} actions`, risk, scene: true,
    warn: risk === 'medium' ? 'Moves physical doors. Check nothing is in the way.' : null,
    exec: () => {
      if (ctl.readOnly) return toast('Read-only mode is on. Turn it off at the top right to try controls.', 'warn');
      for (const { n, c, v } of steps) {
        const label = c.kind === 'toggle' ? (v ? (c.onVerb || `${c.label} on`) : (c.offVerb || `${c.label} off`)) : `${c.label} ${v}${c.unit || ''}`;
        setValue(n.id, c.id, v);
        ctl.log.unshift({ t: Date.now(), id: n.id, device: n.label, action: `${label} · ${s.title}`, risk: 'low' });
      }
      ctl.log = ctl.log.slice(0, 200); store.set('atlas.actionlog', ctl.log);
      toast(`<b>Scene · ${esc(s.title)}</b> <span class="k">· ${steps.length} actions</span>`, 'ok');
      hooks.refreshPanel?.();
    },
  };
}

function globalCommands() {
  return [
    ...SCENES.map(sceneCommand),
    { title: 'Show the whole house', sub: 'reset the camera', risk: 'low', nav: true, exec: () => hooks.resetView() },
    { title: ctl.readOnly ? 'Turn read-only mode off' : 'Turn read-only mode on', sub: 'blocks every action while on', risk: 'low', nav: true, exec: toggleReadOnly },
    { title: 'List: new devices', risk: 'low', nav: true, exec: () => hooks.setListFilter('new') },
    { title: 'List: offline devices', risk: 'low', nav: true, exec: () => hooks.setListFilter('offline') },
    { title: 'List: all devices', risk: 'low', nav: true, exec: () => hooks.setListFilter('all') },
  ];
}

// ------------------------------------------------------------------------------------
// Command palette
// ------------------------------------------------------------------------------------

const palette = { items: [], sel: 0, confirm: null };
const palQ = () => document.getElementById('pal-q');
export const paletteOpen = () => !document.getElementById('palette').hidden;

export function openPalette(prefill = '') {
  closeContextMenu();
  document.getElementById('palette').hidden = false;
  palQ().value = prefill; palette.sel = 0; palette.confirm = null;
  renderPalette(); palQ().focus();
}
export function closePalette() { document.getElementById('palette').hidden = true; palQ().blur(); }

function allCommands() {
  const out = globalCommands();
  for (const n of hooks.nodes()) {
    out.push({ device: n, type: hooks.typeOf(n), title: 'Inspect', risk: 'low', nav: true, exec: () => hooks.focus(n.id) });
    out.push(...deviceCommands(n));
  }
  return out;
}

function hay(c) {
  const n = c.device;
  return [c.title, c.sub, n?.label, n?.user?.room, ...(n?.user?.tags || []), c.type && TYPES[c.type]?.label, c.type].filter(Boolean).join(' ').toLowerCase();
}

function renderPalette() {
  const q = palQ().value.trim().toLowerCase(), toks = q.split(/\s+/).filter(Boolean);
  let items = allCommands();
  if (toks.length) {
    items = items.map((c) => {
      // match at the start of a word (plus un- words, so "lock" also finds "Unlock")
      const h = hay(c); if (!toks.every((t) => new RegExp(`(^|[\\s·:(/-]|un)${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(h))) return null;
      const score = toks.reduce((s, t) => s + (c.title.toLowerCase().startsWith(t) ? 3 : 0) + (new RegExp(`(^|\\s)${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(h) ? 2 : 0), 0) - (c.nav ? 0.5 : 0);
      return { c, score };
    }).filter(Boolean).sort((a, b) => b.score - a.score).map((x) => x.c);
  } else {
    items = items.filter((c) => !c.device || c.title === 'Inspect').slice(0, 18);
  }
  palette.items = items.slice(0, 60);
  palette.sel = Math.min(palette.sel, Math.max(0, palette.items.length - 1));
  const list = document.getElementById('pal-list');
  list.innerHTML = palette.items.map((c, i) => {
    const n = c.device, color = n ? hooks.colorOf(n) : 'var(--dim)';
    const icon = n ? glyphSVG(c.type, color, 16) : `<span class="pal-dot">${c.scene ? '✦' : '›'}</span>`;
    return `<div class="pal-row ${i === palette.sel ? 'sel' : ''} ${palette.confirm === i ? 'confirm' : ''}" data-i="${i}">
      ${icon}<span class="pal-t">${esc(c.title)}</span><span class="pal-s">${esc(n ? n.label + (n.user?.room ? ' · ' + n.user.room : '') : c.sub || '')}</span>
      ${c.risk !== 'low' ? `<span class="pal-r ${c.risk}">${RISK[c.risk].label}</span>` : ''}</div>`;
  }).join('') || '<div class="empty pal-empty">no matching devices or actions</div>';
  list.querySelectorAll('.pal-row').forEach((r) => {
    r.onmousemove = () => { if (palette.sel !== +r.dataset.i) { palette.sel = +r.dataset.i; palette.confirm = null; paintSel(); } };
    r.onclick = () => { palette.sel = +r.dataset.i; choose(); };
  });
  paintFoot();
}
function paintSel() {
  document.querySelectorAll('#pal-list .pal-row').forEach((r) => { r.classList.toggle('sel', +r.dataset.i === palette.sel); r.classList.toggle('confirm', +r.dataset.i === palette.confirm); });
  document.querySelector('#pal-list .pal-row.sel')?.scrollIntoView({ block: 'nearest' });
  paintFoot();
}
function paintFoot() {
  const c = palette.items[palette.sel], foot = document.getElementById('pal-foot');
  if (c && palette.confirm === palette.sel) foot.innerHTML = `<span class="warnf">${esc(c.warn || 'Medium-risk action.')} Press ↵ again to confirm.</span>`;
  else if (c && c.risk === 'high') foot.innerHTML = '<span class="warnf">High-risk actions open the device panel, where you hold to confirm.</span>';
  else foot.innerHTML = `<span>↑↓ move</span><span>↵ run</span><span>esc close</span><span class="sp"></span><span>${ctl.readOnly ? 'read-only · actions blocked' : 'all actions simulated'}</span>`;
}

function choose() {
  const c = palette.items[palette.sel]; if (!c) return;
  if (c.risk === 'high') { closePalette(); hooks.openControls(c.device.id, c.ctrl?.id); return; }
  if (c.risk === 'medium' && palette.confirm !== palette.sel && !ctl.readOnly) { palette.confirm = palette.sel; paintSel(); return; }
  closePalette(); c.exec();
}

function paletteKeys(e) {
  if (e.key === 'ArrowDown') { e.preventDefault(); palette.sel = Math.min(palette.items.length - 1, palette.sel + 1); palette.confirm = null; paintSel(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); palette.sel = Math.max(0, palette.sel - 1); palette.confirm = null; paintSel(); }
  else if (e.key === 'Enter') { e.preventDefault(); choose(); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePalette(); }
}

// ------------------------------------------------------------------------------------
// Right-click menu on a node
// ------------------------------------------------------------------------------------

export function openContextMenu(n, x, y) {
  const el = document.getElementById('ctx');
  const type = hooks.typeOf(n);
  const quick = n.kind === 'external' ? [] : deviceCommands(n).filter((c) => c.risk === 'low' && !c.nav).slice(0, 4);
  const items = [
    { title: 'Inspect', exec: () => hooks.focus(n.id) },
    ...(n.kind !== 'external' ? [{ title: 'Open controls', exec: () => hooks.openControls(n.id) }] : []),
    ...quick,
    ...(n.ip ? [{ title: `Copy IP ${n.ip}`, exec: () => { navigator.clipboard?.writeText(n.ip).then(() => toast(`Copied ${esc(n.ip)}`, 'info'), () => {}); } }] : []),
  ];
  el.innerHTML = `<div class="ctx-h">${glyphSVG(type, hooks.colorOf(n), 14)}<span>${esc(n.label)}</span></div>` +
    items.map((c, i) => `<div class="ctx-i ${i === 2 && quick.length ? 'sep' : ''}" data-i="${i}">${esc(c.title)}</div>`).join('');
  el.hidden = false;
  const w = 230, h = el.offsetHeight;
  el.style.left = `${Math.min(x, window.innerWidth - w - 10)}px`; el.style.top = `${Math.min(y, window.innerHeight - h - 10)}px`;
  el.querySelectorAll('.ctx-i').forEach((r) => (r.onclick = () => { closeContextMenu(); items[+r.dataset.i].exec(); }));
}
export function closeContextMenu() { const el = document.getElementById('ctx'); if (el) el.hidden = true; }
export const contextOpen = () => !document.getElementById('ctx')?.hidden;
