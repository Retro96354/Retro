// server.js - Local Print Bridge
// Client ke computer pe chalta hai. Dashboard (browser) isse http://127.0.0.1:<port> pe baat karta hai
// aur ye printer ko print bhejta hai:
//   - mode "network"    -> printer ke IP:port (default 9100) pe raw ESC/POS bytes
//   - mode "usb_silent" -> computer me installed printer ke naam pe, bina print dialog ke
//
// Koi npm dependency nahi hai, sirf Node.js (v16+) chahiye.

const http = require('http');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { buildReceipt } = require('./escpos');

const VERSION = '1.0.0';
const IS_WIN = process.platform === 'win32';

// ---------- config ----------
function loadConfig() {
  const defaults = { port: 17890, allowedOrigins: [], token: '' };
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8');
    return { ...defaults, ...JSON.parse(raw) };
  } catch (e) {
    return defaults;
  }
}
const config = loadConfig();

// ---------- helpers ----------
function isPrivateIp(ip) {
  if (net.isIPv4(ip) === false) return false;
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a === 127
  );
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  const allowed = config.allowedOrigins || [];
  const open = allowed.length === 0 || allowed.includes('*');
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-bridge-token',
    // Chrome Private Network Access: public site -> localhost ke liye zaruri
    'Access-Control-Allow-Private-Network': 'true',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
  if (origin && (open || allowed.includes(origin))) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

function send(req, res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...corsHeaders(req) });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1024 * 1024) {
        reject(new Error('request bahut bada hai'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(new Error('invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// ---------- network printing ----------
function printNetwork(ip, port, buffer) {
  return new Promise((resolve, reject) => {
    if (!isPrivateIp(ip)) {
      return reject(new Error('Sirf local network ka IP allowed hai'));
    }
    const socket = new net.Socket();
    let settled = false;
    const done = (err) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      err ? reject(err) : resolve();
    };

    socket.setTimeout(5000);
    socket.once('timeout', () => done(new Error(`Printer ${ip}:${port} se connect nahi hua (timeout)`)));
    socket.once('error', (e) => done(new Error(`Printer ${ip}:${port} error: ${e.message}`)));
    socket.connect(port, ip, () => {
      socket.write(buffer, (err) => {
        if (err) return done(err);
        // thoda ruk ke close karte hain taaki printer ko poora data mil jaye
        socket.end();
        setTimeout(() => done(), 300);
      });
    });
  });
}

// ---------- USB (system printer) ----------
function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, timeout: 15000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message || '').trim()));
      resolve(stdout);
    });
  });
}

async function listSystemPrinters() {
  if (IS_WIN) {
    const out = await run('powershell', [
      '-NoProfile',
      '-Command',
      'Get-CimInstance Win32_Printer | Select-Object Name,Default,WorkOffline | ConvertTo-Json -Compress',
    ]);
    if (!out.trim()) return [];
    const parsed = JSON.parse(out);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr.map((p) => ({ name: p.Name, isDefault: !!p.Default, offline: !!p.WorkOffline }));
  }
  // macOS / Linux (CUPS)
  const out = await run('lpstat', ['-e']);
  return out
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((name) => ({ name, isDefault: false, offline: false }));
}

async function printSystem(printerName, buffer) {
  if (!printerName) throw new Error('printerName required hai');
  const tmp = path.join(os.tmpdir(), `receipt-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`);
  fs.writeFileSync(tmp, buffer);
  try {
    if (IS_WIN) {
      await run('powershell', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.join(__dirname, 'raw-print.ps1'),
        '-PrinterName',
        printerName,
        '-FilePath',
        tmp,
      ]);
    } else {
      await run('lp', ['-d', printerName, '-o', 'raw', tmp]);
    }
  } finally {
    fs.unlink(tmp, () => {});
  }
}

// ---------- test receipt ----------
function testReceipt() {
  return [
    { t: 'text', text: 'PRINTER TEST', align: 'center', bold: true, size: 2 },
    { t: 'sep' },
    { t: 'text', text: 'Print bridge connected', align: 'center' },
    { t: 'text', text: new Date().toLocaleString('en-IN'), align: 'center' },
    { t: 'sep' },
    { t: 'feed', n: 2 },
    { t: 'cut' },
  ];
}

// ---------- print dispatcher ----------
async function dispatchPrint({ mode, ip, port, printerName, receipt }) {
  const buffer = buildReceipt(receipt);
  if (mode === 'network') {
    if (!ip) throw new Error('ip required hai');
    await printNetwork(ip, parseInt(port, 10) || 9100, buffer);
  } else if (mode === 'usb_silent') {
    await printSystem(printerName, buffer);
  } else {
    throw new Error(`mode "${mode}" bridge support nahi karta`);
  }
}

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders(req));
      return res.end();
    }

    if (config.token && req.headers['x-bridge-token'] !== config.token) {
      return send(req, res, 401, { ok: false, error: 'invalid token' });
    }

    const url = req.url.split('?')[0];

    if (req.method === 'GET' && url === '/health') {
      return send(req, res, 200, { ok: true, version: VERSION, platform: process.platform });
    }

    if (req.method === 'GET' && url === '/printers/system') {
      const printers = await listSystemPrinters();
      return send(req, res, 200, { ok: true, printers });
    }

    if (req.method === 'POST' && url === '/print') {
      const body = await readJson(req);
      await dispatchPrint(body);
      return send(req, res, 200, { ok: true });
    }

    if (req.method === 'POST' && url === '/test') {
      const body = await readJson(req);
      await dispatchPrint({ ...body, receipt: testReceipt() });
      return send(req, res, 200, { ok: true });
    }

    return send(req, res, 404, { ok: false, error: 'not found' });
  } catch (err) {
    console.error('[bridge error]', err.message);
    return send(req, res, 500, { ok: false, error: err.message });
  }
});

// sirf is computer se hi access ho (127.0.0.1)
server.listen(config.port, '127.0.0.1', () => {
  console.log(`Print Bridge v${VERSION} chal raha hai: http://127.0.0.1:${config.port}`);
});
