// Device types: how a node is recognised, how it is drawn, and what it could be controlled with.
// Everything here is descriptive. Nothing in this file talks to a device.

// ------------------------------------------------------------------------------------
// Glyphs: stroke-only line art in a 48x48 box, drawn in the node's cluster colour
// ------------------------------------------------------------------------------------

const G = {
  phone: '<rect x="15" y="5" width="18" height="38" rx="4"/><path d="M21 9.5h6"/><circle cx="24" cy="38" r="1.2"/>',
  tablet: '<rect x="9" y="7" width="30" height="34" rx="3.5"/><circle cx="24" cy="37" r="1"/>',
  laptop: '<rect x="11" y="10" width="26" height="19" rx="2"/><path d="M6 33h36l-3 4.5H9z"/>',
  tv: '<rect x="5" y="9" width="38" height="25" rx="2"/><path d="M24 34v5M17 39.5h14"/>',
  streamer: '<rect x="9" y="22" width="30" height="11" rx="3"/><circle cx="33.5" cy="27.5" r="1.2"/><path d="M18.5 16.5a8 8 0 0 1 11 0M21.5 19.5a3.6 3.6 0 0 1 5 0"/>',
  speaker: '<rect x="14" y="5" width="20" height="38" rx="5"/><circle cx="24" cy="29" r="6.5"/><circle cx="24" cy="29" r="2"/><circle cx="24" cy="14" r="2.5"/>',
  assistant: '<ellipse cx="24" cy="17" rx="14" ry="5"/><path d="M10 17v13c0 2.8 6.3 5 14 5s14-2.2 14-5V17"/><path d="M14 28.5c2.6 1.6 6 2.4 10 2.4s7.4-.8 10-2.4" opacity=".55"/>',
  camera: '<rect x="7" y="13" width="25" height="16" rx="3"/><path d="M32 18.5l8-4v13l-8-4"/><circle cx="17.5" cy="21" r="4"/><path d="M15 29v8M10 37.5h10"/>',
  doorbell: '<rect x="16" y="4" width="16" height="40" rx="8"/><circle cx="24" cy="14.5" r="4"/><circle cx="24" cy="31" r="5.5"/><circle cx="24" cy="31" r="1.6"/>',
  lock: '<rect x="12" y="21" width="24" height="20" rx="3"/><path d="M17 21v-6a7 7 0 0 1 14 0v6"/><circle cx="24" cy="29.5" r="2"/><path d="M24 31.5v4"/>',
  garage: '<path d="M6 20L24 8l18 12v20H6z"/><path d="M12 40V24h24v16M12 29h24M12 34.5h24"/>',
  thermostat: '<circle cx="24" cy="24" r="16"/><circle cx="24" cy="24" r="10.5" opacity=".5"/><path d="M24 24l6-6"/><circle cx="24" cy="24" r="1.4"/>',
  light: '<path d="M17 28.5a10.5 10.5 0 1 1 14 0c-1.6 1.5-2 3-2 5H19c0-2-.4-3.5-2-5z"/><path d="M19.5 37.5h9M21.5 41.5h5"/>',
  plug: '<rect x="12" y="9" width="24" height="30" rx="6"/><path d="M20 18v5M28 18v5"/><path d="M20.5 29.5a3.5 3.5 0 0 0 7 0"/>',
  hub: '<circle cx="24" cy="24" r="5"/><circle cx="10" cy="12" r="3"/><circle cx="38" cy="12" r="3"/><circle cx="10" cy="36" r="3"/><circle cx="38" cy="36" r="3"/><path d="M12.5 14l7.5 6.5M35.5 14L28 20.5M12.5 34l7.5-6.5M35.5 34L28 27.5"/>',
  router: '<rect x="6" y="27" width="36" height="10" rx="2"/><path d="M13 27V15M35 27V15"/><circle cx="12" cy="32" r="1"/><circle cx="17" cy="32" r="1"/><path d="M19 18.5a7 7 0 0 1 10 0M15.8 14.8a12 12 0 0 1 16.4 0"/>',
  printer: '<path d="M15 18V7h18v11"/><rect x="7" y="18" width="34" height="14" rx="2"/><path d="M15 28h18v13H15zM19 33h10M19 36.5h7"/>',
  vacuum: '<circle cx="24" cy="24" r="16"/><circle cx="24" cy="24" r="5"/><path d="M12.5 14.5a16 16 0 0 1 23 0"/>',
  sensor: '<rect x="12" y="7" width="24" height="34" rx="4"/><path d="M17 31l4.5-6.5 4 3.5 5-8.5"/><path d="M17 13h8"/>',
  car: '<path d="M5 30.5v-5l5.5-8.5c1-1.4 2.4-2 4-2h19c1.6 0 3 .6 4 2l5.5 8.5v5c0 1.2-.8 2-2 2H7c-1.2 0-2-.8-2-2z"/><path d="M10 25h28"/><circle cx="14" cy="33" r="3.5"/><circle cx="34" cy="33" r="3.5"/>',
  watch: '<rect x="14" y="14" width="20" height="20" rx="5"/><path d="M18 14l2-8h8l2 8M18 34l2 8h8l2-8M24 19v5l3 2"/>',
  headphones: '<path d="M10 30v-6a14 14 0 0 1 28 0v6"/><rect x="6.5" y="28" width="7" height="12" rx="3"/><rect x="34.5" y="28" width="7" height="12" rx="3"/>',
  tag: '<rect x="11" y="11" width="26" height="26" rx="7"/><circle cx="24" cy="24" r="6"/><circle cx="31" cy="16.5" r="1.4"/>',
  chip: '<rect x="14" y="14" width="20" height="20" rx="2"/><rect x="19.5" y="19.5" width="9" height="9" opacity=".55"/><path d="M19 14V8M24 14V8M29 14V8M19 34v6M24 34v6M29 34v6M14 19H8M14 24H8M14 29H8M34 19h6M34 24h6M34 29h6"/>',
  beacon: '<circle cx="24" cy="24" r="3"/><path d="M17 17a10 10 0 0 0 0 14M31 17a10 10 0 0 1 0 14M12 12a17 17 0 0 0 0 24M36 12a17 17 0 0 1 0 24"/>',
  unknown: '<circle cx="24" cy="24" r="15" stroke-dasharray="3 3"/><path d="M19.5 19.5a4.5 4.5 0 1 1 6.5 4c-1.3.7-2 1.6-2 3v1"/><circle cx="24" cy="32.5" r=".9"/>',
  globe: '<circle cx="24" cy="24" r="15"/><ellipse cx="24" cy="24" rx="6.5" ry="15"/><path d="M9 24h30M11.5 16h25M11.5 32h25"/>',
};

