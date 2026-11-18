#!/usr/bin/env python3
"""
home_scan.py - inventory the smart devices on your home network and nearby Bluetooth LE.

Discovery layers (run concurrently):
  1. ARP sweep          -> every IP host on the subnet + MAC address -> manufacturer (OUI)
  2. Reverse DNS        -> DHCP hostnames your router hands out (e.g. "Ring-Doorbell-3f2a")
  3. mDNS / DNS-SD      -> service announcements (_googlecast, _hap, _matterc, _hue, ...)
                           plus TXT records that often carry the exact model ("Google Nest Mini")
  4. SSDP / UPnP        -> M-SEARCH responses + device description XML (friendlyName, model)
  5. BLE advertisements -> nearby Bluetooth devices, manufacturer IDs, signal strength

Everything is merged per IP into one inventory with a best-guess device type and a
confidence level, printed as a table and written to JSON.

Only scan networks you own or have explicit permission to scan.

Setup:
  pip install zeroconf bleak mac-vendor-lookup
  pip install scapy        # optional (GPL-2.0): raw ARP; without it the OS ARP cache is used

Run:
  sudo python3 home_scan.py                  # full scan; raw ARP needs root/admin
  python3 home_scan.py                       # no root: falls back to the OS ARP cache
  python3 home_scan.py --subnet 192.168.1.0/24 --timeout 10 --no-ble --out inv.json

Notes:
  - macOS: grant your terminal Bluetooth + Local Network permission (System Settings > Privacy).
  - Windows: raw ARP needs Npcap; without it the ARP-cache fallback is used automatically.
  - Zigbee / Z-Wave / Thread end devices are invisible from a laptop. You'll see their *hubs*
    (Hue bridge, SmartThings, Echo) here; the devices behind them need a radio dongle.
"""
from __future__ import annotations

import argparse
import asyncio
import concurrent.futures as cf
import ipaddress
import json
import re
import socket
import subprocess
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field

# --------------------------------------------------------------------------------------
# Reference data
# --------------------------------------------------------------------------------------

# Browsed in addition to whatever the network itself reports via _services._dns-sd._udp
COMMON_MDNS_TYPES = [
    "_googlecast._tcp.local.", "_hap._tcp.local.", "_matter._tcp.local.", "_matterc._udp.local.",
    "_meshcop._udp.local.", "_hue._tcp.local.", "_sonos._tcp.local.", "_airplay._tcp.local.",
    "_raop._tcp.local.", "_spotify-connect._tcp.local.", "_esphomelib._tcp.local.",
    "_ipp._tcp.local.", "_printer._tcp.local.", "_amzn-wplay._tcp.local.", "_shelly._tcp.local.",
    "_androidtvremote2._tcp.local.", "_companion-link._tcp.local.", "_http._tcp.local.",
    "_elg._tcp.local.", "_miio._udp.local.", "_smb._tcp.local.",
]

# TXT keys worth keeping (model / friendly-name carriers across common service types)
TXT_MODEL_KEYS = ("md", "model", "modelid", "am", "rpMd", "ty", "product")
TXT_NAME_KEYS = ("fn", "name")
TXT_KEEP = set(TXT_MODEL_KEYS + TXT_NAME_KEYS + ("ci", "manufacturer", "vendor", "mf"))

# HomeKit accessory category IDs (TXT key "ci" on _hap._tcp)
HAP_CATEGORIES = {
    2: "bridge", 3: "fan", 4: "garage door opener", 5: "light", 6: "door lock", 7: "outlet",
    8: "switch", 9: "thermostat", 10: "sensor", 11: "security system", 12: "door", 13: "window",
    14: "window covering", 15: "programmable switch", 17: "IP camera", 18: "video doorbell",
    19: "air purifier", 20: "heater", 21: "air conditioner", 22: "humidifier",
    23: "dehumidifier", 28: "sprinkler", 31: "television", 32: "remote",
}

# Bluetooth SIG company identifiers seen most often in homes
BLE_COMPANY_IDS = {
    0x004C: "Apple", 0x0006: "Microsoft", 0x0075: "Samsung", 0x00E0: "Google",
    0x0171: "Amazon", 0x038F: "Xiaomi",
}

