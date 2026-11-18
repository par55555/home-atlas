# Home Atlas

A live 3D map of every device in your home and where their data goes.

## Run it (Mac)

```bash
cd home-atlas
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
pip install -r requirements-optional.txt   # optional: Scapy, for raw ARP + the multicast listener

sudo .venv/bin/python server.py          # live: scans your network every 20s
.venv/bin/python server.py --demo        # synthetic household, for showing others
```

Open **http://127.0.0.1:8765**.

`sudo` is needed for raw ARP, the multicast listener, and seeing other apps' connections.
Without it, the app still runs: ARP falls back to the OS cache and the other two layers show as `off`.
The same fallbacks apply if Scapy isn't installed.
The first time, macOS asks to allow Terminal to use **Local Network** and **Bluetooth**. Say yes.

## What you're looking at

| Thing | Meaning |
|---|---|
| Bright center node | Your router / gateway |
| Clusters (NETWORK CORE, ENTERTAINMENT, ASSISTANTS, PERSONAL, SECURITY, HOME) | Devices grouped by what they are |
| **Red** nodes / UNIDENTIFIED | Devices the scanner couldn't identify. Review these. |
| BLUETOOTH FIELD | Bluetooth LE devices heard near the laptop, off the network |
| Outer shell / INTERNET | Companies your devices talk to; **orange** = ads / tracking |
| Thicker, brighter line | High chattiness: more lookups or connections |
| Moving particles | Active data flows and multicast searches |

**Device list** on the left: filter by ALL / ONLINE / NEW / OFFLINE. A device is online if seen in the last few scans,
away after that, offline after 10 minutes. NEW means it first joined in the last 24 hours.

**Panel tabs**: Overview (rename, room, type, tags), Control, Network, Data (privacy grade), History (presence per scan).
Your edits and each device's true first-seen date live in `atlas_devices.json` (`atlas_devices.demo.json` in demo mode).

**Controls are a preview.** Nothing is linked yet: every action is simulated and logged. Risk tiers: low runs at once,
medium needs a second click, high needs a press-and-hold. **⌘K** opens the command palette (devices, actions, scenes);
**right-click** a node or list row for quick actions. The top-right switch turns on read-only mode.

**Hover** for a label. **Click** to inspect: identity, which layers saw it, services it advertises,
what it searches for, where its data goes. **/** searches. Toggles at the bottom filter by layer.

## Layers

| Layer | Source | Needs |
|---|---|---|
| ARP | who is on the network + MAC → manufacturer | sudo (else OS cache) |
| rDNS | hostnames from your router | – |
| mDNS / SSDP | devices announcing themselves (often exact model) | – |
| BLE | Bluetooth devices near the laptop | Bluetooth permission |
| MULTICAST | live listener: who is searching for whom on your LAN | sudo |
| LAPTOP | this Mac's own connections (app → company) | sudo for other apps |
| DNS | every device's destinations via AdGuard Home | optional setup below |

## Optional: per-device destinations (AdGuard Home)

Many ISP gateways won't let you change the network's DNS, so point individual devices at
AdGuard Home running on this Mac (filtering **off**, log only). Then:

```bash
sudo ADGUARD_URL=http://127.0.0.1:3000 ADGUARD_USER=admin ADGUARD_PASS=yourpass .venv/bin/python server.py
```

## Data

- `GET /api/graph` – the full graph (nodes, links, clusters, layer status)
- `GET /api/raw` – raw output of the last scan, per layer (for debugging)
- `atlas_state.json` – latest graph, written after every live scan
- `atlas_devices.json` – your names, rooms, tags and types, plus each device's first-seen date

These files and `atlas_test_report.json` describe your real network (IPs, MACs, hostnames).
They are git-ignored. Don't commit them.

## Rebuilding the front end (only if you edit `web/src/`)

The built bundle `static/app.js` is committed, so running the app needs no Node.js.

```bash
cd web && npm install && npm run build
```

Only scan networks you own.

## License

MIT, see [LICENSE](LICENSE). The bundled front end includes three.js, 3d-force-graph and d3-force-3d (MIT).
Optional dependency Scapy is GPL-2.0 and is not required or distributed with this project.
