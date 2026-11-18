#!/usr/bin/env python3
"""
House Atlas - live 3D map of every device in your home and where their data goes.

Backend: runs the discovery layers from home_scan.py on a loop, listens to local
multicast chatter (who is looking for whom), optionally pulls per-device DNS
destinations from AdGuard Home, adds this laptop's own connections, and pushes one
graph JSON to the browser over a WebSocket.

Run (Mac):
    sudo python3 server.py                 # live scan of your network
    python3 server.py --demo               # synthetic household, no network access
    open http://127.0.0.1:8765

Optional AdGuard Home (per-device DNS destinations):
    sudo ADGUARD_URL=http://127.0.0.1:3000 ADGUARD_USER=admin ADGUARD_PASS=... python3 server.py

Only scan networks you own or have permission to scan.
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import ipaddress
import json
import os
import re
import socket
import subprocess
import sys
import time
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path
from types import SimpleNamespace

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

import home_scan as hs

ROOT = Path(__file__).parent
STATIC = ROOT / "static"
STATE_FILE = ROOT / "atlas_state.json"
PRESENCE_LEN = 120          # scans of online/offline history kept per node (in memory)
NEW_WINDOW = 24 * 3600      # a device counts as "new" for a day after it first joins

# --------------------------------------------------------------------------------------
# Clusters ("lobes")
# --------------------------------------------------------------------------------------

CLUSTERS = {
    "core":          {"title": "NETWORK CORE",   "subtitle": "ROUTING"},
    "entertainment": {"title": "ENTERTAINMENT",  "subtitle": "MEDIA"},
    "assistants":    {"title": "ASSISTANTS",     "subtitle": "VOICE"},
    "personal":      {"title": "PERSONAL",       "subtitle": "PHONES · LAPTOPS"},
    "security":      {"title": "SECURITY",       "subtitle": "CAMERAS · LOCKS"},
    "home":          {"title": "HOME",           "subtitle": "CLIMATE · POWER · LIGHT"},
    "unknown":       {"title": "UNIDENTIFIED",   "subtitle": "NEEDS REVIEW"},
    "ble":           {"title": "BLUETOOTH FIELD", "subtitle": "OFF-NETWORK"},
    "internet":      {"title": "INTERNET",       "subtitle": "EXTERNAL DESTINATIONS"},
}

CLUSTER_RULES = [  # (regex, cluster) - first match wins; tried on model/names first, then on the guess
    (r"router|gateway|mesh node|thread border|xfi pod|eero|orbi", "core"),
    (r"thermostat|ecobee", "home"),
    (r"doorbell|camera|\bcam\b|door lock|smart lock|security system|garage|wyze|\bring\b", "security"),
    (r"echo|alexa|nest mini|nest hub|nest audio|google home", "assistants"),
    (r"google cast|chromecast|roku|sonos|smart tv|\btv\b|television|apple tv|homepod|fire ?tv|speaker|soundbar", "entertainment"),
    (r"nest|plug|bulb|light|switch|outlet|power strip|shelly|esphome|esp32|tuya|kasa|tapo|lutron|rachio|"
     r"hue|matter|homekit|sensor|printer|fan|heater|purifier|humidifier|sprinkler|vacuum", "home"),
    (r"phone|tablet|laptop|computer|apple device|raspberry pi|macbook|\bmac\b|iphone|ipad|pixel|galaxy", "personal"),
]

# --------------------------------------------------------------------------------------
# External destinations: registrable domain suffix -> (company, category)
# --------------------------------------------------------------------------------------

COMPANIES = {
    # trackers / ads (checked first)
    "doubleclick.net": ("Google Ads", "tracker"), "googlesyndication.com": ("Google Ads", "tracker"),
    "googleadservices.com": ("Google Ads", "tracker"), "google-analytics.com": ("Google Analytics", "tracker"),
    "app-measurement.com": ("Google Analytics", "tracker"), "crashlytics.com": ("Firebase Crashlytics", "tracker"),
    "amazon-adsystem.com": ("Amazon Ads", "tracker"), "scorecardresearch.com": ("Comscore", "tracker"),
    "branch.io": ("Branch", "tracker"), "adjust.com": ("Adjust", "tracker"), "appsflyer.com": ("AppsFlyer", "tracker"),
    "samsungads.com": ("Samsung Ads", "tracker"), "ads.samsung.com": ("Samsung Ads", "tracker"),
    "facebook.net": ("Meta Pixel", "tracker"), "ads.roku.com": ("Roku Ads", "tracker"),
    "logs.roku.com": ("Roku Telemetry", "tracker"), "alphonso.tv": ("Alphonso (TV ACR)", "tracker"),
    "samba.tv": ("Samba TV (ACR)", "tracker"), "innovid.com": ("Innovid", "tracker"),
    "sentry.io": ("Sentry", "tracker"), "segment.io": ("Segment", "tracker"), "mixpanel.com": ("Mixpanel", "tracker"),
    # platforms
    "google.com": ("Google", "platform"), "googleapis.com": ("Google", "platform"), "gstatic.com": ("Google", "platform"),
    "youtube.com": ("YouTube", "media"), "googlevideo.com": ("YouTube", "media"), "ytimg.com": ("YouTube", "media"),
    "nest.com": ("Google Nest", "vendor"), "1e100.net": ("Google", "platform"),
    "amazon.com": ("Amazon", "platform"), "amazonaws.com": ("AWS", "cloud"), "a2z.com": ("Amazon Alexa", "vendor"),
    "amazonalexa.com": ("Amazon Alexa", "vendor"), "ring.com": ("Ring", "vendor"), "media-amazon.com": ("Amazon", "platform"),
    "apple.com": ("Apple", "platform"), "icloud.com": ("Apple iCloud", "platform"), "mzstatic.com": ("Apple", "platform"),
    "aaplimg.com": ("Apple", "platform"), "apple-dns.net": ("Apple", "platform"),
    "microsoft.com": ("Microsoft", "platform"), "windows.com": ("Microsoft", "platform"),
    "live.com": ("Microsoft", "platform"), "office.com": ("Microsoft", "platform"), "azure.com": ("Azure", "cloud"),
    "netflix.com": ("Netflix", "media"), "nflxvideo.net": ("Netflix", "media"), "nflxso.net": ("Netflix", "media"),
    "spotify.com": ("Spotify", "media"), "scdn.co": ("Spotify", "media"), "hulu.com": ("Hulu", "media"),
    "disneyplus.com": ("Disney+", "media"), "roku.com": ("Roku", "vendor"), "sonos.com": ("Sonos", "vendor"),
    "samsung.com": ("Samsung", "vendor"), "samsungcloud.com": ("Samsung", "vendor"), "lgtvsdp.com": ("LG", "vendor"),
    "lge.com": ("LG", "vendor"), "tplinkcloud.com": ("TP-Link", "vendor"), "tuya.com": ("Tuya", "vendor"),
    "tuyaus.com": ("Tuya", "vendor"), "ecobee.com": ("ecobee", "vendor"), "meethue.com": ("Philips Hue", "vendor"),
    "wyze.com": ("Wyze", "vendor"), "myq-cloud.com": ("Chamberlain myQ", "vendor"),
    "facebook.com": ("Meta", "platform"), "instagram.com": ("Meta", "platform"), "whatsapp.net": ("Meta", "platform"),
    "fbcdn.net": ("Meta", "platform"), "tiktokv.com": ("TikTok", "platform"), "tiktokcdn.com": ("TikTok", "platform"),
    "cloudflare.com": ("Cloudflare", "cloud"), "akamaiedge.net": ("Akamai", "cloud"), "akamai.net": ("Akamai", "cloud"),
    "fastly.net": ("Fastly", "cloud"), "cloudfront.net": ("AWS CloudFront", "cloud"), "comcast.net": ("Comcast", "isp"),
    "xfinity.com": ("Xfinity", "isp"), "anthropic.com": ("Anthropic", "platform"), "claude.ai": ("Anthropic", "platform"),
    "github.com": ("GitHub", "platform"), "slack.com": ("Slack", "platform"), "zoom.us": ("Zoom", "platform"),
}

MULTI_PART_TLDS = {"co.uk", "com.au", "co.jp", "com.br", "co.in"}


def registrable(domain: str) -> str:
    parts = domain.lower().rstrip(".").split(".")
    if len(parts) >= 3 and ".".join(parts[-2:]) in MULTI_PART_TLDS:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:]) if len(parts) >= 2 else domain


def company_for(domain: str) -> tuple[str, str]:
    d = domain.lower().rstrip(".")
    for suffix, info in COMPANIES.items():  # longest/most specific keys are listed first per group
        if d == suffix or d.endswith("." + suffix):
            return info
    return registrable(d), "other"


# --------------------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------------------


def default_gateway() -> str | None:
    try:
        if sys.platform == "darwin":
            out = subprocess.run(["route", "-n", "get", "default"], capture_output=True, text=True, timeout=5).stdout
            m = re.search(r"gateway:\s*(\S+)", out)
        else:
            out = subprocess.run(["ip", "route", "show", "default"], capture_output=True, text=True, timeout=5).stdout
            m = re.search(r"default via (\S+)", out)
        if m:
            return m.group(1)
    except Exception:
        pass
    try:  # Linux without iproute2
        with open("/proc/net/route") as f:
            for line in f.readlines()[1:]:
                parts = line.split()
                if parts[1] == "00000000" and int(parts[3], 16) & 2:
                    return socket.inet_ntoa(bytes.fromhex(parts[2])[::-1])
    except Exception:
        pass
    return None


def is_private(ip: str) -> bool:
    try:
        a = ipaddress.ip_address(ip)
        return a.is_private or a.is_loopback or a.is_link_local or a.is_multicast
    except ValueError:
        return True


def cluster_for(guess: str, evidence: str) -> str:
    if guess == "unknown":
        return "unknown"
    for blob in (evidence.lower(), guess.lower()):
        for pattern, cluster in CLUSTER_RULES:
            if re.search(pattern, blob):
                return cluster
    return "unknown"


def svc_key(s: str) -> str:
    """'_googlecast._tcp.local.' / '_googlecast._tcp.local' -> '_googlecast._tcp'"""
    s = s.rstrip(".")
    return s[: -len(".local")] if s.endswith(".local") else s


def now() -> float:
    return time.time()


# --------------------------------------------------------------------------------------
# Multicast listener: who is advertising / searching on the LAN
# --------------------------------------------------------------------------------------


def sniff_multicast(seconds: float) -> dict:
    """Passively listen to mDNS (5353) and SSDP (1900) multicast. Returns per-source
    packet counts plus which service types each host searched for. Needs root."""
    from scapy.all import DNS, IP, UDP, Raw, sniff  # type: ignore

    packets: Counter = Counter()
    searches: dict[str, set[str]] = defaultdict(set)

    def handle(pkt):
        if IP not in pkt or UDP not in pkt:
            return
        src = pkt[IP].src
        packets[src] += 1
        try:
            if pkt[UDP].dport == 5353 and DNS in pkt and pkt[DNS].qr == 0 and pkt[DNS].qd:
                qd = pkt[DNS].qd
                questions = qd if isinstance(qd, list) else [qd]
                for q in questions:
                    name = q.qname.decode(errors="ignore") if isinstance(q.qname, bytes) else str(q.qname)
                    if "._tcp" in name or "._udp" in name:
                        searches[src].add(name.rstrip("."))
            elif pkt[UDP].dport == 1900 and Raw in pkt:
                text = bytes(pkt[Raw].load).decode(errors="ignore")
                if text.startswith("M-SEARCH"):
                    m = re.search(r"(?im)^ST:\s*(.+)$", text)
                    if m:
                        searches[src].add("ssdp:" + m.group(1).strip())
        except Exception:
            pass

    try:
        sniff(filter="udp and (port 5353 or port 1900)", prn=handle, store=False, timeout=seconds)
    except Exception:  # no BPF compiler (libpcap) - filter in Python instead
        sniff(lfilter=lambda p: UDP in p and (p[UDP].dport in (5353, 1900) or p[UDP].sport in (5353, 1900)),
              prn=handle, store=False, timeout=seconds)
    return {"packets": dict(packets), "searches": {k: sorted(v) for k, v in searches.items()}}


# --------------------------------------------------------------------------------------
# Flow sources
# --------------------------------------------------------------------------------------


def adguard_querylog(limit: int = 2000) -> list[dict]:
    url = os.environ.get("ADGUARD_URL")
    if not url:
        return []
    req = urllib.request.Request(f"{url.rstrip('/')}/control/querylog?limit={limit}")
    user, pw = os.environ.get("ADGUARD_USER"), os.environ.get("ADGUARD_PASS")
    if user:
        req.add_header("Authorization", "Basic " + base64.b64encode(f"{user}:{pw or ''}".encode()).decode())
    with urllib.request.urlopen(req, timeout=5) as r:  # noqa: S310 (local service)
        data = json.loads(r.read())
    out = []
    for row in data.get("data", []):
        name = (row.get("question") or {}).get("name") or (row.get("question") or {}).get("host")
        client = row.get("client") or (row.get("client_info") or {}).get("ip")
        if name and client:
            out.append({"client": client, "domain": name.rstrip(".")})
    return out


_rdns_cache: dict[str, str | None] = {}


def laptop_connections() -> list[dict]:
    """This machine's own established internet connections (process -> remote host)."""
    import psutil

    rows = []
    for c in psutil.net_connections(kind="inet"):
        if c.status != psutil.CONN_ESTABLISHED or not c.raddr:
            continue
        rip = c.raddr.ip
        if is_private(rip):
            continue
        try:
            proc = psutil.Process(c.pid).name() if c.pid else "?"
        except Exception:
            proc = "?"
        rows.append({"remote_ip": rip, "remote_port": c.raddr.port, "process": proc})
    # resolve remote IPs to names (cached; many CDNs return useful PTRs like *.1e100.net)
    for r in rows:
        ip = r["remote_ip"]
        if ip not in _rdns_cache:
            try:
                socket.setdefaulttimeout(1.5)
                _rdns_cache[ip] = socket.gethostbyaddr(ip)[0]
            except Exception:
                _rdns_cache[ip] = None
            finally:
                socket.setdefaulttimeout(None)
        r["remote_host"] = _rdns_cache[ip]
    return rows


