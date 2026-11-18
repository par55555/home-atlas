#!/usr/bin/env python3
"""
House Atlas self-test: runs ONE full live scan (no web server) and writes everything that
came back - per-layer raw output, layer status, and the final graph - to
atlas_test_report.json, plus a readable summary in the terminal.

    sudo .venv/bin/python selftest.py            # full test
    .venv/bin/python selftest.py --no-ble        # skip Bluetooth

The report contains your devices' IPs, MACs and hostnames (no passwords, no traffic contents).
"""
import argparse
import asyncio
import json
import platform
import sys
import time
from collections import Counter

import server


async def run(args):
    atlas = server.Atlas()
    t = time.time()
    await server.scan_once(atlas, args)
    graph = atlas.graph()
    report = {
        "system": {"platform": platform.platform(), "python": sys.version.split()[0],
                   "root": graph["meta"].get("root"), "seconds": round(time.time() - t, 1)},
        "status": atlas.status,
        "meta": graph["meta"],
        "raw": json.loads(json.dumps(atlas.raw_last, default=list)),
        "graph": json.loads(json.dumps(graph, default=list)),
    }
    with open("atlas_test_report.json", "w") as f:
        json.dump(report, f, indent=2)

    nodes = graph["nodes"]
    print(f"\n=== House Atlas self-test  ({report['system']['seconds']}s, root={report['system']['root']}) ===")
    print(f"subnet {graph['meta'].get('subnet')}   gateway {graph['meta'].get('gateway')}   this Mac {graph['meta'].get('self_ip')}\n")
    print("LAYER STATUS")
    for k, v in atlas.status.items():
        print(f"  {k:<10} {v}")
    print("\nCLUSTERS  ", dict(Counter(n["cluster"] for n in nodes)))
    print("LINKS     ", dict(Counter(lk["kind"] for lk in graph["links"])))
    print("\nDEVICES")
    for n in sorted((n for n in nodes if n["kind"] in ("device", "gateway")), key=lambda n: n["cluster"]):
        print(f"  {n['cluster']:<14} {str(n.get('ip')):<15} {str(n['label'])[:34]:<34} "
              f"{str(n.get('guess'))[:40]:<40} {','.join(n['layers'])}")
    ble = [n for n in nodes if n["kind"] == "ble"]
    if ble:
        print(f"\nBLUETOOTH ({len(ble)})")
        for n in ble[:15]:
            print(f"  {str(n.get('rssi')):>4} dBm  {str(n['label'])[:40]}")
    ext = [n for n in nodes if n["kind"] == "external"]
    if ext:
        print(f"\nDESTINATIONS ({len(ext)}): " + ", ".join(n["label"] for n in ext[:25]))
    print("\nFull output written to atlas_test_report.json - attach it in the chat.\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--subnet")
    ap.add_argument("--timeout", type=float, default=8.0)
    ap.add_argument("--no-ble", action="store_true")
    asyncio.run(run(ap.parse_args()))


if __name__ == "__main__":
    main()
