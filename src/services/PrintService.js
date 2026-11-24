// services/printService.js
// Dashboard ka single print entry point.
//
//   printer.mode === 'browser'    -> purana flow (window.print / existing browserPrint function, preview ke saath)
//   printer.mode === 'usb_silent' -> bridge se computer ke installed printer pe, bina dialog
//   printer.mode === 'network'    -> bridge se WiFi printer ke IP:port pe
//
// Printer nahi mila (ya koi printer configured nahi) -> browser flow, yaani purane clients pe koi change nahi.
//
// Bridge version check: bridge >= NEW_OPS_MIN_VERSION ho to naye ops (row/box/boxrow/spacing)
// bhejte hain, warna purane bridge ke liye toTextOps se plain text lines.

import { formatOrderReceipt, formatTestReceipt, toTextOps } from './PrintFormatter';

const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:17890';
const NEW_OPS_MIN_VERSION = '1.3.0';

let bridge = { url: DEFAULT_BRIDGE_URL, token: '' };
let bridgeInfo = { version: null, checkedAt: 0 }; // /health ka cache

export function configurePrintBridge({ url, token } = {}) {
  if (url) bridge.url = url.replace(/\/+$/, '');
  if (token !== undefined) bridge.token = token;
  bridgeInfo = { version: null, checkedAt: 0 };
}

// ---------- bridge calls ----------
async function bridgeFetch(path, { method = 'GET', body, timeoutMs = 6000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${bridge.url}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(bridge.token ? { 'x-bridge-token': bridge.token } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || `Bridge error (${res.status})`);
    }
    return data;
  } catch (e) {
    if (e.name === 'AbortError' || e instanceof TypeError) {
      throw new Error('Print Bridge se connect nahi ho paya. Bridge is computer par chal raha hai?');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function checkBridge() {
  try {
    const data = await bridgeFetch('/health', { timeoutMs: 2500 });
    bridgeInfo = { version: data.version || '0.0.0', checkedAt: Date.now() };
    return true;
  } catch (e) {
    return false;
  }
}

// "1.2.0" vs "1.3.0" compare
const versionGte = (v, min) => {
  const a = String(v || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const b = String(min).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) > (b[i] || 0)) return true;
    if ((a[i] || 0) < (b[i] || 0)) return false;
  }
  return true;
};

// Bridge ka version (30 sec cache). Pata na chale to '0.0.0' (yaani purana maano).
async function getBridgeVersion() {
  if (bridgeInfo.version && Date.now() - bridgeInfo.checkedAt < 30000) return bridgeInfo.version;
  try {
    const data = await bridgeFetch('/health', { timeoutMs: 2500 });
    bridgeInfo = { version: data.version || '0.0.0', checkedAt: Date.now() };
    return bridgeInfo.version;
  } catch (e) {
    return '0.0.0';
  }
}

// USB (silent) mode ke liye: is computer me installed printers ki list
export async function listSystemPrinters() {
  const data = await bridgeFetch('/printers/system', { timeoutMs: 10000 });
  return data.printers || [];
}

// Settings: USB/installed + same-network WiFi printers khud dhundho (scan me kuch second lagte hain)
export async function discoverPrinters() {
  const data = await bridgeFetch('/discover', { timeoutMs: 40000 });
  return { usb: data.usb || [], network: data.network || [], subnets: data.subnets || [] };
}

// ---------- printer selection ----------
const norm = (v) => String(v == null ? '' : v).trim().toLowerCase();

// Order ke outlet/station ke hisaab se printer chunta hai.
//   1) outlet match karne wala printer
//   2) bina outlet wala default printer
//   3) koi bhi default printer
// Kuch nahi mila -> null (caller browser flow chalaye)
export function pickPrinterForOrder(printers = [], order = {}) {
  const active = printers.filter((p) => p && p.active !== false);
  if (active.length === 0) return null;

  const station = norm(order.station || order.deliveryStation || order.outlet);

  if (station) {
    const matched = active.filter((p) => norm(p.outletId) === station);
    if (matched.length) return matched.find((p) => p.isDefault) || matched[0];
  }

  const generic = active.filter((p) => !norm(p.outletId));
  if (generic.length) return generic.find((p) => p.isDefault) || generic[0];

  return active.find((p) => p.isDefault) || null;
}

// ---------- printing ----------
function toBridgePayload(printer, receipt) {
  return {
    mode: printer.mode,
    ip: printer.ip,
    port: printer.port || 9100,
    printerName: printer.systemPrinterName,
    receipt,
  };
}

/**
 * Order print karo.
 *
 * @param {object} order
 * @param {object|null} printer  pickPrinterForOrder() ka result
 * @param {object} opts
 *   - browserPrint(order): dashboard ka existing browser print function (preview wala)
 *   - allowFallback (default true): bridge fail hone par browser print try kare.
 *   - receiptOptions: { businessName, address, paymentId } (client profile) - bill header/QR ke liye
 * @returns {{ok:boolean, mode:string, usedFallback?:boolean, error?:string}}
 */
export async function printOrder(order, printer, { browserPrint, allowFallback = true, receiptOptions } = {}) {
  if (!printer || printer.mode === 'browser' || !printer.mode) {
    if (browserPrint) await browserPrint(order);
    return { ok: true, mode: 'browser' };
  }

  try {
    let receipt = formatOrderReceipt(order, receiptOptions);

    // Purana bridge naye ops (row/box/boxrow) skip kar deta hai -> plain text me badlo
    const version = await getBridgeVersion();
    if (!versionGte(version, NEW_OPS_MIN_VERSION)) {
      receipt = toTextOps(receipt);
    }

    await bridgeFetch('/print', { method: 'POST', body: toBridgePayload(printer, receipt) });
    return { ok: true, mode: printer.mode };
  } catch (e) {
    const canFallback =
      allowFallback && printer.fallbackToBrowser !== false && typeof browserPrint === 'function';
    if (canFallback) {
      await browserPrint(order);
      return { ok: true, mode: 'browser', usedFallback: true, error: e.message };
    }
    return { ok: false, mode: printer.mode, error: e.message };
  }
}

// Settings screen ka "Test Print" button
export async function testPrinter(printer) {
  if (!printer || printer.mode === 'browser') {
    return { ok: false, error: 'Browser mode me test print available nahi hai' };
  }
  try {
    await bridgeFetch('/test', { method: 'POST', body: toBridgePayload(printer, formatTestReceipt()) });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
