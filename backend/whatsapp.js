// ═══════════════════════════════════════════════════════════════════════════
// MIGME — whatsapp.js
// WhatsApp Business Cloud API (Meta) — multi-restaurant
//   1. Har restaurant ka apna number (phoneNumberId + token) -> clients/{id}.whatsapp
//   2. Bulk / customized messages (approved TEMPLATES) -> campaigns
//   3. Inbound webhook -> sirf 3-4 "watchNumbers" ke messages save hote hain
//
// backend.js mein integrate karna:
//   (a) express.json() ko ye banao (signature verify ke liye raw body chahiye):
//         app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
//   (b) app.listen(...) se PEHLE:
//         require("./whatsapp")(app, { db, authAdmin, encrypt, decrypt, requireAdmin,
//           safeCompareKey, rateLimit, log, warn, err, delay });
//
// Env vars (naye):
//   WA_APP_SECRET        -> Meta App Secret (webhook signature verify)
//   WA_VERIFY_TOKEN      -> koi bhi random string (webhook setup mein wahi daalna)
//   WA_GRAPH_VERSION     -> optional, default v21.0
// ═══════════════════════════════════════════════════════════════════════════
const crypto = require("crypto");
const {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, query, where,
} = require("firebase/firestore");

module.exports = function registerWhatsApp(app, deps) {
  const { db, authAdmin, encrypt, decrypt, requireAdmin, safeCompareKey,
    rateLimit, log, warn, err, delay } = deps;

  const GRAPH = `https://graph.facebook.com/${process.env.WA_GRAPH_VERSION || "v21.0"}`;
  const MAX_RECIPIENTS = 5000;
  const SEND_GAP_MS = 150; // ~6-7 msg/sec per campaign, Meta limits se safe

  // Vendor naam (IRCTC, Zoop, RailFood ...) — backend ki vendor-rules se
  let VENDOR_NAMES = [];
  try {
    VENDOR_NAMES = [...new Set(require("./vendor-rules").VENDOR_MAP.map((v) => v.name).filter(Boolean))].sort();
  } catch (_) {
    VENDOR_NAMES = [];
  }

  // ── helpers ──────────────────────────────────────────────────────────────
  // Order ke contactNo kai formats mein aa sakte hain ("+91 98765-43210",
  // "9876543210, 9123456789" ...) — hamesha ek valid number "91XXXXXXXXXX" banao
  function normPhone(p) {
    const raw = String(p || "");
    const d = raw.replace(/\D/g, "");
    if (d.length === 10) return "91" + d;
    if (d.length === 11 && d.startsWith("0")) return "91" + d.slice(1);
    if (d.length === 12 && d.startsWith("91")) return d;
    if (d.length > 12) {
      // Ek field mein kai numbers — pehla valid Indian mobile nikalo
      const m = raw.match(/(?:^|\D)(?:\+?91[\s-]?)?([6-9]\d{9})(?!\d)/);
      return m ? "91" + m[1] : "";
    }
    return d.length === 11 ? d : "";
  }

  async function getWaConfig(clientId) {
    const snap = await getDoc(doc(db, "clients", clientId));
    if (!snap.exists()) return null;
    const wa = snap.data().whatsapp;
    if (!wa || !wa.enabled || !wa.phoneNumberId || !wa.accessToken) return null;
    return {
      phoneNumberId: wa.phoneNumberId,
      wabaId: wa.wabaId || "",
      token: decrypt(wa.accessToken),
      watchNumbers: (wa.watchNumbers || []).map(normPhone).filter(Boolean),
    };
  }

  async function meta(path, token, method = "GET", body) {
    const res = await fetch(`${GRAPH}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = new Error(json?.error?.message || `Meta API ${res.status}`);
      e.code = json?.error?.code;
      throw e;
    }
    return json;
  }

  // Admin key YA us restaurant ka apna Firebase login token
  async function requireClientOrAdmin(req, res, next) {
    try {
      if (process.env.ADMIN_API_KEY && typeof safeCompareKey === "function" &&
          safeCompareKey(req.headers["x-admin-key"], process.env.ADMIN_API_KEY)) return next();
      const h = req.headers.authorization || "";
      const idToken = h.startsWith("Bearer ") ? h.slice(7) : "";
      if (!idToken) return res.status(401).json({ error: "Unauthorized" });
      const decoded = await authAdmin.verifyIdToken(idToken);
      // clients create hote waqt Auth uid == client doc id rakha gaya hai
      if (decoded.uid !== req.params.clientId) return res.status(403).json({ error: "Forbidden" });
      next();
    } catch (_) {
      res.status(401).json({ error: "Unauthorized" });
    }
  }

  // ── 1. ADMIN: restaurant ka WhatsApp connect karo ────────────────────────
  // body: { phoneNumberId, wabaId, accessToken, watchNumbers:["98xxxxxxx1", ...] }
  // Client apne Settings page se khud connect karta hai (admin ki zaroorat nahi)
  app.post("/api/whatsapp/clients/:clientId/config", rateLimit(10), requireClientOrAdmin, async (req, res) => {
    try {
      const { phoneNumberId, wabaId, accessToken, watchNumbers } = req.body;
      if (!phoneNumberId || !wabaId || !accessToken)
        return res.status(400).json({ error: "phoneNumberId, wabaId, accessToken required" });
      if (Array.isArray(watchNumbers) && watchNumbers.length > 4)
        return res.status(400).json({ error: "Max 4 watchNumbers" });

      // 1) Save se pehle Meta se credentials check karo
      let displayNumber = "", verifiedName = "";
      try {
        const info = await meta(`/${phoneNumberId}?fields=display_phone_number,verified_name`, accessToken);
        displayNumber = info.display_phone_number || "";
        verifiedName = info.verified_name || "";
      } catch (e) {
        return res.status(400).json({ error: `Meta ne details reject kiye: ${e.message}` });
      }

      // 2) Webhook (incoming messages) ke liye is WABA ko hamare app se jodo
      let webhookSubscribed = true;
      try {
        await meta(`/${wabaId}/subscribed_apps`, accessToken, "POST");
      } catch (e) {
        webhookSubscribed = false;
        warn(`WA subscribed_apps failed for ${req.params.clientId}: ${e.message}`);
      }

      // Dotted keys: feedback settings jaisi baaki cheezein overwrite nahi hongi
      const update = {
        "whatsapp.enabled": true,
        "whatsapp.phoneNumberId": String(phoneNumberId),
        "whatsapp.wabaId": String(wabaId),
        "whatsapp.accessToken": encrypt(accessToken),
        "whatsapp.displayNumber": displayNumber,
        "whatsapp.verifiedName": verifiedName,
        "whatsapp.webhookSubscribed": webhookSubscribed,
        "whatsapp.updatedAt": new Date().toISOString(),
      };
      if (Array.isArray(watchNumbers))
        update["whatsapp.watchNumbers"] = watchNumbers.map(normPhone).filter(Boolean);
      await updateDoc(doc(db, "clients", req.params.clientId), update);
      log(`WhatsApp configured for client ${req.params.clientId}`);
      return res.json({ success: true, displayNumber, verifiedName, webhookSubscribed });
    } catch (e) {
      warn(`WA config error: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // Settings page ke liye: connection status (token kabhi wapas nahi bhejte)
  app.get("/api/whatsapp/clients/:clientId/status", rateLimit(30), requireClientOrAdmin, async (req, res) => {
    try {
      const snap = await getDoc(doc(db, "clients", req.params.clientId));
      const wa = (snap.exists() && snap.data().whatsapp) || {};
      let tokenValid = null;
      if (wa.enabled) {
        try {
          const cfg = await getWaConfig(req.params.clientId);
          await meta(`/${cfg.phoneNumberId}?fields=id`, cfg.token);
          tokenValid = true;
        } catch (_) { tokenValid = false; }
      }
      res.json({
        connected: !!wa.enabled,
        tokenValid,
        displayNumber: wa.displayNumber || "",
        verifiedName: wa.verifiedName || "",
        webhookSubscribed: !!wa.webhookSubscribed,
        watchNumbers: wa.watchNumbers || [],
        orderMessage: wa.orderMessage || null,
        autoMessages: wa.autoMessages || null,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Disconnect: token delete ho jata hai
  app.delete("/api/whatsapp/clients/:clientId/config", rateLimit(10), requireClientOrAdmin, async (req, res) => {
    try {
      await updateDoc(doc(db, "clients", req.params.clientId), {
        "whatsapp.enabled": false,
        "whatsapp.accessToken": "",
      });
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Restaurant owner / admin watchNumbers badal sake
  app.put("/api/whatsapp/clients/:clientId/watch-numbers", rateLimit(20), requireClientOrAdmin, async (req, res) => {
    try {
      const nums = (req.body.watchNumbers || []).map(normPhone).filter(Boolean);
      if (nums.length > 4) return res.status(400).json({ error: "Max 4 numbers" });
      await updateDoc(doc(db, "clients", req.params.clientId), { "whatsapp.watchNumbers": nums });
      res.json({ watchNumbers: nums });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── 2. TEMPLATES (Meta se approve hote hain) ─────────────────────────────
  app.get("/api/whatsapp/clients/:clientId/templates", rateLimit(30), requireClientOrAdmin, async (req, res) => {
    try {
      const cfg = await getWaConfig(req.params.clientId);
      if (!cfg) return res.status(400).json({ error: "WhatsApp not configured" });
      const r = await meta(`/${cfg.wabaId}/message_templates?limit=100&fields=name,language,status,category,components`, cfg.token);
      res.json(r.data || []);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // body: { name:"diwali_offer", language:"en", category:"MARKETING",
  //         text:"Hi {{1}}, Diwali par {{2}} offer! Order karein." , example:["Rahul","20% off"] }
  app.post("/api/whatsapp/clients/:clientId/templates", rateLimit(10), requireClientOrAdmin, async (req, res) => {
    try {
      const cfg = await getWaConfig(req.params.clientId);
      if (!cfg) return res.status(400).json({ error: "WhatsApp not configured" });
      const { name, language = "en", category = "MARKETING", text, example = [] } = req.body;
      if (!name || !text) return res.status(400).json({ error: "name and text required" });
      const bodyComp = { type: "BODY", text };
      if (example.length) bodyComp.example = { body_text: [example] };
      const r = await meta(`/${cfg.wabaId}/message_templates`, cfg.token, "POST", {
        name: String(name).toLowerCase().replace(/[^a-z0-9_]/g, "_"),
        language,
        category,
        components: [bodyComp],
      });
      res.json(r); // status PENDING -> Meta approve karega
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── 3. CUSTOMERS (opt-in list) ───────────────────────────────────────────
  // body: { customers:[{name, phone, tags:[], optIn:true}] }
  // optIn:true explicitly chahiye — bina opt-in ke marketing bhejna ban/quality risk hai
  app.post("/api/whatsapp/clients/:clientId/customers/import", rateLimit(10), requireClientOrAdmin, async (req, res) => {
    try {
      const { clientId } = req.params;
      let saved = 0, skipped = 0;
      for (const c of (req.body.customers || []).slice(0, 2000)) {
        const phone = normPhone(c.phone);
        if (!phone || c.optIn !== true) { skipped++; continue; }
        await setDoc(doc(db, "wa_customers", `${clientId}_${phone}`), {
          clientId, phone,
          name: (c.name || "").trim(),
          tags: Array.isArray(c.tags) ? c.tags : [],
          optIn: true,
          optInAt: new Date().toISOString(),
        }, { merge: true });
        saved++;
      }
      res.json({ saved, skipped });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/whatsapp/clients/:clientId/customers", rateLimit(30), requireClientOrAdmin, async (req, res) => {
    try {
      const snap = await getDocs(query(collection(db, "wa_customers"), where("clientId", "==", req.params.clientId)));
      res.json(snap.docs.map((d) => d.data()).sort((a, b) => (a.name || "").localeCompare(b.name || "")));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/whatsapp/clients/:clientId/customers/:phone", rateLimit(30), requireClientOrAdmin, async (req, res) => {
    try {
      const phone = normPhone(req.params.phone);
      if (!phone) return res.status(400).json({ error: "Invalid phone" });
      await deleteDoc(doc(db, "wa_customers", `${req.params.clientId}_${phone}`));
      res.json({ deleted: phone });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── 4. CAMPAIGN — bulk customized message ────────────────────────────────
  // body: { templateName, language:"en",
  //         variables:["{{name}}","20% off"],   // {{name}} har customer ke naam se replace hoga
  //         tag:"vip" (optional), phones:[...] (optional) }
  app.post("/api/whatsapp/clients/:clientId/campaigns", rateLimit(5), requireClientOrAdmin, async (req, res) => {
    try {
      const { clientId } = req.params;
      const cfg = await getWaConfig(clientId);
      if (!cfg) return res.status(400).json({ error: "WhatsApp not configured" });
      const { templateName, language = "en", variables = [], tag, phones } = req.body;
      if (!templateName) return res.status(400).json({ error: "templateName required" });

      const snap = await getDocs(query(collection(db, "wa_customers"), where("clientId", "==", clientId)));
      let recipients = snap.docs.map((d) => d.data()).filter((c) => c.optIn === true);
      if (tag) recipients = recipients.filter((c) => (c.tags || []).includes(tag));
      if (Array.isArray(phones) && phones.length) {
        const set = new Set(phones.map(normPhone));
        recipients = recipients.filter((c) => set.has(c.phone));
      }
      if (recipients.length === 0) return res.status(400).json({ error: "No opted-in recipients" });
      if (recipients.length > MAX_RECIPIENTS)
        return res.status(400).json({ error: `Max ${MAX_RECIPIENTS} recipients per campaign` });

      const ref = await addDoc(collection(db, "wa_campaigns"), {
        clientId, templateName, language, variables,
        recipients: recipients.map((c) => ({ phone: c.phone, name: c.name || "" })),
        total: recipients.length, sent: 0, failed: 0,
        status: "running", createdAt: new Date().toISOString(),
      });
      runCampaign(ref.id, clientId, cfg, { templateName, language, variables }, recipients)
        .catch((e) => err(`Campaign ${ref.id} crashed: ${e.message}`));
      res.json({ campaignId: ref.id, total: recipients.length, status: "running" });
    } catch (e) {
      warn(`WA campaign error: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/whatsapp/clients/:clientId/campaigns", rateLimit(30), requireClientOrAdmin, async (req, res) => {
    try {
      const snap = await getDocs(query(collection(db, "wa_campaigns"), where("clientId", "==", req.params.clientId)));
      res.json(snap.docs.map((d) => {
        const { recipients, ...rest } = d.data(); // list heavy hoti hai
        return { id: d.id, ...rest };
      }).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  async function runCampaign(campaignId, clientId, cfg, tpl, recipients) {
    let sent = 0, failed = 0, consecutiveFail = 0;
    const cRef = doc(db, "wa_campaigns", campaignId);
    for (const c of recipients) {
      // Template variables: {{name}} -> customer ka naam
      const params = (tpl.variables || []).map((v) => ({
        type: "text",
        text: String(v).replace(/\{\{name\}\}/gi, c.name || "Customer"),
      }));
      const payload = {
        messaging_product: "whatsapp",
        to: c.phone,
        type: "template",
        template: {
          name: tpl.templateName,
          language: { code: tpl.language },
          ...(params.length ? { components: [{ type: "body", parameters: params }] } : {}),
        },
      };
      try {
        const r = await meta(`/${cfg.phoneNumberId}/messages`, cfg.token, "POST", payload);
        const wamid = r.messages?.[0]?.id;
        sent++; consecutiveFail = 0;
        if (wamid) {
          await setDoc(doc(db, "wa_outbound", wamid), {
            clientId, campaignId, phone: c.phone, status: "sent",
            at: new Date().toISOString(),
          }).catch(() => {});
        }
      } catch (e) {
        failed++; consecutiveFail++;
        warn(`[WA ${clientId}] send to ${c.phone} failed: ${e.message}`);
        // Token expire / template reject / quality block -> aage bhejna bekaar
        if (consecutiveFail >= 10) {
          await updateDoc(cRef, { status: "aborted", sent, failed, error: e.message }).catch(() => {});
          return;
        }
      }
      if ((sent + failed) % 20 === 0) await updateDoc(cRef, { sent, failed }).catch(() => {});
      await delay(SEND_GAP_MS);
    }
    await updateDoc(cRef, { status: "completed", sent, failed, completedAt: new Date().toISOString() }).catch(() => {});
    log(`[WA ${clientId}] campaign ${campaignId} done — sent ${sent}, failed ${failed}`);
  }

  // ── 5. WEBHOOK (Meta -> hamara server) ───────────────────────────────────
  // Meta ka ek hi webhook URL hota hai poore app ke liye; hum phone_number_id se
  // pata lagate hain ki message kis restaurant ka hai.
  app.get("/api/whatsapp/webhook", (req, res) => {
    if (
      req.query["hub.mode"] === "subscribe" &&
      req.query["hub.verify_token"] === process.env.WA_VERIFY_TOKEN
    ) return res.status(200).send(req.query["hub.challenge"]);
    res.sendStatus(403);
  });

  // ── 7. ORDER MESSAGES ────────────────────────────────────────────────────
  // Flow: date + vendor chuno -> us din ke orders -> pehle se set template
  // un orders ke customers (order ke contactNo) ko bhejo.
  const TOKENS = {
    name: (o) => {
      const n = (o.customerName || "").trim();
      return !n || /^(n\/a|unknown)$/i.test(n) ? "Customer" : n;
    },
    orderNo: (o) => o.orderNo,
    trainInfo: (o) => o.trainInfo,
    coach: (o) => o.coach,
    deliveryTime: (o) => o.deliveryTime,
    deliveryDate: (o) => o.deliveryDate,
    vendor: (o) => o.vendorName,
    total: (o) => o.totalAmount,
  };

  // "{{name}}" jaise tokens ko order ki value se replace karo.
  // WhatsApp params khali, newline/tab ya 4+ spaces wale nahi ho sakte.
  function fillTokens(str, o) {
    const out = String(str || "")
      .replace(/\{\{(\w+)\}\}/g, (m, k) => (TOKENS[k] ? String(TOKENS[k](o) ?? "") : m))
      .replace(/[\n\t]+/g, " ")
      .replace(/ {4,}/g, "   ")
      .trim();
    return out || "-";
  }

  // Ek baar template set karo (har baar nahi)
  // body: { templateName, language, variables:["{{name}}","{{trainInfo}}"] }
  app.put("/api/whatsapp/clients/:clientId/order-message-settings", rateLimit(20), requireClientOrAdmin, async (req, res) => {
    try {
      const { templateName, language = "en", variables = [] } = req.body;
      if (!templateName) return res.status(400).json({ error: "templateName required" });
      if (!Array.isArray(variables) || variables.length > 10)
        return res.status(400).json({ error: "variables invalid" });
      for (const v of variables) {
        for (const m of String(v).matchAll(/\{\{(\w+)\}\}/g)) {
          if (!TOKENS[m[1]]) return res.status(400).json({ error: `Unknown field {{${m[1]}}}` });
        }
      }
      const orderMessage = { templateName, language, variables: variables.map(String), updatedAt: new Date().toISOString() };
      await updateDoc(doc(db, "clients", req.params.clientId), { "whatsapp.orderMessage": orderMessage });
      res.json(orderMessage);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Ek date ke saare orders (frontend vendor ke hisaab se filter karta hai)
  app.get("/api/whatsapp/clients/:clientId/orders", rateLimit(60), requireClientOrAdmin, async (req, res) => {
    try {
      const date = String(req.query.date || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "date must be YYYY-MM-DD" });
      const snap = await getDocs(query(
        collection(db, "orders"),
        where("clientId", "==", req.params.clientId),
        where("deliveryDate", "==", date),
      ));
      const rows = snap.docs.map((d) => {
        const o = d.data();
        return {
          orderNo: o.orderNo,
          customerName: o.customerName || "",
          phone: normPhone(o.contactNo),
          vendorName: o.vendorName || "Unknown",
          trainInfo: o.trainInfo || "",
          coach: o.coach || "",
          deliveryTime: o.deliveryTime || "",
          totalAmount: o.totalAmount || 0,
          status: o.status || "",
          waMessage: o.waMessage || null,
          waMessageError: o.waMessageError || "",
        };
      }).filter((o) => !/cancel/i.test(o.status))
        .sort((a, b) => (a.deliveryTime || "99").localeCompare(b.deliveryTime || "99"));
      res.json(rows);
    } catch (e) {
      warn(`WA orders list error: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // body: { orderNos:[...], force:false, vendor:"IRCTC", date:"2026-10-10" }
  app.post("/api/whatsapp/clients/:clientId/order-messages", rateLimit(5), requireClientOrAdmin, async (req, res) => {
    try {
      const { clientId } = req.params;
      const { orderNos, force = false, vendor = "", date = "" } = req.body;
      if (!Array.isArray(orderNos) || orderNos.length === 0)
        return res.status(400).json({ error: "orderNos required" });
      if (orderNos.length > 500)
        return res.status(400).json({ error: "Ek baar mein max 500 orders" });

      const cfg = await getWaConfig(clientId);
      if (!cfg) return res.status(400).json({ error: "WhatsApp connect nahi hai" });
      const clientSnap = await getDoc(doc(db, "clients", clientId));
      const om = clientSnap.data()?.whatsapp?.orderMessage;
      if (!om?.templateName) return res.status(400).json({ error: "Pehle template set karein" });

      const skipped = { noPhone: 0, alreadySent: 0, optedOut: 0, duplicatePhone: 0, notFound: 0 };
      const jobs = [];
      const seenPhones = new Set();
      for (const orderNo of orderNos) {
        const no = String(orderNo);
        if (!no || no.includes("/")) { skipped.notFound++; continue; }
        const snap = await getDoc(doc(db, "orders", `${clientId}_${no}`));
        if (!snap.exists()) { skipped.notFound++; continue; }
        const o = snap.data();
        const phone = normPhone(o.contactNo);
        if (!phone) { skipped.noPhone++; continue; }
        if (o.waMessage?.sentAt && !force) { skipped.alreadySent++; continue; }
        if (seenPhones.has(phone)) { skipped.duplicatePhone++; continue; }
        const cust = await getDoc(doc(db, "wa_customers", `${clientId}_${phone}`));
        if (cust.exists() && cust.data().optIn === false) { skipped.optedOut++; continue; }
        seenPhones.add(phone);
        jobs.push({ orderNo: no, phone, order: o });
      }
      if (jobs.length === 0)
        return res.status(400).json({ error: "Bhejne layak koi order nahi mila", skipped });

      const ref = await addDoc(collection(db, "wa_campaigns"), {
        clientId, kind: "orders", templateName: om.templateName, language: om.language,
        vendor: String(vendor), date: String(date),
        total: jobs.length, sent: 0, failed: 0,
        status: "running", createdAt: new Date().toISOString(),
      });
      runOrderMessages(ref.id, clientId, cfg, om, jobs)
        .catch((e) => err(`Order messages ${ref.id} crashed: ${e.message}`));
      res.json({ campaignId: ref.id, queued: jobs.length, skipped });
    } catch (e) {
      warn(`WA order-messages error: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  async function runOrderMessages(campaignId, clientId, cfg, om, jobs) {
    let sent = 0, failed = 0, consecutiveFail = 0, lastError = "";
    const cRef = doc(db, "wa_campaigns", campaignId);
    for (const job of jobs) {
      const params = (om.variables || []).map((v) => ({ type: "text", text: fillTokens(v, job.order) }));
      const orderRef = doc(db, "orders", `${clientId}_${job.orderNo}`);
      try {
        const r = await meta(`/${cfg.phoneNumberId}/messages`, cfg.token, "POST", {
          messaging_product: "whatsapp",
          to: job.phone,
          type: "template",
          template: {
            name: om.templateName,
            language: { code: om.language || "en" },
            ...(params.length ? { components: [{ type: "body", parameters: params }] } : {}),
          },
        });
        const wamid = r.messages?.[0]?.id || "";
        sent++; consecutiveFail = 0;
        await updateDoc(orderRef, {
          waMessage: { templateName: om.templateName, sentAt: new Date().toISOString(), wamid },
          waMessageError: "",
        }).catch(() => {});
        if (wamid) {
          await setDoc(doc(db, "wa_outbound", wamid), {
            clientId, campaignId, orderNo: job.orderNo, phone: job.phone,
            status: "sent", at: new Date().toISOString(),
          }).catch(() => {});
        }
      } catch (e) {
        failed++; consecutiveFail++; lastError = e.message;
        warn(`[WA ${clientId}] order #${job.orderNo} message failed: ${e.message}`);
        await updateDoc(orderRef, { waMessageError: e.message }).catch(() => {});
        if (consecutiveFail >= 10) {
          await updateDoc(cRef, { status: "aborted", sent, failed, error: e.message }).catch(() => {});
          return;
        }
      }
      if ((sent + failed) % 10 === 0) await updateDoc(cRef, { sent, failed }).catch(() => {});
      await delay(SEND_GAP_MS);
    }
    await updateDoc(cRef, {
      status: "completed", sent, failed,
      ...(lastError ? { error: lastError } : {}),
      completedAt: new Date().toISOString(),
    }).catch(() => {});
    log(`[WA ${clientId}] order messages ${campaignId} done — sent ${sent}, failed ${failed}`);
  }

  // ── 6. AUTO MESSAGES ─────────────────────────────────────────────────────
  // (a) Template 1: dashboard se order PRINT hote hi customer ko turant message
  // (b) Template 2: print ke X minute (default 120) baad review message
  // Dono ke liye vendor chun sakte hain (sab ya kuch). Timer order ke document
  // mein save hota hai (waReview.dueAt), isliye server restart par bhi nahi chhootta.
  const DEFAULT_GOOD = "Shukriya! 😊 Aapko humara khana pasand aaya, humein khushi hui. Agla order dene ke liye neeche button dabayein 👇";
  const DEFAULT_BAD = "Humein khed hai ki aapka experience accha nahi raha 🙏 Aapka feedback hamari team tak pahunch gaya hai, hum ise zaroor sudharenge.";

  // Template ko Meta se check karo: approved hai? hamare liye supported hai?
  async function inspectTemplate(cfg, name, language) {
    const r = await meta(
      `/${cfg.wabaId}/message_templates?name=${encodeURIComponent(name)}&limit=50&fields=name,language,status,category,components`,
      cfg.token,
    );
    const t = (r.data || []).find((x) => x.name === name && (!language || x.language === language));
    if (!t) return { error: `Template "${name}" nahi mila` };
    if (t.status !== "APPROVED") return { error: `Template "${name}" abhi approve nahi hua (status: ${t.status})` };
    const comps = t.components || [];
    const body = comps.find((c) => c.type === "BODY");
    const header = comps.find((c) => c.type === "HEADER");
    const buttons = comps.find((c) => c.type === "BUTTONS");
    if (header && header.format !== "TEXT") return { error: "Image/video/document header wale templates support nahi hain" };
    if (header && /\{\{/.test(header.text || "")) return { error: "Header mein variable wale templates support nahi hain" };
    const btns = (buttons && buttons.buttons) || [];
    for (const b of btns) {
      if (b.type === "URL" && /\{\{/.test(b.url || "")) return { error: "Dynamic link button wale templates support nahi hain" };
      if (!["QUICK_REPLY", "URL", "PHONE_NUMBER"].includes(b.type)) return { error: `"${b.type}" button wale templates support nahi hain` };
    }
    const quickReplies = btns.filter((b) => b.type === "QUICK_REPLY").length;
    if (quickReplies > 2) return { error: "Max 2 quick-reply buttons support hote hain" };
    const nums = [...(((body && body.text) || "").matchAll(/\{\{(\d+)\}\}/g))].map((m) => parseInt(m[1], 10));
    return { language: t.language, category: t.category, quickReplies, varCount: new Set(nums).size };
  }

  function vendorAllowed(block, order) {
    if (!block) return false;
    if (block.allVendors) return true;
    const v = String(order.vendorName || "").trim().toLowerCase();
    return (block.vendors || []).some((x) => String(x).trim().toLowerCase() === v);
  }

  // Ek block (print ya review) ko validate karke saaf form mein banao
  async function buildBlock(raw, kind, cfg) {
    const b = raw || {};
    const vendors = [...new Set((Array.isArray(b.vendors) ? b.vendors : []).map((x) => String(x).trim()).filter(Boolean))].slice(0, 60);
    const out = {
      enabled: !!b.enabled,
      templateName: String(b.templateName || "").trim(),
      language: String(b.language || "").trim(),
      variables: (Array.isArray(b.variables) ? b.variables : []).map((x) => String(x)).slice(0, 10),
      allVendors: !!b.allVendors,
      vendors,
      quickReplies: 0,
    };
    if (kind === "review") {
      out.delayMinutes = Math.min(1440, Math.max(1, parseInt(b.delayMinutes, 10) || 120));
      out.goodUrl = String(b.goodUrl || "").trim();
      out.goodText = String(b.goodText || "").trim().slice(0, 500);
      out.badText = String(b.badText || "").trim().slice(0, 500);
    }
    if (!out.enabled) return { block: out }; // band hai — check ki zaroorat nahi

    if (!out.templateName) return { error: "Template chuniye" };
    if (!out.allVendors && out.vendors.length === 0)
      return { error: 'Kam se kam ek vendor chuniye ya "Sab vendors" on karein' };
    for (const v of out.variables) {
      for (const m of String(v).matchAll(/\{\{(\w+)\}\}/g)) {
        if (!TOKENS[m[1]]) return { error: `Unknown field {{${m[1]}}}` };
      }
    }
    let info;
    try {
      info = await inspectTemplate(cfg, out.templateName, out.language);
    } catch (e) {
      return { error: `Meta se template check nahi hua: ${e.message}` };
    }
    if (info.error) return { error: info.error };
    out.language = info.language;
    out.quickReplies = info.quickReplies;
    if (out.variables.length !== info.varCount)
      return { error: `Template mein ${info.varCount} variable hain, aapne ${out.variables.length} bhare` };
    if (out.variables.some((v) => !String(v).trim())) return { error: "Har variable ke liye value chuniye" };
    if (kind === "review") {
      if (out.goodUrl && !/^https:\/\//.test(out.goodUrl)) return { error: "Link https:// se shuru hona chahiye" };
      if (info.quickReplies > 0 && !out.goodUrl)
        return { error: '"Accha tha" button dabane par kholne wala link (https) daalein' };
    }
    return { block: out };
  }

  // Settings page se save: { enabled, print:{...}, review:{...} }
  app.put("/api/whatsapp/clients/:clientId/auto-messages", rateLimit(20), requireClientOrAdmin, async (req, res) => {
    try {
      const cfg = await getWaConfig(req.params.clientId);
      if (!cfg) return res.status(400).json({ error: "Pehle WhatsApp connect karein" });
      const pb = await buildBlock(req.body.print, "print", cfg);
      if (pb.error) return res.status(400).json({ error: `Print message: ${pb.error}` });
      const rb = await buildBlock(req.body.review, "review", cfg);
      if (rb.error) return res.status(400).json({ error: `Review message: ${rb.error}` });
      const settings = {
        enabled: !!req.body.enabled,
        print: pb.block,
        review: rb.block,
        updatedAt: new Date().toISOString(),
      };
      await updateDoc(doc(db, "clients", req.params.clientId), { "whatsapp.autoMessages": settings });
      res.json(settings);
    } catch (e) {
      warn(`WA auto-messages save error: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // Vendor chips ke liye
  app.get("/api/whatsapp/clients/:clientId/vendors", rateLimit(30), requireClientOrAdmin, (_req, res) => {
    res.json(VENDOR_NAMES);
  });

  async function isOptedOut(clientId, phone) {
    try {
      const c = await getDoc(doc(db, "wa_customers", `${clientId}_${phone}`));
      return c.exists() && c.data().optIn === false;
    } catch (_) {
      return false;
    }
  }

  // Template bhejo. mode "review" mein quick-reply buttons feedback payload ke saath jaate hain.
  async function sendAutoTemplate(cfg, tpl, order, phone, mode) {
    const components = [];
    if ((tpl.variables || []).length) {
      components.push({
        type: "body",
        parameters: tpl.variables.map((v) => ({ type: "text", text: fillTokens(v, order) })),
      });
    }
    for (let i = 0; i < (tpl.quickReplies || 0); i++) {
      components.push({
        type: "button",
        sub_type: "quick_reply",
        index: String(i),
        parameters: [{
          type: "payload",
          payload: mode === "review" ? `${i === 0 ? "FB_GOOD" : "FB_BAD"}:${order.orderNo}` : `QR${i}:${order.orderNo}`,
        }],
      });
    }
    const r = await meta(`/${cfg.phoneNumberId}/messages`, cfg.token, "POST", {
      messaging_product: "whatsapp",
      to: phone,
      type: "template",
      template: {
        name: tpl.templateName,
        language: { code: tpl.language || "en" },
        ...(components.length ? { components } : {}),
      },
    });
    const wamid = (r.messages && r.messages[0] && r.messages[0].id) || "";
    if (wamid) {
      await setDoc(doc(db, "wa_outbound", wamid), {
        clientId: order.clientId, orderNo: order.orderNo, phone, kind: mode,
        status: "sent", at: new Date().toISOString(),
      }).catch(() => {});
    }
    return wamid;
  }

  // ── Order PRINT hua -> Template 1 turant + review ka timer ──────────────────
  const _printLocks = new Set();
  async function processPrinted(clientId, orderNo) {
    const lockKey = `${clientId}_${orderNo}`;
    if (_printLocks.has(lockKey)) return { skipped: "in_progress" }; // double-click se bachav
    _printLocks.add(lockKey);
    try {
      const clientSnap = await getDoc(doc(db, "clients", clientId));
      const wa = (clientSnap.exists() && clientSnap.data().whatsapp) || {};
      const am = wa.autoMessages;
      if (!wa.enabled || !am || !am.enabled) return { skipped: "auto_messages_off" };
      const cfg = await getWaConfig(clientId);
      if (!cfg) return { skipped: "not_connected" };

      const ref = doc(db, "orders", `${clientId}_${orderNo}`);
      const snap = await getDoc(ref);
      if (!snap.exists()) return { skipped: "order_not_found" };
      const o = snap.data();
      const now = new Date();
      const updates = {};
      const result = { print: "off", review: "off" };
      if (!o.printedAt) updates.printedAt = now.toISOString();

      const phone = normPhone(o.contactNo);
      const optedOut = phone ? await isOptedOut(clientId, phone) : false;

      // Template 1 — turant
      const p = am.print;
      if (p && p.enabled && p.templateName) {
        if (!vendorAllowed(p, o)) result.print = "vendor_off";
        else if (o.waPrint && o.waPrint.sentAt) result.print = "already_sent";
        else if (!phone) result.print = "no_phone";
        else if (optedOut) result.print = "opted_out";
        else {
          try {
            const wamid = await sendAutoTemplate(cfg, p, o, phone, "print");
            updates.waPrint = { templateName: p.templateName, sentAt: now.toISOString(), wamid };
            updates.waPrintError = "";
            result.print = "sent";
          } catch (e) {
            warn(`[WA ${clientId}] print message failed #${orderNo}: ${e.message}`);
            updates.waPrintError = e.message;
            result.print = "failed";
            result.error = e.message;
          }
        }
      }

      // Template 2 — review ka timer
      const r = am.review;
      if (r && r.enabled && r.templateName && vendorAllowed(r, o)) {
        if (o.waReview) result.review = o.waReview.status || "scheduled"; // pehle se laga hai
        else if (!phone) result.review = "no_phone";
        else if (optedOut) result.review = "opted_out";
        else {
          const delayMin = r.delayMinutes || 120;
          updates.waReview = {
            status: "scheduled",
            scheduledAt: now.toISOString(),
            dueAt: new Date(now.getTime() + delayMin * 60000).toISOString(),
            attempts: 0,
          };
          result.review = "scheduled";
        }
      } else if (r && r.enabled) {
        result.review = "vendor_off";
      }

      if (Object.keys(updates).length) await updateDoc(ref, updates);
      return result;
    } finally {
      _printLocks.delete(lockKey);
    }
  }

  // Print wali screen is endpoint ko call karti hai (print dabane ke baad)
  app.post("/api/whatsapp/clients/:clientId/orders/:orderNo/printed", rateLimit(120), requireClientOrAdmin, async (req, res) => {
    try {
      const orderNo = String(req.params.orderNo || "");
      if (!orderNo || orderNo.includes("/")) return res.status(400).json({ error: "Invalid orderNo" });
      res.json(await processPrinted(req.params.clientId, orderNo));
    } catch (e) {
      warn(`WA printed error: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // ── Review sweep: har 1 minute mein due orders ko review bhejo ──────────────
  const MAX_REVIEW_ATTEMPTS = 3;
  const REVIEW_EXPIRE_MS = 12 * 3600 * 1000; // 12 ghante se zyada late ho to ab nahi bhejte
  let _reviewSweeping = false;
  async function reviewSweep() {
    if (_reviewSweeping) return;
    _reviewSweeping = true;
    try {
      const clients = await getDocs(query(collection(db, "clients"), where("active", "==", true)));
      for (const c of clients.docs) {
        const wa = c.data().whatsapp || {};
        const r = wa.autoMessages && wa.autoMessages.review;
        if (!wa.enabled || !wa.autoMessages || !wa.autoMessages.enabled || !r || !r.enabled || !r.templateName) continue;
        const cfg = await getWaConfig(c.id);
        if (!cfg) continue;
        const snap = await getDocs(query(
          collection(db, "orders"),
          where("clientId", "==", c.id),
          where("waReview.status", "==", "scheduled"),
        ));
        const nowMs = Date.now();
        for (const d of snap.docs) {
          const o = d.data();
          const due = new Date(o.waReview.dueAt).getTime();
          if (!due || due > nowMs) continue;
          if (nowMs - due > REVIEW_EXPIRE_MS) {
            await updateDoc(d.ref, { "waReview.status": "expired" }).catch(() => {});
            continue;
          }
          const phone = normPhone(o.contactNo);
          if (/cancel/i.test(o.status || "") || !phone || (await isOptedOut(c.id, phone))) {
            await updateDoc(d.ref, { "waReview.status": "skipped" }).catch(() => {});
            continue;
          }
          try {
            const wamid = await sendAutoTemplate(cfg, r, o, phone, "review");
            await updateDoc(d.ref, {
              "waReview.status": "sent",
              "waReview.sentAt": new Date().toISOString(),
              "waReview.wamid": wamid,
            });
            log(`[WA ${c.id}] review sent for #${o.orderNo}`);
          } catch (e) {
            const attempts = (o.waReview.attempts || 0) + 1;
            warn(`[WA ${c.id}] review send failed #${o.orderNo} (try ${attempts}): ${e.message}`);
            await updateDoc(d.ref, {
              "waReview.attempts": attempts,
              "waReview.error": e.message,
              "waReview.status": attempts >= MAX_REVIEW_ATTEMPTS ? "failed" : "scheduled",
              "waReview.dueAt": new Date(Date.now() + 5 * 60000).toISOString(), // 5 min baad dobara
            }).catch(() => {});
          }
          await delay(SEND_GAP_MS);
        }
      }
    } catch (e) {
      warn(`reviewSweep error: ${e.message}`);
    } finally {
      _reviewSweeping = false;
    }
  }

  // Customer ne review message ka button dabaya -> auto reply
  async function handleFeedback(clientId, from, payload) {
    const [tag, ...rest] = payload.split(":");
    const orderNo = rest.join(":");
    const good = tag === "FB_GOOD";
    const orderRef = doc(db, "orders", `${clientId}_${orderNo}`);
    const orderSnap = await getDoc(orderRef);
    if (!orderSnap.exists() || orderSnap.data().feedback) return; // double-tap ignore
    await updateDoc(orderRef, {
      feedback: { rating: good ? "good" : "bad", phone: from, at: new Date().toISOString() },
    });
    const cfg = await getWaConfig(clientId);
    const clientSnap = await getDoc(doc(db, "clients", clientId));
    const r = (clientSnap.data() && clientSnap.data().whatsapp && clientSnap.data().whatsapp.autoMessages &&
      clientSnap.data().whatsapp.autoMessages.review) || {};
    if (!cfg) return;
    const url = `/${cfg.phoneNumberId}/messages`;
    if (good && r.goodUrl) {
      try {
        await meta(url, cfg.token, "POST", {
          messaging_product: "whatsapp", to: from, type: "interactive",
          interactive: {
            type: "cta_url",
            body: { text: r.goodText || DEFAULT_GOOD },
            action: { name: "cta_url", parameters: { display_text: "IRCTC kholein", url: r.goodUrl } },
          },
        });
      } catch (_) {
        // cta_url na chale to plain text + link
        await meta(url, cfg.token, "POST", {
          messaging_product: "whatsapp", to: from, type: "text",
          text: { body: `${r.goodText || DEFAULT_GOOD}\n${r.goodUrl}`, preview_url: true },
        });
      }
    } else {
      await meta(url, cfg.token, "POST", {
        messaging_product: "whatsapp", to: from, type: "text",
        text: { body: good ? (r.goodText || DEFAULT_GOOD) : (r.badText || DEFAULT_BAD) },
      });
    }
    log(`[WA ${clientId}] feedback ${good ? "GOOD" : "BAD"} for #${orderNo}`);
  }

  const _clientByPhoneId = new Map(); // phoneNumberId -> { clientId, watch:Set, at }
  async function resolveClient(phoneNumberId) {
    const hit = _clientByPhoneId.get(phoneNumberId);
    if (hit && Date.now() - hit.at < 60000) return hit;
    const snap = await getDocs(query(collection(db, "clients"), where("whatsapp.phoneNumberId", "==", phoneNumberId)));
    if (snap.empty) return null;
    const d = snap.docs[0];
    const wa = d.data().whatsapp || {};
    const entry = {
      clientId: d.id,
      watch: new Set((wa.watchNumbers || []).map(normPhone)),
      at: Date.now(),
    };
    _clientByPhoneId.set(phoneNumberId, entry);
    return entry;
  }

  app.post("/api/whatsapp/webhook", async (req, res) => {
    // Signature verify — fake requests reject
    const secret = process.env.WA_APP_SECRET;
    const sig = req.headers["x-hub-signature-256"] || "";
    if (!secret || !req.rawBody) return res.sendStatus(403);
    const expected = "sha256=" + crypto.createHmac("sha256", secret).update(req.rawBody).digest("hex");
    const a = Buffer.from(sig), b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.sendStatus(403);

    res.sendStatus(200); // Meta ko turant 200 do, processing baad mein
    try {
      for (const entry of req.body.entry || []) {
        for (const ch of entry.changes || []) {
          const v = ch.value || {};
          const phoneNumberId = v.metadata?.phone_number_id;
          if (!phoneNumberId) continue;
          const client = await resolveClient(phoneNumberId);
          if (!client) continue;

          // Delivery status updates (sent/delivered/read/failed)
          for (const s of v.statuses || []) {
            await updateDoc(doc(db, "wa_outbound", s.id), {
              status: s.status, statusAt: new Date().toISOString(),
              ...(s.errors?.[0] ? { error: `${s.errors[0].code || ""} ${s.errors[0].title || ""}`.trim() } : {}),
            }).catch(() => {});
          }

          // Inbound messages
          const names = {};
          (v.contacts || []).forEach((c) => (names[c.wa_id] = c.profile?.name || ""));
          for (const m of v.messages || []) {
            const from = normPhone(m.from);
            const text = m.text?.body || m.button?.text || m.interactive?.button_reply?.title || "";

            // Feedback button reply (kisi bhi customer se) — watchNumbers filter se pehle
            const btnPayload = m.button?.payload || m.interactive?.button_reply?.id || "";
            if (btnPayload.startsWith("FB_")) {
              await handleFeedback(client.clientId, from, btnPayload).catch((e) =>
                warn(`[WA ${client.clientId}] handleFeedback failed: ${e.message}`));
              continue;
            }

            // STOP / unsubscribe — kisi bhi sender se, sirf opt-out flag lagta hai (text store nahi)
            if (/^\s*(stop|unsubscribe)\s*$/i.test(text)) {
              await setDoc(doc(db, "wa_customers", `${client.clientId}_${from}`), {
                clientId: client.clientId, phone: from,
                optIn: false, optOutAt: new Date().toISOString(),
              }, { merge: true }).catch(() => {});
              continue;
            }

            // Sirf chune hue 3-4 numbers ke messages save hote hain
            if (!client.watch.has(from)) continue;

            await setDoc(doc(db, "wa_messages", `${client.clientId}_${m.id}`), {
              clientId: client.clientId,
              from,
              name: names[m.from] || "",
              type: m.type,
              text,
              timestamp: new Date(Number(m.timestamp) * 1000).toISOString(),
              receivedAt: new Date().toISOString(),
              read: false,
            }, { merge: true });
            log(`[WA ${client.clientId}] message saved from watched number ${from.slice(0, 5)}***`);
          }
        }
      }
    } catch (e) {
      err(`WA webhook processing error: ${e.message}`);
    }
  });

  app.put("/api/whatsapp/clients/:clientId/messages/:msgId/read", rateLimit(120), requireClientOrAdmin, async (req, res) => {
    try {
      // msgId hamesha us client ka hona chahiye (doc id = clientId_wamid)
      if (!req.params.msgId.startsWith(`${req.params.clientId}_`))
        return res.status(403).json({ error: "Forbidden" });
      await updateDoc(doc(db, "wa_messages", req.params.msgId), { read: true });
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Dashboard ke liye: watched numbers ke messages
  app.get("/api/whatsapp/clients/:clientId/messages", rateLimit(60), requireClientOrAdmin, async (req, res) => {
    try {
      const snap = await getDocs(query(collection(db, "wa_messages"), where("clientId", "==", req.params.clientId)));
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .sort((x, y) => (y.timestamp || "").localeCompare(x.timestamp || ""))
        .slice(0, 200);
      res.json(rows);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  setInterval(reviewSweep, 60 * 1000); // har 1 minute mein due review messages
  log("WhatsApp module registered (auto messages active)");
};
