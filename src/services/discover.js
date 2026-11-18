// discover.js
// Printers ko khud dhundhta hai:
//   1) USB / installed printers : is computer ke OS me installed printers (virtual PDF/XPS/Fax hata ke)
//   2) WiFi / LAN printers      : is computer ke network (same subnet) me port 9100 wale devices
//
// Koi npm dependency nahi. Sirf Node.js built-ins.

const net = require('net');
const os = require('os');
const http = require('http');
const { execFile } = require('child_process');

const IS_WIN = process.platform === 'win32';

// ---------- helpers ----------
function isPrivateIp(ip) {
  if (net.isIPv4(ip) === false) return false;
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a === 127;
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, timeout: 15000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message || '').trim()));
      resolve(stdout);
    });
  });
}

// ---------- 1) installed (USB) printers ----------
const VIRTUAL_RE = /(pdf|xps|onenote|fax|document writer|send to|print to file|virtual)/i;
const VIRTUAL_PORT_RE = /^(PORTPROMPT|FILE|nul|XPSPort|SHRFAX)/i;

function classifyWin(p) {
  const port = String(p.PortName || '');
  const hay = `${p.Name || ''} ${p.DriverName || ''}`;
  if (VIRTUAL_RE.test(hay) || VIRTUAL_PORT_RE.test(port)) return { kind: 'virtual' };
  const ipMatch = port.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
  if (ipMatch) return { kind: 'network', ip: ipMatch[1] };
  if (/usb/i.test(port)) return { kind: 'usb' };
  return { kind: 'other' };
}

function classifyUri(uri) {
  const u = String(uri || '');
  if (/^usb:/i.test(u)) return { kind: 'usb' };
  const m = u.match(/^(?:socket|lpd|ipp|ipps|http|https):\/\/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/i);
  if (m) return { kind: 'network', ip: m[1] };
  if (/^(file|cups-pdf|pdf)/i.test(u)) return { kind: 'virtual' };
  return { kind: 'other' };
}

// Usable (non-virtual) printers installed on this computer
async function listSystemPrinters() {
  if (IS_WIN) {
    const out = await run('powershell', [
      '-NoProfile',
      '-Command',
      'Get-CimInstance Win32_Printer | Select-Object Name,Default,WorkOffline,PortName,DriverName | ConvertTo-Json -Compress',
    ]);
    if (!out.trim()) return [];
    const parsed = JSON.parse(out);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr
      .map((p) => ({
        name: p.Name,
        isDefault: !!p.Default,
        offline: !!p.WorkOffline,
        port: p.PortName || '',
        ...classifyWin(p),
      }))
      .filter((p) => p.kind !== 'virtual');
  }

  // macOS / Linux (CUPS)
  try {
    const out = await run('lpstat', ['-v']);
    return out
      .split('\n')
      .map((l) => l.match(/^device for (.+?): (.+)$/))
      .filter(Boolean)
      .map((m) => ({ name: m[1].trim(), isDefault: false, offline: false, port: m[2].trim(), ...classifyUri(m[2]) }))
      .filter((p) => p.kind !== 'virtual');
  } catch (e) {
    const out = await run('lpstat', ['-e']);
    return out
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((name) => ({ name, isDefault: false, offline: false, port: '', kind: 'other' }));
  }
}

// ---------- 2) WiFi / LAN printers (port 9100 scan) ----------
// Computer ke har private IPv4 interface ka /24 subnet (jaise 192.168.1.1-254)
function localSubnets() {
  const seen = new Set();
  const out = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal || !isPrivateIp(a.address)) continue;
      const base = a.address.split('.').slice(0, 3).join('.');
      if (seen.has(base)) continue;
      seen.add(base);
      out.push({ base, self: a.address });
    }
  }
  return out;
}

function probe(ip, port, timeoutMs) {
  return new Promise((resolve) => {
    const s = new net.Socket();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(timeoutMs);
    s.once('connect', () => finish(true));
    s.once('timeout', () => finish(false));
    s.once('error', () => finish(false));
    s.connect(port, ip);
  });
}

async function scanPool(ips, port, timeoutMs, concurrency) {
  const found = [];
  let i = 0;
  const worker = async () => {
    while (i < ips.length) {
      const ip = ips[i++];
      if (await probe(ip, port, timeoutMs)) found.push(ip);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, ips.length) }, worker));
  return found;
}

async function scanNetwork({ port = 9100, timeoutMs = 600, concurrency = 100 } = {}) {
  const found = [];
  for (const { base, self } of localSubnets()) {
    const ips = [];
    for (let n = 1; n <= 254; n++) {
      const ip = `${base}.${n}`;
      if (ip !== self) ips.push(ip);
    }
    found.push(...(await scanPool(ips, port, timeoutMs, concurrency)));
  }
  return found.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

// Printer ke web page ka <title> (naam/model) - best effort
function fetchTitle(ip) {
  return new Promise((resolve) => {
    const req = http.get({ host: ip, port: 80, path: '/', timeout: 1200 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      const end = () => {
        const m = body.match(/<title[^>]*>([^<]{1,80})<\/title>/i);
        resolve(m ? m[1].trim() : '');
      };
      res.on('data', (c) => {
        body += c;
        if (body.length > 8192) res.destroy();
      });
      res.on('end', end);
      res.on('close', end);
    });
    req.on('timeout', () => {
      req.destroy();
      resolve('');
    });
    req.on('error', () => resolve(''));
  });
}

// ---------- combined ----------
let inflight = null;

// { usb: [...], network: [...], subnets: [...] }
function discoverAll() {
  if (inflight) return inflight; // scan chal raha ho to wahi result share
  inflight = (async () => {
    const [system, ips] = await Promise.all([
      listSystemPrinters().catch(() => []),
      scanNetwork().catch(() => []),
    ]);

    // Windows me IP port wale installed printer ka naam scan result ko de do
    const sysByIp = new Map(system.filter((p) => p.ip).map((p) => [p.ip, p]));

    const network = await Promise.all(
      ips.map(async (ip) => {
        const sys = sysByIp.get(ip);
        const title = sys ? '' : await fetchTitle(ip);
        return { ip, port: 9100, name: sys ? sys.name : title || `Network printer (${ip})`, title };
      }),
    );

    // Jo network printer scan me mila wo "network" me; baaki installed printers "usb" list me
    const usb = system.filter((p) => !(p.kind === 'network' && ips.includes(p.ip)));

    return { usb, network, subnets: localSubnets().map((s) => `${s.base}.0/24`) };
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

module.exports = {
  isPrivateIp,
  run,
  listSystemPrinters,
  discoverAll,
  _test: { classifyWin, classifyUri, scanPool, probe, fetchTitle },
};
