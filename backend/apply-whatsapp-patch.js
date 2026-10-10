// ═══════════════════════════════════════════════════════════════════════════
// apply-whatsapp-patch.js
// backend.js mein WhatsApp ke liye zaroori badlav apne aap kar deta hai.
//
// Kaise chalayein (backend folder mein, jahan backend.js hai):
//     node apply-whatsapp-patch.js
//
// - Pehle backend.js.bak naam se backup banata hai
// - Har badlav se pehle check karta hai ki jagah (anchor) file mein ek hi baar
//   mili — nahi mili to kuch bhi nahi badalta aur batata hai kaun si line nahi mili
// - Do baar chalane par bhi kuch double nahi hota
// - Kaam hone ke baad is file ko delete kar sakte ho
// ═══════════════════════════════════════════════════════════════════════════
const fs = require("fs");
const path = require("path");

const TARGET = path.join(__dirname, "backend.js");
if (!fs.existsSync(TARGET)) {
  console.error("❌ backend.js is folder mein nahi mila:", TARGET);
  process.exit(1);
}

let src = fs.readFileSync(TARGET, "utf8");

if (src.includes('require("./whatsapp")')) {
  console.log("ℹ️  Patch pehle se laga hua hai — kuch badalne ki zaroorat nahi.");
  process.exit(0);
}

// Windows (CRLF) files ke liye bhi chale
const usesCRLF = src.includes("\r\n");
if (usesCRLF) src = src.replace(/\r\n/g, "\n");

function replaceOnce(label, anchor, replacement) {
  const first = src.indexOf(anchor);
  if (first === -1) {
    console.error(`❌ "${label}" wali jagah backend.js mein nahi mili.\n   Dhoondh rahe the:\n   ${anchor.split("\n")[0]}`);
    console.error("   Kuch bhi badla nahi gaya. Manual steps follow karein.");
    process.exit(1);
  }
  if (src.indexOf(anchor, first + 1) !== -1) {
    console.error(`❌ "${label}" wali line ek se zyada baar mili — safe nahi hai, kuch badla nahi gaya.`);
    process.exit(1);
  }
  src = src.slice(0, first) + replacement + src.slice(first + anchor.length);
  console.log(`✅ ${label}`);
}

// ── 1. Logs mein 12-digit phone aur WhatsApp token mask karo ────────────────
replaceOnce(
  "Logs mein phone/token masking",
  'msg = msg.replace(/\\b(\\d{3})\\d{3}(\\d{4})\\b/g, "$1***$2");',
  [
    'msg = msg.replace(/\\b(\\d{3})\\d{3}(\\d{4})\\b/g, "$1***$2");',
    '  msg = msg.replace(/\\b(91\\d{3})\\d{3}(\\d{4})\\b/g, "$1***$2"); // 91 + 10-digit mobile',
    '  msg = msg.replace(/\\bEAA[A-Za-z0-9]{20,}\\b/g, "EAA***"); // Meta / WhatsApp access token',
  ].join("\n"),
);

// ── 2. Webhook signature verify ke liye raw body ────────────────────────────
replaceOnce(
  "express.json() mein rawBody",
  "app.use(express.json());",
  "app.use(\n  express.json({\n    // WhatsApp webhook ki signature verify karne ke liye raw body chahiye\n    verify: (req, _res, buf) => {\n      req.rawBody = buf;\n    },\n  }),\n);",
);

// ── 3. WhatsApp module register (delay define hone ke BAAD) ─────────────────
replaceOnce(
  "WhatsApp module register",
  "const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));",
  [
    "const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));",
    "",
    "// ═══════════════════════════════════════════════════════════════════════════",
    "// WHATSAPP INTEGRATION",
    "// (delay upar define ho chuka hai, isliye registration yahin hoti hai)",
    "// ═══════════════════════════════════════════════════════════════════════════",
    'for (const k of ["WA_APP_SECRET", "WA_VERIFY_TOKEN"]) {',
    "  if (!process.env[k]) {",
    "    warn(`WhatsApp: ${k} .env mein nahi hai — webhook kaam nahi karega`);",
    "  }",
    "}",
    'require("./whatsapp")(app, {',
    "  db,",
    "  authAdmin,",
    "  encrypt,",
    "  decrypt,",
    "  requireAdmin,",
    "  safeCompareKey,",
    "  rateLimit,",
    "  log,",
    "  warn,",
    "  err,",
    "  delay,",
    "});",
  ].join("\n"),
);

// ── 4. "Delete ALL client data" mein WhatsApp ka data bhi hatao ─────────────
replaceOnce(
  "Client data delete mein WhatsApp collections",
  "    log(`Admin deleted ALL data (${total} docs) for client ${clientId}`);",
  [
    '    for (const col of ["wa_customers", "wa_campaigns", "wa_messages", "wa_outbound"]) {',
    '      const waSnap = await getDocs(query(collection(db, col), where("clientId", "==", clientId)));',
    "      for (const d of waSnap.docs) {",
    "        await deleteDoc(doc(db, col, d.id));",
    "        total++;",
    "      }",
    "    }",
    "    log(`Admin deleted ALL data (${total} docs) for client ${clientId}`);",
  ].join("\n"),
);

// ── Save (pehle backup) ─────────────────────────────────────────────────────
fs.copyFileSync(TARGET, TARGET + ".bak");
fs.writeFileSync(TARGET, usesCRLF ? src.replace(/\n/g, "\r\n") : src, "utf8");
console.log("\n🎉 Ho gaya! Backup: backend.js.bak");
console.log("   Ab backend/whatsapp.js isi folder mein rakhein aur server restart karein.");