export function glyphSVG(type, color, size = 16, extra = '') {
  return `<svg class="glyph" width="${size}" height="${size}" viewBox="0 0 48 48" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" ${extra}>${G[TYPES[type]?.glyph || type] || G.unknown}</svg>`;
}
export const glyphInner = (type) => G[TYPES[type]?.glyph || type] || G.unknown;

// ------------------------------------------------------------------------------------
// Control specs
//   kinds: toggle, button, slider, seg, stepper, media, dpad, readout
//   risk:  low = runs at once · medium = click again to confirm · high = press and hold
//   toggles may carry a risk per direction (riskOn / riskOff) and their own wording
// ------------------------------------------------------------------------------------

const power = { id: 'power', kind: 'toggle', label: 'Power', default: true, risk: 'low', onVerb: 'Power on', offVerb: 'Power off' };
const volume = { id: 'volume', kind: 'slider', label: 'Volume', min: 0, max: 100, step: 1, unit: '%', default: 28, risk: 'low' };
const mute = { id: 'mute', kind: 'toggle', label: 'Mute', default: false, risk: 'low', onVerb: 'Mute', offVerb: 'Unmute' };
const media = { id: 'media', kind: 'media', label: 'Playback', risk: 'low' };
const dpad = { id: 'remote', kind: 'dpad', label: 'Remote', risk: 'low' };
const ringPhone = { id: 'ring', kind: 'button', label: 'Play sound', verb: 'Play a sound to find it', risk: 'low' };
const locate = { id: 'locate', kind: 'button', label: 'Locate', verb: 'Show its last known location', risk: 'low' };
const identify = { id: 'identify', kind: 'button', label: 'Identify', verb: 'Blink or beep so you can find it', risk: 'low' };

