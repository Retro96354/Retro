// ═══════════════════════════════════════════════════════════════════════════
// MIGME BACKEND — backend.js
// ═══════════════════════════════════════════════════════════════════════════
require("dotenv").config({
  path: require("path").join(__dirname, "..", ".env"),
});

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const imaps = require("imap-simple");
const { simpleParser } = require("mailparser");
// DOM parsing for text/html vendors — used by parseDomOrder()
const cheerio = require("cheerio");
const { decode: decodeQP } = require("quoted-printable");

// ── Firebase client SDK ────────────────────────────────────────────────────
const { initializeApp } = require("firebase/app");
const { getFirestore, collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, query, where, onSnapshot, runTransaction, } = require("firebase/firestore");

const { getAuth, signInWithCustomToken } = require("firebase/auth");

const {
  BedrockRuntimeClient,
  ConverseCommand,
} = require("@aws-sdk/client-bedrock-runtime");

// ═══════════════════════════════════════════════════════════════════════════
// MANDATORY ENV-VAR STARTUP CHECK
// ═══════════════════════════════════════════════════════════════════════════
const REQUIRED_ENV = [
  "ENCRYPTION_KEY",
  "ADMIN_API_KEY",
  "EXPO_PUBLIC_FIREBASE_API_KEY",
  "EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "EXPO_PUBLIC_FIREBASE_PROJECT_ID",
  "EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET",
  "EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  "EXPO_PUBLIC_FIREBASE_APP_ID",
];
const missingEnv = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missingEnv.length > 0) {
  process.stderr.write(
    `[FATAL] Missing required env vars: ${missingEnv.join(", ")}\nExiting.\n`,
  );
  process.exit(1);
}

// ═══════════════════════════════════════════════════════════════════════════
// CRASH RECOVERY & LOGGING
// ═══════════════════════════════════════════════════════════════════════════
const LOG_FILE = path.join(__dirname, "server.log");
const LOG_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

function maskPII(msg) {
  if (typeof msg !== "string") msg = String(msg);
  msg = msg.replace(/\b(\d{3})\d{3}(\d{4})\b/g, "$1***$2");
  msg = msg.replace(
    /\b([A-Za-z0-9._%+\-]{1,3})[A-Za-z0-9._%+\-]+(@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})\b/g,
    "$1***$2",
  );
  return msg;
}

function rotateLogIfNeeded() {
  try {
    const stat = fs.statSync(LOG_FILE);
    if (stat.size < LOG_MAX_BYTES) return;
    const rotated = `${LOG_FILE}.${Date.now()}.bak`;
    fs.renameSync(LOG_FILE, rotated);
    const dir = path.dirname(LOG_FILE);
    const base = path.basename(LOG_FILE);
    const backs = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(base + ".") && f.endsWith(".bak"))
      .map((f) => ({ f, t: parseInt(f.split(".").slice(-2, -1)[0], 10) || 0 }))
      .sort((a, b) => b.t - a.t);
    backs.slice(2).forEach(({ f }) => {
      try {
        fs.unlinkSync(path.join(dir, f));
      } catch (_) {}
    });
  } catch (_) {}
}

function writeLog(level, msg) {
  const masked = maskPII(msg);
  const line = `[${new Date().toISOString()}] [${level}] ${masked}\n`;
  process.stdout.write(line);
  try {
    rotateLogIfNeeded();
    fs.appendFileSync(LOG_FILE, line);
  } catch (_) {}
}
const log = (msg) => writeLog("INFO", msg);
const warn = (msg) => writeLog("WARN", msg);
const err = (msg) => writeLog("ERROR", msg);

// ═══════════════════════════════════════════════════════════════════════════
// ✅ LAYER 1 — PROCESS-LEVEL SAFETY NET
// This is the LAST line of defense, not the first. Layers 2 and 3 (below,
// near the IMAP connection code) are meant to catch socket problems BEFORE
// they ever reach here. This handler only exists in case something slips
// past those — e.g. a raw socket 'error' event with truly no listener
// anywhere in the call chain.
//
// Problem it guards against: "This socket has been ended by the other party"
// (and similar ECONNRESET/EPIPE errors) used to surface as an
// uncaughtException, which called process.exit(1) — killing the ENTIRE
// process and dropping every client's active poller because of ONE
// client's network blip.
//
// Fix: recognize harmless socket/pipe errors by code or message, log and
// continue. Only genuinely unexpected errors exit the process (so
// Railway/PM2 can auto-restart cleanly).
// ═══════════════════════════════════════════════════════════════════════════
function isHarmlessSocketError(e) {
  const harmlessCodes = [
    "ECONNRESET",
    "EPIPE",
    "ENOTCONN",
    "ECONNABORTED",
    "ETIMEDOUT",
    "EHOSTUNREACH",
    "ECONNREFUSED",
  ];
  if (e && harmlessCodes.includes(e.code)) return true;
  const msg = (e && e.message) || "";
  return (
    msg.includes("socket has been ended") ||
    msg.includes("write after end") ||
    msg.includes("This socket has been ended by the other party") ||
    msg.includes("read ECONNRESET") ||
    msg.includes("Connection closed") ||
    msg.includes("IMAP_HANG") ||
    msg.endsWith("_TIMEOUT")
  );
}

process.on("uncaughtException", (e) => {
  if (isHarmlessSocketError(e)) {
    warn(`[Layer 1] uncaughtException (harmless socket/timeout — ignored, process stays alive): ${e.message}`);
    return;
  }
  err(`[Layer 1] uncaughtException (fatal — exiting for clean restart): ${e.stack || e.message}`);
  setTimeout(() => process.exit(1), 500);
});

process.on("unhandledRejection", (reason) => {
  if (isHarmlessSocketError(reason)) {
    warn(`[Layer 1] unhandledRejection (harmless socket/timeout — ignored): ${reason?.message || reason}`);
    return;
  }
  err(`[Layer 1] unhandledRejection: ${reason?.stack || reason}`);
});

// ═══════════════════════════════════════════════════════════════════════════
// GRACEFUL SHUTDOWN
// ═══════════════════════════════════════════════════════════════════════════
const globalStopFns = new Set();

function shutdown(signal) {
  log(
    `${signal} received — stopping ${globalStopFns.size} active poller(s)...`,
  );
  for (const fn of globalStopFns) {
    try {
      fn();
    } catch (_) {}
  }
  setTimeout(() => {
    log("Graceful exit complete.");
    process.exit(0);
  }, 3000);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// ═══════════════════════════════════════════════════════════════════════════
// FIREBASE CLIENT SDK
// ═══════════════════════════════════════════════════════════════════════════
const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};
const firebaseApp = initializeApp(firebaseConfig, "migme-backend");
const db = getFirestore(firebaseApp);

// ═══════════════════════════════════════════════════════════════════════════
// FIREBASE ADMIN SDK
// ═══════════════════════════════════════════════════════════════════════════
const admin = require("firebase-admin");
const SA_PATH =
  process.env.FIREBASE_SA_PATH ||
  path.join(__dirname, "serviceAccountKey.json");

if (admin.apps.length === 0) {
  if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      }),
    });
  } else if (fs.existsSync(SA_PATH)) {
    admin.initializeApp({ credential: admin.credential.cert(SA_PATH) });
  } else {
    admin.initializeApp({
      projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
    });
    warn(
      "Firebase Admin: no service account credentials found — Auth operations may fail",
    );
  }
}
const authAdmin = admin.auth();

const BACKEND_AUTH_UID = "__backend__";
const backendAuthReady = (async function authBackend() {
  try {
    await authAdmin.getUser(BACKEND_AUTH_UID);
  } catch {
    await authAdmin.createUser({
      uid: BACKEND_AUTH_UID,
      email: "backend@migme.internal",
      password: crypto.randomBytes(24).toString("hex"),
    });
  }
  const token = await authAdmin.createCustomToken(BACKEND_AUTH_UID, {
    email: "backend@migme.internal",
  });
  const authInstance = getAuth(firebaseApp);
  await signInWithCustomToken(authInstance, token);
  log("Backend Firestore client authenticated");
})().catch((e) => {
  warn(`Backend auth failed: ${e.message}`);
  throw e;
});

// ═══════════════════════════════════════════════════════════════════════════
// ENCRYPTION  (AES-256-GCM)
// ═══════════════════════════════════════════════════════════════════════════
function getEncryptionKey() {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error("ENCRYPTION_KEY env var is required");
  return crypto.createHash("sha256").update(raw).digest();
}

function encrypt(plaintext) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