# --------------------------------------------------------------------------------------
# Atlas state
# --------------------------------------------------------------------------------------


class Registry:
    """What the user told us about each device (name, room, tags, type) plus the first time
    each LAN device was ever seen. Survives restarts; keyed by MAC when there is one."""

    FIELDS = ("name", "room", "tags", "type")

    def __init__(self, path: Path, fresh_first_seen: bool = False):
        self.path = path
        data = {}
        try:
            data = json.loads(path.read_text())
        except Exception:
            pass
        self.created = data.get("created") or now()
        self.devices: dict[str, dict] = data.get("devices", {})
        if fresh_first_seen:  # demo: replay the "newcomer" story every run, keep user edits
            self.created = now()
            for rec in self.devices.values():
                rec.pop("first_seen", None)
        self.dirty = not path.exists() or fresh_first_seen

    def first_seen(self, key: str, t: float) -> float:
        rec = self.devices.setdefault(key, {})
        if "first_seen" not in rec:
            rec["first_seen"] = t
            self.dirty = True
        return rec["first_seen"]

    def user(self, key: str) -> dict:
        rec = self.devices.get(key, {})
        return {k: rec[k] for k in self.FIELDS if rec.get(k)}

    def edit(self, key: str, fields: dict) -> dict:
        rec = self.devices.setdefault(key, {})
        for k in self.FIELDS:
            if k in fields:
                v = fields[k]
                if v in (None, "", []):
                    rec.pop(k, None)
                else:
                    rec[k] = v
        self.dirty = True
        return self.user(key)

    def save(self) -> bool:
        if self.dirty:
            try:
                self.path.write_text(json.dumps({"created": self.created, "devices": self.devices}, indent=1))
            except OSError as e:  # e.g. root-owned from an earlier sudo run; keep working in memory
                print(f"[registry] could not save {self.path.name}: {e.strerror}", file=sys.stderr)
                return False
            self.dirty = False
        return True