const NETWORK = {
  title: 'Network', note: 'Works for any device once a DNS filter or router integration is linked.',
  items: [
    { id: 'net.trackers', kind: 'toggle', label: 'Block trackers', default: false, risk: 'low', onText: 'Blocking', offText: 'Allowed', onVerb: 'Block trackers', offVerb: 'Allow trackers' },
    { id: 'net.pause', kind: 'toggle', label: 'Internet', default: true, onText: 'Allowed', offText: 'Paused', onVerb: 'Resume internet', offVerb: 'Pause internet', riskOn: 'low', riskOff: 'medium',
      warnOff: 'Cuts this device off from the internet until you resume it.' },
    { id: 'net.quarantine', kind: 'button', label: 'Quarantine', verb: 'Isolate from the house and the internet', risk: 'high',
      warn: 'Blocks every connection to and from this device. Anything relying on it stops working.' },
  ],
};

export const TYPES = {
  phone: { label: 'Phone', glyph: 'phone', via: 'Find My or Google Find Hub · cloud, no public API',
    groups: [{ title: 'Find', items: [ringPhone, locate] }] },
  tablet: { label: 'Tablet', glyph: 'tablet', via: 'Find My or Google Find Hub · cloud, no public API',
    groups: [{ title: 'Find', items: [ringPhone, locate] }] },
  laptop: { label: 'Computer', glyph: 'laptop', via: 'Wake-on-LAN · local, no account',
    groups: [{ title: 'Power', items: [
      { id: 'wake', kind: 'button', label: 'Wake', verb: 'Send a Wake-on-LAN packet', risk: 'low' },
      { id: 'lockscreen', kind: 'button', label: 'Lock screen', risk: 'low' },
      { id: 'sleep', kind: 'button', label: 'Sleep', risk: 'medium', warn: 'Anything running on it pauses.' },
    ] }] },
  tv: { label: 'Television', glyph: 'tv', via: 'Samsung / LG / Roku local API · one-time pairing',
    groups: [
      { title: 'Screen', items: [power, { id: 'input', kind: 'seg', label: 'Input', options: ['TV', 'HDMI 1', 'HDMI 2', 'Apps'], default: 'HDMI 1', risk: 'low' }] },
      { title: 'Media', items: [media, volume, mute] },
      { title: 'Remote', items: [dpad] },
    ] },
  streamer: { label: 'Streaming player', glyph: 'streamer', via: 'Roku ECP / Google Cast / Apple TV · local',
    groups: [
      { title: 'Player', items: [power, { id: 'app', kind: 'seg', label: 'App', options: ['Home', 'Netflix', 'YouTube', 'Spotify'], default: 'Home', risk: 'low' }] },
      { title: 'Media', items: [media, volume, mute] },
      { title: 'Remote', items: [dpad] },
    ] },
  speaker: { label: 'Speaker', glyph: 'speaker', via: 'Sonos / Google Cast / AirPlay · local',
    groups: [{ title: 'Media', items: [media, volume, mute, { id: 'group', kind: 'toggle', label: 'Group with others', default: false, risk: 'low', onVerb: 'Group speakers', offVerb: 'Ungroup' }] }] },
  assistant: { label: 'Voice assistant', glyph: 'assistant', via: 'Alexa / Google Home · cloud, limited',
    groups: [
      { title: 'Privacy', items: [{ id: 'mic', kind: 'toggle', label: 'Microphone', default: true, onText: 'Listening', offText: 'Muted', risk: 'low', onVerb: 'Unmute microphone', offVerb: 'Mute microphone' },
        { id: 'dnd', kind: 'toggle', label: 'Do not disturb', default: false, risk: 'low' }] },
      { title: 'Media', items: [media, volume] },
    ] },
  camera: { label: 'Camera', glyph: 'camera', via: 'Ring / Nest / Wyze · cloud account',
    groups: [
      { title: 'Camera', items: [
        { id: 'live', kind: 'button', label: 'Live view', verb: 'Open the live stream', risk: 'low' },
        { id: 'privacy', kind: 'toggle', label: 'Recording', default: true, onText: 'Recording', offText: 'Privacy mode', onVerb: 'Resume recording', offVerb: 'Privacy mode', riskOn: 'low', riskOff: 'medium',
          warnOff: 'Stops recording and motion alerts. Nothing is captured until you turn it back on.' },
        { id: 'motion', kind: 'toggle', label: 'Motion alerts', default: true, risk: 'low' },
        { id: 'siren', kind: 'button', label: 'Siren', verb: 'Sound the siren', risk: 'high', warn: 'Loud alarm audible to neighbours. Use only for a real intrusion.' },
      ] },
    ] },
  doorbell: { label: 'Doorbell', glyph: 'doorbell', via: 'Ring / Nest · cloud account',
    groups: [
      { title: 'Doorbell', items: [
        { id: 'live', kind: 'button', label: 'Live view', verb: 'See who is at the door', risk: 'low' },
        { id: 'talk', kind: 'button', label: 'Talk', verb: 'Two-way audio', risk: 'low' },
        { id: 'chime', kind: 'toggle', label: 'Indoor chime', default: true, risk: 'low' },
        { id: 'privacy', kind: 'toggle', label: 'Recording', default: true, onText: 'Recording', offText: 'Privacy mode', onVerb: 'Resume recording', offVerb: 'Privacy mode', riskOn: 'low', riskOff: 'medium',
          warnOff: 'Stops recording the front door until you turn it back on.' },
      ] },
    ] },
  lock: { label: 'Door lock', glyph: 'lock', via: 'HomeKit / Matter / August · local or cloud',
    groups: [
      { title: 'Lock', items: [
        { id: 'locked', kind: 'toggle', label: 'Door', default: true, onText: 'Locked', offText: 'Unlocked', onVerb: 'Lock', offVerb: 'Unlock',
          riskOn: 'low', riskOff: 'high', warnOff: 'Unlocks the door. Anyone at the door can walk in.' },
        { id: 'autolock', kind: 'toggle', label: 'Auto-lock', default: true, onText: 'On', offText: 'Off', onVerb: 'Enable auto-lock', offVerb: 'Disable auto-lock', riskOn: 'low', riskOff: 'medium', warnOff: 'The door will stay unlocked if someone forgets.' },
      ] },
    ] },
  garage: { label: 'Garage door', glyph: 'garage', via: 'myQ · cloud, closed API (Home Assistant or a relay)',
    groups: [
      { title: 'Door', items: [
        { id: 'closed', kind: 'toggle', label: 'Garage', default: true, onText: 'Closed', offText: 'Open', onVerb: 'Close', offVerb: 'Open',
          riskOn: 'medium', riskOff: 'high', warnOn: 'The door moves. Check nothing is underneath.', warnOff: 'Opens the garage to the street.' },
        { id: 'light', kind: 'toggle', label: 'Light', default: false, risk: 'low' },
      ] },
    ] },
  thermostat: { label: 'Thermostat', glyph: 'thermostat', via: 'Nest SDM / ecobee · cloud account',
    groups: [
      { title: 'Climate', items: [
        { id: 'setpoint', kind: 'stepper', label: 'Target', min: 60, max: 80, step: 1, unit: '°F', default: 70, risk: 'low' },
        { id: 'mode', kind: 'seg', label: 'Mode', options: ['Heat', 'Cool', 'Auto', 'Off'], default: 'Auto', risk: 'low' },
        { id: 'eco', kind: 'toggle', label: 'Eco', default: false, risk: 'low' },
        { id: 'temp', kind: 'readout', label: 'Indoor', value: '—' },
      ] },
    ] },
  light: { label: 'Light', glyph: 'light', via: 'Hue / WiZ / Kasa · local',
    groups: [{ title: 'Light', items: [power,
      { id: 'brightness', kind: 'slider', label: 'Brightness', min: 1, max: 100, step: 1, unit: '%', default: 80, risk: 'low' },
      { id: 'tone', kind: 'seg', label: 'Tone', options: ['Warm', 'Neutral', 'Cool'], default: 'Warm', risk: 'low' }] }] },
  plug: { label: 'Smart plug', glyph: 'plug', via: 'Kasa / Tapo / Shelly · local, no account',
    groups: [{ title: 'Outlet', items: [power,
      { id: 'timer', kind: 'seg', label: 'Turn off in', options: ['—', '30m', '1h', '2h'], default: '—', risk: 'low' },
      { id: 'watts', kind: 'readout', label: 'Drawing', value: '— W' }] }] },
  hub: { label: 'Smart-home hub', glyph: 'hub', via: 'Hue bridge / SmartThings / Matter · local',
    groups: [{ title: 'Hub', items: [identify,
      { id: 'pair', kind: 'button', label: 'Allow pairing', verb: 'Open pairing for 60 seconds', risk: 'medium', warn: 'Any nearby device can join the hub for 60 seconds.' }] }] },
  router: { label: 'Router', glyph: 'router', via: 'Xfinity app · no public API',
    groups: [{ title: 'Network', items: [
      { id: 'guest', kind: 'toggle', label: 'Guest Wi-Fi', default: false, onText: 'On', offText: 'Off', onVerb: 'Enable guest Wi-Fi', offVerb: 'Disable guest Wi-Fi', riskOn: 'medium', riskOff: 'low', warnOn: 'Lets visitors join a separate network.' },
      { id: 'reboot', kind: 'button', label: 'Reboot', verb: 'Restart the router', risk: 'high', warn: 'Every device in the house goes offline for about 3 minutes.' }] }] },
  printer: { label: 'Printer', glyph: 'printer', via: 'IPP · local, no account',
    groups: [{ title: 'Printer', items: [
      { id: 'test', kind: 'button', label: 'Test page', risk: 'low' },
      { id: 'cancel', kind: 'button', label: 'Cancel jobs', risk: 'medium', warn: 'Drops everything waiting to print.' },
      { id: 'ink', kind: 'readout', label: 'Toner', value: '—' }] }] },
  vacuum: { label: 'Robot vacuum', glyph: 'vacuum', via: 'Roborock / iRobot · cloud account',
    groups: [{ title: 'Cleaning', items: [
      { id: 'clean', kind: 'button', label: 'Start', verb: 'Start cleaning', risk: 'low' },
      { id: 'dock', kind: 'button', label: 'Dock', verb: 'Return to dock', risk: 'low' },
      { id: 'suction', kind: 'seg', label: 'Suction', options: ['Quiet', 'Balanced', 'Max'], default: 'Balanced', risk: 'low' }] }] },
  sensor: { label: 'Sensor', glyph: 'sensor', via: 'Matter / Home Assistant · local',
    groups: [{ title: 'Readings', items: [
      { id: 'reading', kind: 'readout', label: 'Latest', value: '—' },
      { id: 'refresh', kind: 'button', label: 'Refresh', risk: 'low' }] }] },
  car: { label: 'Car', glyph: 'car', via: 'Tesla Fleet API · signed commands',
    groups: [
      { title: 'Access', items: [
        { id: 'locked', kind: 'toggle', label: 'Doors', default: true, onText: 'Locked', offText: 'Unlocked', onVerb: 'Lock', offVerb: 'Unlock',
          riskOn: 'low', riskOff: 'high', warnOff: 'Unlocks the car wherever it is parked.' },
        { id: 'frunk', kind: 'button', label: 'Frunk', verb: 'Open the front trunk', risk: 'high', warn: 'It cannot be closed remotely.' },
        { id: 'sentry', kind: 'toggle', label: 'Sentry mode', default: true, onText: 'Watching', offText: 'Off', onVerb: 'Enable sentry', offVerb: 'Disable sentry', riskOn: 'low', riskOff: 'medium', warnOff: 'The car stops watching its surroundings.' },
        { id: 'flash', kind: 'button', label: 'Flash lights', risk: 'low' },
      ] },
      { title: 'Climate & charging', items: [
        { id: 'climate', kind: 'toggle', label: 'Climate', default: false, risk: 'low' },
        { id: 'cabin', kind: 'stepper', label: 'Cabin', min: 60, max: 82, step: 1, unit: '°F', default: 70, risk: 'low' },
        { id: 'limit', kind: 'slider', label: 'Charge limit', min: 50, max: 100, step: 5, unit: '%', default: 80, risk: 'low' },
        { id: 'battery', kind: 'readout', label: 'Battery', value: '—' },
      ] },
    ] },
  watch: { label: 'Watch', glyph: 'watch', via: 'Find My · cloud, no public API', groups: [{ title: 'Find', items: [ringPhone] }] },
  headphones: { label: 'Headphones', glyph: 'headphones', via: 'Find My · cloud, no public API', groups: [{ title: 'Find', items: [ringPhone] }] },
  tag: { label: 'Tracker tag', glyph: 'tag', via: 'Tile / AirTag · cloud, no public API', groups: [{ title: 'Find', items: [ringPhone] }] },
  chip: { label: 'Microcontroller', glyph: 'chip', via: 'ESPHome / Tuya local · depends on firmware', groups: [] },
  beacon: { label: 'Bluetooth device', glyph: 'beacon', via: 'Bluetooth only · not on your network', groups: [] },
  unknown: { label: 'Unidentified', glyph: 'unknown', via: 'Identify it first: give it a type in Overview', groups: [] },
  external: { label: 'Internet destination', glyph: 'globe', groups: [] },
};