# (regex over all evidence for a host, guess, confidence) - first match wins, most specific first
RULES: list[tuple[str, str, str]] = [
    (r"_matterc\._udp", "Matter device (waiting to be paired)", "high"),
    (r"_meshcop\._udp", "Thread border router", "high"),
    (r"_hue\._tcp|philips hue|signify", "Philips Hue bridge", "high"),
    (r"_sonos|sonos", "Sonos speaker", "high"),
    (r"_esphomelib", "ESPHome device", "high"),
    (r"_shelly|shelly", "Shelly relay / plug / meter", "high"),
    (r"_googlecast|google nest|chromecast", "Google Cast device (Nest speaker / Chromecast / TV)", "high"),
    (r"roku", "Roku streamer / TV", "high"),
    (r"_ipp\._tcp|_printer\._tcp|printer|epson|brother industries|canon|hewlett", "Printer", "high"),
    (r"raspberry pi", "Raspberry Pi", "high"),
    (r"ecobee", "ecobee thermostat", "high"),
    (r"nest labs", "Nest thermostat / camera / protect", "medium"),
    (r"\bring\b|ring[-_]", "Ring doorbell / camera", "medium"),
    (r"_amzn-wplay|amazon|\becho\b|fire ?tv", "Amazon Echo / Fire TV", "medium"),
    (r"myq|chamberlain", "Garage door controller", "medium"),
    (r"wyze", "Wyze camera / sensor hub", "medium"),
    (r"tp-link|kasa|tapo", "TP-Link Kasa / Tapo plug, bulb or camera", "medium"),
    (r"lutron", "Lutron Caseta bridge", "medium"),
    (r"rachio", "Rachio sprinkler controller", "medium"),
    (r"tuya", "Tuya-based plug / bulb / sensor", "medium"),
    (r"lg electronics|webos|\blgwebos", "LG TV / appliance", "medium"),
    (r"samsung", "Samsung TV / SmartThings hub / appliance", "medium"),
    (r"vizio|hisense|tcl", "Smart TV", "medium"),
    (r"espressif", "ESP32/ESP8266 device (often Tuya, WiZ, Shelly or DIY)", "medium"),
    (r"_hap\._tcp", "HomeKit accessory", "medium"),
    (r"_airplay|_raop|_companion-link|\bapple\b", "Apple device (Apple TV / HomePod / Mac / iPhone)", "medium"),
    (r"internetgatewaydevice|eero|netgear|ubiquiti|asustek|arris|router|gateway", "Router / gateway / mesh node", "medium"),
    (r"intel corp|liteon|azurewave|hon hai|murata|dell|lenovo|microsoft", "Computer / phone (Wi-Fi chipset vendor)", "low"),
]

# --------------------------------------------------------------------------------------
# Model
# --------------------------------------------------------------------------------------


@dataclass
class Device:
    ip: str
    mac: str | None = None
    vendor: str | None = None
    randomized_mac: bool = False
    hostname: str | None = None
    model: str | None = None
    names: set[str] = field(default_factory=set)
    mdns_services: set[str] = field(default_factory=set)
    mdns_txt: dict[str, str] = field(default_factory=dict)
    upnp: dict[str, str] = field(default_factory=dict)
    ssdp_server: str | None = None
    sources: set[str] = field(default_factory=set)
    guess: str = "unknown"
    confidence: str = "none"

    def evidence(self) -> str:
        parts = [self.vendor, self.hostname, self.model, self.ssdp_server, *self.names,
                 *self.mdns_services, *self.mdns_txt.values(), *self.upnp.values()]
        return " ".join(p for p in parts if p).lower()

    def to_json(self) -> dict:
        return {
            "ip": self.ip, "mac": self.mac, "vendor": self.vendor,
            "randomized_mac": self.randomized_mac, "hostname": self.hostname,
            "model": self.model, "names": sorted(self.names),
            "mdns_services": sorted(self.mdns_services), "mdns_txt": self.mdns_txt,
            "upnp": self.upnp, "ssdp_server": self.ssdp_server,
            "sources": sorted(self.sources), "guess": self.guess, "confidence": self.confidence,
        }


