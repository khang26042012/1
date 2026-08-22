#!/usr/bin/env python3
"""Auto-fetch Vietnam proxies from multiple sources and update 9router proxy list.
Uses only stdlib (urllib) - no external dependencies needed."""

import json
import sys
import time
import urllib.request
import urllib.error
import re
import ssl
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

PROXY_SOURCES = {
    "proxyscrape": "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=5000&country=vn&ssl=yes&anonymity=all",
    "geonode": "https://proxylist.geonode.com/api/proxy-list?country=VN&limit=100&page=1&sort_by=speed&sort_type=asc&protocols=http%2Chttps",
    "monosans": "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt",
}

OUTPUT_FILE = Path(__file__).parent.parent / "data" / "vn-proxies.json"
TIMEOUT_SEC = 8
MAX_TEST = 50


def fetch_url(url, timeout=TIMEOUT_SEC):
    """Fetch URL content using stdlib urllib."""
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            return resp.read().decode("utf-8", errors="ignore")
    except Exception as e:
        print(f"  Fetch error for {url[:60]}...: {e}")
        return ""


def fetch_source(name, url):
    """Fetch and parse proxies from a single source."""
    text = fetch_url(url)
    if not text:
        print(f"[{name}] No data returned")
        return []

    proxies = []
    if name == "geonode":
        try:
            data = json.loads(text)
            for p in data.get("data", []):
                if "ip" in p and "port" in p:
                    proxies.append(f"{p['ip']}:{p['port']}")
        except (json.JSONDecodeError, KeyError):
            pass
    else:
        for line in text.strip().split("\n"):
            line = line.strip()
            if re.match(r'^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d{2,5}$', line):
                proxies.append(line)

    print(f"[{name}] Fetched {len(proxies)} proxies")
    return proxies


def check_proxy(proxy_str):
    """Test if a proxy is alive by connecting through it."""
    host, port = proxy_str.split(":")
    proxy_handler = urllib.request.ProxyHandler({
        "http": f"http://{proxy_str}",
        "https": f"http://{proxy_str}",
    })
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    opener = urllib.request.build_opener(
        proxy_handler,
        urllib.request.HTTPSHandler(context=ctx),
    )
    start = time.time()
    try:
        req = urllib.request.Request("http://httpbin.org/ip", headers={"User-Agent": "Mozilla/5.0"})
        with opener.open(req, timeout=5) as resp:
            if resp.status == 200:
                latency = int((time.time() - start) * 1000)
                return {"host": host, "port": int(port), "latency_ms": latency, "alive": True}
    except Exception:
        pass
    return None


def main():
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    all_proxies = set()

    # Fetch all sources concurrently
    print("=== Fetching Vietnam Proxies ===")
    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = {executor.submit(fetch_source, n, u): n for n, u in PROXY_SOURCES.items()}
        for future in as_completed(futures):
            result = future.result()
            all_proxies.update(result)

    print(f"\nTotal unique proxies: {len(all_proxies)}")

    # Test connectivity
    test_list = list(all_proxies)[:MAX_TEST]
    print(f"Testing connectivity ({len(test_list)} proxies)...")

    alive = []
    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {executor.submit(check_proxy, p): p for p in test_list}
        for future in as_completed(futures):
            result = future.result()
            if result is not None:
                alive.append(result)

    alive.sort(key=lambda x: x["latency_ms"])

    output = {
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "total_fetched": len(all_proxies),
        "tested": len(test_list),
        "alive_count": len(alive),
        "proxies": alive,
    }
    with open(OUTPUT_FILE, "w") as f:
        json.dump(output, f, indent=2)

    print(f"\nSaved {len(alive)} alive proxies to {OUTPUT_FILE}")
    if alive:
        print(f"Fastest: {alive[0]['host']}:{alive[0]['port']} ({alive[0]['latency_ms']}ms)")
    return len(alive)


if __name__ == "__main__":
    count = main()
    sys.exit(0 if count > 0 else 1)