// types a user can pick from when correcting a guess
export const PICKABLE = Object.keys(TYPES).filter((k) => !['external'].includes(k));

// ------------------------------------------------------------------------------------
// Recognition
// ------------------------------------------------------------------------------------

const RULES = [
  [/samsung tv/, 'tv'],
  [/computer \/ phone/, 'laptop'],
  [/tesla|\bmodel [3sxy]\b|cybertruck/, 'car'],
  [/airpods|buds|headphone|earbud|beats|bose qc|wh-1000/, 'headphones'],
  [/\bwatch\b/, 'watch'],
  [/\btile\b|airtag|smarttag/, 'tag'],
  [/ipad|tablet|galaxy tab|kindle/, 'tablet'],
  [/iphone|pixel(?! ?book)|galaxy s|galaxy z|oneplus|\bphone\b/, 'phone'],
  [/macbook|laptop|thinkpad|notebook|\blt-\d|imac|desktop|\bpc\b/, 'laptop'],
  [/doorbell/, 'doorbell'],
  [/\block\b|aqara u|august|yale|schlage/, 'lock'],
  [/garage|myq|chamberlain/, 'garage'],
  [/thermostat|ecobee/, 'thermostat'],
  [/\bcam\b|camera|stick up|dropcam|wyze/, 'camera'],
  [/ring doorbell|ring llc|ring solutions/, 'camera'],
  [/hue bridge|bridge|smartthings hub|hub\b|thread border/, 'hub'],
  [/bulb|\blight\b|\bwiz\b|lifx|nanoleaf/, 'light'],
  [/plug|outlet|power strip|kasa|tapo|shelly|switch\b/, 'plug'],
  [/printer|brother|epson|canon|laserjet/, 'printer'],
  [/vacuum|roborock|roomba|irobot/, 'vacuum'],
  [/sensor|meter|air quality|netatmo|govee|gvh\d|switchbot|purple ?air|protect/, 'sensor'],
  [/echo dot|echo studio|echo show|nest mini|nest audio|nest hub|homepod|alexa|\becho\b/, 'assistant'],
  [/sonos|speaker|soundbar|\bbeam\b|\barc\b/, 'speaker'],
  [/apple tv|chromecast|roku|fire ?tv|shield|streamer/, 'streamer'],
  [/\btv\b|television|qn\d|oled|webos|bravia/, 'tv'],
  [/router|gateway|mesh|xfi pod|eero|netgear|orbi|access point/, 'router'],
  [/espressif|esp32|esp8266|esp_|tuya/, 'chip'],
  [/oral-b|toothbrush/, 'sensor'],
];

