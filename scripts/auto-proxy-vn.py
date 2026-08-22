#!/usr/bin/env python3
"""Auto-fetch Vietnam proxies from multiple sources and update 9router proxy list.
Uses only stdlib (urllib) - no external dependencies needed.

Sources:
  - ProxyScrape (VN filter)
  - Geonode (VN API)
  - Monosans GitHub list (global, filtered by IP range)
  - FreeProxyList.net
  - SSLProxies.org
  - Socks-Proxy.net (SOCKS4/5 converted to HTTP check)
  - OpenProxy.space
  - RootJazz
"""

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
    "freeproxylist": "https://www.freeproxylists.net/data/free_proxy_list.txt",
    "sslproxies": "https://www.sslproxies.org/wp-content/uploads/2024/01/ssl-proxies.txt",
    "openproxy": "https://api.openproxy.space/lists/http",
    "rootjazz": "https://rootjazz.com/proxies/proxies.txt",
}

OUTPUT_FILE = Path(__file__).parent.parent / "data" / "vn-proxies.json"
TIMEOUT_SEC = 8
MAX_TEST = 200  # Increased from 50 to test more candidates


def is_vn_ip(ip):
    """Check if IP belongs to Vietnam based on known VN IP ranges."""
    try:
        parts = ip.split(".")
        if len(parts) != 4:
            return False
        first = int(parts[0])
        second = int(parts[1])

        # Common VN ISP prefixes
        vn_first_octets = {
            14, 27, 36, 42, 45, 49, 58, 59, 61, 112, 113, 115, 116, 117,
            118, 119, 123, 125, 140, 150, 157, 160, 171, 183, 202, 203, 210
        }
        if first in vn_first_octets:
            return True

        # Specific VN subnets
        if first == 103 and 70 <= second <= 100:  # FPT/Viettel/MobiFone
            return True
        if first == 120 and 230 <= second <= 240:  # VNPT/Mobile
            return True
        if first == 219 and 140 <= second <= 150:  # Viettel
            return True
        if first == 171 and 230 <= second <= 255:  # CMC Telecom
            return True
        if first == 45 and second in range(112, 128):  # NetNam
            return True

        return False
    except (ValueError, IndexError):
        return False


def fetch_url(url, timeout=TIMEOUT_SEC):
    """Fetch URL content using stdlib urllib."""
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "text/html,application/json,text/plain,*/*",
        })
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
    elif name == "openproxy":
        # OpenProxy returns JSON array or plain text
        try:
            data = json.loads(text)
            if isinstance(data, list):
                for item in data:
                    if isinstance(item, str) and ":" in item:
                        proxies.append(item.strip())
                    elif isinstance(item, dict) and "ip" in item:
                        proxies.append(f"{item['ip']}:{item.get('port', '80')}")
        except json.JSONDecodeError:
            # Fallback to line-by-line parsing
            for line in text.strip().split("\n"):
                line = line.strip()
                if re.match(r'^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d{2,5}$', line):
                    proxies.append(line)
    else:
        # Generic line-by-line parsing
        for line in text.strip().split("\n"):
            line = line.strip()
            # Remove comments and extra whitespace
            if "#" in line:
                line = line.split("#")[0].strip()
            if re.match(r'^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d{2,5}$', line):
                proxies.append(line)

    print(f"[{name}] Fetched {len(proxies)} raw proxies")
    return proxies


def check_proxy(proxy_str):
    """Test if a proxy is alive by connecting through it."""
    try:
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
        req = urllib.request.Request("http://httpbin.org/ip", headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
        })
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
    with ThreadPoolExecutor(max_workers=6) as executor:
        futures = {executor.submit(fetch_source, n, u): n for n, u in PROXY_SOURCES.items()}
        for future in as_completed(futures):
            result = future.result()
            all_proxies.update(result)

    print(f"\nTotal unique proxies fetched: {len(all_proxies)}")

    # Filter to VN-only IPs before testing (save bandwidth)
    vn_candidates = [p for p in all_proxies if is_vn_ip(p.split(":")[0])]
    non_vn_count = len(all_proxies) - len(vn_candidates)
    print(f"VN candidates after IP filter: {len(vn_candidates)} (removed {non_vn_count} non-VN)")

    # Test connectivity (up to MAX_TEST)
    test_list = vn_candidates[:MAX_TEST]
    print(f"Testing connectivity ({len(test_list)} proxies)...")

    alive = []
    with ThreadPoolExecutor(max_workers=20) as executor:
        futures = {executor.submit(check_proxy, p): p for p in test_list}
        for future in as_completed(futures):
            result = future.result()
            if result is not None:
                alive.append(result)

    alive.sort(key=lambda x: x["latency_ms"])

    output = {
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "total_fetched": len(all_proxies),
        "vn_candidates": len(vn_candidates),
        "tested": len(test_list),
        "alive_count": len(alive),
        "proxies": alive,
    }
    with open(OUTPUT_FILE, "w") as f:
        json.dump(output, f, indent=2)

    print(f"\nSaved {len(alive)} alive VN proxies to {OUTPUT_FILE}")
    if alive:
        print(f"Fastest: {alive[0]['host']}:{alive[0]['port']} ({alive[0]['latency_ms']}ms)")
        print(f"Slowest: {alive[-1]['host']}:{alive[-1]['port']} ({alive[-1]['latency_ms']}ms)")
    else:
        print("WARNING: No alive VN proxies found!")

    return len(alive)


if __name__ == "__main__":
    count = main()
    sys.exit(0 if count > 0 else 1)

