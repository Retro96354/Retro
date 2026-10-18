// ═══════════════════════════════════════════════════════════════════════════
// src/screens/WhatsAppOrderMessageScreen.js
// Do tareeke se message bhejna:
//   TAB 1 "Orders se":  Date chuno -> Vendor chuno -> us din ke orders ->
//                       template chuno -> "Bhejein"   (print hua ho ya nahi, farak nahi)
//   TAB 2 "Imported list": Excel/CSV (Order ID + Phone) import karo, system me
//                       save ho jati hai -> select karo -> template chuno -> bulk bhejo
// Template ab har baar bhejte waqt chuna jata hai.
// ═══════════════════════════════════════════════════════════════════════════
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  Platform,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as XLSX from "xlsx";
import * as wa from "../services/Whatsappapi";

const C = {
  bg: "#F5F6F8",
  card: "#FFFFFF",
  text: "#1B1F24",
  sub: "#6B7280",
  line: "#E5E7EB",
  primary: "#128C7E",
  primaryDark: "#075E54",
  danger: "#DC2626",
  warn: "#D97706",
  ok: "#16A34A",
};

// Order ki kaun si jaankari template mein lag sakti hai
const TOKENS = [
  { key: "name", label: "Customer naam" },
  { key: "orderNo", label: "Order no" },
  { key: "trainInfo", label: "Train" },
  { key: "coach", label: "Coach/Seat" },
  { key: "deliveryTime", label: "Time" },
  { key: "vendor", label: "Vendor" },
  { key: "total", label: "Total ₹" },
];
// Imported list mein sirf naam aur order no hota hai
const IMPORT_TOKENS = TOKENS.filter((t) => t.key === "name" || t.key === "orderNo");

const MAX_IMPORT_ROWS = 5000;
const IMPORT_CHUNK = 1000;

// ── date helpers (IST, device timezone par nirbhar nahi) ────────────────────
function istToday() {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}
function shiftDate(d, n) {
  const [y, m, dd] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10);
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function prettyDate(d) {
  const [y, m, dd] = d.split("-").map(Number);
  return `${dd} ${MONTHS[m - 1]} ${y}`;
}

// Template ke {{n}} ko order ki value se bharke preview banao
function renderPreview(tplBody, variables, order) {
  const vals = (variables || []).map((v) =>
    String(v || "").replace(/\{\{(\w+)\}\}/g, (m, k) => {
      if (!order) return m;
      const map = {
        name: order.customerName || "Customer",
        orderNo: order.orderNo,
        trainInfo: order.trainInfo,
        coach: order.coach,
        deliveryTime: order.deliveryTime,
        vendor: order.vendorName,
        total: order.totalAmount,
      };
      return map[k] !== undefined && map[k] !== "" ? String(map[k]) : m;
    }),
  );
  let i = 0;
  // variables array template ke {{1}}, {{2}} ... ke order mein hai
  return String(tplBody || "").replace(/\{\{\d+\}\}/g, () => vals[i++] || "…");
}

// ── template selection helpers ──────────────────────────────────────────────
const tplKey = (t) => `${t.name}|${t.language}`;

function resolveTpl(templates, sel) {
  const tpl = templates.find((t) => tplKey(t) === sel.key) || null;
  if (!tpl) return { tpl: null, ready: false, payload: null };
  const variables = tpl.varNums.map((_, i) => (sel.vars[i] || "").trim());
  return {
    tpl,
    ready: variables.every(Boolean),
    payload: { templateName: tpl.name, language: tpl.language, variables },
  };
}

function skippedText(sk = {}) {
  const parts = [];
  if (sk.alreadySent) parts.push(`${sk.alreadySent} pehle bheje ja chuke`);
  if (sk.noPhone) parts.push(`${sk.noPhone} ka number nahi`);
  if (sk.optedOut) parts.push(`${sk.optedOut} ne STOP kiya hai`);
  if (sk.duplicatePhone) parts.push(`${sk.duplicatePhone} ka number repeat tha`);
  if (sk.notFound) parts.push(`${sk.notFound} nahi mile`);
  return parts.join("\n");
}

// ── Excel / CSV padhna ──────────────────────────────────────────────────────
function readFileAsBase64(uri) {
  return fetch(uri)
    .then((r) => r.blob())
    .then(
      (blob) =>
        new Promise((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(String(fr.result).split(",")[1] || "");
          fr.onerror = () => reject(new Error("File padh nahi paye"));
          fr.readAsDataURL(blob);
        }),
    );
}