export function typeOf(n) {
  if (n.user?.type && TYPES[n.user.type]) return n.user.type;
  if (n.kind === 'external') return 'external';
  if (n.kind === 'gateway') return 'router';
  if (n.is_self) return 'laptop';
  // names first: they describe the device; vendor and the scanner's guess are fallbacks
  const named = [n.auto_label || n.label, n.model, n.hostname, ...(n.names || [])].filter(Boolean).join(' ').toLowerCase();
  const broad = [n.guess, n.vendor, ...(n.services || []), ...Object.values(n.upnp || {})].filter(Boolean).join(' ').toLowerCase();
  for (const blob of [named, broad]) for (const [re, t] of RULES) if (re.test(blob)) return t;
  if (/private mac|phone \/ tablet/.test(broad)) return 'phone';
  if (n.kind === 'ble') return 'beacon';
  return 'unknown';
}

// a sharper "how would we talk to it" line when the vendor is known
const VIA = [
  [/roku/, 'Roku ECP · local, no account'], [/sonos/, 'Sonos local API · no account'],
  [/chromecast|googlecast|google cast|nest mini|nest audio/, 'Google Cast · local'], [/apple tv|homepod/, 'pyatv · local, one-time pairing'],
  [/samsung/, 'Samsung Tizen WebSocket · local, one-time pairing'], [/kasa|tp-link|tapo/, 'Kasa local protocol · no account'],
  [/hue|signify/, 'Hue bridge API · local, press the link button'], [/\bring\b|ring llc/, 'Ring · cloud account'],
  [/myq|chamberlain/, 'myQ · cloud, closed API'], [/nest/, 'Google Smart Device Management · cloud'],
  [/tesla/, 'Tesla Fleet API · signed commands'], [/amazon|echo/, 'Alexa · cloud, limited'],
  [/aqara|_hap\._tcp|homekit/, 'HomeKit / Matter controller · local'], [/\bwiz\b/, 'WiZ local UDP · no account'],
  [/tuya/, 'Tuya local key · advanced'], [/roborock/, 'Roborock · cloud account'], [/xfinity|technicolor/, 'Xfinity app · no public API'],
];
export function integrationFor(n, type) {
  const blob = [n.auto_label || n.label, n.model, n.vendor, n.guess, n.hostname, ...(n.services || [])].filter(Boolean).join(' ').toLowerCase();
  for (const [re, v] of VIA) if (re.test(blob)) return v;
  return TYPES[type]?.via || 'Home Assistant or Matter';
}

// the full set of control groups for a node: its type's groups plus network controls for LAN devices
export function controlGroups(n, type) {
  const groups = [...(TYPES[type]?.groups || [])];
  if ((n.kind === 'device') && !n.is_self) groups.push(NETWORK);
  return groups;
}
