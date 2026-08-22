/**
 * Proxy Rotation Manager for 9router
 * 
 * Auto-rotates through Vietnam proxies from data/vn-proxies.json.
 * Tracks failures per proxy and removes dead ones automatically.
 * Periodically refreshes proxy list via fetch-vn-proxies.py script.
 * 
 * Integration: Import getActiveProxy() in proxyFetch.js to get current proxy URL.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execFile } from "child_process";
import { dbg } from "./debugLog.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "../../data");
const PROXY_FILE = join(DATA_DIR, "vn-proxies.json");
const STATE_FILE = join(DATA_DIR, "proxy-state.json");

// Configuration
const MAX_FAILURES = 3;           // Remove proxy after N consecutive failures
const REFRESH_INTERVAL_MS = 30 * 60 * 1000;  // Refresh proxy list every 30 min
const MIN_PROXIES_THRESHOLD = 3;  // Trigger emergency refresh if below this

class ProxyRotationManager {
  constructor() {
    this.proxies = [];          // Array of {host, port, latency_ms}
    this.failures = new Map();  // proxy_key -> consecutive failure count
    this.currentIndex = 0;
    this.lastRefresh = 0;
    this.refreshing = false;
    this.initialized = false;
  }

  /**
   * Load proxies from JSON file
   */
  loadProxies() {
    try {
      if (!existsSync(PROXY_FILE)) {
        dbg("PROXY", `No proxy file found at ${PROXY_FILE}`);
        return false;
      }
      const raw = readFileSync(PROXY_FILE, "utf-8");
      const data = JSON.parse(raw);
      this.proxies = (data.proxies || []).filter(p => p.host && p.port);
      this.lastRefresh = Date.now();
      this.initialized = true;
      
      // Reset failures for proxies still in list
      const validKeys = new Set(this.proxies.map(p => `${p.host}:${p.port}`));
      for (const key of this.failures.keys()) {
        if (!validKeys.has(key)) this.failures.delete(key);
      }
      
      dbg("PROXY", `Loaded ${this.proxies.length} proxies from ${PROXY_FILE}`);
      return this.proxies.length > 0;
    } catch (e) {
      dbg("PROXY", `Failed to load proxies: ${e.message}`);
      return false;
    }
  }

  /**
   * Get next active proxy URL (round-robin with failure tracking)
   * Returns null if no proxies available
   */
  getActiveProxy() {
    if (!this.initialized) this.loadProxies();
    
    // Auto-refresh if stale
    if (Date.now() - this.lastRefresh > REFRESH_INTERVAL_MS && !this.refreshing) {
      this.triggerRefresh();
    }

    if (this.proxies.length === 0) return null;

    // Find next alive proxy
    let attempts = 0;
    while (attempts < this.proxies.length) {
      const proxy = this.proxies[this.currentIndex % this.proxies.length];
      const key = `${proxy.host}:${proxy.port}`;
      const fails = this.failures.get(key) || 0;
      
      if (fails < MAX_FAILURES) {
        this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
        return `http://${key}`;
      }
      
      this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
      attempts++;
    }

    // All proxies exceeded failure threshold - reset and try again
    dbg("PROXY", "All proxies failed, resetting failure counts");
    this.failures.clear();
    const fallback = this.proxies[0];
    return fallback ? `http://${fallback.host}:${fallback.port}` : null;
  }

  /**
   * Report success for a proxy (reset failure counter)
   */
  reportSuccess(proxyUrl) {
    const key = this.extractKey(proxyUrl);
    if (key && this.failures.has(key)) {
      this.failures.set(key, 0);
    }
  }

  /**
   * Report failure for a proxy (increment counter, remove if threshold exceeded)
   */
  reportFailure(proxyUrl, reason = "") {
    const key = this.extractKey(proxyUrl);
    if (!key) return;

    const fails = (this.failures.get(key) || 0) + 1;
    this.failures.set(key, fails);
    
    dbg("PROXY", `Proxy ${key} failure #${fails}: ${reason}`);

    if (fails >= MAX_FAILURES) {
      this.removeProxy(key);
    }

    // Emergency refresh if running low
    const aliveCount = this.proxies.filter(p => 
      (this.failures.get(`${p.host}:${p.port}`) || 0) < MAX_FAILURES
    ).length;
    
    if (aliveCount < MIN_PROXIES_THRESHOLD && !this.refreshing) {
      dbg("PROXY", `Only ${aliveCount} alive proxies left, triggering emergency refresh`);
      this.triggerRefresh();
    }
  }

  /**
   * Remove a proxy from the active list
   */
  removeProxy(key) {
    const idx = this.proxies.findIndex(p => `${p.host}:${p.port}` === key);
    if (idx !== -1) {
      this.proxies.splice(idx, 1);
      this.failures.delete(key);
      dbg("PROXY", `Removed dead proxy: ${key} (${this.proxies.length} remaining)`);
      
      // Adjust index if needed
      if (this.currentIndex >= this.proxies.length && this.proxies.length > 0) {
        this.currentIndex = 0;
      }
    }
  }

  /**
   * Trigger async refresh of proxy list via Python script
   */
  triggerRefresh() {
    if (this.refreshing) return;
    this.refreshing = true;

    const scriptPath = join(__dirname, "../../scripts/fetch-vn-proxies.py");
    dbg("PROXY", "Triggering proxy list refresh...");

    execFile("python3", [scriptPath], { timeout: 120000 }, (err, stdout, stderr) => {
      this.refreshing = false;
      if (err) {
        dbg("PROXY", `Refresh script failed: ${err.message}`);
        return;
      }
      this.loadProxies();
      dbg("PROXY", `Refresh complete: ${this.proxies.length} proxies loaded`);
    });
  }

  /**
   * Extract host:port key from proxy URL
   */
  extractKey(proxyUrl) {
    if (!proxyUrl) return null;
    try {
      const url = new URL(proxyUrl);
      return `${url.hostname}:${url.port}`;
    } catch {
      // Handle raw host:port format
      const match = proxyUrl.match(/(\d+\.\d+\.\d+\.\d+:\d+)/);
      return match ? match[1] : null;
    }
  }

  /**
   * Get stats for monitoring
   */
  getStats() {
    return {
      total: this.proxies.length,
      alive: this.proxies.filter(p => 
        (this.failures.get(`${p.host}:${p.port}`) || 0) < MAX_FAILURES
      ).length,
      currentIndex: this.currentIndex,
      lastRefresh: new Date(this.lastRefresh).toISOString(),
      refreshing: this.refreshing,
      failures: Object.fromEntries(this.failures),
    };
  }
}

// Singleton instance
const manager = new ProxyRotationManager();

export function getActiveProxy() {
  return manager.getActiveProxy();
}

export function reportProxySuccess(proxyUrl) {
  manager.reportSuccess(proxyUrl);
}

export function reportProxyFailure(proxyUrl, reason) {
  manager.reportFailure(proxyUrl, reason);
}

export function getProxyStats() {
  return manager.getStats();
}

export function forceProxyRefresh() {
  manager.triggerRefresh();
}

export default manager;

