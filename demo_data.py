"""Synthetic demo household for House Atlas (no network access needed).

Tells a small story when demoing:
  - the Samsung TV is the chattiest device, mostly to ad / ACR (viewing-tracking) companies
  - ~25 seconds in, an unidentified ESP32 device joins and starts talking to an unknown host
"""
from __future__ import annotations

import random
import time

# (ip_suffix, mac, vendor, model/name, hostname, guess, confidence, sources, mdns_services)
DEVICES = [
    (1, "a4:5d:a1:00:00:01", "Technicolor", "Xfinity XB8 Gateway", "xfinity-gateway", "Router / gateway / mesh node", "high", ["arp", "ssdp"], []),
    (2, "a4:5d:a1:00:00:02", "Technicolor", "xFi Pod", "xfi-pod-upstairs", "Router / gateway / mesh node", "medium", ["arp"], []),
    (10, "f0:18:98:aa:10:10", "Apple, Inc.", "MacBook Pro", "Home-MacBook-Pro", "This laptop (scanner)", "high", ["arp"], []),
    (11, "3a:21:7c:aa:11:11", None, "Alex's iPhone", "Alexs-iPhone", "Phone / tablet / laptop (private MAC)", "low", ["arp", "rdns", "mdns"], ["_companion-link._tcp.local."]),
    (12, "52:9e:1d:aa:12:12", None, "iPad", "iPad", "Phone / tablet / laptop (private MAC)", "low", ["arp", "rdns"], []),
    (13, "6e:44:90:aa:13:13", None, "Pixel 9", "Pixel-9", "Phone / tablet / laptop (private MAC)", "low", ["arp", "rdns"], []),
    (14, "8c:85:90:aa:14:14", "Dell Inc.", "Work laptop", "LT-48213", "Computer / phone (Wi-Fi chipset vendor)", "low", ["arp", "rdns"], []),
    (20, "f4:f5:d8:aa:20:20", "Google, Inc.", "Google Nest Mini", "Kitchen-speaker", "Google Cast device (Nest speaker / Chromecast / TV)", "high", ["arp", "mdns"], ["_googlecast._tcp.local."]),
    (21, "f4:f5:e8:aa:21:21", "Google, Inc.", "Chromecast with Google TV", "Bedroom-TV", "Google Cast device (Nest speaker / Chromecast / TV)", "high", ["arp", "mdns"], ["_googlecast._tcp.local.", "_androidtvremote2._tcp.local."]),
    (22, "8c:79:f5:aa:22:22", "Samsung Electronics", "Samsung QN90 TV", "Samsung-QN90", "Samsung TV / SmartThings hub / appliance", "medium", ["arp", "ssdp", "mdns"], ["_airplay._tcp.local."]),
    (23, "d8:31:34:aa:23:23", "Roku, Inc.", "Roku Ultra", "Roku-Ultra", "Roku streamer / TV", "high", ["arp", "ssdp", "rdns"], []),
    (24, "48:a6:b8:aa:24:24", "Sonos, Inc.", "Sonos Beam", "Sonos-Beam", "Sonos speaker", "high", ["arp", "mdns", "ssdp"], ["_sonos._tcp.local.", "_spotify-connect._tcp.local.", "_airplay._tcp.local."]),
    (25, "f0:b3:ec:aa:25:25", "Apple, Inc.", "Apple TV 4K", "Living-Room", "Apple device (Apple TV / HomePod / Mac / iPhone)", "medium", ["arp", "mdns"], ["_airplay._tcp.local.", "_raop._tcp.local.", "_companion-link._tcp.local."]),
    (30, "44:00:49:aa:30:30", "Amazon Technologies Inc.", "Echo Dot (5th Gen)", "echo-dot-kitchen", "Amazon Echo / Fire TV", "medium", ["arp", "rdns"], []),
    (31, "44:00:49:aa:31:31", "Amazon Technologies Inc.", "Echo Show 8", "echo-show-bedroom", "Amazon Echo / Fire TV", "medium", ["arp", "rdns"], ["_amzn-wplay._tcp.local."]),
    (32, "44:00:49:aa:32:32", "Amazon Technologies Inc.", "Echo Studio", "echo-studio", "Amazon Echo / Fire TV", "medium", ["arp", "rdns"], []),
    (40, "9c:76:13:aa:40:40", "Ring LLC", "Ring Video Doorbell 4", "Ring-Doorbell-3f2a", "Ring doorbell / camera", "medium", ["arp", "rdns"], []),
    (41, "9c:76:13:aa:41:41", "Ring LLC", "Ring Stick Up Cam", "Ring-Cam-Garage", "Ring doorbell / camera", "medium", ["arp", "rdns"], []),
    (42, "64:16:66:aa:42:42", "Nest Labs Inc.", "Nest Cam (battery)", "Nest-Cam-Backyard", "Nest thermostat / camera / protect", "medium", ["arp"], []),
    (43, "24:5e:be:aa:43:43", "Shenzhen Aqara", "Aqara Smart Lock U100", "Aqara-U100", "HomeKit door lock", "high", ["arp", "mdns"], ["_hap._tcp.local."]),
    (50, "18:b4:30:aa:50:50", "Nest Labs Inc.", "Nest Learning Thermostat", "Nest-Thermostat", "Nest thermostat / camera / protect", "medium", ["arp", "rdns"], []),
    (51, "00:17:88:aa:51:51", "Signify (Philips Hue)", "Hue Bridge", "Philips-hue", "Philips Hue bridge", "high", ["arp", "mdns", "ssdp"], ["_hue._tcp.local.", "_hap._tcp.local."]),
    (52, "50:c7:bf:aa:52:52", "TP-Link", "Kasa Smart Plug KP125", "HS-Plug-Lamp", "TP-Link Kasa / Tapo plug, bulb or camera", "medium", ["arp", "rdns"], []),
    (53, "50:c7:bf:aa:53:53", "TP-Link", "Kasa Smart Plug KP125", "HS-Plug-Fan", "TP-Link Kasa / Tapo plug, bulb or camera", "medium", ["arp", "rdns"], []),
    (54, "d8:a0:11:aa:54:54", "Espressif Inc.", "WiZ bulb", "wiz_3a9f21", "ESP32/ESP8266 device (often Tuya, WiZ, Shelly or DIY)", "medium", ["arp", "rdns"], []),
    (55, "38:1f:8d:aa:55:55", "Tuya Smart", "Smart power strip", "ESP_7C21A0", "Tuya-based plug / bulb / sensor", "medium", ["arp"], []),
    (56, "3c:2a:f4:aa:56:56", "Brother Industries", "Brother HL-L2350DW", "BRW3C2AF4", "Printer", "high", ["arp", "mdns", "ssdp"], ["_ipp._tcp.local.", "_printer._tcp.local."]),
    (57, "70:ee:50:aa:57:57", "Netatmo", "Air quality monitor", "Netatmo-Home", "unknown", "none", ["arp"], []),
    (58, "b0:4a:39:aa:58:58", "Beijing Roborock", "Roborock S8", "roborock-vacuum-a15", "unknown", "none", ["arp", "rdns"], []),
    (59, "e8:68:e7:aa:59:59", "Espressif Inc.", None, None, "unknown", "none", ["arp"], []),
]