class Atlas:
    def __init__(self, registry: Registry | None = None):
        self.registry = registry
        self.presence: dict[str, str] = {}      # node id -> "1101..." one char per scan, newest last
        self.interval = 20.0
        self.new_grace = 300.0                  # devices found this soon after the first-ever scan are baseline
        self.devices: dict[str, dict] = {}      # ip -> device record (persisted across scans)
        self.ble: dict[str, dict] = {}          # address -> record
        self.flow_counts: Counter = Counter()   # (src_id, company) -> count (decayed)
        self.flow_domains: dict[tuple, Counter] = defaultdict(Counter)
        self.flow_procs: dict[tuple, Counter] = defaultdict(Counter)
        self.company_cat: dict[str, str] = {}
        self.multicast_pkts: Counter = Counter()
        self.searches: dict[str, set] = defaultdict(set)
        self.status: dict[str, str] = {}
        self.meta: dict = {}
        self.raw_last: dict = {}
        self.scan_count = 0
        self.version = 0

    # ---- ingest -------------------------------------------------------------------

    def ingest_devices(self, devices: dict, gateway: str | None, self_ip: str):
        t = now()
        for ip, d in devices.items():
            j = d.to_json()
            rec = self.devices.get(ip, {"first_seen": t})
            rec.update(j)
            rec["last_seen"] = t
            if ip == gateway:
                rec["guess"], rec["confidence"] = rec.get("guess") if "router" in (rec.get("guess") or "").lower() \
                    else "Router / gateway", "high"
                rec["is_gateway"] = True
            self.devices[ip] = rec
        # this laptop is never in its own ARP table
        rec = self.devices.get(self_ip, {"first_seen": t, "ip": self_ip, "sources": [], "names": []})
        rec.update({"guess": "This laptop (scanner)", "confidence": "high", "last_seen": t, "is_self": True})
        rec["hostname"] = rec.get("hostname") or socket.gethostname()
        self.devices[self_ip] = rec
        if gateway and gateway not in self.devices:
            self.devices[gateway] = {"ip": gateway, "guess": "Router / gateway", "confidence": "high",
                                     "is_gateway": True, "first_seen": t, "last_seen": t, "sources": ["route"]}

    def ingest_ble(self, ble: list[dict] | None):
        t = now()
        for b in ble or []:
            rec = self.ble.get(b["address"], {"first_seen": t})
            rec.update(b)
            rec["last_seen"] = t
            self.ble[b["address"]] = rec

    def ingest_multicast(self, mc: dict | None):
        if not mc:
            return
        for ip, n in mc["packets"].items():
            self.multicast_pkts[ip] = int(self.multicast_pkts[ip] * 0.5 + n)
        for ip, s in mc["searches"].items():
            self.searches[ip] |= set(s)

    def mark_presence(self, scan_started: float):
        """Append one online/offline sample per node for the scan that just finished."""
        ids = {f"dev:{ip}": d.get("last_seen", 0) for ip, d in self.devices.items()}
        ids.update({f"ble:{a}": b.get("last_seen", 0) for a, b in self.ble.items()})
        for nid, last in ids.items():
            bit = "1" if last >= scan_started - 0.5 else "0"
            self.presence[nid] = (self.presence.get(nid, "") + bit)[-PRESENCE_LEN:]
        for nid in [k for k, v in self.presence.items() if "1" not in v]:
            del self.presence[nid]  # forget rotated BLE addresses that are long gone

    def key_for(self, nid: str) -> str:
        if nid.startswith("dev:"):
            mac = (self.devices.get(nid[4:]) or {}).get("mac")
            if mac:
                return "mac:" + mac.lower()
        return nid

    def decorate(self, node: dict, t: float):
        """Attach registry facts (user edits, persistent first-seen, new flag) and presence."""
        nid = node["id"]
        node["presence"] = self.presence.get(nid, "")
        if not self.registry or node["kind"] == "external":
            return
        key = self.key_for(nid)
        node["key"] = key
        if node["kind"] in ("device", "gateway"):
            fs = self.registry.first_seen(key, node.get("first_seen") or t)
            node["first_seen"] = fs
            node["is_new"] = fs > self.registry.created + self.new_grace and t - fs < NEW_WINDOW
        user = self.registry.user(key)
        if user:
            node["user"] = user
            if user.get("name"):
                node["auto_label"] = node["label"]
                node["label"] = user["name"]

    def decay_flows(self, factor=0.7):
        for k in list(self.flow_counts):
            self.flow_counts[k] *= factor
            if self.flow_counts[k] < 0.2:
                del self.flow_counts[k]

    def add_flow(self, src_id: str, domain: str, process: str | None = None):
        company, cat = company_for(domain)
        key = (src_id, company)
        self.flow_counts[key] += 1
        self.flow_domains[key][domain] += 1
        if process:
            self.flow_procs[key][process] += 1
        self.company_cat[company] = cat

    # ---- graph --------------------------------------------------------------------

    def graph(self) -> dict:
        nodes, links = [], []
        gateway_id = next((f"dev:{ip}" for ip, d in self.devices.items() if d.get("is_gateway")), None)
        self_id = next((f"dev:{ip}" for ip, d in self.devices.items() if d.get("is_self")), None)
        t = now()

        service_providers: dict[str, list[str]] = defaultdict(list)  # service type -> device ids
        for ip, d in self.devices.items():
            nid = f"dev:{ip}"
            evidence = " ".join([d.get("model") or "", d.get("hostname") or "", *d.get("names", []),
                                 *(d.get("upnp") or {}).values()])
            cluster = "core" if d.get("is_gateway") else ("personal" if d.get("is_self") else
                                                          cluster_for(d.get("guess", "unknown"), evidence))
            names = d.get("names") or []
            label = d.get("model") or (names[0] if names else None) or d.get("hostname") or d.get("vendor") or ip
            if d.get("is_self"):
                label = f"This laptop ({d.get('hostname')})"
            layers = sorted(set(d.get("sources", [])) | ({"multicast"} if self.multicast_pkts.get(ip) else set()))
            nodes.append({
                "id": nid, "kind": "gateway" if d.get("is_gateway") else "device", "cluster": cluster,
                "label": label, "ip": ip, "mac": d.get("mac"), "vendor": d.get("vendor"),
                "model": d.get("model"), "hostname": d.get("hostname"), "names": names,
                "guess": d.get("guess"), "confidence": d.get("confidence"),
                "randomized_mac": d.get("randomized_mac", False), "services": d.get("mdns_services", []),
                "upnp": d.get("upnp", {}), "layers": layers or ["arp"],
                "first_seen": d.get("first_seen"), "last_seen": d.get("last_seen"),
                "stale": t - d.get("last_seen", t) > 600, "is_self": bool(d.get("is_self")),
                "searching_for": sorted(self.searches.get(ip, [])),
                "multicast_packets": self.multicast_pkts.get(ip, 0),
            })
            for svc in d.get("mdns_services", []):
                service_providers[svc_key(svc)].append(nid)
            # every device hangs off the gateway
            if gateway_id and nid != gateway_id:
                links.append({"source": nid, "target": gateway_id, "kind": "lan",
                              "layers": layers or ["arp"], "weight": 1 + self.multicast_pkts.get(ip, 0) / 5,
                              "label": "LAN"})
            # the scanner directly heard this device announce itself
            if self_id and nid not in (self_id, gateway_id):
                heard = [layer for layer in ("mdns", "ssdp") if layer in layers]
                if heard:
                    links.append({"source": self_id, "target": nid, "kind": "discovery", "layers": heard,
                                  "weight": 1, "label": "discovered via " + " + ".join(heard).upper()})

        # real device-to-device evidence: host A multicast-searched for a service host B offers
        for ip, wanted in self.searches.items():
            src = f"dev:{ip}"
            if not any(n["id"] == src for n in nodes):
                continue
            for want in wanted:
                for svc, providers in service_providers.items():
                    if svc_key(want) == svc:
                        for p in providers:
                            if p != src:
                                links.append({"source": src, "target": p, "kind": "seeks", "layers": ["multicast"],
                                              "weight": 2, "label": f"searches for {svc}"})

        # BLE field
        for addr, b in self.ble.items():
            nid = f"ble:{addr}"
            makers = ", ".join(b.get("manufacturers") or []) or None
            nodes.append({"id": nid, "kind": "ble", "cluster": "ble", "label": b.get("name") or makers or "BLE device",
                          "address": addr, "rssi": b.get("rssi"), "vendor": makers,
                          "service_uuids": b.get("service_uuids", []), "layers": ["ble"],
                          "guess": "Bluetooth LE device", "confidence": "low",
                          "first_seen": b.get("first_seen"), "last_seen": b.get("last_seen"),
                          "stale": t - b.get("last_seen", t) > 300})
            if self_id:
                rssi = b.get("rssi") or -100
                links.append({"source": self_id, "target": nid, "kind": "ble", "layers": ["ble"],
                              "weight": max(0.5, (rssi + 100) / 15), "label": f"heard at {rssi} dBm"})

        # external destinations
        companies = {c for (_, c) in self.flow_counts}
        for c in companies:
            cat = self.company_cat.get(c, "other")
            nodes.append({"id": f"ext:{c}", "kind": "external", "cluster": "internet", "label": c,
                          "category": cat, "tracker": cat == "tracker", "layers": ["dns", "laptop"]})
        for (src, c), w in self.flow_counts.items():
            key = (src, c)
            layer = "laptop" if self.flow_procs.get(key) else "dns"
            links.append({"source": src, "target": f"ext:{c}", "kind": "flow", "layers": [layer],
                          "weight": round(w, 2), "label": f"{round(w)} lookups/conns",
                          "domains": [d for d, _ in self.flow_domains[key].most_common(8)],
                          "processes": [p for p, _ in self.flow_procs[key].most_common(5)]})

        node_ids = {n["id"] for n in nodes}
        dedup: dict[str, dict] = {}
        for lk in links:
            if lk["source"] in node_ids and lk["target"] in node_ids and lk["source"] != lk["target"]:
                lk["id"] = f"{lk['source']}|{lk['target']}|{lk['kind']}"
                dedup.setdefault(lk["id"], lk)
        links = list(dedup.values())
        for n in nodes:
            self.decorate(n, t)
        if self.registry:
            self.registry.save()
        return {
            "meta": {**self.meta, "version": self.version, "scan_count": self.scan_count, "status": self.status,
                     "generated_at": t, "interval": self.interval},
            "clusters": [{"id": k, **v} for k, v in CLUSTERS.items()],
            "nodes": nodes, "links": links,
        }