// Pehli sheet se rows nikalo. Heading me "order"/"phone/mobile" ho to wahi columns,
// warna pehla column = Order ID, doosra = Phone. Optional "name" column.
function parseSheet(b64) {
  const wb = XLSX.read(b64, { type: "base64" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
  if (!grid.length) return [];

  const head = (grid[0] || []).map((h) => String(h).toLowerCase().trim());
  const find = (re) => head.findIndex((h) => re.test(h));
  let o = find(/order|booking|pnr|ref|^id$/);
  let p = find(/phone|mobile|contact|whatsapp|cell/);
  let n = find(/name|customer/);
  let start = 1;
  if (o < 0 || p < 0) {
    o = 0;
    p = 1;
    n = -1;
    // pehli row data jaisi lage (doosre column me 10+ digit) to heading nahi hai
    start = String(grid[0]?.[1] ?? "").replace(/\D/g, "").length >= 10 ? 0 : 1;
  }
  if (n === o || n === p) n = -1;

  return grid
    .slice(start)
    .map((r) => ({
      orderNo: String(r[o] ?? "").trim(),
      phone: String(r[p] ?? "").trim(),
      name: n >= 0 ? String(r[n] ?? "").trim() : "",
    }))
    .filter((r) => r.orderNo || r.phone);
}

// ═══════════════════════════════════════════════════════════════════════════
// TEMPLATE CHUNNE WALA CARD (controlled — dono tabs me use hota hai)
// ═══════════════════════════════════════════════════════════════════════════
function TemplatePicker({ title, templates, loading, error, value, onChange, tokens, sample }) {
  const [open, setOpen] = useState(false);
  const { tpl } = resolveTpl(templates, value);
  const showList = open || !tpl;

  const setVar = (idx, v) => onChange({ ...value, vars: { ...value.vars, [idx]: v } });
  const addToken = (idx, key) => {
    const cur = (value.vars[idx] || "").trim();
    setVar(idx, cur ? `${cur} {{${key}}}` : `{{${key}}}`);
  };
  const previewVars = tpl ? tpl.varNums.map((_, i) => value.vars[i] || "") : [];

  return (
    <View style={styles.card}>
      <View style={styles.rowBetween}>
        <Text style={styles.cardTitle}>{title}</Text>
        {tpl ? (
          <TouchableOpacity onPress={() => setOpen((v) => !v)}>
            <Text style={styles.link}>{open ? "Band karein" : "Badlein"}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {loading ? <ActivityIndicator color={C.primary} style={{ marginVertical: 16 }} /> : null}
      {error ? <Text style={styles.errorText}>Templates load nahi hue: {error}</Text> : null}
      {!loading && !error && templates.length === 0 ? (
        <Text style={styles.muted}>
          Abhi koi approved template nahi hai. WhatsApp Manager mein "Utility" category ka template banayein; approve
          hone mein kuch minute se 24 ghante lagte hain.
        </Text>
      ) : null}

      {showList
        ? templates.map((t) => {
            const on = value.key === tplKey(t);
            return (
              <TouchableOpacity
                key={tplKey(t)}
                activeOpacity={t.supported ? 0.7 : 1}
                onPress={() => {
                  if (!t.supported) return;
                  if (!on) onChange({ key: tplKey(t), vars: {} });
                  setOpen(false);
                }}
                style={[styles.tplItem, on && styles.tplItemOn, !t.supported && { opacity: 0.5 }]}
              >
                <View style={styles.rowBetween}>
                  <Text style={styles.tplName}>{t.name}</Text>
                  <Text style={styles.pill}>{t.category}</Text>
                </View>
                <Text style={styles.tplBody} numberOfLines={on ? undefined : 2}>
                  {t.bodyText}
                </Text>
                {!t.supported ? <Text style={styles.warnText}>⚠ {t.reason}</Text> : null}
              </TouchableOpacity>
            );
          })
        : null}

      {tpl ? (
        <View style={{ marginTop: 10 }}>
          <View style={styles.bubble}>
            <Text style={styles.bubbleText}>{renderPreview(tpl.bodyText, previewVars, sample)}</Text>
          </View>

          {tpl.varNums.length === 0 ? (
            <Text style={styles.muted}>Is template mein koi variable nahi hai.</Text>
          ) : (
            <Text style={styles.label}>Har variable mein kya jaye:</Text>
          )}
          {tpl.varNums.map((n, idx) => (
            <View key={n} style={{ marginBottom: 12 }}>
              <Text style={styles.varLabel}>{`{{${n}}}`}</Text>
              <TextInput
                style={styles.input}
                value={value.vars[idx] || ""}
                onChangeText={(v) => setVar(idx, v)}
                placeholder="Neeche se chuniye ya khud likhiye"
                placeholderTextColor={C.sub}
              />
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {tokens.map((t) => (
                  <TouchableOpacity key={t.key} style={styles.tokenChip} onPress={() => addToken(idx, t.key)}>
                    <Text style={styles.tokenText}>+ {t.label}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN SCREEN
// ═══════════════════════════════════════════════════════════════════════════
export default function WhatsAppOrderMessageScreen() {
  const [tab, setTab] = useState("orders"); // "orders" | "imported"

  // ── common ────────────────────────────────────────────────────────────────
  const [status, setStatus] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [tplLoading, setTplLoading] = useState(false);
  const [tplError, setTplError] = useState("");
  const [run, setRun] = useState(null); // chal raha send job (dono tabs ke liye)

  // ── orders tab ────────────────────────────────────────────────────────────
  const [date, setDate] = useState(istToday());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [orders, setOrders] = useState([]);
  const [vendor, setVendor] = useState(null); // null = sab vendors
  const [selected, setSelected] = useState({});
  const [orderTpl, setOrderTpl] = useState({ key: null, vars: {} });
  const [sending, setSending] = useState(false);
  const reqId = useRef(0);

  // ── imported tab ──────────────────────────────────────────────────────────
  const [imported, setImported] = useState([]);
  const [impLoading, setImpLoading] = useState(false);
  const [impError, setImpError] = useState("");
  const [impSel, setImpSel] = useState({});
  const [impSearch, setImpSearch] = useState("");
  const [impFilter, setImpFilter] = useState("all"); // all | unsent | sent
  const [importing, setImporting] = useState(false);
  const [impBusy, setImpBusy] = useState(false);
  const [impSending, setImpSending] = useState(false);
  const [importTpl, setImportTpl] = useState({ key: null, vars: {} });
  const impLoaded = useRef(false);

  const connected = !!status?.connected;

  // ── orders load ───────────────────────────────────────────────────────────
  const load = useCallback(async (forDate, silent = false) => {
    const id = ++reqId.current;
    if (!silent) setLoading(true);
    try {
      const [st, list] = await Promise.all([wa.getStatus(), wa.getOrdersByDate(forDate)]);
      if (id !== reqId.current) return; // purana response, ignore
      setStatus(st);
      setOrders(list);
      setError("");
      // Pehle save kiya hua template ek baar pre-select kar do (user badal sakta hai)
      const om = st.orderMessage;
      if (om?.templateName) {
        setOrderTpl((p) =>
          p.key
            ? p
            : {
                key: `${om.templateName}|${om.language}`,
                vars: Object.fromEntries((om.variables || []).map((v, i) => [i, v])),
              },
        );
      }
    } catch (e) {
      if (id === reqId.current) setError(e.message);
    } finally {
      if (id === reqId.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    setVendor(null);
    load(date);
  }, [date, load]);

  // ── templates (ek baar, connected hone par) ───────────────────────────────
  useEffect(() => {
    if (!connected) return undefined;
    let alive = true;
    (async () => {
      setTplLoading(true);
      setTplError("");
      try {
        const list = await wa.getTemplates();
        if (alive) setTemplates(list.filter((t) => t.status === "APPROVED").map((t) => wa.analyzeTemplate(t)));
      } catch (e) {
        if (alive) setTplError(e.message);
      } finally {
        if (alive) setTplLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [connected]);

  // ── imported load ─────────────────────────────────────────────────────────
  const loadImported = useCallback(async (silent = false) => {
    if (!silent) setImpLoading(true);
    try {
      setImported(await wa.getImportedContacts());
      setImpError("");
    } catch (e) {
      setImpError(e.message);
    } finally {
      setImpLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "imported" && connected && !impLoaded.current) {
      impLoaded.current = true;
      loadImported();
    }
  }, [tab, connected, loadImported]);

  // ── orders: vendors / visible ─────────────────────────────────────────────
  const vendors = useMemo(() => {
    const map = {};
    orders.forEach((o) => (map[o.vendorName] = (map[o.vendorName] || 0) + 1));
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [orders]);

  const visible = useMemo(() => (vendor ? orders.filter((o) => o.vendorName === vendor) : orders), [orders, vendor]);
  const isSent = (o) => !!o.waMessage?.sentAt;
  const eligible = useMemo(() => visible.filter((o) => o.phone && !isSent(o)), [visible]);

  // vendor/date badalne par bhejne layak sab orders apne aap select
  useEffect(() => {
    const sel = {};
    eligible.forEach((o) => (sel[o.orderNo] = true));
    setSelected(sel);
  }, [eligible]);

  const selectedOrders = useMemo(() => visible.filter((o) => selected[o.orderNo] && o.phone), [visible, selected]);
  const allSelected = eligible.length > 0 && eligible.every((o) => selected[o.orderNo]);

  const toggle = (o) => {
    if (!o.phone) return;
    setSelected((p) => ({ ...p, [o.orderNo]: !p[o.orderNo] }));
  };
  const toggleAll = () => {
    const sel = {};
    if (!allSelected) eligible.forEach((o) => (sel[o.orderNo] = true));
    setSelected(sel);
  };

  const orderInfo = useMemo(() => resolveTpl(templates, orderTpl), [templates, orderTpl]);

  // ── imported: filter / select ─────────────────────────────────────────────
  const sentCount = useMemo(() => imported.filter((r) => r.waMessage?.sentAt).length, [imported]);

  const impVisible = useMemo(() => {
    const q = impSearch.trim().toLowerCase();
    const qd = q.replace(/\D/g, "");
    return imported.filter((r) => {
      const sent = !!r.waMessage?.sentAt;
      if (impFilter === "unsent" && sent) return false;
      if (impFilter === "sent" && !sent) return false;
      if (!q) return true;
      return (
        String(r.orderNo).toLowerCase().includes(q) ||
        (qd && r.phone.includes(qd)) ||
        (r.name || "").toLowerCase().includes(q)
      );
    });
  }, [imported, impSearch, impFilter]);

  const impEligible = useMemo(() => impVisible.filter((r) => !r.waMessage?.sentAt), [impVisible]);
  const impSelected = useMemo(() => imported.filter((r) => impSel[r.orderNo]), [imported, impSel]);
  const impAllSelected = impEligible.length > 0 && impEligible.every((r) => impSel[r.orderNo]);

  const toggleImp = (r) => setImpSel((p) => ({ ...p, [r.orderNo]: !p[r.orderNo] }));
  const toggleAllImp = () => {
    const sel = {};
    if (!impAllSelected) impEligible.forEach((r) => (sel[r.orderNo] = true));
    setImpSel(sel);
  };

  const importInfo = useMemo(() => resolveTpl(templates, importTpl), [templates, importTpl]);

  // ── orders: send ──────────────────────────────────────────────────────────
  const send = async () => {
    if (!orderInfo.ready) {
      wa.notify("Template adhoora hai", "Pehle template chuniye aur har variable ki value bharein.");
      return;
    }
    if (selectedOrders.length === 0) return;
    const resend = selectedOrders.filter(isSent).length;
    const ok = await wa.confirmAsync(
      "Message bhejein?",
      `${vendor || "Sab vendors"} · ${prettyDate(date)}\n\n${selectedOrders.length} customers ko "${orderInfo.payload.templateName}" message jayega.` +
        (resend ? `\n\n⚠ ${resend} customers ko pehle bhi bheja ja chuka hai, unko dobara jayega.` : "") +
        "\n\nMessage ke paise aapke Meta account se katenge.",
    );
    if (!ok) return;

    setSending(true);
    try {
      const r = await wa.sendOrderMessages({
        orderNos: selectedOrders.map((o) => o.orderNo),
        force: resend > 0,
        vendor: vendor || "",
        date,
        template: orderInfo.payload,
      });
      setRun({ id: r.campaignId, total: r.queued, sent: 0, failed: 0, status: "running" });
      const txt = skippedText(r.skipped);
      if (txt) wa.notify("Kuch orders skip hue", txt);
    } catch (e) {
      wa.notify("Message nahi gaye", e.message);
    } finally {
      setSending(false);
    }
  };

  // ── imported: Excel import ────────────────────────────────────────────────
  const doImport = async () => {
    setImporting(true);
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: [
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "application/vnd.ms-excel",
          "text/csv",
          "text/comma-separated-values",
        ],
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.length) return;

      const b64 = await readFileAsBase64(res.assets[0].uri);
      const rows = parseSheet(b64);
      if (rows.length === 0) {
        wa.notify("File khali hai", "Is file me Order ID aur Phone wali koi row nahi mili.");
        return;
      }
      if (rows.length > MAX_IMPORT_ROWS) {
        wa.notify("File badi hai", `Ek baar me max ${MAX_IMPORT_ROWS} rows import ho sakti hain. File ko do hisson me baant lein.`);
        return;
      }
      const ok = await wa.confirmAsync(
        "Import karein?",
        `${res.assets[0].name || "File"} me ${rows.length} rows mili.\n\nGalat number ya khali Order ID wali rows skip ho jayengi. Pehle se saved Order ID ho to update ho jayegi.`,
        "Import",
      );
      if (!ok) return;

      let saved = 0;
      const skipped = { noOrderNo: 0, badPhone: 0, duplicateInFile: 0 };
      for (let i = 0; i < rows.length; i += IMPORT_CHUNK) {
        const r = await wa.importContacts(rows.slice(i, i + IMPORT_CHUNK));
        saved += r.saved || 0;
        Object.keys(skipped).forEach((k) => (skipped[k] += (r.skipped && r.skipped[k]) || 0));
      }
      const parts = [];
      if (skipped.badPhone) parts.push(`${skipped.badPhone} ka number galat tha`);
      if (skipped.noOrderNo) parts.push(`${skipped.noOrderNo} ki Order ID khali thi`);
      if (skipped.duplicateInFile) parts.push(`${skipped.duplicateInFile} Order ID repeat thi`);
      wa.notify(`✓ ${saved} contacts save hue`, parts.join("\n"));
      setImpSel({});
      await loadImported(true);
    } catch (e) {
      wa.notify("Import nahi hua", e.message);
    } finally {
      setImporting(false);
    }
  };

  const deleteSelectedImported = async () => {
    if (impSelected.length === 0) return;
    const ok = await wa.confirmAsync(
      "Contacts hatayein?",
      `${impSelected.length} contacts list se hat jayenge.`,
      "Hatayein",
    );
    if (!ok) return;
    setImpBusy(true);
    try {
      await wa.deleteImported({ orderNos: impSelected.map((r) => r.orderNo) });
      setImpSel({});
      await loadImported(true);
    } catch (e) {
      wa.notify("Error", e.message);
    }
    setImpBusy(false);
  };

  const deleteAllImported = async () => {
    if (imported.length === 0) return;
    const ok = await wa.confirmAsync(
      "Poori list hatayein?",
      `Saare ${imported.length} imported contacts delete ho jayenge. Ye wapas nahi aayenge.`,
      "Sab hatayein",
    );
    if (!ok) return;
    setImpBusy(true);
    try {
      await wa.deleteImported({ all: true });
      setImpSel({});
      await loadImported(true);
    } catch (e) {
      wa.notify("Error", e.message);
    }
    setImpBusy(false);
  };

  // ── imported: send ────────────────────────────────────────────────────────
  const sendImported = async () => {
    if (!importInfo.ready) {
      wa.notify("Template adhoora hai", "Pehle template chuniye aur har variable ki value bharein.");
      return;
    }
    if (impSelected.length === 0) return;
    const resend = impSelected.filter((r) => r.waMessage?.sentAt).length;
    const ok = await wa.confirmAsync(
      "Message bhejein?",
      `${impSelected.length} contacts ko "${importInfo.payload.templateName}" message jayega.` +
        (resend ? `\n\n⚠ ${resend} contacts ko pehle bhi bheja ja chuka hai, unko dobara jayega.` : "") +
        "\n\nMessage ke paise aapke Meta account se katenge.",
    );
    if (!ok) return;

    setImpSending(true);
    try {
      const r = await wa.sendImportedMessages({
        orderNos: impSelected.map((x) => x.orderNo),
        template: importInfo.payload,
        force: resend > 0,
      });
      setRun({ id: r.campaignId, total: r.queued, sent: 0, failed: 0, status: "running" });
      const txt = skippedText(r.skipped);
      if (txt) wa.notify("Kuch contacts skip hue", txt);
    } catch (e) {
      wa.notify("Message nahi gaye", e.message);
    } finally {
      setImpSending(false);
    }
  };

  // ── Progress poll ─────────────────────────────────────────────────────────
  const runId = run?.id;
  const runStatus = run?.status;
  useEffect(() => {
    if (!runId || runStatus !== "running") return undefined;
    const t = setInterval(async () => {
      try {
        const list = await wa.getCampaigns();
        const c = list.find((x) => x.id === runId);
        if (!c) return;
        setRun(c);
        if (c.status !== "running") {
          load(date, true);
          if (impLoaded.current) {
            loadImported(true);
            setImpSel({});
          }
          wa.notify(
            c.status === "completed" ? "Messages bhej diye" : "Bhejna beech mein ruk gaya",
            `Bheje: ${c.sent || 0}  ·  Fail: ${c.failed || 0}` + (c.error ? `\n${c.error}` : ""),
          );
        }
      } catch (_) {}
    }, 3000);
    return () => clearInterval(t);
  }, [runId, runStatus, date, load, loadImported]);

  // ── early state ───────────────────────────────────────────────────────────
  if (!loading && status && !status.connected) {
    return (
      <View style={styles.center}>
        <Text style={styles.bigIcon}>💬</Text>
        <Text style={styles.centerTitle}>WhatsApp connect nahi hai</Text>
        <Text style={[styles.muted, { textAlign: "center", marginTop: 6 }]}>
          Settings → WhatsApp mein Phone Number ID, WABA ID aur Access Token daalein.
        </Text>
      </View>
    );
  }

  const running = runStatus === "running";
  const pct = run?.total ? Math.min(100, Math.round((((run.sent || 0) + (run.failed || 0)) / run.total) * 100)) : 0;
  const sample = visible[0] || orders[0];
  const impSample = impSelected[0] || impVisible[0] || imported[0];
  const impSampleOrder = impSample ? { customerName: impSample.name, orderNo: impSample.orderNo } : null;

  const canSend = orderInfo.ready && selectedOrders.length > 0 && !sending && !running;
  const canSendImp = importInfo.ready && impSelected.length > 0 && !impSending && !running;

  const tokenBanner =
    status?.tokenValid === false ? (
      <View style={styles.banner}>
        <Text style={styles.bannerText}>⚠ WhatsApp token expire ho gaya hai. Settings mein naya token daalein.</Text>
      </View>
    ) : null;

  const runCard = run ? (
    <View style={styles.card}>
      <View style={styles.rowBetween}>
        <Text style={styles.cardTitle}>
          {run.status === "running" ? "Bhej rahe hain…" : run.status === "completed" ? "Poora hua ✓" : "Beech mein ruka"}
        </Text>
        <Text style={styles.muted}>
          {(run.sent || 0) + (run.failed || 0)}/{run.total}
        </Text>
      </View>
      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressFill,
            { width: `${run.status === "completed" ? 100 : pct}%`, backgroundColor: run.status === "aborted" ? C.danger : C.primary },
          ]}
        />
      </View>
      <Text style={styles.muted}>
        Bheje: {run.sent || 0} · Fail: {run.failed || 0}
      </Text>
    </View>
  ) : null;

  // ── TAB 1 header ──────────────────────────────────────────────────────────
  const ordersHeader = (
    <View>
      {tokenBanner}

      {/* Date */}
      <View style={styles.dateBar}>
        <TouchableOpacity style={styles.dateArrow} onPress={() => setDate(shiftDate(date, -1))}>
          <Text style={styles.dateArrowText}>‹</Text>
        </TouchableOpacity>
        <TouchableOpacity style={{ flex: 1, alignItems: "center" }} onPress={() => setDate(istToday())}>
          <Text style={styles.dateText}>{prettyDate(date)}</Text>
          <Text style={styles.dateSub}>{date === istToday() ? "Aaj" : "Aaj par jaane ke liye dabayein"}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.dateArrow} onPress={() => setDate(shiftDate(date, 1))}>
          <Text style={styles.dateArrowText}>›</Text>
        </TouchableOpacity>
      </View>

      {runCard}

      {/* Vendors */}
      <Text style={styles.sectionTitle}>Vendor chuniye</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 6 }}>
        <TouchableOpacity style={[styles.chip, !vendor && styles.chipOn]} onPress={() => setVendor(null)}>
          <Text style={[styles.chipText, !vendor && styles.chipTextOn]}>Sab ({orders.length})</Text>
        </TouchableOpacity>
        {vendors.map(([name, count]) => (
          <TouchableOpacity key={name} style={[styles.chip, vendor === name && styles.chipOn]} onPress={() => setVendor(name)}>
            <Text style={[styles.chipText, vendor === name && styles.chipTextOn]}>
              {name} ({count})
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Template */}
      <TemplatePicker
        title="Kaun sa message bhejna hai?"
        templates={templates}
        loading={tplLoading}
        error={tplError}
        value={orderTpl}
        onChange={setOrderTpl}
        tokens={TOKENS}
        sample={sample}
      />

      {visible.length > 0 ? (
        <TouchableOpacity style={styles.selectAll} onPress={toggleAll}>
          <View style={[styles.box, allSelected && styles.boxOn]}>{allSelected ? <Text style={styles.tick}>✓</Text> : null}</View>
          <Text style={styles.selectAllText}>
            Sab select karein ({eligible.length} bhejne layak, {visible.length} orders)
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );

  // ── TAB 2 header ──────────────────────────────────────────────────────────
  const importedHeader = (
    <View>
      {tokenBanner}
      {runCard}

      {/* Import */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Excel / CSV se contacts import karein</Text>
        <Text style={[styles.muted, { marginTop: 6, marginBottom: 12 }]}>
          File me 2 column chahiye: Order ID aur Phone (chahein to Name bhi). Pehli row me heading ho to behtar. Ek baar
          me max {MAX_IMPORT_ROWS} rows. Import ke baad list yahin save rehti hai.
        </Text>
        <TouchableOpacity style={[styles.primaryBtn, importing && styles.btnDisabled]} onPress={doImport} disabled={importing}>
          {importing ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Excel / CSV file chuniye</Text>}
        </TouchableOpacity>
        {imported.length > 0 ? (
          <Text style={[styles.muted, { marginTop: 10 }]}>
            Saved: {imported.length} contacts · Bheje gaye: {sentCount}
          </Text>
        ) : null}
      </View>

      {imported.length > 0 ? (
        <>
          {/* Template */}
          <TemplatePicker
            title="Kaun sa message bhejna hai?"
            templates={templates}
            loading={tplLoading}
            error={tplError}
            value={importTpl}
            onChange={setImportTpl}
            tokens={IMPORT_TOKENS}
            sample={impSampleOrder}
          />

          {/* Search + filter */}
          <TextInput
            style={styles.input}
            value={impSearch}
            onChangeText={setImpSearch}
            placeholder="Order ID, number ya naam se dhoondhein"
            placeholderTextColor={C.sub}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 6 }}>
            {[
              ["all", `Sab (${imported.length})`],
              ["unsent", `Bhejne baaki (${imported.length - sentCount})`],
              ["sent", `Bheje gaye (${sentCount})`],
            ].map(([k, label]) => (
              <TouchableOpacity key={k} style={[styles.chip, impFilter === k && styles.chipOn]} onPress={() => setImpFilter(k)}>
                <Text style={[styles.chipText, impFilter === k && styles.chipTextOn]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <TouchableOpacity style={styles.selectAll} onPress={toggleAllImp}>
            <View style={[styles.box, impAllSelected && styles.boxOn]}>{impAllSelected ? <Text style={styles.tick}>✓</Text> : null}</View>
            <Text style={styles.selectAllText}>
              Sab select karein ({impEligible.length} bhejne layak, {impVisible.length} dikh rahe)
            </Text>
          </TouchableOpacity>

          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.outlineBtn, (impSelected.length === 0 || impBusy) && styles.btnDisabled]}
              onPress={deleteSelectedImported}
              disabled={impSelected.length === 0 || impBusy}
            >
              <Text style={styles.dangerText}>Selected hatayein ({impSelected.length})</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.outlineBtn, impBusy && styles.btnDisabled]} onPress={deleteAllImported} disabled={impBusy}>
              <Text style={styles.dangerText}>Poori list hatayein</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : null}
    </View>
  );

  // ── render ────────────────────────────────────────────────────────────────
  const tabBar = (
    <View style={styles.tabBar}>
      <TouchableOpacity style={[styles.tab, tab === "orders" && styles.tabOn]} onPress={() => setTab("orders")}>
        <Text style={[styles.tabText, tab === "orders" && styles.tabTextOn]}>Orders se bhejein</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.tab, tab === "imported" && styles.tabOn]} onPress={() => setTab("imported")}>
        <Text style={[styles.tabText, tab === "imported" && styles.tabTextOn]}>
          Imported list{imported.length ? ` (${imported.length})` : ""}
        </Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.screen}>
      {tabBar}

      {tab === "orders" ? (
        loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={C.primary} />
          </View>
        ) : error ? (
          <View style={styles.center}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={[styles.primaryBtn, { marginTop: 16, paddingHorizontal: 24 }]} onPress={() => load(date)}>
              <Text style={styles.primaryBtnText}>Dobara try karein</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={visible}
            extraData={selected}
            keyExtractor={(o) => o.orderNo}
            ListHeaderComponent={ordersHeader}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => {
                  setRefreshing(true);
                  load(date, true);
                }}
              />
            }
            ListEmptyComponent={
              <Text style={styles.empty}>
                {prettyDate(date)} ko {vendor ? `${vendor} ke` : ""} koi order nahi hai.
              </Text>
            }
            renderItem={({ item: o }) => {
              const sent = isSent(o);
              const on = !!selected[o.orderNo];
              return (
                <TouchableOpacity
                  activeOpacity={o.phone ? 0.7 : 1}
                  onPress={() => toggle(o)}
                  style={[styles.orderCard, !o.phone && { opacity: 0.55 }]}
                >
                  <View style={[styles.box, on && styles.boxOn, !o.phone && styles.boxOff]}>
                    {on ? <Text style={styles.tick}>✓</Text> : null}
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <View style={styles.rowBetween}>
                      <Text style={styles.orderName} numberOfLines={1}>
                        {o.customerName || "(naam nahi)"}
                      </Text>
                      <Text style={styles.orderNo}>#{o.orderNo}</Text>
                    </View>
                    <Text style={styles.muted}>
                      {o.phone ? `+${o.phone}` : "Number nahi mila"}
                      {o.vendorName ? `  ·  ${o.vendorName}` : ""}
                    </Text>
                    <Text style={styles.muted} numberOfLines={1}>
                      {[o.trainInfo, o.coach, o.deliveryTime].filter(Boolean).join("  ·  ")}
                    </Text>
                    {sent ? <Text style={styles.sentText}>✓ Message bheja gaya</Text> : null}
                    {!sent && o.waMessageError ? (
                      <Text style={styles.failText} numberOfLines={2}>
                        ✗ Pichli baar fail: {o.waMessageError}
                      </Text>
                    ) : null}
                  </View>
                </TouchableOpacity>
              );
            }}
          />
        )
      ) : impLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={C.primary} />
        </View>
      ) : impError ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{impError}</Text>
          <TouchableOpacity style={[styles.primaryBtn, { marginTop: 16, paddingHorizontal: 24 }]} onPress={() => loadImported()}>
            <Text style={styles.primaryBtnText}>Dobara try karein</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={impVisible}
          extraData={impSel}
          keyExtractor={(r) => String(r.orderNo)}
          ListHeaderComponent={importedHeader}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={20}
          maxToRenderPerBatch={30}
          windowSize={10}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {imported.length === 0 ? "Abhi koi list import nahi hui. Upar se Excel file chuniye." : "Is filter me koi contact nahi hai."}
            </Text>
          }
          renderItem={({ item: r }) => {
            const sent = !!r.waMessage?.sentAt;
            const on = !!impSel[r.orderNo];
            return (
              <TouchableOpacity activeOpacity={0.7} onPress={() => toggleImp(r)} style={styles.orderCard}>
                <View style={[styles.box, on && styles.boxOn]}>{on ? <Text style={styles.tick}>✓</Text> : null}</View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <View style={styles.rowBetween}>
                    <Text style={styles.orderName} numberOfLines={1}>
                      #{r.orderNo}
                    </Text>
                    <Text style={styles.orderNo}>+{r.phone}</Text>
                  </View>
                  {r.name ? <Text style={styles.muted}>{r.name}</Text> : null}
                  {sent ? <Text style={styles.sentText}>✓ Message bheja gaya</Text> : null}
                  {!sent && r.waMessageError ? (
                    <Text style={styles.failText} numberOfLines={2}>
                      ✗ Pichli baar fail: {r.waMessageError}
                    </Text>
                  ) : null}
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}

      {/* Bottom send bar */}
      {tab === "orders" && !loading && !error ? (
        <View style={styles.bottomBar}>
          <TouchableOpacity style={[styles.primaryBtn, !canSend && styles.btnDisabled]} onPress={send} disabled={!canSend}>
            {sending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>
                {running
                  ? "Bhej rahe hain…"
                  : !orderInfo.tpl
                  ? "Pehle template chuniye"
                  : !orderInfo.ready
                  ? "Variables bharein"
                  : `${selectedOrders.length} customers ko message bhejein`}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      ) : null}

      {tab === "imported" && !impLoading && !impError && imported.length > 0 ? (
        <View style={styles.bottomBar}>
          <TouchableOpacity style={[styles.primaryBtn, !canSendImp && styles.btnDisabled]} onPress={sendImported} disabled={!canSendImp}>
            {impSending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>
                {running
                  ? "Bhej rahe hain…"
                  : !importInfo.tpl
                  ? "Pehle template chuniye"
                  : !importInfo.ready
                  ? "Variables bharein"
                  : `${impSelected.length} contacts ko message bhejein`}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: C.bg },
  bigIcon: { fontSize: 44, marginBottom: 8 },
  centerTitle: { fontSize: 18, fontWeight: "700", color: C.text },
  list: { padding: 14, paddingBottom: 100 },
  empty: { textAlign: "center", color: C.sub, marginTop: 30, fontSize: 14 },

  tabBar: {
    flexDirection: "row",
    backgroundColor: C.card,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
  },
  tab: { flex: 1, paddingVertical: 14, alignItems: "center", borderBottomWidth: 3, borderBottomColor: "transparent" },
  tabOn: { borderBottomColor: C.primary },
  tabText: { fontSize: 14, fontWeight: "600", color: C.sub },
  tabTextOn: { color: C.primaryDark, fontWeight: "700" },

  banner: { backgroundColor: "#FEF3C7", padding: 10, borderRadius: 8, marginBottom: 10 },
  bannerText: { color: "#92400E", fontSize: 13 },

  dateBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.line,
    marginBottom: 12,
  },
  dateArrow: { width: 52, height: 56, alignItems: "center", justifyContent: "center" },
  dateArrowText: { fontSize: 28, color: C.primaryDark, fontWeight: "700" },
  dateText: { fontSize: 17, fontWeight: "700", color: C.text },
  dateSub: { fontSize: 11.5, color: C.sub, marginTop: 1 },

  card: {
    backgroundColor: C.card,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: C.line,
  },
  cardTitle: { fontSize: 15, fontWeight: "700", color: C.text, flexShrink: 1 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  muted: { fontSize: 13, color: C.sub, lineHeight: 19 },
  link: { color: C.primary, fontSize: 13, fontWeight: "700" },
  errorText: { fontSize: 13, color: C.danger, marginTop: 4 },
  warnText: { fontSize: 12, color: C.warn, marginTop: 6 },
  label: { fontSize: 13, fontWeight: "700", color: C.text, marginBottom: 8 },
  varLabel: { fontSize: 13, fontWeight: "700", color: C.primaryDark, marginBottom: 4 },

  tplItem: { borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 12, marginTop: 10 },
  tplItemOn: { borderColor: C.primary, borderWidth: 2 },
  tplName: { fontSize: 14.5, fontWeight: "700", color: C.text, flexShrink: 1 },
  tplBody: { fontSize: 13.5, color: C.text, marginTop: 6, lineHeight: 19 },
  pill: {
    fontSize: 11,
    color: C.primaryDark,
    backgroundColor: "#DCF8C6",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: "hidden",
  },

  input: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === "ios" ? 12 : 9,
    fontSize: 14,
    color: C.text,
    marginBottom: 8,
  },
  tokenChip: {
    borderWidth: 1,
    borderColor: C.primary,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
    backgroundColor: "#F0FDF9",
  },
  tokenText: { fontSize: 12.5, color: C.primaryDark, fontWeight: "600" },

  bubble: { backgroundColor: "#DCF8C6", borderRadius: 12, borderTopLeftRadius: 2, padding: 12, marginVertical: 10 },
  bubbleText: { fontSize: 14, color: "#111", lineHeight: 20 },

  progressTrack: { height: 6, backgroundColor: C.line, borderRadius: 3, marginVertical: 10, overflow: "hidden" },
  progressFill: { height: 6, borderRadius: 3 },

  sectionTitle: { fontSize: 15, fontWeight: "700", color: C.text, marginTop: 4, marginBottom: 8 },
  chip: {
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.card,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 8,
  },
  chipOn: { backgroundColor: C.primary, borderColor: C.primary },
  chipText: { fontSize: 13, color: C.text },
  chipTextOn: { color: "#fff", fontWeight: "700" },

  selectAll: { flexDirection: "row", alignItems: "center", paddingVertical: 10 },
  selectAllText: { marginLeft: 12, fontSize: 13.5, color: C.text, fontWeight: "600", flexShrink: 1 },

  actionRow: { flexDirection: "row", gap: 10, marginBottom: 12 },
  outlineBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: "#FECACA",
    backgroundColor: "#FEF2F2",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  dangerText: { color: C.danger, fontSize: 13, fontWeight: "700" },

  orderCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.card,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: C.line,
  },
  orderName: { fontSize: 15, fontWeight: "700", color: C.text, flexShrink: 1, marginRight: 8 },
  orderNo: { fontSize: 12.5, color: C.sub },
  sentText: { fontSize: 12.5, color: C.ok, fontWeight: "700", marginTop: 3 },
  failText: { fontSize: 12, color: C.danger, marginTop: 3 },

  box: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: C.sub,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.card,
  },
  boxOn: { backgroundColor: C.primary, borderColor: C.primary },
  boxOff: { borderColor: C.line, backgroundColor: C.line },
  tick: { color: "#fff", fontSize: 15, fontWeight: "800", marginTop: -1 },

  primaryBtn: {
    backgroundColor: C.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  btnDisabled: { opacity: 0.45 },

  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: 14,
    backgroundColor: C.card,
    borderTopWidth: 1,
    borderTopColor: C.line,
  },
});
