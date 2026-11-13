// Playwright transport — lazy-initialized, pooled single browser instance.
// Shared across all providers that opt into transport: browser.
//
// Usage from a provider:
//   import { makeBrowserCtx } from './_browser.mjs';
//   const ctx = makeBrowserCtx();
//   const html = await ctx.fetchText(url);
//
// The browser is launched on first fetch and closed at process exit.

import { fetchJson as httpFetchJson } from './_http.mjs';
import { isBlockedAddress } from './_ip-guard.mjs';

const DEFAULT_NAVIGATE_TIMEOUT_MS = 30_000;

// LOCAL FIX 2026-10-09: _http.mjs no longer exports assertSafeHttpUrl (dropped by
// commit 12d98b58 when the HTTP transport moved to the address-level _ip-guard),
// which made this module — and so mid-filter.mjs — fail to load. This keeps the
// pre-navigation check for the browser transport, where the _ip-guard's DNS hook
// does not apply (Chromium resolves names itself). It rejects non-http(s) schemes,
// well-known local names, and private/loopback IP literals. It cannot catch a public
// name that resolves to a private address; that gap existed in the old string check too.
function assertSafeHttpUrl(rawUrl) {
  if (!rawUrl) throw new Error('Missing URL');
  let u;
  try { u = new URL(rawUrl); } catch {
    throw new Error(`Unparseable URL: ${String(rawUrl).slice(0, 80)}`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`Unsupported URL protocol: ${u.protocol}`);
  }
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const isIpLiteral = host.includes(':') || /^[0-9.]+$/.test(host);
  const isLocalName = host === 'localhost' || /\.(localhost|local|internal)$/.test(host);
  if (isLocalName || (isIpLiteral && isBlockedAddress(host))) {
    throw new Error(`Blocked URL host (loopback/private): ${host}`);
  }
}
let browserPromise = null;

async function getBrowser() {
  if (browserPromise) return browserPromise;
  browserPromise = (async () => {
    const { chromium } = await import('playwright');
    return await chromium.launch({ headless: true });
  })();
  // Clear the cache if the launch fails so a transient error doesn't poison
  // every later browser-transport entry sharing this module-level promise.
  browserPromise.catch(() => { browserPromise = null; });
  return browserPromise;
}

// Callers must invoke this once they're done — Playwright's IPC handle keeps
// the Node event loop alive, so the process won't exit on its own.
export async function closeBrowser() {
  if (!browserPromise) return;
  const p = browserPromise;
  browserPromise = null;
  try { await (await p).close(); } catch {}
}

async function withPage(fn) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (compatible; career-ops/1.3)',
  });
  const page = await context.newPage();
  try {
    return await fn(page);
  } finally {
    await context.close();
  }
}

export async function fetchText(url, { timeoutMs = DEFAULT_NAVIGATE_TIMEOUT_MS, waitUntil = 'domcontentloaded' } = {}) {
  // Same SSRF guard as the HTTP transport — reject loopback/private hosts
  // and non-http(s) schemes before page.goto() can probe internal networks.
  assertSafeHttpUrl(url);
  return await withPage(async page => {
    await page.goto(url, { timeout: timeoutMs, waitUntil });
    return await page.content();
  });
}

export async function fetchJson(url, opts = {}) {
  // JSON endpoints rarely need browser transport. Fall back to plain fetch.
  return await httpFetchJson(url, opts);
}

export function makeBrowserCtx() {
  return {
    transport: 'browser',
    fetchText,
    fetchJson,
    withPage,
  };
}
