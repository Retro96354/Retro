// server.js - Local Print Bridge
// Client ke computer pe chalta hai. Dashboard (browser) isse http://127.0.0.1:<port> pe baat karta hai
// aur ye printer ko print bhejta hai:
//   - mode "network"    -> printer ke IP:port (default 9100) pe raw ESC/POS bytes
//   - mode "usb_silent" -> computer me installed printer ke naam pe, bina print dialog ke
//
// /discover : USB/installed + same-network WiFi printers khud dhundhta hai (discover.js)
// Koi npm dependency nahi hai, sirf Node.js (v16+) chahiye.

const http = require('http');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, execFileSync, spawn } = require('child_process');
const { buildReceipt } = require('./escpos');
const { isPrivateIp, run, listSystemPrinters, discoverAll } = require('./discover');

const VERSION = '1.2.0';
const IS_WIN = process.platform === 'win32';

// .exe (Windows) = background app: window nahi dikhti, startup me apne aap chalta hai.
// Pehli baar double-click ("setup mode") par khud ko INSTALL_DIR me copy karke startup me jod deta hai.
const IS_PKG_WIN = !!process.pkg && IS_WIN;
const INSTALL_DIR = path.join(process.env.LOCALAPPDATA || os.homedir(), 'MigmePrintBridge');
const INSTALLED_EXE = path.join(INSTALL_DIR, 'print-bridge.exe');
const SETUP_MODE = IS_PKG_WIN && path.resolve(process.execPath).toLowerCase() !== INSTALLED_EXE.toLowerCase();

// Window nahi hai to console.log kahin dikhega nahi, isliye log file me likhte hain
if (IS_PKG_WIN) {
  const LOG_FILE = path.join(INSTALL_DIR, 'bridge.log');
  const toFile = (...a) => {
    try {
      fs.mkdirSync(INSTALL_DIR, { recursive: true });
      fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${a.map(String).join(' ')}\n`);
    } catch (e) {}
  };
  console.log = toFile;
  console.error = toFile;
}

// Normal Node / bat se chalane par crash ke baad error padhne ka time dete hain
const EXIT_DELAY_MS = IS_PKG_WIN ? 500 : 15000;
function fatal(err) {
  console.error('[bridge FATAL]', err && err.stack ? err.stack : err);
  setTimeout(() => process.exit(1), EXIT_DELAY_MS);
}
process.on('uncaughtException', fatal);
process.on('unhandledRejection', fatal);

// ---------- config ----------
// .exe (pkg) me config.json exe ke bagal me hoti hai, normal Node me server.js ke bagal me
const BASE_DIR = process.pkg ? path.dirname(process.execPath) : __dirname;

function loadConfig() {
  const defaults = { port: 17890, allowedOrigins: [], token: '' };
  try {
    const raw = fs.readFileSync(path.join(BASE_DIR, 'config.json'), 'utf8');
    return { ...defaults, ...JSON.parse(raw) };
  } catch (e) {
    return defaults;
  }
}
const config = loadConfig();

// ---------- helpers ----------
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
// raw-print.ps1 ko PowerShell ke liye real file chahiye; .exe me bundled ho to temp me nikalte hain
function getPsScriptPath() {
  const src = path.join(__dirname, 'raw-print.ps1');
  if (!process.pkg) return src;
  const out = path.join(os.tmpdir(), 'print-bridge-raw-print.ps1');
  fs.writeFileSync(out, fs.readFileSync(src));
  return out;
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
        getPsScriptPath(),
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
  const buffer = buildReceipt(receipt, { chars: config.paperChars });
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

    if (req.method === 'GET' && url === '/discover') {
      const result = await discoverAll();
      return send(req, res, 200, { ok: true, ...result });
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

// Bridge pehle se chal raha ho (jaise Windows startup + manual start) to dusri copy chup-chaap band
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log(`Print Bridge pehle se chal raha hai (port ${config.port}).`);
    // double-click par message padhne ka time mile
    setTimeout(() => process.exit(0), process.pkg ? 5000 : 0);
    return;
  }
  throw e;
});

// ---------- self-install (sirf .exe, setup mode) ----------
function msgBox(text) {
  execFile(
    'powershell',
    ['-NoProfile', '-WindowStyle', 'Hidden', '-Command',
     `Add-Type -AssemblyName PresentationFramework; [void][System.Windows.MessageBox]::Show('${text}','Print Bridge')`],
    { windowsHide: true },
    () => process.exit(0),
  );
}

function installSelf() {
  try {
    fs.mkdirSync(INSTALL_DIR, { recursive: true });
    // purani copy chal rahi ho to band karo, warna file lock rehti hai
    try { execFileSync('taskkill', ['/F', '/IM', 'print-bridge.exe'], { windowsHide: true, stdio: 'ignore' }); } catch (e) {}
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
    fs.copyFileSync(process.execPath, INSTALLED_EXE);
    execFileSync('reg', ['add', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
      '/v', 'MigmePrintBridge', '/t', 'REG_SZ', '/d', `"${INSTALLED_EXE}"`, '/f'], { windowsHide: true });
    spawn(INSTALLED_EXE, [], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } catch (e) {
    console.error('[install error]', e.message);
    return msgBox('Install nahi ho paya. Log: %LOCALAPPDATA%\\MigmePrintBridge\\bridge.log');
  }
  // 2 second baad check: bridge sach me chal raha hai?
  setTimeout(() => {
    http
      .get({ host: '127.0.0.1', port: config.port, path: '/health', timeout: 3000 }, (res) => {
        res.resume();
        msgBox('Print Bridge install ho gaya aur background me chal raha hai. Ab computer chalu hone par apne aap start hoga.');
      })
      .on('error', () => msgBox('Install ho gaya, par bridge start nahi hua. Agar purani Print Bridge window khuli hai to use band karke dobara try karo.'));
  }, 2000);
}

if (SETUP_MODE) {
  installSelf();
} else {
  // sirf is computer se hi access ho (127.0.0.1)
  server.listen(config.port, '127.0.0.1', () => {
    console.log(`Print Bridge v${VERSION} chal raha hai: http://127.0.0.1:${config.port}`);
    if (!IS_PKG_WIN) console.log('Is window ko band mat karo, printing ke liye ye chalti rehni chahiye.');
  });
}