# --------------------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------------------

MAC_RE = re.compile(r"(?:[0-9a-f]{1,2}[:-]){5}[0-9a-f]{1,2}", re.I)
IP_RE = re.compile(r"\b(\d{1,3}(?:\.\d{1,3}){3})\b")


def normalize_mac(mac: str) -> str:
    return ":".join(p.zfill(2) for p in re.split(r"[:-]", mac)).lower()


def is_randomized(mac: str) -> bool:
    """Locally-administered bit set -> phone/laptop 'private Wi-Fi address', not a real OUI."""
    return bool(int(mac.split(":")[0], 16) & 0x02)


def local_ipv4() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))  # no packet is sent; just picks the outbound iface
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def warn(msg: str) -> None:
    print(f"  [!] {msg}", file=sys.stderr)


# --------------------------------------------------------------------------------------
# Layer 1: ARP
# --------------------------------------------------------------------------------------


def arp_raw(subnet: ipaddress.IPv4Network, timeout: float) -> dict[str, str]:
    from scapy.all import ARP, Ether, conf, srp  # type: ignore

    conf.verb = 0
    ans, _ = srp(Ether(dst="ff:ff:ff:ff:ff:ff") / ARP(pdst=str(subnet)), timeout=timeout, retry=1)
    return {r.psrc: normalize_mac(r.hwsrc) for _, r in ans}