# --------------------------------------------------------------------------------------
# Scan loop
# --------------------------------------------------------------------------------------


async def vendor_lookup(macs: list[str]) -> dict[str, str]:
    try:
        from mac_vendor_lookup import AsyncMacLookup
    except ImportError:
        return {}
    ml = AsyncMacLookup()
    out = {}
    for mac in macs:
        if hs.is_randomized(mac):
            continue
        try:
            out[mac] = await ml.lookup(mac)
        except Exception:
            pass
    return out


async def scan_once(atlas: Atlas, args) -> None:
    started = now()
    self_ip = hs.local_ipv4()
    subnet = ipaddress.ip_network(args.subnet or f"{self_ip}/24", strict=False)
    gateway = default_gateway()
    ns = SimpleNamespace(timeout=args.timeout, no_raw_arp=False, no_ble=args.no_ble)

    async def multicast():
        try:
            return await asyncio.to_thread(sniff_multicast, args.timeout + 2)
        except Exception as e:  # no root, no libpcap
            atlas.status["multicast"] = f"off ({type(e).__name__}: {str(e)[:80]})"
            return None

    layers, mc = await asyncio.gather(hs.gather_layers(ns, subnet), multicast())
    devices = hs.merge(subnet, layers)
    for ip, name in (await asyncio.to_thread(hs.reverse_dns, list(devices), 5)).items():
        devices[ip].hostname = name
        devices[ip].sources.add("rdns")
    vendors = await vendor_lookup([d.mac for d in devices.values() if d.mac])
    for d in devices.values():
        if d.mac:
            d.vendor = vendors.get(d.mac)
        hs.classify(d)

    atlas.ingest_devices(devices, gateway, self_ip)
    atlas.ingest_ble(layers.get("ble"))
    atlas.ingest_multicast(mc)
    if mc is not None:
        atlas.status["multicast"] = f"ok ({sum(mc['packets'].values())} packets)"

    # status per layer
    arp = layers.get("arp")
    atlas.status["arp"] = f"ok via {arp[1]} ({len(arp[0])} hosts)" if arp else "failed"
    atlas.status["mdns"] = f"ok ({len(layers['mdns'])} records)" if layers.get("mdns") is not None else "failed"
    atlas.status["ssdp"] = f"ok ({len(layers['ssdp'])} hosts)" if layers.get("ssdp") is not None else "failed"
    atlas.status["ble"] = ("off (--no-ble)" if args.no_ble else
                           f"ok ({len(layers['ble'])} devices)" if layers.get("ble") is not None else "failed")

    # flows
    atlas.decay_flows()
    try:
        rows = adguard_querylog()
        for r in rows:
            if f"dev:{r['client']}" in {f"dev:{ip}" for ip in atlas.devices}:
                atlas.add_flow(f"dev:{r['client']}", r["domain"])
        atlas.status["dns"] = f"ok ({len(rows)} queries)" if os.environ.get("ADGUARD_URL") else "off (no ADGUARD_URL)"
    except Exception as e:
        atlas.status["dns"] = f"error ({type(e).__name__}: {str(e)[:80]})"
    try:
        conns = await asyncio.to_thread(laptop_connections)
        for c in conns:
            atlas.add_flow(f"dev:{self_ip}", c["remote_host"] or c["remote_ip"], c["process"])
        atlas.status["laptop"] = f"ok ({len(conns)} connections)"
        atlas.raw_last["laptop_connections"] = conns[:200]
    except Exception as e:
        atlas.status["laptop"] = f"off ({type(e).__name__}: {str(e)[:80]})"

    atlas.mark_presence(started)
    atlas.scan_count += 1
    atlas.version += 1
    atlas.meta = {"mode": "live", "title": "HOUSE – ATLAS – V1", "subnet": str(subnet), "gateway": gateway,
                  "self_ip": self_ip, "scan_seconds": round(now() - started, 1), "root": os.geteuid() == 0
                  if hasattr(os, "geteuid") else None}
    atlas.raw_last.update({k: v for k, v in layers.items() if k != "arp"})
    atlas.raw_last["arp"] = layers.get("arp")
    atlas.raw_last["multicast"] = mc