# device ip suffix -> [(domain, base rate per tick)]
FLOWS = {
    10: [("www.google.com", 6), ("claude.ai", 5), ("slack.com", 3), ("github.com", 2), ("login.microsoftonline.com", 2), ("icloud.com", 2)],
    11: [("gateway.icloud.com", 4), ("graph.instagram.com", 5), ("api16-normal.tiktokv.com", 4), ("app-measurement.com", 3), ("api2.branch.io", 1)],
    12: [("netflix.com", 3), ("youtube.com", 4), ("googlevideo.com", 6)],
    13: [("android.googleapis.com", 4), ("app-measurement.com", 2), ("graph.facebook.com", 2)],
    14: [("outlook.office.com", 5), ("zoom.us", 3), ("teams.microsoft.com", 3)],
    20: [("clients3.google.com", 3), ("www.googleapis.com", 2)],
    21: [("youtube.com", 3), ("googlevideo.com", 8), ("doubleclick.net", 2)],
    22: [("ads.samsungads.com", 9), ("acr0.samsungcloud.com", 8), ("tvx.alphonso.tv", 7), ("osb.samsungqbe.com", 4), ("api.samsungcloud.com", 3), ("nflxvideo.net", 5)],
    23: [("logs.roku.com", 6), ("ads.roku.com", 4), ("nflxvideo.net", 5), ("hulu.com", 2)],
    24: [("api.spotify.com", 3), ("sonos.com", 2)],
    25: [("apple.com", 2), ("mzstatic.com", 2), ("aaplimg.com", 2)],
    30: [("avs-alexa-na.amazon.com", 4), ("device-metrics-us.amazon.com", 3), ("api.amazonalexa.com", 2)],
    31: [("avs-alexa-na.amazon.com", 4), ("media-amazon.com", 3), ("amazon-adsystem.com", 2)],
    32: [("avs-alexa-na.amazon.com", 3), ("music.amazon.com", 3)],
    40: [("fw.ring.com", 4), ("es.ring.com", 3), ("amazonaws.com", 2)],
    41: [("fw.ring.com", 3), ("amazonaws.com", 2)],
    42: [("nexus.dropcam.com", 3), ("nest.com", 2)],
    43: [("aqara.com", 1)],
    50: [("frontdoor.nest.com", 2), ("nest.com", 1)],
    51: [("ws.meethue.com", 2)],
    52: [("n-devs.tplinkcloud.com", 2)],
    53: [("n-devs.tplinkcloud.com", 2)],
    54: [("eu.wiz.world", 1)],
    55: [("a1.tuyaus.com", 3), ("m1.tuyaus.com", 2)],
    56: [("brother.com", 1)],
    57: [("api.netatmo.com", 1)],
    58: [("usiot.roborock.com", 3), ("api-us.roborock.com", 2)],
    59: [("cdn.espressif.com", 1)],
}