function decrypt(ciphertext) {
  const key = getEncryptionKey();
  const parts = ciphertext.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted format");
  const iv = Buffer.from(parts[0], "base64");
  const tag = Buffer.from(parts[1], "base64");
  const enc = Buffer.from(parts[2], "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(enc, "utf8") + decipher.final("utf8");
}

// ═══════════════════════════════════════════════════════════════════════════
// PASSWORD HASHING
// ═══════════════════════════════════════════════════════════════════════════
function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString("hex");
    crypto.scrypt(password, salt, 64, (e, key) => {
      if (e) reject(e);
      else resolve(`${salt}:${key.toString("hex")}`);
    });
  });
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(":")) {
    return Promise.resolve(password === stored);
  }
  return new Promise((resolve, reject) => {
    const [salt, hash] = stored.split(":");
    crypto.scrypt(password, salt, 64, (e, key) => {
      if (e) reject(e);
      else {
        try {
          resolve(crypto.timingSafeEqual(Buffer.from(hash, "hex"), key));
        } catch (_) {
          resolve(false);
        }
      }
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN KEY HELPERS
// ═══════════════════════════════════════════════════════════════════════════
function maskKey(key) {
  if (!key || key.length < 8) return "***";
  return key.slice(0, 4) + "*".repeat(key.length - 8) + key.slice(-4);
}

function safeCompareKey(provided, secret) {
  if (!provided || !secret) return false;
  const hmacA = crypto
    .createHmac("sha256", "migme-key-cmp")
    .update(provided)
    .digest();
  const hmacB = crypto
    .createHmac("sha256", "migme-key-cmp")
    .update(secret)
    .digest();
  return crypto.timingSafeEqual(hmacA, hmacB);
}

// ═══════════════════════════════════════════════════════════════════════════
// RATE LIMITER
// ═══════════════════════════════════════════════════════════════════════════
const _rateBuckets = new Map();

function rateLimit(maxPerMinute = 20) {
  return (req, res, next) => {
    const ip = (
      req.headers["x-forwarded-for"] ||
      req.socket.remoteAddress ||
      "unknown"
    )
      .split(",")[0]
      .trim();
    const key = `${ip}:${Math.floor(Date.now() / 60000)}`;
    const cnt = (_rateBuckets.get(key) || 0) + 1;
    _rateBuckets.set(key, cnt);
    if (_rateBuckets.size > 2000) {
      const cutoff = Math.floor(Date.now() / 60000) - 2;
      for (const k of _rateBuckets.keys()) {
        if (parseInt(k.split(":").pop(), 10) < cutoff) _rateBuckets.delete(k);
      }
    }
    if (cnt > maxPerMinute) {
      return res
        .status(429)
        .json({ error: "Too many requests — please slow down." });
    }
    next();
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// DAILY IN-MEMORY CACHE
// ═══════════════════════════════════════════════════════════════════════════
const dailyOrderCache = {};
const dailyEmailCache = {};

// ✅ FIX #8 — Timezone-safe "today" (IST), regardless of server TZ.
// Previously `new Date().toISOString().slice(0,10)` used the server's
// wall-clock (often UTC on Railway/Render), so "today" could roll over at
// 5:30 AM IST instead of midnight IST — shifting deliveryDate-based
// grouping for late-night orders. This computes the calendar date in
// Asia/Kolkata explicitly, no matter what TZ the host runs in.
const IST_TZ = "Asia/Kolkata";
function todayStr() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: IST_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()); // en-CA gives YYYY-MM-DD directly
}

function msUntilNextISTMidnight() {
  const now = new Date();
  // Get current IST wall-clock time as a Date-parsable string
  const istNowStr = new Intl.DateTimeFormat("en-US", {
    timeZone: IST_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(now);
  const [datePart, timePart] = istNowStr.split(", ");
  const [mm, dd, yyyy] = datePart.split("/");
  const [HH, MM, SS] = timePart.split(":");
  const istNow = new Date(`${yyyy}-${mm}-${dd}T${HH}:${MM}:${SS}`);
  const istNext = new Date(istNow);
  istNext.setDate(istNext.getDate() + 1);
  istNext.setHours(0, 1, 0, 0); // 00:01 IST — small buffer past midnight
  return istNext - istNow;
}

const orderDocId = (clientId, orderNo) => `${clientId}_${orderNo}`;
const emailDocId = (clientId, uid) => `${clientId}_${uid}`;
const emailIndexId = (clientId, date) => `${clientId}_${date}`;

function getOrderMap(dateStr, clientId) {
  if (!dailyOrderCache[dateStr]) dailyOrderCache[dateStr] = {};
  if (!dailyOrderCache[dateStr][clientId])
    dailyOrderCache[dateStr][clientId] = new Map();
  return dailyOrderCache[dateStr][clientId];
}

function getEmailSet(dateStr, clientId) {
  if (!dailyEmailCache[dateStr]) dailyEmailCache[dateStr] = {};
  if (!dailyEmailCache[dateStr][clientId])
    dailyEmailCache[dateStr][clientId] = new Set();
  return dailyEmailCache[dateStr][clientId];
}

function scheduleMidnightReset() {
  const ms = msUntilNextISTMidnight();
  setTimeout(() => {
    const today = todayStr();
    for (const key of Object.keys(dailyOrderCache)) {
      if (key !== today) delete dailyOrderCache[key];
    }
    for (const key of Object.keys(dailyEmailCache)) {
      if (key !== today) delete dailyEmailCache[key];
    }
    log(`🕛 Midnight (IST) cache reset — keeping only ${today}`);
    scheduleMidnightReset();
  }, ms);
}
scheduleMidnightReset();

async function warmOrderCache(clientId) {
  const date = todayStr();
  const orderMap = getOrderMap(date, clientId);
  if (orderMap.size > 0) return;
  try {
    const q = query(
      collection(db, "orders"),
      where("deliveryDate", "==", date),
      where("clientId", "==", clientId),
    );
    const snap = await getDocs(q);
    snap.forEach((d) => orderMap.set(d.id, d.data()));
    log(`📦 Cache warmed for ${clientId}/${date}: ${orderMap.size} orders`);
  } catch (e) {
    warn(`Cache warm failed for ${clientId}: ${e.message}`);
  }
}

async function warmEmailCache(clientId) {
  const date = todayStr();
  const emailSet = getEmailSet(date, clientId);
  if (emailSet.size > 0) return;
  try {
    const indexSnap = await getDoc(
      doc(db, "processed_emails_index", emailIndexId(clientId, date)),
    );
    if (indexSnap.exists()) {
      (indexSnap.data().uids || []).forEach((u) => emailSet.add(u));
      log(
        `📬 Email cache warmed for ${clientId}/${date}: ${emailSet.size} UIDs`,
      );
    }
  } catch (e) {
    warn(`Email cache warm failed for ${clientId}: ${e.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// recordProcessedEmail
// ✅ FIX #6 — index-doc race condition. Multiple emails in the same batch
// (Promise.allSettled) used to read-modify-write the SAME daily index doc
// concurrently, so parallel writes could clobber each other's UID (last
// write wins). Now wrapped in a Firestore transaction so concurrent calls
// serialize safely and no UID ever gets lost from the index.
// ═══════════════════════════════════════════════════════════════════════════
async function recordProcessedEmail(uidStr, orderNo, status, clientId, extraFields = {}) {
  const date = todayStr();
  const emailSet = getEmailSet(date, clientId);

  const permanentStatuses = [
    "success",
    "update_applied",
    "duplicate",
    "blocked_sender",
    "skipped_fake",
    "ai_exhausted",
  ];
  if (permanentStatuses.includes(status)) {
    emailSet.add(uidStr);
  }

  try {
    await setDoc(
      doc(db, "processed_emails", emailDocId(clientId, uidStr)),
      {
        status,
        orderNo: orderNo || "",
        clientId,
        processedAt: new Date().toISOString(),
        ...extraFields,
      },
      { merge: true },
    );

    if (permanentStatuses.includes(status)) {
      const indexRef = doc(
        db,
        "processed_emails_index",
        emailIndexId(clientId, date),
      );
      await runTransaction(db, async (tx) => {
        const indexSnap = await tx.get(indexRef);
        const existing = indexSnap.exists() ? indexSnap.data().uids || [] : [];
        if (!existing.includes(uidStr)) {
          tx.set(indexRef, { uids: [...existing, uidStr] }, { merge: true });
        }
      });
    }
  } catch (e) {
    warn(`recordProcessedEmail failed: ${e.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PER-ORDER PROCESSING LOCK
// ═══════════════════════════════════════════════════════════════════════════
const processingLocks = new Set();

function acquireLock(lockKey) {
  if (processingLocks.has(lockKey)) return false;
  processingLocks.add(lockKey);
  return true;
}
function releaseLock(lockKey) {
  processingLocks.delete(lockKey);
}

// ═══════════════════════════════════════════════════════════════════════════
// WEB SERVER
// ═══════════════════════════════════════════════════════════════════════════
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const ALLOWED_ORIGINS = (
  process.env.CORS_ORIGINS ||
  "http://localhost:8081,http://localhost:19006,https://migme.onrender.com"
)
  .split(",")
  .map((o) => o.trim());

app.use(
  cors({
    origin: ALLOWED_ORIGINS,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-admin-key"],
  }),
);

app.get("/", (_req, res) => {
  const today = todayStr();
  let orderCount = 0,
    emailCount = 0;
  if (dailyOrderCache[today]) {
    for (const map of Object.values(dailyOrderCache[today]))
      orderCount += map.size;
  }
  if (dailyEmailCache[today]) {
    for (const set of Object.values(dailyEmailCache[today]))
      emailCount += set.size;
  }
  res.send(
    `MIGME Backend ✅ | Date: ${today}` +
      ` | Orders in cache: ${orderCount}` +
      ` | Emails processed today: ${emailCount}` +
      ` | Active pollers: ${globalStopFns.size}`,
  );
});

// ✅ FIX #2 — /logs used to fail OPEN if LOG_TOKEN wasn't set (anyone could
// read logs with no token at all). Now fails CLOSED: no LOG_TOKEN configured
// means the endpoint is forbidden by default, not silently public.
app.get("/logs", rateLimit(30), (req, res) => {
  const token = process.env.LOG_TOKEN;
  if (!token) {
    warn("GET /logs: LOG_TOKEN not configured — endpoint locked down by default");
    return res.status(403).send("Forbidden — LOG_TOKEN not configured");
  }
  if (req.query.token !== token) return res.status(403).send("Forbidden");
  try {
    const lines = fs
      .readFileSync(LOG_FILE, "utf8")
      .split("\n")
      .slice(-200)
      .join("\n");
    res.type("text/plain").send(lines);
  } catch (_) {
    res.send("No log file yet.");
  }
});

function requireAdmin(req, res, next) {
  if (!safeCompareKey(req.headers["x-admin-key"], process.env.ADMIN_API_KEY)) {
    warn(
      `Admin route ${req.method} ${req.path}: rejected key ${maskKey(req.headers["x-admin-key"] || "")}`,
    );
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}

// ═══════════════════════════════════════════════════════════════════════════
// ✅ WATCHDOG STATUS ENDPOINT — quick visibility into per-client poller health
// (supports FIX #7 below). Handy for 50+ clients where manual log-scanning
// isn't practical.
// ═══════════════════════════════════════════════════════════════════════════
app.get("/api/pollers/status", requireAdmin, (_req, res) => {
  const now = Date.now();
  const rows = [];
  for (const [clientKey, info] of pollerHealth.entries()) {
    rows.push({
      clientId: clientKey,
      businessName: info.businessName,
      lastActivityAt: new Date(info.lastActivityAt).toISOString(),
      secondsSinceActivity: Math.round((now - info.lastActivityAt) / 1000),
      consecutiveFailures: info.consecutiveFailures || 0,
    });
  }
  res.json({ pollers: rows, activeCount: globalStopFns.size });
});

// ═══════════════════════════════════════════════════════════════════════════
// CLIENTS  (email-polling clients — used by watchClients() / IMAP pollers)
// ═══════════════════════════════════════════════════════════════════════════
app.post("/api/clients", rateLimit(5), requireAdmin, async (req, res) => {
  try {
    const { businessName, address, email, appPassword, password } = req.body;
    if (!businessName || !address || !email || !appPassword || !password) {
      return res.status(400).json({
        error:
          "Missing required fields: businessName, address, email, appPassword, password",
      });
    }
    const encryptedAppPassword = encrypt(appPassword);
    const passwordHash = await hashPassword(password);
    const clientEmail = email.trim().toLowerCase();
    const docRef = await addDoc(collection(db, "clients"), {
      businessName: businessName.trim(),
      address: address.trim(),
      email: clientEmail,
      appPassword: encryptedAppPassword,
      passwordHash,
      active: true,
      createdAt: new Date().toISOString(),
    });
    try {
      await authAdmin.createUser({
        uid: docRef.id,
        email: clientEmail,
        password,
      });
    } catch (authErr) {
      warn(
        `POST /api/clients: Auth user creation non-fatal: ${authErr.message}`,
      );
    }
    log(`Client created: ${businessName} (${docRef.id})`);
    res.json({ id: docRef.id, businessName });
  } catch (e) {
    warn(`POST /api/clients error: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

app.post(
  "/api/auth/create-user",
  rateLimit(5),
  requireAdmin,
  async (req, res) => {
    try {
      const { uid, email, password } = req.body;
      if (!uid || !email || !password) {
        return res
          .status(400)
          .json({ error: "Missing uid, email, or password" });
      }
      await authAdmin.createUser({ uid, email, password });
      log(`Auth user created for ${email} (${uid})`);
      res.json({ success: true });
    } catch (e) {
      warn(`POST /api/auth/create-user error: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  },
);

app.post(
  "/api/auth/verify-password",
  rateLimit(10),
  requireAdmin,
  async (req, res) => {
    try {
      const { uid, password } = req.body;
      if (!uid || !password) {
        return res.status(400).json({ error: "Missing uid or password" });
      }
      const snap = await getDoc(doc(db, "clients", uid));
      if (!snap.exists()) return res.json({ valid: false });
      const data = snap.data();
      const stored = data.passwordHash || data.password;
      const valid =
        stored && stored.includes(":")
          ? await verifyPassword(password, stored)
          : password === stored;
      res.json({ valid });
    } catch (e) {
      warn(`POST /api/auth/verify-password error: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  },
);

app.delete(
  "/api/data/client/:clientId/range",
  requireAdmin,
  async (req, res) => {
    try {
      const { clientId } = req.params;
      const { startDate, endDate } = req.body;
      if (!startDate || !endDate) {
        return res
          .status(400)
          .json({ error: "startDate and endDate required" });
      }
      const q = query(
        collection(db, "orders"),
        where("clientId", "==", clientId),
        where("createdAt", ">=", new Date(startDate).toISOString()),
        where("createdAt", "<=", new Date(endDate).toISOString()),
      );
      const snap = await getDocs(q);
      let deleted = 0;
      for (const d of snap.docs) {
        await deleteDoc(doc(db, "orders", d.id));
        deleted++;
      }
      const start = new Date(startDate);
      const end = new Date(endDate);
      let indexDeleted = 0;
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().slice(0, 10);
        const indexRef = doc(
          db,
          "processed_emails_index",
          `${clientId}_${dateStr}`,
        );
        const s = await getDoc(indexRef);
        if (s.exists()) {
          await deleteDoc(indexRef);
          indexDeleted++;
        }
      }
      log(
        `Admin deleted ${deleted} orders + ${indexDeleted} index entries for client ${clientId} [${startDate} → ${endDate}]`,
      );
      res.json({ deletedOrders: deleted, deletedIndexEntries: indexDeleted });
    } catch (e) {
      warn(`DELETE /api/data/client/:clientId/range error: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  },
);

app.delete(
  "/api/data/client/:clientId/order/:orderNo",
  requireAdmin,
  async (req, res) => {
    try {
      const { clientId, orderNo } = req.params;
      const docId = `${clientId}_${orderNo}`;
      const ref = doc(db, "orders", docId);
      const snap = await getDoc(ref);
      if (!snap.exists())
        return res.status(404).json({ error: "Order not found" });
      await deleteDoc(ref);
      log(`Admin deleted order ${docId}`);
      res.json({ deleted: docId });
    } catch (e) {
      warn(
        `DELETE /api/data/client/:clientId/order/:orderNo error: ${e.message}`,
      );
      res.status(500).json({ error: e.message });
    }
  },
);

app.delete("/api/data/client/:clientId/all", requireAdmin, async (req, res) => {
  try {
    const { clientId } = req.params;
    let total = 0;
    const ordersSnap = await getDocs(
      query(collection(db, "orders"), where("clientId", "==", clientId)),
    );
    for (const d of ordersSnap.docs) {
      await deleteDoc(doc(db, "orders", d.id));
      total++;
    }
    const emailsSnap = await getDocs(
      query(
        collection(db, "processed_emails"),
        where("clientId", "==", clientId),
      ),
    );
    for (const d of emailsSnap.docs) {
      await deleteDoc(doc(db, "processed_emails", d.id));
      total++;
    }
    const indexSnap = await getDocs(collection(db, "processed_emails_index"));
    for (const d of indexSnap.docs) {
      if (d.id.startsWith(`${clientId}_`)) {
        await deleteDoc(doc(db, "processed_emails_index", d.id));
        total++;
      }
    }
    const menuSnap = await getDocs(
      query(collection(db, "menuItems"), where("clientId", "==", clientId)),
    );
    for (const d of menuSnap.docs) {
      await deleteDoc(doc(db, "menuItems", d.id));
      total++;
    }
    const catSnap = await getDocs(
      query(collection(db, "categories"), where("clientId", "==", clientId)),
    );
    for (const d of catSnap.docs) {
      await deleteDoc(doc(db, "categories", d.id));
      total++;
    }
    const execSnap = await getDocs(
      query(collection(db, "executives"), where("clientId", "==", clientId)),
    );
    for (const d of execSnap.docs) {
      await deleteDoc(doc(db, "executives", d.id));
      total++;
    }
    log(`Admin deleted ALL data (${total} docs) for client ${clientId}`);
    res.json({ deletedDocs: total });
  } catch (e) {
    warn(`DELETE /api/data/client/:clientId/all error: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => log(`MIGME Backend running on port ${PORT}`));

// ═══════════════════════════════════════════════════════════════════════════
// PDF PARSE
// ═══════════════════════════════════════════════════════════════════════════
let pdfParseLib = require("pdf-parse");
let pdfParse = pdfParseLib.default || pdfParseLib;
if (typeof pdfParse !== "function") pdfParse = async () => ({ text: "" });

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ═══════════════════════════════════════════════════════════════════════════
// ✅ LAYER 3 — OPERATION-LEVEL TIMEOUT WRAPPER (fixes IMAP_HANG)
//
// Problem: a "half-open" TCP socket doesn't error and doesn't close — it just
// goes silent. Neither Layer 1 (uncaughtException) nor Layer 2 (imap 'error'/
// 'close' listeners) fire for this, because nothing was ever thrown or
// emitted. Any bare `await connection.search(...)` or `await
// connection.addFlags(...)` can then hang FOREVER, freezing that client's
// polling cycle permanently (Promise.allSettled never settles, so the next
// setTimeout(cycle, 30000) never gets scheduled).
//
// Fix: every IMAP network call in this file is wrapped in withTimeout(). If
// the call doesn't resolve/reject within the given window, we reject
// ourselves with a "<LABEL>_TIMEOUT" error. That error is recognized as
// harmless by isHarmlessSocketError() (Layer 1) and is also caught locally
// by processEmail's / runPollingCycle's own try/catch, which triggers the
// existing reconnect logic — so a hang can never block the process anymore.
//
// ✅ FIX #5 — a timed-out promise used to keep running in the background
// forever (its underlying IMAP command was never actually cancelled), which
// risked a stale in-flight command colliding with a fresh command issued on
// a reconnected socket (IMAP is strictly sequential per-connection). Now
// withTimeout optionally accepts the live `connection` and force-closes the
// socket the instant a timeout fires, guaranteeing the dangling command's
// socket is dead and cannot desync a future command.
// ═══════════════════════════════════════════════════════════════════════════
function withTimeout(promise, ms, label, connectionToKillOnTimeout = null) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      if (connectionToKillOnTimeout) {
        try {
          connectionToKillOnTimeout.end();
        } catch (_) {}
      }
      reject(new Error(`${label}_TIMEOUT`));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ═══════════════════════════════════════════════════════════════════════════
// ✅ AI ATTEMPT LIMIT
// ═══════════════════════════════════════════════════════════════════════════
const MAX_AI_ATTEMPTS = 5;

// ═══════════════════════════════════════════════════════════════════════════
// ✅ GLOBAL BEDROCK CONCURRENCY LIMITER
//
// Problem: with N clients each processing batches of up to BATCH_SIZE emails
// in parallel, the number of SIMULTANEOUS Bedrock calls scales with N — e.g.
// 15 clients × 3 = up to 45 concurrent calls. AWS Bedrock has per-account
// rate/concurrency limits; hitting them causes calls to fail, which feeds
// straight into the retry/backoff path and stacks up delay across cycles —
// exactly the kind of "works with 2 clients, breaks at 15" scaling failure.
//
// Fix: a simple counting semaphore. Every Bedrock call (new-order parse,
// update parse, missing-field fill) acquires a slot first. Only
// MAX_CONCURRENT_AI calls run at once system-wide; everything else queues
// and runs as soon as a slot frees up — no calls are ever rejected outright,
// they just wait their turn instead of all firing at once and tripping
// AWS-side throttling.
// ═══════════════════════════════════════════════════════════════════════════
const MAX_CONCURRENT_AI = 6;
let _aiActiveCount = 0;
const _aiWaitQueue = [];

function acquireAISlot() {
  return new Promise((resolve) => {
    const tryAcquire = () => {
      if (_aiActiveCount < MAX_CONCURRENT_AI) {
        _aiActiveCount++;
        resolve();
      } else {
        _aiWaitQueue.push(tryAcquire);
      }
    };
    tryAcquire();
  });
}

function releaseAISlot() {
  _aiActiveCount--;
  const next = _aiWaitQueue.shift();
  if (next) next();
}

async function withAISlot(fn) {
  await acquireAISlot();
  try {
    return await fn();
  } finally {
    releaseAISlot();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// VENDOR REGISTRY
// ═══════════════════════════════════════════════════════════════════════════
const {
  VENDOR_MAP,
  VENDOR_RULES,
  VENDOR_DOM_CONFIGS,
  VENDOR_SKIP_SUBJECTS,
} = require("./vendor-rules");

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

// ✅ PRODUCTION MODE — reads only UNSEEN emails, marks them read after
// processing. markEmailAsRead is now wrapped in withTimeout (Layer 3) so a
// hung addFlags() call can never block a cycle.
async function markEmailAsRead(connection, uid) {
  try {
    await withTimeout(connection.addFlags(uid, ["\\Seen"]), 10000, "MARK_READ");
    log(`   ✉️  UID ${uid} marked as read`);
  } catch (e) {
    warn(`   ⚠️  Could not mark UID ${uid} as read: ${e.message}`);
  }
}

function getMissingFields(orderData) {
  const missing = [];
  const name = (orderData.customerName || "").trim();
  if (!name || name === "N/A" || name === "Unknown")
    missing.push("customerName");
  if (
    !orderData.items ||
    !Array.isArray(orderData.items) ||
    orderData.items.length === 0
  )
    missing.push("items");
  if (!(orderData.trainInfo || "").trim() || orderData.trainInfo === "N/A")
    missing.push("trainInfo");
  const date = (orderData.deliveryDate || "").trim();
  if (!date || date === "N/A" || date === "YYYY-MM-DD")
    missing.push("deliveryDate");
  return missing.length > 0 ? missing.join(", ") : null;
}

const cleanFloat = (val) =>
  parseFloat((val || 0).toString().replace(/[^\d.]/g, "")) || 0;

// ── HTML to plain text — used for AI path (text/plain vendors) ──────────────
function htmlToText(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/th>/gi, " | ")
    .replace(/<\/td>/gi, " | ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ═══════════════════════════════════════════════════════════════════════════
// DOM ORDER PARSER — text/html vendors only
// (unchanged from previous version — all vendor fixes 1-9c preserved)
// ═══════════════════════════════════════════════════════════════════════════
function htmlToLines(htmlBody) {
  return htmlBody
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function parseLineBasedOrder(htmlBody, vendorName, vendorType, domConfig, tag) {
  try {
    const lines = htmlToLines(htmlBody);
    const order = { vendorName };

    for (const [fieldName, cfg] of Object.entries(domConfig.lineBasedFields || {})) {
      let rawValue = null;
      for (const line of lines) {
        const m = line.match(cfg.match);
        if (m) {
          rawValue = m[1] !== undefined ? m[1].trim() : m[0].trim();
          break;
        }
      }
      order[fieldName] = rawValue !== null
        ? (cfg.transform ? cfg.transform(rawValue) : rawValue)
        : null;
    }

    const items = [];
    const itemsCfg = domConfig.lineBasedItems;
    if (itemsCfg) {
      let inItems = false;

      // ✅ NEW — "stride" mode: for vendors whose HTML flattens each table
      // cell onto its own line, so one item spans N consecutive lines
      // (e.g. name, price, qty, total) instead of one combined line.
      // Activated only when the vendor config sets groupSize + columns —
      // vendors using the original single-line itemLineMatch are untouched.
      if (itemsCfg.groupSize && Array.isArray(itemsCfg.columns)) {
        let buffer = [];
        for (const line of lines) {
          if (!inItems) {
            const _startHit = typeof itemsCfg.startMarker === "string"
              ? line.toUpperCase().includes(itemsCfg.startMarker.toUpperCase())
              : itemsCfg.startMarker.test(line);
            if (_startHit) {
              inItems = true;
            }
            continue;
          }
          if (itemsCfg.endMarker.test(line)) break;
          if (itemsCfg.skipPattern && itemsCfg.skipPattern.test(line)) continue;

          buffer.push(line);
          if (buffer.length === itemsCfg.groupSize) {
            const row = {};
            itemsCfg.columns.forEach((col, i) => {
              row[col] = buffer[i];
            });
            const name = (row.name || "").trim();
            const qty = parseInt((row.qty || "").replace(/[^\d]/g, ""), 10) || 1;
            const price = itemsCfg.priceFromTotal
              ? cleanFloat(row.total) / qty
              : cleanFloat(row.price);
            if (name) {
              items.push({
                name,
                quantity: qty,
                price: Math.round(price * 100) / 100,
              });
              log(
                `${tag}      DOM item (line-based/stride): "${name}" ₹${price} × ${qty}`,
              );
            }
            buffer = [];
          }
        }
      } else {
        // Original single-line-per-item path — unchanged.
        for (const line of lines) {
          if (!inItems) {
            const _startHit = typeof itemsCfg.startMarker === "string"
              ? line.toUpperCase().includes(itemsCfg.startMarker.toUpperCase())
              : itemsCfg.startMarker.test(line);
            if (_startHit) {
              inItems = true;
            }
            continue;
          }
          if (itemsCfg.endMarker.test(line)) break;
          if (itemsCfg.skipPattern && itemsCfg.skipPattern.test(line)) continue;

          const m = line.match(itemsCfg.itemLineMatch);
          if (m) {
            const nameGroup = itemsCfg.nameGroup || 1;
            const qtyGroup = itemsCfg.qtyGroup || 2;
            const name = m[nameGroup].trim();
            const qty = parseInt(m[qtyGroup], 10) || 1;
            items.push({ name, quantity: qty, price: 0 });
            log(`${tag}      DOM item (line-based): "${name}" × ${qty}`);
          }
        }
      }
    }
    order.items = items;

    if (items.length === 0) {
      warn(`${tag} ⚠ line-based DOM parse found 0 items — returning null to trigger AI fallback`);
      return null;
    }

    // ✅ NEW — label→next-line footer capture (e.g. "Payable Total:" on one
    // line, "Rs. 792.75" on the next). Mirrors captureFooterTotal from the
    // cheerio table path, adapted for flattened line-based vendors.
    if (domConfig.lineBasedFooter) {
      order._footerCaptures = order._footerCaptures || {};
      for (const [captureName, cfg] of Object.entries(domConfig.lineBasedFooter)) {
        for (let i = 0; i < lines.length - 1; i++) {
          if (cfg.label.test(lines[i])) {
            order._footerCaptures[captureName] = cleanFloat(lines[i + 1]);
            break;
          }
        }
      }
    }

    let finalOrder = order;
    if (typeof domConfig.postProcess === "function") {
      finalOrder = domConfig.postProcess(order) || order;
    }

    finalOrder.vendorName = vendorName;
    finalOrder.tax = finalOrder.tax ?? 0;
    finalOrder.deliveryCharge = finalOrder.deliveryCharge ?? 0;
    finalOrder.remark = finalOrder.remark ?? "";

    log(
      `${tag} ✅ line-based DOM parse complete — ${items.length} item(s), ₹${finalOrder.totalAmount}`,
    );
    return finalOrder;
  } catch (e) {
    err(`${tag} parseLineBasedOrder crashed: ${e.message}`);
    return null;
  }
}

function parseDomOrder(htmlBody, vendorName, vendorType, domConfig, tag) {
  if (domConfig.lineBased) {
    return parseLineBasedOrder(htmlBody, vendorName, vendorType, domConfig, tag);
  }

  try {
    const $ = cheerio.load(htmlBody);
    const order = { vendorName };

    const _thCells = [];
    $("thead th").each((_, el) => {
      _thCells.push($(el).text().replace(/\s+/g, " ").trim());
    });

    for (const [fieldName, cfg] of Object.entries(domConfig.fields)) {
      let rawValue = null;

      // ✅ FIX 10 — heading-based extraction (h1-h6), e.g. "New Order
      // Details (Order #45)". Purely additive — only runs when a vendor
      // config explicitly sets cfg.headingMatch; every existing vendor's
      // td/th-based fields (headerThIndex, labelText) are untouched.
      if (cfg.headingMatch) {
        $("h1, h2, h3, h4, h5, h6").each((_, el) => {
          const headingText = $(el).text().replace(/\s+/g, " ").trim();
          const m = headingText.match(cfg.headingMatch);
          if (m) {
            rawValue = m[1] !== undefined ? m[1].trim() : m[0].trim();
            return false;
          }
        });
      } else if (cfg.headerThIndex !== undefined && _thCells[cfg.headerThIndex]) {
        rawValue = _thCells[cfg.headerThIndex];
      } else {
        const labelsToTry = [cfg.labelText];
        if (cfg.fallback) labelsToTry.push(cfg.fallback);

        for (const labelText of labelsToTry) {
          $("td, th").each((_, el) => {
            if ($(el).find("td, th").length > 0) return;
            const cellText = $(el).text().replace(/\s+/g, " ").trim();
            const isMatch = cfg.exactMatch
              ? cellText === labelText
              : cellText.includes(labelText);
            if (isMatch) {
              if (cfg.selfContained) {
                if (cfg.selfContainedExtract) {
                  const m = cellText.match(cfg.selfContainedExtract);
                  if (m) rawValue = m[1] || m[0];
                }
                const colonMatch = cellText.match(/:\s*(.+?)\s*$/);
                if (colonMatch) {
                  rawValue = colonMatch[1];
                } else {
                  const numMatch = cellText.match(/(\d+)\s*$/);
                  if (numMatch) {
                    rawValue = numMatch[1];
                  }
                }
              } else {
                let sibling = $(el).next("td, th");
                if (
                  cfg.skipColon &&
                  sibling.length &&
                  /^:+-?$/.test(sibling.text().trim())
                ) {
                  sibling = sibling.next("td, th");
                }
                if (sibling.length) {
                  rawValue = sibling.text().replace(/\s+/g, " ").trim();
                  return false;
                }
              }
            }
          });
          if (rawValue !== null) break;
        }
      }

      if (
        rawValue !== null &&
        cfg.valuePrefix &&
        rawValue.startsWith(cfg.valuePrefix)
      ) {
        rawValue = rawValue.slice(cfg.valuePrefix.length);
      }

      try {
        order[fieldName] = rawValue !== null ? cfg.transform(rawValue) : null;
      } catch (e) {
        warn(`${tag} DOM field "${fieldName}" transform error: ${e.message}`);
        order[fieldName] = null;
      }
    }

    const { columnMap, itemCellSplit, footerLabels } = domConfig.itemsTable;
    const colIndex = {};
    let headerFound = false;
    const items = [];

    $("table tr").each((_, tr) => {
      const cells = $(tr).find("td, th");
      if (!cells.length) return;

      if (!headerFound) {
        const columnMapEntries = Object.entries(columnMap);
        if (cells.length !== columnMapEntries.length) return;

        const used = new Array(columnMapEntries.length).fill(false);
        let matchCount = 0;
        cells.each((i, td) => {
          const text = $(td).text().trim().toLowerCase();
          for (let k = 0; k < columnMapEntries.length; k++) {
            if (used[k]) continue;
            const [headerText, fieldName] = columnMapEntries[k];
            const normalizedHeader = /^__empty\d*$/.test(headerText)
              ? ""
              : headerText.toLowerCase();
            if (text === normalizedHeader) {
              colIndex[fieldName] = i;
              used[k] = true;
              matchCount++;
              break;
            }
          }
        });
        if (matchCount === columnMapEntries.length) headerFound = true;
        return;
      }

      const firstText = cells.eq(0).text().trim();
      const secondText = cells.eq(1).text().trim();

      let labelText, valueText, isFooter;

      if (domConfig.itemsTable.captureFooterMap) {
        // generic last-two-cells detection — sirf opt-in vendors ke liye
        labelText = cells.eq(cells.length - 2).text().replace(/\s+/g, " ").trim();
        valueText = cells.eq(cells.length - 1).text().replace(/\s+/g, " ").trim();
        isFooter = footerLabels.some((l) =>
          labelText.toLowerCase().includes(l.toLowerCase()),
        );
      } else {
        // purana behavior — kisi bhi existing vendor ke liye untouched
        labelText = firstText || secondText;
        valueText = cells.last().text().trim();
        isFooter =
          (!firstText &&
            footerLabels.some((l) =>
              secondText.toLowerCase().includes(l.toLowerCase()),
            )) ||
          footerLabels.some((l) =>
            firstText.toLowerCase().includes(l.toLowerCase()),
          );
      }
      if (isFooter) {
        if (domConfig.itemsTable.captureFooterMap) {
          if (!order._footerMap) order._footerMap = {};
          const normalized = labelText
            .toLowerCase()
            .replace(/:+\s*$/, "")
            .replace(/[()]/g, "")
            .trim();
          const numVal =
            parseFloat(valueText.replace(/rs\.?/i, "").replace(/,/g, "")) || 0;
          order._footerMap[normalized] = numVal;
        }
        if (domConfig.itemsTable.captureFooterTotal) {
          const captureConfig = domConfig.itemsTable.captureFooterTotal;
          const isMultiCapture = Array.isArray(captureConfig);
          const captureLabels = isMultiCapture
            ? captureConfig
            : [captureConfig];

          const normalizeFooter = (s) =>
            s.toLowerCase().replace(/:+$/g, "").trim();

          for (const rawLabel of captureLabels) {
            const captureLabel = rawLabel.toLowerCase();
            if (
              normalizeFooter(firstText).startsWith(captureLabel) ||
              normalizeFooter(secondText).startsWith(captureLabel)
            ) {
              const lastCell = cells.last();
              const value =
                parseFloat(lastCell.text().replace(/[^\d.]/g, "")) || 0;

              if (!isMultiCapture) {
                order._itemsTotal = value;
                log(`${tag} Captured _itemsTotal: ${order._itemsTotal}`);
                return false;
              }

              if (!order._footerCaptures) order._footerCaptures = {};
              order._footerCaptures[rawLabel] = value;
              log(`${tag} Captured _footerCaptures["${rawLabel}"]: ${value}`);
              if (rawLabel === captureLabels[0]) {
                order._itemsTotal = value;
              }
            }
          }

          if (isMultiCapture) {
            const allCaptured = captureLabels.every(
              (l) =>
                order._footerCaptures && l in order._footerCaptures,
            );
            if (allCaptured) return false;
            return;
          }
          return;
        }
        return;
      }

      const _rawItemText = cells
        .eq(colIndex["rawItem"])
        .text()
        .trim()
        .toLowerCase();
      if (Object.keys(columnMap).some((h) => _rawItemText === h.toLowerCase()))
        return;

      const rawItemCell = cells.eq(colIndex["rawItem"]);
      const priceText = cells.eq(colIndex["price"]).text().trim();
      const qtyText = cells.eq(colIndex["qty"]).text().trim();

      let itemName = "",
        itemDesc = "";
      if (itemCellSplit === "br") {
        const parts = (rawItemCell.html() || "")
          .split(/<br\s*\/?>/i)
          .map((p) => cheerio.load(p).text().trim())
          .filter(Boolean);
        itemName = parts[0] || "";
        itemDesc = parts[1] || "";
      } else if (domConfig.itemsTable.itemNameFromP) {
        itemName = rawItemCell.find("p").first().text().trim();
        itemDesc = rawItemCell.find("small").text().trim();
      } else {
        const parts = rawItemCell
          .text()
          .split("\n")
          .map((p) => p.trim())
          .filter(Boolean);
        itemName = parts[0] || "";
        itemDesc = parts[1] || "";
      }

      if (!itemName || !qtyText) return;
      const hasPriceColumn = Object.values(columnMap).includes("price");
      if (hasPriceColumn && !priceText) return;

      const cleanPriceText = domConfig.itemsTable.stripCurrencyPrefix
        ? priceText.replace(domConfig.itemsTable.stripCurrencyPrefix, "").trim()
        : priceText;
      const price = parseFloat(cleanPriceText) || 0;

      const cleanQtyText = domConfig.itemsTable.stripQtyPrefix
        ? qtyText
            .replace(
              new RegExp("^" + domConfig.itemsTable.stripQtyPrefix, "i"),
              "",
            )
            .trim()
        : qtyText;
      const quantity = parseInt(cleanQtyText, 10) || 1;

      const name = itemDesc ? `${itemName} ${itemDesc}` : itemName;

      let itemAmount = null;
      if (
        domConfig.itemsTable.enableQtyCrossCheck &&
        colIndex["amountCol"] !== undefined
      ) {
        const amountText = cells.eq(colIndex["amountCol"]).text().trim();
        const cleanAmountText = domConfig.itemsTable.stripCurrencyPrefix
          ? amountText
              .replace(domConfig.itemsTable.stripCurrencyPrefix, "")
              .trim()
          : amountText;
        itemAmount = parseFloat(cleanAmountText) || null;
      }

      log(`${tag}      DOM item: "${name}" ₹${price} × ${quantity}`);
      const itemObj = { name, quantity, price };
      if (itemAmount !== null) itemObj._amount = itemAmount;
      items.push(itemObj);
    });

    if (!headerFound || items.length === 0) {
      warn(
        `${tag} DOM parser: items table not found or empty — falling back to AI`,
      );
      return null;
    }

    order.items = items;
    order.subTotal = items.reduce((s, it) => s + it.price * it.quantity, 0);

    const finalOrder = domConfig.postProcess
      ? domConfig.postProcess(order)
      : order;

    finalOrder.vendorName = vendorName;
    finalOrder.tax = finalOrder.tax ?? 0;
    finalOrder.deliveryCharge = finalOrder.deliveryCharge ?? 0;
    finalOrder.remark = finalOrder.remark ?? "";

    log(
      `${tag} ✅ DOM parse complete — ${items.length} item(s), ₹${finalOrder.totalAmount}`,
    );
    return finalOrder;
  } catch (e) {
    err(`${tag} parseDomOrder crashed: ${e.message}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// AI — AWS BEDROCK BASE CALL
// ═══════════════════════════════════════════════════════════════════════════
async function callBedrockAI(prompt) {
  const keyId = process.env.AWS_ACCESS_KEY_ID || "";
  const secretKey = process.env.AWS_SECRET_ACCESS_KEY || "";
  const bearerToken = process.env.AWS_BEARER_TOKEN_BEDROCK || "";
  const endpointUrl = process.env.AWS_BEDROCK_ENDPOINT || "";
  const useBearer = bearerToken || keyId.startsWith("BedrockAPIKey");

  if (useBearer) {
    const token =
      bearerToken ||
      (secretKey.startsWith("ABSK")
        ? Buffer.from(secretKey.substring(4), "base64").toString("utf-8")
        : "");
    if (!token) {
      err("Bearer token not resolved");
      return null;
    }
    const url =
      endpointUrl || "https://bedrock-runtime.ap-south-1.amazonaws.com";
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
          "x-api-key": keyId,
        },
        body: JSON.stringify({
          modelId: process.env.AWS_BEDROCK_MODEL || "qwen.qwen3-vl-235b-a22b",
          system: [
            {
              text: "You are a strict data extraction API. Return a SINGLE, VALID JSON object without markdown formatting.",
            },
          ],
          messages: [{ role: "user", content: [{ text: prompt }] }],
        }),
      });
      if (!res.ok) {
        err(`Bearer API ${res.status}: ${await res.text()}`);
        return null;
      }
      const json = await res.json();
      return (
        json.output?.message?.content?.[0]?.text ||
        json.content?.[0]?.text ||
        JSON.stringify(json)
      );
    } catch (e) {
      err(`Bearer API error: ${e.message}`);
      return null;
    }
  }

  if (!keyId || !secretKey) {
    err("No AWS credentials found.");
    return null;
  }
  try {
    const client = new BedrockRuntimeClient({
      region: process.env.AWS_REGION || "ap-south-1",
      credentials: { accessKeyId: keyId, secretAccessKey: secretKey },
    });
    const command = new ConverseCommand({
      modelId: process.env.AWS_BEDROCK_MODEL || "qwen.qwen3-vl-235b-a22b",
      system: [
        {
          text: "You are a strict data extraction API. Return a SINGLE, VALID JSON object without markdown formatting.",
        },
      ],
      messages: [{ role: "user", content: [{ text: prompt }] }],
    });
    const result = await client.send(command);
    return result.output?.message?.content?.[0]?.text;
  } catch (e) {
    err(`Bedrock SDK error: ${e.name} - ${e.message}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// AI — RETRY WITH EXPONENTIAL BACKOFF
// ✅ Now wrapped in the global AI concurrency slot (withAISlot) so it never
// fires more than MAX_CONCURRENT_AI calls at once across ALL clients —
// prevents AWS Bedrock throttling as client count scales up.
// ✅ Backoff shortened (was attempt*4000 = up to 8s between tries) so a
// failing call doesn't eat into the 1-2 min delivery budget as much.
// ═══════════════════════════════════════════════════════════════════════════
async function callBedrockWithRetry(prompt, maxRetries = 3) {
  return withAISlot(async () => {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await callBedrockAI(prompt);
        if (result) return result;
        warn(`AI attempt ${attempt}/${maxRetries} returned null`);
      } catch (e) {
        warn(`AI attempt ${attempt}/${maxRetries} threw: ${e.message}`);
      }
      if (attempt < maxRetries) {
        const backoff = attempt * 2000;
        warn(`Backing off ${backoff / 1000}s before retry...`);
        await delay(backoff);
      }
    }
    err("All AI retry attempts exhausted");
    return null;
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// AI OUTPUT VALIDATION
// ═══════════════════════════════════════════════════════════════════════════
function validateOrderData(data, vendorType) {
  const errors = [];
  const warnings = [];

  if (!data.deliveryDate || !data.deliveryDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
    errors.push(`Invalid deliveryDate: "${data.deliveryDate}"`);
  } else {
    const daysDiff = (new Date(data.deliveryDate) - new Date()) / 86400000;
    if (daysDiff < -1 || daysDiff > 30) {
      warnings.push(
        `Suspicious deliveryDate: ${data.deliveryDate} (${daysDiff.toFixed(0)} days from today)`,
      );
    }
  }

  if (data.deliveryTime && !data.deliveryTime.match(/^\d{2}:\d{2}$/)) {
    warnings.push(`Invalid deliveryTime format: "${data.deliveryTime}"`);
    data.deliveryTime = "";
  }

  if (!data.items || data.items.length === 0) {
    errors.push("No items found");
  } else {
    const qtyHardCap = vendorType === "railfood" ? 500 : 200;
    for (const item of data.items) {
      if (item.quantity > qtyHardCap) {
        warnings.push(
          `Suspiciously high quantity for "${item.name}": ${item.quantity} (capped at ${qtyHardCap})`,
        );
        item.quantity = qtyHardCap;
      }
      if (item.quantity <= 0) item.quantity = 1;
      if (item.price < 0) {
        warnings.push(`Negative price for "${item.name}"`);
        item.price = 0;
      }
      if (item.price > 5000) {
        warnings.push(
          `Unusually high price for "${item.name}": ₹${item.price}`,
        );
      }
    }
  }

  if (
    data.totalAmount <= 0 &&
    vendorType !== "travelkhana" &&
    vendorType !== "yatribhojan"
  ) {
    warnings.push("totalAmount is 0 or missing");
  }
  if (data.totalAmount > 10000) {
    warnings.push(`Unusually high totalAmount: ₹${data.totalAmount}`);
  }

  if (data.coach && data.coach.length > 20) {
    warnings.push(`Coach value suspiciously long: "${data.coach}"`);
  }

  if (data.contactNo) {
    const raw = data.contactNo.trim();
    const allDigits = raw.replace(/\D/g, "");
    if (allDigits.length === 10) {
      data.contactNo = allDigits;
    } else if (allDigits.length > 10) {
      const match = raw.match(/(?:^|[^\d])([6-9]\d{9})(?:[^\d]|$)/);
      if (match) {
        data.contactNo = match[1];
      } else {
        const first10 = allDigits.slice(0, 10);
        if (/^[6-9]/.test(first10)) {
          data.contactNo = first10;
          warnings.push(
            `Multiple contact numbers — using first: "${first10}" from "${raw}"`,
          );
        } else {
          warnings.push(`Could not extract valid mobile from: "${raw}"`);
          data.contactNo = "";
        }
      }
    } else {
      warnings.push(`Contact number not 10 digits: "${raw}"`);
      data.contactNo = "";
    }
  }

  if (!["COD", "Prepaid"].includes(data.paymentType)) {
    warnings.push(
      `Unknown paymentType "${data.paymentType}" — defaulting to COD`,
    );
    data.paymentType = "COD";
  }

  return { errors, warnings, data };
}

// ═══════════════════════════════════════════════════════════════════════════
// AI — FILL MISSING FIELDS FROM DOM PARSE
// ═══════════════════════════════════════════════════════════════════════════
async function fillMissingFields(emailText, missingFieldsStr, tag) {
  const fieldDescriptions = {
    deliveryDate: "deliveryDate in YYYY-MM-DD format (e.g. 2026-06-06)",
    deliveryTime: "deliveryTime in HH:MM 24-hour format (e.g. 15:20)",
    customerName: "customerName (full name of the person who placed the order)",
    trainInfo:
      "trainInfo (train number and name, e.g. 22932 / JSM BDTS SF EXP)",
    coach: "coach (coach/berth number, e.g. B4/63)",
    contactNo: "contactNo (10-digit mobile number)",
    orderNo: "orderNo (order reference number)",
    paymentType: "paymentType (COD or Prepaid)",
    items: "items (array of {name, quantity, price})",
    totalAmount: "totalAmount (total order value as number)",
    tax: "tax (GST/tax amount as number)",
  };

  const fieldList = missingFieldsStr
    .split(", ")
    .map((f) => fieldDescriptions[f] || f)
    .join(", ");

  const prompt = `Extract ONLY the following fields from this train food delivery order email.
Return a SINGLE VALID JSON object containing ONLY these fields — no extra fields, no markdown formatting, no explanation.

Fields to extract: ${fieldList}

Rules:
- deliveryDate must be YYYY-MM-DD format
- deliveryTime must be HH:MM 24-hour format
- items must be an array of {name: string, quantity: number, price: number}
- totalAmount, tax must be plain numbers (not strings)
- If a field is not found in the email, set it to null

Email:
${emailText}`;

  const result = await callBedrockWithRetry(prompt);
  if (!result) return null;
  try {
    return JSON.parse(result);
  } catch (_) {}
  const m = result.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) {
    try {
      return JSON.parse(m[1]);
    } catch (_) {}
  }
  const obj = result.match(/\{[\s\S]*\}/);
  if (obj) {
    try {
      return JSON.parse(obj[0]);
    } catch (_) {}
  }
  warn(`${tag} fillMissingFields: could not parse AI response as JSON`);
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// AI — PARSE NEW ORDER EMAIL
// ═══════════════════════════════════════════════════════════════════════════
async function parseWithAWS(rawText, subject, senderEmail) {
  const lowerFrom = senderEmail.toLowerCase();
  let vendorName = "",
    vendorType = "generic";

  for (const v of VENDOR_MAP) {
    if (lowerFrom.includes(v.match)) {
      vendorName = v.name;
      vendorType = v.type;
      break;
    }
  }
  if (!vendorName) {
    try {
      const parts = lowerFrom.split("@")[1]?.split(".") || [];
      const root = parts.length > 2 ? parts[parts.length - 2] : parts[0];
      vendorName = root.charAt(0).toUpperCase() + root.slice(1);
    } catch (_) {}
  }

  log(`   🏷️ Vendor: ${vendorName || "Unknown"} (${vendorType})`);
  const vendorRule = VENDOR_RULES[vendorType] || VENDOR_RULES.generic;

  const prompt = `
You are a STRICT invoice/order parser.
VENDOR: ${vendorType} | VENDOR NAME: "${vendorName}"

${vendorRule}

STRICT GLOBAL RULES (apply to ALL vendors):
1. OUTPUT vendorName as "${vendorName}" exactly.
2. ORDER NUMBER: Follow the ORDER NO instruction in the vendor rule above EXACTLY.
   Strip any leading "#" symbol. Use only the field the rule specifies — do NOT substitute other IDs.
3. QUANTITY: from quantity column or explicit marker (X, ×, -prefix) ONLY.
   Numbers inside item descriptions are NEVER quantity.
   VERIFY: Price × Qty ≈ Row Total — BUT ONLY if the vendor rule above does NOT say "DO NOT verify".
   If the vendor rule explicitly says "DO NOT verify Price × Quantity = Total", skip this check entirely.
4. DATE: always output YYYY-MM-DD.
5. DELIVERY TIME: ETA only, HH:MM 24hr format.
6. PHONE: 10-digit mobile number only.
7. COACH: capture the FULL coach+seat value.
   - Single combined field (e.g. "Coach/Seat: M2/ 74"): normalise to "COACH/SEAT" (e.g. "M2/74").
   - Two separate fields (e.g. IRCTC "Coach No: B6" + "Seat No: 67"): combine as "CoachValue/SeatValue".
   - NEVER truncate the seat number.
8. PAYMENT: "COD"/"Cash on Delivery"/"CASH_ON_DELIVERY"→"COD"; "PRE_PAID"/"PREPAID"/"Online"/"ONLINE"→"Prepaid".

JSON SCHEMA (return this exact structure, no markdown):
{"_thinking":"...","deliveryDate":"YYYY-MM-DD","deliveryTime":"HH:MM","items":[{"name":"","quantity":1,"price":0}],"subTotal":0,"tax":0,"deliveryCharge":0,"totalAmount":0,"orderNo":"","vendorName":"${vendorName}","customerName":"","contactNo":"","trainInfo":"","coach":"","paymentType":"COD","remark":""}

SENDER: "${senderEmail}" | SUBJECT: "${subject}"
BODY:
${rawText.substring(0, 15000)}`;

  try {
    const raw = await callBedrockWithRetry(prompt);
    if (!raw) {
      err("Empty response from Bedrock after retries");
      return null;
    }

    const data = JSON.parse(raw.replace(/```json|```/g, "").trim());
    data.orderNo = data.orderNo?.toString().trim() || "";
    data.pnr = data.pnr?.toString().trim() || "";
    if (!data.orderNo && !data.pnr) data.orderNo = `AUTO_${Date.now()}`;
    data.vendorName = vendorName;

    if (Array.isArray(data.items)) {
      let sub = 0;
      for (const item of data.items) {
        item.quantity = parseInt(item.quantity, 10) || 1;
        item.price = parseFloat(item.price) || 0;
        if (item.quantity <= 0) item.quantity = 1;
        sub += item.price * item.quantity;
        log(
          `      ${item.name}: ₹${item.price} × ${item.quantity} = ₹${item.price * item.quantity}`,
        );
      }
      if (
        vendorType !== "railfood" &&
        Math.abs((parseFloat(data.subTotal) || 0) - sub) > 5
      ) {
        warn(`      SubTotal mismatch — correcting to ₹${sub}`);
        data.subTotal = sub;
      }
    }

    const {
      errors,
      warnings,
      data: validatedData,
    } = validateOrderData(data, vendorType);
    if (warnings.length > 0)
      warn(`   ⚠️ Validation warnings: ${warnings.join(" | ")}`);
    if (errors.length > 0) {
      err(`   ❌ Validation FAILED: ${errors.join(" | ")}`);
      return null;
    }
    return validatedData;
  } catch (e) {
    err(`Parse error: ${e.message}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// AI — PARSE UPDATE EMAIL
// ═══════════════════════════════════════════════════════════════════════════
async function parseUpdateEmail(rawText, subject, existingOrder) {
  const prompt = `
You are an ORDER UPDATE extractor. This email is a CHANGE NOTIFICATION for an existing order.

Current DB values:
- Coach/Seat: ${existingOrder.coach || "N/A"}
- Delivery Date: ${existingOrder.deliveryDate || "N/A"}
- Delivery Time: ${existingOrder.deliveryTime || "N/A"}
- Contact No: ${existingOrder.contactNo || "N/A"}
- Train Info: ${existingOrder.trainInfo || "N/A"}
- Payment: ${existingOrder.paymentType || "N/A"}
- Total: ${existingOrder.totalAmount || "N/A"}
- Items: ${JSON.stringify(existingOrder.items || [])}

STRICT RULES:
1. A field is changed ONLY if the email LITERALLY states it is being updated.
2. DO NOT extract a field that appears only for reference/context.
3. DO NOT guess or fill in fields not explicitly stated as changed.
4. Output null for every unchanged field — no exceptions.
5. "remark" = plain English description of what changed.

JSON (always include all keys, null if unchanged):
{"_thinking":"quote the exact text proving each change, or state not mentioned","coach":null,"deliveryDate":null,"deliveryTime":null,"contactNo":null,"trainInfo":null,"paymentType":null,"totalAmount":null,"items":null,"subTotal":null,"remark":""}

SUBJECT: "${subject}"
BODY: ${rawText.substring(0, 10000)}`;

  try {
    const raw = await callBedrockWithRetry(prompt);
    if (!raw) return null;
    return JSON.parse(raw.replace(/```json|```/g, "").trim());
  } catch (e) {
    err(`Update parse error: ${e.message}`);
    return null;
  }
}

function buildChangePayload(existingOrder, updateResult) {
  const FIELDS = [
    "coach",
    "deliveryDate",
    "deliveryTime",
    "contactNo",
    "trainInfo",
    "paymentType",
    "totalAmount",
    "items",
    "subTotal",
  ];
  const changes = {};
  const changeLog = [];

  for (const field of FIELDS) {
    const aiVal = updateResult[field];
    if (aiVal === null || aiVal === undefined) continue;
    if (field === "items") {
      if (JSON.stringify(aiVal) === JSON.stringify(existingOrder.items || []))
        continue;
      changes.items = aiVal;
      changeLog.push("items updated");
      continue;
    }
    const newVal = aiVal.toString().trim();
    const oldVal = (existingOrder[field] || "").toString().trim();
    if (
      !newVal ||
      newVal === oldVal ||
      newVal === "N/A" ||
      newVal === "YYYY-MM-DD" ||
      newVal === "HH:MM"
    )
      continue;
    changes[field] = aiVal;
    changeLog.push(`${field}: "${oldVal}" → "${newVal}"`);
  }
  return { changes, changeLog };
}

// ═══════════════════════════════════════════════════════════════════════════
// FCM — NEW ORDER PUSH NOTIFICATION
// ═══════════════════════════════════════════════════════════════════════════
// Reads every FCM token the client app registered under
// `clients/<clientId>/fcmTokens/*` (doc ID == token) and pushes a "new
// order" alert. Only called when a genuinely NEW order is created — existing
// / updated orders never trigger a push.
async function sendNewOrderPush(clientId, orderData, tag) {
  try {
    const clientSnap = await getDoc(doc(db, "clients", clientId));
    if (clientSnap.exists() && clientSnap.data().notificationsEnabled === false) {
      log(`${tag} Push skipped — client ${clientId} has notifications off`);
      return;
    }
  } catch (e) {
    warn(`${tag} Could not read notifications flag for ${clientId}: ${e.message}`);
  }
  let tokens = [];
  try {
    const snap = await getDocs(
      collection(db, "clients", clientId, "fcmTokens"),
    );
    tokens = snap.docs.map((d) => d.id).filter((t) => t && t.length > 20);
  } catch (e) {
    warn(
      `${tag} FCM token read failed for ${clientId} (no tokens yet?) — ${e.message}`,
    );
    return;
  }
  if (tokens.length === 0) return;

  try {
    const title = "🛎 New Order";
    const body = `${orderData.orderNo || ""} · ${orderData.customerName || ""} · ₹${orderData.totalAmount || 0}`;
    if (typeof admin.messaging === "function") {
      const res = await admin
        .messaging()
        .sendEachForMulticast({
          tokens,
          data: {
            type: "new_order",
            orderId: `${clientId}_${orderData.orderNo || ""}`,
            order_id: `${clientId}_${orderData.orderNo || ""}`,
            orderNo: String(orderData.orderNo || ""),
            clientId,
            customerName: String(orderData.customerName || ""),
            totalAmount: String(orderData.totalAmount || 0),
            trainInfo: String(orderData.trainInfo || ""),
            title,
            body,
          },
          android: {
            priority: "high",
          },
        });
      const failedTokens = [];
      res.responses.forEach((r, i) => {
        if (r.success) return;
        if (
          r.error &&
          [
            "messaging/registration-token-not-registered",
            "messaging/invalid-registration-token",
          ].includes(r.error.code)
        ) {
          failedTokens.push(res.responses[i].originalToken || tokens[i]);
        }
      });
      // cleanup stale tokens so dead devices stop getting billed
      for (const tok of failedTokens) {
        try {
          await deleteDoc(doc(db, "clients", clientId, "fcmTokens", tok));
        } catch (_) {}
      }
      log(
        `${tag} 🔔 FCM sent to ${res.successCount}/${tokens.length} device(s) for #${orderData.orderNo}`,
      );
    } else {
      warn(`${tag} FCM skipping — admin.messaging() unavailable`);
    }
  } catch (e) {
    warn(`${tag} FCM push failed for #${orderData.orderNo}: ${e.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EMAIL PROCESSOR
// ═══════════════════════════════════════════════════════════════════════════
async function processEmail(
  item,
  connection,
  clientId,
  orderMap,
  emailSet,
  tag,
  blockedSenders,
  sessionUIDCache,
  clientCreatedAt,
) {
  const uid = item.attributes.uid;
  const uidStr = uid.toString();

  try {
    // ── 5-layer duplicate guard ───────────────────────────────────────────
    if (sessionUIDCache.has(uid)) return; // Guard 1

    if (emailSet.has(uidStr)) {
      sessionUIDCache.add(uid);
      return;
    }

    try {
      const processedSnap = await getDoc(
        doc(db, "processed_emails", emailDocId(clientId, uidStr)),
      );
      if (processedSnap.exists()) {
        const prevStatus = processedSnap.data().status;
        if (prevStatus !== "incomplete_data" && prevStatus !== "ai_failed" && prevStatus !== "ai_in_progress") {
          log(`${tag} UID ${uidStr} already in DB (${prevStatus}) — skipping`);
          emailSet.add(uidStr);
          sessionUIDCache.add(uid);
          await markEmailAsRead(connection, uid);
          return;
        }
        log(`${tag} UID ${uidStr} was "${prevStatus}" — retrying parse`);
      }
    } catch (e) {
      warn(
        `${tag} Firestore pre-check failed for UID ${uidStr}: ${e.message} — processing anyway`,
      );
    }

    // ✅ LAYER 3 — full body fetch wrapped in withTimeout (fixes IMAP_HANG).
    // Previously this call had NO timeout at all — a half-open socket here
    // would freeze this email's processing forever, silently blocking the
    // whole Promise.allSettled batch. Now it fails fast at 20s and the outer
    // catch below handles it as a normal retry-next-cycle case. Also passes
    // `connection` so a timeout force-closes the stale socket (FIX #5).
    const fullMsg = await withTimeout(
      connection.search([["UID", uid]], { bodies: [""], markSeen: false }),
      20000,
      "FULL_FETCH",
      connection,
    );
    if (!fullMsg || fullMsg.length === 0) return;
    const parsed = await simpleParser(
      fullMsg[0].parts.find((p) => p.which === "").body,
    );

    // Guard 4 — date filter (production: only emails since client was created)
    const emailDate = parsed.date ? new Date(parsed.date) : new Date();
    const FETCH_SINCE = new Date(clientCreatedAt || Date.now());
    if (emailDate < FETCH_SINCE) {
      sessionUIDCache.add(uid);
      await markEmailAsRead(connection, uid);
      return;
    }

    const subject = parsed.subject || "No Subject";
    const fromAddress =
      parsed.from?.value?.[0]?.address || parsed.from?.text || "Unknown";
    const lowerFrom = fromAddress.toLowerCase();

    if (
      blockedSenders.some((bs) => lowerFrom.includes(bs) || lowerFrom === bs)
    ) {
      log(`${tag} Blocked sender: ${fromAddress}`);
      sessionUIDCache.add(uid);
      await recordProcessedEmail(uidStr, "", "blocked_sender", clientId);
      await markEmailAsRead(connection, uid);
      return;
    }

    // Guard 5 — subject keyword filter
    const vendorFromSender = VENDOR_MAP.find((v) =>
      lowerFrom.includes(v.match),
    );
    const subjectMatches =
      /Order|Booking|PNR|Reservation|Invoice|Bill|Catering|Check Order/i.test(
        subject,
      );

    if (!subjectMatches && !vendorFromSender) {
      sessionUIDCache.add(uid);
      await markEmailAsRead(connection, uid);
      return;
    }
    if (!subjectMatches && vendorFromSender) {
      warn(
        `${tag} Known vendor ${vendorFromSender.name} with unusual subject: "${subject}" — processing anyway`,
      );
    }

    // ── Detect vendor ─────────────────────────────────────────────────────
    let detectedType = "generic",
      detectedName = "";
    for (const v of VENDOR_MAP) {
      if (lowerFrom.includes(v.match)) {
        detectedType = v.type;
        detectedName = v.name;
        break;
      }
    }
    if (!detectedName) {
      try {
        const parts = lowerFrom.split("@")[1]?.split(".") || [];
        const root = parts.length > 2 ? parts[parts.length - 2] : parts[0];
        detectedName = root.charAt(0).toUpperCase() + root.slice(1);
      } catch (_) {}
    }

    // IRCTC structural guard
    if (detectedType === "irctc") {
      const hasPdfAttachment = (parsed.attachments || []).some(
        (att) => att.contentType === "application/pdf",
      );
      if (hasPdfAttachment) {
        log(`${tag} Skipping IRCTC PDF-attachment email (not a real order): "${subject}"`);
        sessionUIDCache.add(uid);
        await recordProcessedEmail(uidStr, "", "skipped_fake", clientId);
        await markEmailAsRead(connection, uid);
        return;
      }
    }

    // ── Skip known-fake subjects per vendor ────────────────────────────────
    const skipPatterns = VENDOR_SKIP_SUBJECTS[detectedType];
    if (skipPatterns) {
      const lowerSubject = subject.toLowerCase();
      if (skipPatterns.some((p) => lowerSubject.includes(p))) {
        log(`${tag} Skipping fake email for ${detectedName}: "${subject}"`);
        sessionUIDCache.add(uid);
        await recordProcessedEmail(uidStr, "", "skipped_fake", clientId);
        await markEmailAsRead(connection, uid);
        return;
      }
    }

    // ── Build fullText for AI path ────────────────────────────────────────
    let fullText = parsed.text || "";
    if (!fullText && parsed.html) {
      fullText = htmlToText(parsed.html);
      log(
        `${tag} HTML-only email — stripped to plain text (${fullText.length} chars)`,
      );
    }
    for (const att of parsed.attachments || []) {
      if (att.contentType === "application/pdf") {
        try {
          const pdf = await pdfParse(att.content);
          const pdfText = (pdf.text || "").trim();
          if (pdfText.length < 50) {
            warn(
              `${tag} PDF extracted only ${pdfText.length} chars — may be image-based`,
            );
          }
          if (pdfText) fullText += "\n\n--- PDF ---\n" + pdfText;
        } catch (e) {
          warn(`${tag} PDF parse error: ${e.message}`);
        }
      }
    }

    log(`${tag} 🤖 Parsing: "${subject}" (From: ${fromAddress})`);

    // ── PATH A: DOM parsing ───────────────────────────────────────────────
    let orderData = null;
    const domCfg = VENDOR_DOM_CONFIGS[detectedType];

    if (domCfg && parsed.html) {
      log(`${tag}    🏗️  DOM parsing for ${detectedName}`);
      orderData = parseDomOrder(
        parsed.html,
        detectedName,
        detectedType,
        domCfg,
        tag,
      );
      if (orderData) {
        log(`${tag}    ✅ DOM parse succeeded — Bedrock not called`);
        const missingFields = getMissingFields(orderData);
        if (missingFields) {
          log(
            `${tag}    🔄 DOM partial — filling missing: [${missingFields}] via targeted AI`,
          );
          const fill = await fillMissingFields(fullText, missingFields, tag);
          if (fill) {
            let merged = 0;
            for (const [key, val] of Object.entries(fill)) {
              if (
                val !== null &&
                val !== undefined &&
                val !== "" &&
                val !== "N/A"
              ) {
                const current = orderData[key];
                if (
                  current === null ||
                  current === undefined ||
                  current === "" ||
                  current === "N/A" ||
                  current === "Unknown" ||
                  current === "YYYY-MM-DD"
                ) {
                  orderData[key] = val;
                  merged++;
                }
              }
            }
            log(
              `${tag}    ✅ AI filled ${merged}/${missingFields.split(", ").length} missing fields`,
            );
          } else {
            warn(
              `${tag}    ⚠️  AI fill failed — fields will remain missing, retry on next cycle`,
            );
          }
        }
      } else {
        warn(`${tag}    ⚠️  DOM parse failed — falling back to AI`);
      }
    }

    // ── PATH B: AI / Bedrock ──────────────────────────────────────────────
    let currentAiAttemptNo = null; // ✅ FIX #1 — tracked across whole function now
    if (!orderData) {
      let previousAttempts = 0;
      try {
        const prevSnap = await getDoc(
          doc(db, "processed_emails", emailDocId(clientId, uidStr)),
        );
        if (prevSnap.exists()) {
          previousAttempts = prevSnap.data().aiAttempts || 0;
        }
      } catch (_) {}

      if (previousAttempts >= MAX_AI_ATTEMPTS) {
        warn(
          `${tag} UID ${uidStr} has failed AI parse ${previousAttempts}/${MAX_AI_ATTEMPTS} times — permanently skipping`,
        );
        sessionUIDCache.add(uid);
        await recordProcessedEmail(uidStr, "", "ai_exhausted", clientId, {
          aiAttempts: previousAttempts,
          subject,
          from: fromAddress,
          exhaustedAt: new Date().toISOString(),
        });
        await markEmailAsRead(connection, uid);
        return;
      }

      const thisAttemptNo = previousAttempts + 1;
      currentAiAttemptNo = thisAttemptNo; // ✅ FIX #1
      log(`${tag}    🤖 AI attempt ${thisAttemptNo}/${MAX_AI_ATTEMPTS} for UID ${uidStr}`);
      try {
        await setDoc(
          doc(db, "processed_emails", emailDocId(clientId, uidStr)),
          {
            status: "ai_in_progress",
            orderNo: "",
            clientId,
            aiAttempts: thisAttemptNo,
            lastAttemptAt: new Date().toISOString(),
            subject,
            from: fromAddress,
          },
          { merge: true },
        );
      } catch (_) {}

      orderData = await parseWithAWS(fullText, subject, fromAddress);

      if (!orderData) {
        const isExhausted = thisAttemptNo >= MAX_AI_ATTEMPTS;
        try {
          await setDoc(
            doc(db, "processed_emails", emailDocId(clientId, uidStr)),
            {
              status: isExhausted ? "ai_exhausted" : "ai_failed",
              aiAttempts: thisAttemptNo,
              lastAttemptAt: new Date().toISOString(),
            },
            { merge: true },
          );
        } catch (_) {}

        if (isExhausted) {
          warn(
            `${tag} UID ${uidStr} reached MAX_AI_ATTEMPTS (${MAX_AI_ATTEMPTS}) — permanently skipping`,
          );
          sessionUIDCache.add(uid);
          await markEmailAsRead(connection, uid);
        } else {
          log(
            `${tag}    ❌ AI attempt ${thisAttemptNo}/${MAX_AI_ATTEMPTS} failed — will retry next cycle`,
          );
        }
        return;
      }
    }

    if (!orderData) {
      log(`${tag}    ❌ All parse paths failed — will retry next cycle`);
      return;
    }

    const finalOrderNo = (orderData.orderNo || orderData.pnr || "")
      .toString()
      .replace(/\//g, "-")
      .trim();

    // ✅ FIX #1 — previously: AI succeeded but produced no usable order
    // number (AUTO_ fallback) just `return`ed here, leaving the Firestore
    // status stuck at "ai_in_progress" forever. Because that status is
    // NOT one of the terminal ones checked at the top of this function, the
    // email would be re-sent to Bedrock on every single cycle forever —
    // silent, unbounded AI cost with no cap. Now this path also counts
    // against MAX_AI_ATTEMPTS and gets permanently retired once exhausted,
    // exactly like a hard AI failure.
    if (!finalOrderNo || finalOrderNo.startsWith("AUTO_")) {
      const attemptNo = currentAiAttemptNo || 1;
      const isExhausted = attemptNo >= MAX_AI_ATTEMPTS;
      try {
        await setDoc(
          doc(db, "processed_emails", emailDocId(clientId, uidStr)),
          {
            status: isExhausted ? "ai_exhausted" : "ai_failed",
            aiAttempts: attemptNo,
            lastAttemptAt: new Date().toISOString(),
            note: "AI parsed but no usable order number extracted",
          },
          { merge: true },
        );
      } catch (_) {}

      if (isExhausted) {
        warn(
          `${tag}    ⚠️ No valid order number after ${attemptNo}/${MAX_AI_ATTEMPTS} attempts — permanently skipping UID ${uidStr}`,
        );
        sessionUIDCache.add(uid);
        await markEmailAsRead(connection, uid);
      } else {
        log(
          `${tag}    ⚠️ No valid order number extracted (attempt ${attemptNo}/${MAX_AI_ATTEMPTS}) — stays unread for retry`,
        );
        sessionUIDCache.add(uid);
      }
      return;
    }

    // ── Per-order lock ────────────────────────────────────────────────────
    const lockKey = orderDocId(clientId, finalOrderNo);
    if (!acquireLock(lockKey)) {
      log(
        `${tag} #${finalOrderNo} already being processed in parallel — skipping`,
      );
      return;
    }

    try {
      const today = todayStr();
      const orderDeliveryDate = (orderData.deliveryDate || "").trim();
      let existingOrder = null;

      if (orderDeliveryDate === today) {
        existingOrder =
          orderMap.get(orderDocId(clientId, finalOrderNo)) || null;
      } else if (orderDeliveryDate) {
        log(
          `${tag}    📅 Order date ${orderDeliveryDate} ≠ today ${today} — Firestore read for #${finalOrderNo}`,
        );
        try {
          const snap = await getDoc(
            doc(db, "orders", orderDocId(clientId, finalOrderNo)),
          );
          if (snap.exists()) existingOrder = snap.data();
        } catch (e) {
          warn(`Firestore read failed: ${e.message}`);
        }
      } else {
        existingOrder =
          orderMap.get(orderDocId(clientId, finalOrderNo)) || null;
        if (!existingOrder) {
          try {
            const snap = await getDoc(
              doc(db, "orders", orderDocId(clientId, finalOrderNo)),
            );
            if (snap.exists()) existingOrder = snap.data();
          } catch (e) {
            warn(`Firestore read failed: ${e.message}`);
          }
        }
      }

      // ── ORDER EXISTS → check for explicit changes ──────────────────────
      if (existingOrder) {
        log(
          `${tag}    🔄 #${finalOrderNo} in DB — checking for explicit changes...`,
        );
        const updateResult = await parseUpdateEmail(
          fullText,
          subject,
          existingOrder,
        );
        if (!updateResult) {
          log(`${tag}    ❌ Update parse failed — stays unread`);
          return;
        }
        log(`${tag}    🧠 ${updateResult._thinking}`);

        const { changes, changeLog } = buildChangePayload(
          existingOrder,
          updateResult,
        );

        if (Object.keys(changes).length === 0) {
          log(
            `${tag}    ℹ️ No explicit changes for #${finalOrderNo} — recording as duplicate`,
          );
        } else {
          const updatePayload = {
            ...changes,
            lastUpdatedAt: new Date().toISOString(),
            updateHistory: [
              ...(existingOrder.updateHistory || []),
              {
                updatedAt: new Date().toISOString(),
                subject,
                changes,
                remark:
                  updateResult.remark || `Updated: ${changeLog.join(", ")}`,
              },
            ],
          };
          await updateDoc(
            doc(db, "orders", orderDocId(clientId, finalOrderNo)),
            updatePayload,
          );
          orderMap.set(orderDocId(clientId, finalOrderNo), {
            ...existingOrder,
            ...changes,
          });
          log(`${tag}    ✅ UPDATED #${finalOrderNo}: ${changeLog.join(", ")}`);
        }

        sessionUIDCache.add(uid);
        await recordProcessedEmail(
          uidStr,
          finalOrderNo,
          Object.keys(changes).length > 0 ? "update_applied" : "duplicate",
          clientId,
        );
        await markEmailAsRead(connection, uid);

      // ── NEW ORDER → validate then save ──────────────────────────────────
      } else {
        log(`${tag}    🆕 New order #${finalOrderNo} — validating fields...`);
        const missing = getMissingFields(orderData);
        if (missing) {
          log(
            `${tag}    ⚠️ INCOMPLETE — missing: [${missing}] — stays UNREAD for retry`,
          );
          await recordProcessedEmail(
            uidStr,
            finalOrderNo,
            "incomplete_data",
            clientId,
          );
          return;
        }

        const newDoc = {
          ...orderData,
          subTotal: cleanFloat(orderData.subTotal),
          tax: cleanFloat(orderData.tax),
          deliveryCharge: cleanFloat(orderData.deliveryCharge),
          totalAmount: cleanFloat(orderData.totalAmount),
          remark: orderData.remark || "",
          orderNo: finalOrderNo,
          clientId,
          createdAt: new Date().toISOString(),
          status: "Active",
          updateHistory: [],
        };

        await setDoc(
          doc(db, "orders", orderDocId(clientId, finalOrderNo)),
          newDoc,
        );
        orderMap.set(orderDocId(clientId, finalOrderNo), newDoc);
        log(`${tag}    ✅ SAVED #${finalOrderNo} | ₹${orderData.totalAmount}`);

        // 🔔 Notify the client's registered devices about the NEW order
        sendNewOrderPush(clientId, newDoc, tag).catch(() => {});

        sessionUIDCache.add(uid);
        await recordProcessedEmail(uidStr, finalOrderNo, "success", clientId);
        await markEmailAsRead(connection, uid);
      }
    } finally {
      releaseLock(lockKey);
    }
  } catch (e) {
    err(`${tag} processEmail error for UID ${uid}: ${e.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ✅ PER-CLIENT POLLER HEALTH TRACKING (supports FIX #7 — staleness watchdog)
//
// Every successful cycle iteration (whether it found new mail or not) and
// every reconnect touches `lastActivityAt` for that client. The watchdog
// interval below compares this against wall-clock time — if a poller has
// gone quiet for too long even though its stopFn is still registered
// (i.e. it looks "alive" but is actually frozen on some new/unknown hang),
// the watchdog force-restarts it. This is the generic safety net that
// catches failure modes we haven't seen yet, not just the ones we've
// already patched.
// ═══════════════════════════════════════════════════════════════════════════
const pollerHealth = new Map(); // clientId -> { businessName, lastActivityAt, consecutiveFailures }

function touchPollerHealth(clientId, businessName) {
  const existing = pollerHealth.get(clientId);
  pollerHealth.set(clientId, {
    businessName,
    lastActivityAt: Date.now(),
    consecutiveFailures: existing ? existing.consecutiveFailures : 0,
  });
}

function bumpPollerFailure(clientId, businessName) {
  const existing = pollerHealth.get(clientId);
  const failures = existing ? (existing.consecutiveFailures || 0) + 1 : 1;
  pollerHealth.set(clientId, {
    businessName,
    lastActivityAt: existing ? existing.lastActivityAt : Date.now(),
    consecutiveFailures: failures,
  });
  return failures;
}

function resetPollerFailures(clientId, businessName) {
  const existing = pollerHealth.get(clientId);
  pollerHealth.set(clientId, {
    businessName,
    lastActivityAt: Date.now(),
    consecutiveFailures: 0,
  });
}

const STALE_POLLER_MS = 5 * 60 * 1000; // 5 minutes of silence = considered stuck

// ═══════════════════════════════════════════════════════════════════════════
// MULTI-TENANT IMAP POLLER
// ═══════════════════════════════════════════════════════════════════════════
async function pollClientInbox(
  clientId,
  emailAddr,
  appPassword,
  clientBusinessName,
  clientCreatedAt,
) {
  const tag = `[${clientBusinessName}]`;
  log(`${tag} Starting IMAP polling for ${emailAddr}`);
  touchPollerHealth(clientId, clientBusinessName);

  await warmEmailCache(clientId);

  let cancelled = false;
  let activeConn = null;
  let isPaused = false;
  let blockedSenders = [];

  // ✅ Prevents overlapping cycle() runs — the IDLE 'mail' event can fire
  // while a scheduled/fallback cycle() is already mid-flight (e.g. busy
  // with Firestore/Bedrock calls). Without this guard, two cycle() calls
  // could both grab the same IMAP connection at once and corrupt state.
  let cycleRunning = false;

  // ✅ Debounce for the IDLE 'mail' event — Gmail can fire several 'mail'
  // events in a burst (e.g. multiple emails arriving together). Without
  // debouncing, each one would trigger its own immediate cycle() call.
  let idleDebounceTimer = null;

  // ✅ FIX #3 — reconnect backoff. Consecutive reconnect failures no longer
  // retry instantly in a tight loop — delay grows (5s → 15s → 30s → 60s,
  // capped) so a chronically flaky client can never hammer Gmail's IMAP
  // servers rapid-fire, which risked Google-side throttling that could
  // affect this client (or, if limits are ever account/IP-shared, others).
  // Failure count itself is tracked in the shared `pollerHealth` map (via
  // bumpPollerFailure/resetPollerFailures) so the watchdog can see it too.
  const RECONNECT_BACKOFF_STEPS = [5000, 15000, 30000, 60000];

  async function refreshClientSettings() {
    try {
      const snap = await getDoc(doc(db, "clients", clientId));
      if (snap.exists()) {
        isPaused = snap.data().emailPaused === true;
        blockedSenders = (snap.data().blockedSenders || [])
          .map((s) => s.toLowerCase().trim())
          .filter(Boolean);
      }
    } catch (_) {}
  }

  const IMAP_CONFIG = {
    imap: {
      user: emailAddr,
      password: appPassword.replace(/\s/g, ""),
      host: "imap.gmail.com",
      port: 993,
      tls: true,
      authTimeout: 5000,
      tlsOptions: { rejectUnauthorized: false },
      keepalive: {
        interval: 10000,
        idleInterval: 300000,
        forceNoop: true,
      },
    },
  };

  let sessionUIDCache = new Set();

  // ═══════════════════════════════════════════════════════════════════════
  // ✅ LAYER 2 — SOCKET-LEVEL ERROR/CLOSE LISTENERS
  //
  // Root cause of the original crash: node-imap (which imap-simple wraps)
  // exposes the raw connection as an EventEmitter at `connection.imap`. If
  // NOTHING is listening for its 'error' event and the socket drops (Gmail
  // resets it, network blip, TLS renegotiation fails, etc.), Node's
  // EventEmitter throws that error as an uncaught exception BY DESIGN.
  // With no listener anywhere, it used to reach process.on('uncaughtException')
  // as a total surprise and take the whole server down — every client's
  // poller included, not just the one that disconnected.
  //
  // Fix: attach 'error' and 'close' listeners directly on connection.imap
  // right after every successful connect (both initial connect AND every
  // reconnect). Now the error is caught HERE FIRST, tagged with which
  // client it belongs to, logged, and swallowed — never becomes an
  // uncaughtException. The next scheduled cycle() call will naturally hit
  // the dead connection, its own try/catch fails, and the EXISTING
  // reconnect logic in cycle() takes over — so recovery is unchanged,
  // just the crash risk is removed.
  // ═══════════════════════════════════════════════════════════════════════
  function attachSocketGuards(connection) {
    try {
      connection.imap.on("error", (imapErr) => {
        warn(`${tag} [Layer 2] IMAP socket error (handled, no crash): ${imapErr.message}`);
      });
      connection.imap.on("close", (hadError) => {
        if (!cancelled) {
          warn(`${tag} [Layer 2] IMAP connection closed (hadError=${hadError})`);
        }
      });
    } catch (e) {
      warn(`${tag} Could not attach socket guards: ${e.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ✅ FIX #1 — IMAP IDLE: PUSH-BASED INSTANT DELIVERY
  //
  // Problem: the old design relied ENTIRELY on setTimeout(cycle, 30000) —
  // a fixed 30s poll. Best case delay was 0-30s; worst case (AI retries,
  // reconnects) stretched into minutes. This scaled the SAME regardless of
  // client count, but never gave a real "always fast" guarantee.
  //
  // Fix: node-imap (which imap-simple wraps) exposes a 'mail' event on the
  // raw connection.imap object — this fires the moment Gmail's IMAP server
  // pushes a new-mail notification (this is what IMAP IDLE is *for*).
  // Instead of waiting for the next scheduled poll, we run a cycle()
  // IMMEDIATELY when this event fires. Delivery becomes near-instant
  // (seconds) instead of tied to a fixed interval.
  //
  // The scheduled setTimeout(cycle, ...) below is KEPT as a fallback safety
  // net (shortened to 20s) — in case a push notification is ever missed,
  // the fallback still guarantees a check well within the "never more than
  // 1-2 min" target.
  // ═══════════════════════════════════════════════════════════════════════
  function attachMailListener(connection, cycleFn) {
    try {
      connection.imap.on("mail", (numNewMsgs) => {
        if (cancelled) return;
        log(`${tag} 📬 IMAP push: ${numNewMsgs} new message signal — triggering immediate check`);
        if (idleDebounceTimer) clearTimeout(idleDebounceTimer);
        // Small debounce (1.5s) to let a burst of 'mail' events settle
        // into a single cycle() call instead of firing one per email.
        idleDebounceTimer = setTimeout(() => {
          idleDebounceTimer = null;
          cycleFn();
        }, 1500);
      });
    } catch (e) {
      warn(`${tag} Could not attach mail listener: ${e.message}`);
    }
  }

  async function runPollingCycle(connection) {
    if (cancelled) return;
    try {
      await refreshClientSettings();
      if (isPaused) {
        log(`${tag} PAUSED — skipping cycle`);
        touchPollerHealth(clientId, clientBusinessName); // still "healthy", just paused
        return;
      }

      // ✅ Production mode: only UNSEEN (unread) emails, wrapped in Layer 3
      // timeout so IMAP_HANG (silent half-open socket) can never freeze
      // this cycle forever. Passes `connection` so a timeout also
      // force-closes the socket (FIX #5).
      //
      // ✅ SERVER-SIDE SINCE FILTER (perf fix)
      // Problem: without this, a newly-added client with hundreds of old
      // unread emails would have EVERY one of them fully fetched (body +
      // parsed) by processEmail's Guard 4, just to discover the date is
      // too old and skip it. That's a full IMAP body transfer wasted per
      // old email — slow first cycle for clients with big backlogs.
      // Fix: push the date filter INTO the IMAP search itself. The server
      // now excludes old emails before they're even transferred — no UID,
      // no header, no body. clientCreatedAt is always defined once a
      // client exists, so this is safe for every poll cycle, not just the
      // first one.
      // Note: IMAP's SINCE granularity is DAY-level, not time-of-day, so
      // an email from earlier the SAME DAY the client was created can
      // still pass this filter — Guard 4 in processEmail (which compares
      // full timestamps) remains in place as the precise safety net.
      const sinceDate = new Date(clientCreatedAt || Date.now());
      const messages = await withTimeout(
        connection.search(["UNSEEN", ["SINCE", sinceDate]], {
          bodies: ["HEADER.FIELDS (SUBJECT)"],
          markSeen: false,
        }),
        15000,
        "IMAP_HEADER_SEARCH",
        connection,
      );

      const today = todayStr();
      const orderMap = getOrderMap(today, clientId);
      const emailSet = getEmailSet(today, clientId);

      const newMessages = messages.filter(
        (m) => !sessionUIDCache.has(m.attributes.uid),
      );
      if (newMessages.length > 0)
        log(`${tag} 📩 ${newMessages.length} email(s) to process`);

      // ✅ Adaptive batch delay — the old fixed 2000ms gap between every
      // batch of 3 added up fast on a busy inbox (e.g. 9 emails = 2 gaps =
      // 4s of pure waiting, on top of AI/DOM processing time). Bedrock
      // calls are now globally slot-limited (MAX_CONCURRENT_AI) instead,
      // so batches no longer need to be artificially spaced out to protect
      // AWS — the delay here is now just a light breather for very large
      // batches, and is skipped entirely for small ones.
      const BATCH_SIZE = 3;
      for (let i = 0; i < newMessages.length; i += BATCH_SIZE) {
        if (cancelled) break;
        const batch = newMessages.slice(i, i + BATCH_SIZE);
        await Promise.allSettled(
          batch.map((item) =>
            processEmail(
              item,
              connection,
              clientId,
              orderMap,
              emailSet,
              tag,
              blockedSenders,
              sessionUIDCache,
              clientCreatedAt,
            ),
          ),
        );
        const remaining = newMessages.length - (i + BATCH_SIZE);
        if (remaining > 0) await delay(remaining > 6 ? 1500 : 500);
      }

      // ✅ FIX #7 support — mark this client as "alive" after every
      // successfully completed cycle (found mail or not).
      touchPollerHealth(clientId, clientBusinessName);
    } catch (e) {
      err(`${tag} Cycle error: ${e.message}`);
      throw e;
    }
  }

  async function startPolling() {
    if (cancelled) return;
    let connection;
    try {
      await refreshClientSettings();
      if (cancelled) return;
      if (isPaused) {
        log(`${tag} PAUSED — retry in 60s`);
        touchPollerHealth(clientId, clientBusinessName);
        if (!cancelled) setTimeout(startPolling, 60000);
        return;
      }

      // ✅ FIX #4 — imaps.connect() previously had NO timeout at all. If the
      // TCP handshake / TLS negotiation hung (half-open socket before any
      // 'error'/'close' event could ever fire), startPolling() would freeze
      // forever with no retry ever scheduled — silently killing this
      // client's polling with zero visibility. Now bounded to 20s.
      connection = await withTimeout(
        imaps.connect(IMAP_CONFIG),
        20000,
        "IMAP_CONNECT",
      );
      activeConn = connection;
      attachSocketGuards(connection); // ✅ Layer 2

      // ✅ FIX #4 — same reasoning for openBox(): previously unwrapped, so a
      // hang here (e.g. Gmail slow to respond right after connect) could
      // freeze startPolling() forever too.
      await withTimeout(connection.openBox("INBOX"), 15000, "OPEN_BOX", connection);
      sessionUIDCache = new Set();
      resetPollerFailures(clientId, clientBusinessName); // ✅ FIX #3 — reset backoff on success
      log(`${tag} ✅ Connected to inbox`);

      // ✅ Wraps runPollingCycle with the overlap guard — used by BOTH the
      // scheduled fallback timer AND the IDLE 'mail' event listener, so
      // only one cycle ever runs at a time for this client regardless of
      // which trigger fired it.
      async function cycle() {
        if (cancelled) {
          log(`${tag} Polling cancelled — closing IMAP connection`);
          try {
            connection.end();
          } catch (_) {}
          activeConn = null;
          return;
        }
        if (cycleRunning) {
          log(`${tag} Cycle already in progress — skipping this trigger`);
          return;
        }
        cycleRunning = true;
        try {
          await runPollingCycle(connection);
        } catch (e) {
          if (cancelled) {
            cycleRunning = false;
            return;
          }
          err(`${tag} Reconnecting after error: ${e.message}`);
          try {
            connection.end();
          } catch (_) {}

          // ✅ FIX #3 — backoff BEFORE attempting reconnect, growing with
          // consecutive failures instead of retrying instantly every time.
          const failureCount = bumpPollerFailure(clientId, clientBusinessName);
          const backoffMs =
            RECONNECT_BACKOFF_STEPS[
              Math.min(failureCount - 1, RECONNECT_BACKOFF_STEPS.length - 1)
            ];
          if (failureCount > 1) {
            warn(
              `${tag} Consecutive reconnect failure #${failureCount} — backing off ${backoffMs / 1000}s before retry`,
            );
            cycleRunning = false;
            if (!cancelled) setTimeout(startPolling, backoffMs);
            return;
          }

          try {
            // ✅ FIX #4 — reconnect path also gets bounded timeouts now.
            connection = await withTimeout(
              imaps.connect(IMAP_CONFIG),
              20000,
              "IMAP_RECONNECT",
            );
            activeConn = connection;
            attachSocketGuards(connection); // ✅ Layer 2 — reattach on every reconnect
            attachMailListener(connection, cycle); // ✅ reattach IDLE listener too
            await withTimeout(
              connection.openBox("INBOX"),
              15000,
              "OPEN_BOX_RECONNECT",
              connection,
            );
            sessionUIDCache = new Set();
            resetPollerFailures(clientId, clientBusinessName);
            log(`${tag} ✅ Reconnected`);

            // ✅ FIX #2 — IMMEDIATE RETRY AFTER RECONNECT
            // Problem: previously, after a successful reconnect, the code
            // just fell through to the bottom setTimeout(cycle, 30000) —
            // meaning ANY mail that arrived during the drop/reconnect
            // window sat unprocessed for up to another 30s on top of the
            // reconnect time itself. Chained drops (as seen in the Paras
            // Gayatri Bhavan logs) could stack this into minutes.
            // Fix: run the cycle immediately once reconnected, so a mail
            // that arrived during the outage is picked up right away
            // instead of waiting for the next scheduled tick.
            cycleRunning = false;
            await cycle();
            return;
          } catch (e2) {
            const nextBackoff =
              RECONNECT_BACKOFF_STEPS[
                Math.min(failureCount, RECONNECT_BACKOFF_STEPS.length - 1)
              ];
            err(
              `${tag} Reconnect failed: ${e2.message} — retry in ${nextBackoff / 1000}s`,
            );
            cycleRunning = false;
            if (!cancelled) setTimeout(startPolling, nextBackoff);
            return;
          }
        }
        cycleRunning = false;
        // ✅ Shortened fallback interval (30s → 20s). This is now just a
        // safety net — real-time delivery comes from the IMAP IDLE 'mail'
        // listener above, which fires within seconds of Gmail receiving
        // mail. This fallback only matters if a push notification is ever
        // missed, and 20s keeps the worst case comfortably under the
        // 1-2 min target even stacked with a retry or two.
        if (!cancelled) setTimeout(cycle, 20000);
      }

      attachMailListener(connection, cycle); // ✅ Fix #1 — push-based trigger
      cycle();
    } catch (error) {
      if (cancelled) return;
      // ✅ FIX #3 — initial-connect failures also back off instead of
      // always waiting a flat 60s (kept as the max step for parity with
      // previous behavior, but early failures recover faster).
      const failureCount = bumpPollerFailure(clientId, clientBusinessName);
      const backoffMs =
        RECONNECT_BACKOFF_STEPS[
          Math.min(failureCount - 1, RECONNECT_BACKOFF_STEPS.length - 1)
        ];
      err(`${tag} IMAP connect failed: ${error.message} — retry in ${backoffMs / 1000}s`);
      setTimeout(startPolling, backoffMs);
    }
  }

  startPolling();

  return function stop() {
    cancelled = true;
    log(`${tag} Stop requested`);
    if (idleDebounceTimer) clearTimeout(idleDebounceTimer);
    if (activeConn) {
      try {
        activeConn.end();
      } catch (_) {}
      activeConn = null;
    }
    pollerHealth.delete(clientId);
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// WATCH CLIENTS COLLECTION
// ═══════════════════════════════════════════════════════════════════════════
async function watchClients() {
  await backendAuthReady;
  log("MIGME: Watching for active clients...");

  const activePolls = new Map();

  onSnapshot(
    query(collection(db, "clients"), where("active", "==", true)),
    (snapshot) => {
      snapshot.docChanges().forEach(async (change) => {
        const data = change.doc.data();
        const clientKey = change.doc.id;

        if (change.type === "added") {
          if (activePolls.has(clientKey)) return;
          log(`Starting polling for ${data.businessName} (${data.email})`);
          await warmOrderCache(clientKey);
          if (activePolls.has(clientKey)) return;
          const plainPassword =
            /^[A-Za-z0-9+/]+=*:[A-Za-z0-9+/]+=*:[A-Za-z0-9+/]+=*$/.test(
              data.appPassword,
            )
              ? decrypt(data.appPassword)
              : data.appPassword;
          const stopFn = await pollClientInbox(
            clientKey,
            data.email,
            plainPassword,
            data.businessName,
            data.createdAt,
          );
          activePolls.set(clientKey, stopFn);
          globalStopFns.add(stopFn);
        }

        if (change.type === "removed") {
          const stopFn = activePolls.get(clientKey);
          if (stopFn) {
            log(`Stopping polling for ${data.businessName || clientKey}`);
            stopFn();
            globalStopFns.delete(stopFn);
            activePolls.delete(clientKey);
          }
        }
      });
    },
  );

  onSnapshot(
    query(collection(db, "clients"), where("active", "==", false)),
    (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === "added") {
          const clientKey = change.doc.id;
          const stopFn = activePolls.get(clientKey);
          if (stopFn) {
            log(`Client ${clientKey} became inactive — stopping poller`);
            stopFn();
            globalStopFns.delete(stopFn);
            activePolls.delete(clientKey);
          }
        }
      });
    },
  );

  // ═══════════════════════════════════════════════════════════════════════
  // ✅ FIX — WATCHDOG / SELF-HEALING CHECK
  //
  // Problem: if a client's poller ever silently stalls, the ORIGINAL
  // watchdog only checked whether an entry existed in `activePolls` — a
  // poller frozen inside some hang (like the Paras Bhavan incident) still
  // has its stopFn registered, so it looked "alive" and was never caught.
  //
  // ✅ FIX #7 — this watchdog now does TWO checks every 5 minutes:
  //   1. Missing poller (original check) — active client with no entry in
  //      activePolls at all → start one.
  //   2. STALE poller (NEW) — client has an entry, but pollerHealth shows
  //      no activity (`lastActivityAt`) for more than STALE_POLLER_MS (5
  //      min) → treat as stuck, force-stop the old one and start fresh.
  //      This is what would have caught the Paras Bhavan freeze even if
  //      its root cause had been something we hadn't already patched.
  // ═══════════════════════════════════════════════════════════════════════
  setInterval(async () => {
    try {
      const snap = await getDocs(
        query(collection(db, "clients"), where("active", "==", true)),
      );
      for (const d of snap.docs) {
        const clientKey = d.id;
        const data = d.data();
        const plainPassword = () =>
          /^[A-Za-z0-9+/]+=*:[A-Za-z0-9+/]+=*:[A-Za-z0-9+/]+=*$/.test(
            data.appPassword,
          )
            ? decrypt(data.appPassword)
            : data.appPassword;

        if (!activePolls.has(clientKey)) {
          warn(`[Watchdog] Client ${data.businessName || clientKey} has no active poller — restarting`);
          const stopFn = await pollClientInbox(
            clientKey,
            data.email,
            plainPassword(),
            data.businessName,
            data.createdAt,
          );
          activePolls.set(clientKey, stopFn);
          globalStopFns.add(stopFn);
          continue;
        }

        // ✅ FIX #7 — staleness check for pollers that "exist" but are frozen.
        const health = pollerHealth.get(clientKey);
        if (health && Date.now() - health.lastActivityAt > STALE_POLLER_MS) {
          err(
            `[Watchdog] Client ${data.businessName || clientKey} has been silent for ${Math.round(
              (Date.now() - health.lastActivityAt) / 1000,
            )}s (> ${STALE_POLLER_MS / 1000}s threshold) — poller looks stuck, force-restarting`,
          );
          const oldStopFn = activePolls.get(clientKey);
          try {
            oldStopFn();
          } catch (_) {}
          globalStopFns.delete(oldStopFn);
          activePolls.delete(clientKey);
          pollerHealth.delete(clientKey);

          const stopFn = await pollClientInbox(
            clientKey,
            data.email,
            plainPassword(),
            data.businessName,
            data.createdAt,
          );
          activePolls.set(clientKey, stopFn);
          globalStopFns.add(stopFn);
        }
      }
    } catch (e) {
      warn(`[Watchdog] check failed: ${e.message}`);
    }
  }, 5 * 60 * 1000);
}

watchClients().catch((e) => {
  err(`watchClients fatal: ${e.message}`);
  process.exit(1);
});