# --------------------------------------------------------------------------------------
# App
# --------------------------------------------------------------------------------------


def build_app(args) -> FastAPI:
    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def lifespan(_app):
        task = asyncio.create_task(loop())
        yield
        task.cancel()

    app = FastAPI(title="House Atlas", lifespan=lifespan)
    registry = Registry(ROOT / ("atlas_devices.demo.json" if args.demo else "atlas_devices.json"), fresh_first_seen=args.demo)
    atlas = Atlas(registry)
    atlas.interval = 4.0 if args.demo else args.interval
    atlas.new_grace = 10.0 if args.demo else 300.0
    clients: set[WebSocket] = set()

    async def broadcast():
        payload = json.dumps(atlas.graph(), default=list)
        if not args.demo:  # the demo must never overwrite the live snapshot
            try:
                STATE_FILE.write_text(payload)
            except OSError as e:  # e.g. the file is root-owned from an earlier sudo run
                atlas.status["state_file"] = f"not saved ({e.strerror})"
        for ws in list(clients):
            try:
                await ws.send_text(payload)
            except Exception:
                clients.discard(ws)

    async def loop():
        if args.demo:
            import demo_data
            gen = demo_data.DemoHousehold()
            while True:
                try:
                    gen.tick(atlas)
                    await broadcast()
                except Exception as e:
                    print(f"[demo error] {type(e).__name__}: {e}", file=sys.stderr)
                await asyncio.sleep(4)
        while True:
            try:
                await scan_once(atlas, args)
                await broadcast()
            except Exception as e:
                atlas.status["scan"] = f"error ({type(e).__name__}: {e})"
                print(f"[scan error] {type(e).__name__}: {e}", file=sys.stderr)
            await asyncio.sleep(args.interval)

    @app.get("/")
    async def index():
        return FileResponse(STATIC / "index.html")

    @app.get("/api/graph")
    async def graph():
        return JSONResponse(json.loads(json.dumps(atlas.graph(), default=list)))

    @app.post("/api/device")
    async def edit_device(body: dict):
        """Save what the user knows about a device: name, room, tags, type."""
        nid = str(body.get("id") or "")
        if not (nid.startswith("dev:") or nid.startswith("ble:")):
            return JSONResponse({"error": "unknown device"}, status_code=400)
        fields = {}
        for k in ("name", "room"):
            if k in body:
                fields[k] = str(body[k] or "").strip()[:60]
        if "type" in body:
            v = str(body["type"] or "").strip().lower()
            if v and not re.fullmatch(r"[a-z]{1,20}", v):
                return JSONResponse({"error": "bad type"}, status_code=400)
            fields["type"] = v
        if "tags" in body:
            raw = body["tags"] if isinstance(body["tags"], list) else str(body["tags"] or "").split(",")
            fields["tags"] = [str(x).strip()[:24] for x in raw if str(x).strip()][:8]
        user = registry.edit(atlas.key_for(nid), fields)
        if not registry.save():
            return JSONResponse({"error": f"could not write {registry.path.name} (file permissions)"}, status_code=500)
        await broadcast()
        return JSONResponse({"ok": True, "user": user})

    @app.get("/api/raw")
    async def raw():
        return JSONResponse(json.loads(json.dumps(atlas.raw_last, default=list)))

    @app.websocket("/ws")
    async def ws_endpoint(ws: WebSocket):
        await ws.accept()
        clients.add(ws)
        try:
            await ws.send_text(json.dumps(atlas.graph(), default=list))
            while True:
                await ws.receive_text()
        except WebSocketDisconnect:
            clients.discard(ws)

    app.mount("/static", StaticFiles(directory=STATIC), name="static")
    return app


def main():
    ap = argparse.ArgumentParser(description="House Atlas - live 3D map of your home network")
    ap.add_argument("--demo", action="store_true", help="synthetic household (no scanning)")
    ap.add_argument("--subnet", help="CIDR to scan (default: your /24)")
    ap.add_argument("--timeout", type=float, default=6.0, help="seconds per discovery layer")
    ap.add_argument("--interval", type=float, default=20.0, help="seconds between scans")
    ap.add_argument("--no-ble", action="store_true")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--host", default="127.0.0.1")
    args = ap.parse_args()

    import uvicorn
    print(f"House Atlas on http://{args.host}:{args.port}  ({'demo' if args.demo else 'live'} mode)")
    uvicorn.run(build_app(args), host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