SEARCHES = {
    11: ["_googlecast._tcp.local", "_airplay._tcp.local", "_sonos._tcp.local"],
    10: ["_ipp._tcp.local", "_airplay._tcp.local", "_googlecast._tcp.local"],
    13: ["_googlecast._tcp.local"],
    30: ["ssdp:urn:schemas-upnp-org:device:MediaRenderer:1"],
    25: ["_hap._tcp.local"],
}

BLE = [
    ("AA:01", "Alex's AirPods Pro", -48, ["Apple"]),
    ("AA:02", "Apple Watch", -55, ["Apple"]),
    ("AA:03", "GVH5075_1A2B", -71, ["0xEC88"]),
    ("AA:04", "Oral-B iO", -80, ["0x00DC"]),
    ("AA:05", "Tile", -84, ["0x01E1"]),
    ("AA:06", "Galaxy Buds2", -88, ["Samsung"]),
    ("AA:07", None, -92, ["Microsoft"]),
    ("AA:08", "SwitchBot Meter", -76, ["0x0969"]),
]

NEWCOMER = (77, "e0:5a:1b:aa:77:77", "Espressif Inc.", None, "ESP-77C1A0", "unknown", "none", ["arp"], [])
NEWCOMER_FLOWS = [("relay.x7iot-cloud.net", 12), ("47.243.12.9", 6)]


class DemoHousehold:
    def __init__(self):
        self.t0 = time.time()
        self.ticks = 0

    def _device(self, row, t):
        suffix, mac, vendor, model, host, guess, conf, sources, svcs = row
        ip = f"10.0.0.{suffix}"
        return ip, {
            "ip": ip, "mac": mac, "vendor": vendor, "model": model, "hostname": host,
            "names": [host] if host else [], "guess": guess, "confidence": conf, "sources": sources,
            "mdns_services": svcs, "upnp": {}, "randomized_mac": vendor is None and mac[1] in "26ae",
            "is_gateway": suffix == 1, "is_self": suffix == 10, "first_seen": self.t0, "last_seen": t,
        }

    def tick(self, atlas):
        t = time.time()
        self.ticks += 1
        newcomer_live = self.ticks >= 6
        rows = DEVICES + ([NEWCOMER] if newcomer_live else [])
        # a little coming and going so presence has something to show:
        #   the work laptop leaves ~60s in, the iPad drops in and out, the vacuum has been off for hours
        away = {14} if self.ticks >= 15 else set()
        if (self.ticks // 6) % 3 == 2:
            away.add(12)
        rows = [r for r in rows if r[0] not in away]
        if self.ticks == 1:
            vac = next(r for r in DEVICES if r[0] == 58)
            ip, rec = self._device(vac, self.t0 - 7200)
            atlas.devices[ip] = rec
        rows = [r for r in rows if r[0] != 58]
        for row in rows:
            ip, rec = self._device(row, t)
            if row is NEWCOMER:
                rec["first_seen"] = atlas.devices.get(ip, {}).get("first_seen", t)
            atlas.devices[ip] = rec
            atlas.multicast_pkts[ip] = random.randint(0, 3) + (8 if rec["mdns_services"] else 0)
        for ip_suffix, wanted in SEARCHES.items():
            atlas.searches[f"10.0.0.{ip_suffix}"] = set(wanted)
        for addr, name, rssi, makers in BLE:
            atlas.ble[addr] = {"address": addr, "name": name, "rssi": rssi + random.randint(-3, 3),
                               "manufacturers": makers, "service_uuids": [], "first_seen": self.t0, "last_seen": t}

        atlas.decay_flows(0.6)
        flows = dict(FLOWS)
        if newcomer_live:
            flows[77] = NEWCOMER_FLOWS
        for suffix, dests in flows.items():
            if suffix in away or suffix == 58:
                continue
            src = f"dev:10.0.0.{suffix}"
            for domain, rate in dests:
                for _ in range(max(0, int(random.gauss(rate, rate * 0.3)))):
                    atlas.add_flow(src, domain, "demo" if suffix == 10 else None)

        atlas.mark_presence(t)
        atlas.scan_count = self.ticks
        atlas.version += 1
        atlas.status = {"arp": "demo", "rdns": "demo", "mdns": "demo", "ssdp": "demo", "ble": "demo",
                        "multicast": "demo", "dns": "demo", "laptop": "demo"}
        atlas.meta = {"mode": "demo", "title": "HOUSE – ATLAS – V1", "subnet": "10.0.0.0/24",
                      "gateway": "10.0.0.1", "self_ip": "10.0.0.10", "subtitle": "synthetic demo household"}