def arp_cache(subnet: ipaddress.IPv4Network, wait: float) -> dict[str, str]:
    """No-root fallback: poke every host with an empty UDP datagram so the OS resolves and
    caches its MAC, then read the ARP table."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    for ip in subnet.hosts():
        try:
            sock.sendto(b"", (str(ip), 9))  # discard port; payload is irrelevant
        except OSError:
            pass
    sock.close()
    time.sleep(wait)

    out = ""
    cmd = ["arp", "-a"] if sys.platform == "win32" else ["arp", "-an"]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=10).stdout
    except (FileNotFoundError, subprocess.TimeoutExpired):
        try:
            with open("/proc/net/arp") as f:
                out = f.read()
        except OSError:
            return {}

    table: dict[str, str] = {}
    for line in out.splitlines():
        ip_m, mac_m = IP_RE.search(line), MAC_RE.search(line)
        if not (ip_m and mac_m):
            continue
        ip = ip_m.group(1)
        try:
            if ipaddress.ip_address(ip) not in subnet:
                continue
        except ValueError:
            continue
        mac = normalize_mac(mac_m.group(0))
        if mac not in ("ff:ff:ff:ff:ff:ff", "00:00:00:00:00:00"):
            table[ip] = mac
    return table


def arp_scan(subnet: ipaddress.IPv4Network, timeout: float, allow_raw: bool) -> tuple[dict[str, str], str]:
    if allow_raw:
        try:
            return arp_raw(subnet, timeout), "raw ARP"
        except Exception as e:  # ImportError, PermissionError, Scapy_Exception (no bpf/npcap)
            warn(f"raw ARP unavailable ({type(e).__name__}: {e}); using OS ARP cache instead")
    return arp_cache(subnet, wait=min(timeout, 3)), "ARP cache"


# --------------------------------------------------------------------------------------
# Layer 2: reverse DNS (DHCP hostnames)
# --------------------------------------------------------------------------------------


def reverse_dns(ips: list[str], timeout: float) -> dict[str, str]:
    def lookup(ip: str) -> tuple[str, str | None]:
        try:
            return ip, socket.gethostbyaddr(ip)[0]
        except (socket.herror, socket.gaierror, OSError):
            return ip, None

    results: dict[str, str] = {}
    pool = cf.ThreadPoolExecutor(max_workers=32)
    futures = [pool.submit(lookup, ip) for ip in ips]
    done, _ = cf.wait(futures, timeout=timeout)
    for f in done:
        ip, name = f.result()
        if name and name != ip:
            results[ip] = name
    pool.shutdown(wait=False, cancel_futures=True)
    return results


# --------------------------------------------------------------------------------------
# Layer 3: mDNS / DNS-SD
# --------------------------------------------------------------------------------------


def mdns_scan(timeout: float) -> list[dict]:
    from zeroconf import IPVersion, ServiceBrowser, ServiceListener, Zeroconf, ZeroconfServiceTypes

    zc = Zeroconf(ip_version=IPVersion.V4Only)
    try:
        types = set(COMMON_MDNS_TYPES)
        try:
            types |= set(ZeroconfServiceTypes.find(zc=zc, timeout=min(3.0, timeout)))
        except Exception as e:
            warn(f"mDNS service-type enumeration failed: {e}")

        found: set[tuple[str, str]] = set()

        class Listener(ServiceListener):
            def add_service(self, zc, type_, name):  # noqa: D401
                found.add((type_, name))

            def update_service(self, zc, type_, name):
                found.add((type_, name))

            def remove_service(self, zc, type_, name):
                pass

        browser = ServiceBrowser(zc, sorted(types), Listener())
        time.sleep(timeout)
        browser.cancel()

        records = []
        for type_, name in sorted(found):
            info = zc.get_service_info(type_, name, timeout=1500)
            if not info:
                continue
            txt: dict[str, str] = {}
            for k, v in (info.properties or {}).items():
                try:
                    key = k.decode() if isinstance(k, bytes) else str(k)
                    if key in TXT_KEEP:
                        txt[key] = (v.decode() if isinstance(v, bytes) else (v or ""))[:80]
                except UnicodeDecodeError:
                    continue
            records.append({
                "type": type_, "name": name, "server": info.server,
                "addresses": info.parsed_addresses(IPVersion.V4Only), "port": info.port, "txt": txt,
            })
        return records
    finally:
        zc.close()


# --------------------------------------------------------------------------------------
# Layer 4: SSDP / UPnP
# --------------------------------------------------------------------------------------


def fetch_upnp_description(url: str) -> dict[str, str]:
    try:
        with urllib.request.urlopen(url, timeout=2) as r:  # noqa: S310 (LAN device URL)
            root = ET.fromstring(r.read(200_000))
    except Exception:
        return {}
    out: dict[str, str] = {}
    for el in root.iter():
        tag = el.tag.split("}")[-1]
        if tag in ("friendlyName", "manufacturer", "modelName", "modelNumber", "deviceType") \
                and tag not in out and el.text and el.text.strip():
            out[tag] = el.text.strip()[:80]
    return out


def ssdp_scan(timeout: float) -> dict[str, dict]:
    msg = "\r\n".join([
        "M-SEARCH * HTTP/1.1", "HOST: 239.255.255.250:1900", 'MAN: "ssdp:discover"',
        "MX: 2", "ST: ssdp:all", "", "",
    ]).encode()
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 2)
    sock.settimeout(0.5)

    hosts: dict[str, dict] = {}
    try:
        for _ in range(2):
            sock.sendto(msg, ("239.255.255.250", 1900))
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                data, (ip, _port) = sock.recvfrom(65507)
            except socket.timeout:
                continue
            headers = {}
            for line in data.decode(errors="ignore").split("\r\n")[1:]:
                if ":" in line:
                    k, v = line.split(":", 1)
                    headers[k.strip().lower()] = v.strip()
            h = hosts.setdefault(ip, {"server": None, "locations": set()})
            h["server"] = h["server"] or headers.get("server")
            if headers.get("location"):
                h["locations"].add(headers["location"])
    except OSError as e:
        warn(f"SSDP failed: {e}")
    finally:
        sock.close()

    # One description fetch per host is enough to identify it
    with cf.ThreadPoolExecutor(max_workers=16) as pool:
        futures = {pool.submit(fetch_upnp_description, sorted(h["locations"])[0]): ip
                   for ip, h in hosts.items() if h["locations"]}
        for f in cf.as_completed(futures):
            hosts[futures[f]]["description"] = f.result()
    for h in hosts.values():
        h["locations"] = sorted(h["locations"])
    return hosts


# --------------------------------------------------------------------------------------
# Layer 5: Bluetooth LE
# --------------------------------------------------------------------------------------


async def ble_scan(timeout: float) -> list[dict]:
    from bleak import BleakScanner

    found = await BleakScanner.discover(timeout=timeout, return_adv=True)
    out = []
    for addr, (dev, adv) in found.items():
        makers = [BLE_COMPANY_IDS.get(cid, f"0x{cid:04X}") for cid in adv.manufacturer_data]
        out.append({
            "address": addr, "name": adv.local_name or dev.name, "rssi": adv.rssi,
            "manufacturers": makers, "service_uuids": list(adv.service_uuids),
        })
    return sorted(out, key=lambda d: -(d["rssi"] if d["rssi"] is not None else -999))


# --------------------------------------------------------------------------------------
# Vendor lookup + classification
# --------------------------------------------------------------------------------------


def lookup_vendors(macs: list[str]) -> dict[str, str]:
    """Must run outside any running asyncio loop (mac-vendor-lookup uses its own)."""
    try:
        from mac_vendor_lookup import MacLookup
    except ImportError:
        warn("mac-vendor-lookup not installed; skipping manufacturer lookup")
        return {}
    ml = MacLookup()
    out: dict[str, str] = {}
    for mac in macs:
        if is_randomized(mac):
            continue
        try:
            out[mac] = ml.lookup(mac)
        except Exception:
            continue  # unknown OUI, or vendor list could not be downloaded
    return out


def classify(d: Device) -> None:
    ci = d.mdns_txt.get("ci", "")
    if "_hap._tcp.local." in d.mdns_services and ci.isdigit() and int(ci) in HAP_CATEGORIES:
        d.guess, d.confidence = f"HomeKit {HAP_CATEGORIES[int(ci)]}", "high"
        return
    blob = d.evidence()
    for pattern, label, conf in RULES:
        if re.search(pattern, blob):
            d.guess, d.confidence = label, conf
            return
    if d.randomized_mac:
        d.guess, d.confidence = "Phone / tablet / laptop (private MAC)", "low"


# --------------------------------------------------------------------------------------
# Orchestration
# --------------------------------------------------------------------------------------


async def gather_layers(args, subnet):
    tasks = {
        "arp": asyncio.to_thread(arp_scan, subnet, args.timeout, not args.no_raw_arp),
        "mdns": asyncio.to_thread(mdns_scan, args.timeout),
        "ssdp": asyncio.to_thread(ssdp_scan, args.timeout),
    }
    if not args.no_ble:
        tasks["ble"] = ble_scan(args.timeout)
    results = await asyncio.gather(*tasks.values(), return_exceptions=True)
    out = {}
    for name, res in zip(tasks, results):
        if isinstance(res, BaseException):
            hint = " (pip install it?)" if isinstance(res, ImportError) else ""
            warn(f"{name} layer failed: {type(res).__name__}: {res}{hint}")
            res = None
        out[name] = res
    return out


def merge(subnet, layers) -> dict[str, Device]:
    devices: dict[str, Device] = {}

    def dev(ip: str) -> Device:
        return devices.setdefault(ip, Device(ip=ip))

    arp_table, _method = layers.get("arp") or ({}, "")
    for ip, mac in arp_table.items():
        d = dev(ip)
        d.mac, d.randomized_mac = mac, is_randomized(mac)
        d.sources.add("arp")

    for rec in layers.get("mdns") or []:
        for ip in rec["addresses"]:
            try:
                if ipaddress.ip_address(ip) not in subnet:
                    continue
            except ValueError:
                continue
            d = dev(ip)
            d.sources.add("mdns")
            d.mdns_services.add(rec["type"])
            d.mdns_txt.update(rec["txt"])
            if rec["server"]:
                d.names.add(rec["server"].rstrip(".").removesuffix(".local"))
            for k in TXT_NAME_KEYS:
                if rec["txt"].get(k):
                    d.names.add(rec["txt"][k])
            for k in TXT_MODEL_KEYS:
                if rec["txt"].get(k) and not d.model:
                    d.model = rec["txt"][k]

    for ip, h in (layers.get("ssdp") or {}).items():
        d = dev(ip)
        d.sources.add("ssdp")
        d.ssdp_server = h.get("server")
        desc = h.get("description") or {}
        d.upnp = desc
        if desc.get("friendlyName"):
            d.names.add(desc["friendlyName"])
        if desc.get("modelName") and not d.model:
            mfr, mdl = desc.get("manufacturer") or "", desc["modelName"]
            d.model = mdl if not mfr or mdl.lower().startswith(mfr.lower()) else f"{mfr} {mdl}"

    return devices


def print_table(devices: list[Device], ble: list[dict] | None, method: str) -> None:
    conf_rank = {"high": 0, "medium": 1, "low": 2, "none": 3}
    print(f"\nNetwork devices: {len(devices)}  (ARP via {method or 'n/a'})\n")
    hdr = f"{'IP':<15} {'Vendor':<22} {'Name / model':<34} {'Best guess':<44} {'Conf':<6} Sources"
    print(hdr)
    print("-" * len(hdr))
    for d in sorted(devices, key=lambda d: ipaddress.ip_address(d.ip)):
        vendor = d.vendor or ("(private MAC)" if d.randomized_mac else "-")
        label = " | ".join(x for x in [next(iter(sorted(d.names)), None), d.model] if x) or d.hostname or "-"
        print(f"{d.ip:<15} {vendor[:22]:<22} {label[:34]:<34} {d.guess[:44]:<44} "
              f"{d.confidence:<6} {','.join(sorted(d.sources))}")

    counts: dict[str, int] = {}
    for d in devices:
        counts[d.confidence] = counts.get(d.confidence, 0) + 1
    print("\nIdentified: " + ", ".join(f"{counts.get(c, 0)} {c}" for c in sorted(conf_rank, key=conf_rank.get)))

    if ble is not None:
        print(f"\nBluetooth LE devices nearby: {len(ble)} (strongest signal first, top 25)")
        for b in ble[:25]:
            makers = ",".join(b["manufacturers"]) or "-"
            print(f"  {str(b['rssi']):>4} dBm  {str(b['name'] or '-')[:30]:<30} {makers[:30]:<30} {b['address']}")


def main() -> None:
    ap = argparse.ArgumentParser(description="Discover smart-home devices on your own network.")
    ap.add_argument("--subnet", help="CIDR to scan (default: your current /24)")
    ap.add_argument("--timeout", type=float, default=6.0, help="seconds per discovery layer")
    ap.add_argument("--no-ble", action="store_true", help="skip the Bluetooth LE scan")
    ap.add_argument("--no-raw-arp", action="store_true", help="never try raw ARP; use OS cache")
    ap.add_argument("--out", default="home_inventory.json", help="JSON output path")
    args = ap.parse_args()

    if args.subnet:
        subnet = ipaddress.ip_network(args.subnet, strict=False)
    else:
        subnet = ipaddress.ip_network(f"{local_ipv4()}/24", strict=False)
    if subnet.num_addresses > 4096:
        sys.exit(f"Refusing to sweep {subnet} ({subnet.num_addresses} addresses); pass a smaller --subnet")

    print(f"Scanning {subnet} for ~{args.timeout:.0f}s per layer "
          f"(ARP, mDNS, SSDP{'' if args.no_ble else ', BLE'})...")
    started = time.time()
    layers = asyncio.run(gather_layers(args, subnet))

    devices = merge(subnet, layers)

    # Post-passes that need plain (non-async) context
    for ip, name in reverse_dns(list(devices), timeout=5).items():
        devices[ip].hostname = name
        devices[ip].sources.add("rdns")
    vendors = lookup_vendors([d.mac for d in devices.values() if d.mac])
    for d in devices.values():
        if d.mac:
            d.vendor = vendors.get(d.mac)
        classify(d)

    method = (layers.get("arp") or ({}, ""))[1]
    print_table(list(devices.values()), layers.get("ble"), method)

    payload = {
        "scanned_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "subnet": str(subnet),
        "duration_s": round(time.time() - started, 1),
        "arp_method": method,
        "devices": [d.to_json() for d in sorted(devices.values(), key=lambda d: ipaddress.ip_address(d.ip))],
        "ble": layers.get("ble"),
    }
    with open(args.out, "w") as f:
        json.dump(payload, f, indent=2)
    print(f"\nWrote {args.out}  ({payload['duration_s']}s)")


if __name__ == "__main__":
    main()
