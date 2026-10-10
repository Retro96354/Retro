// ═══════════════════════════════════════════════════════════════════════════
// src/screens/WhatsAppOrderMessageScreen.js
// Flow:  Date chuno  ->  Vendor chuno (IRCTC / Zoop / RailFood ...)
//        ->  us din ke orders  ->  pehle se set template un customers ko bhejo
// Template ek baar set hota hai (upar wale card se), baad mein har din sirf
// date + vendor chuno aur "Bhejein" dabao.
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
  return String(tplBody || "").replace(/\{\{\d+\}\}/g, () => vals[i++] ?? "…");
}

// ═══════════════════════════════════════════════════════════════════════════
// TEMPLATE SET KARNE WALA CARD
// ═══════════════════════════════════════════════════════════════════════════
function TemplateEditor({ settings, onSaved, onCancel }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [templates, setTemplates] = useState([]);
  const [selected, setSelected] = useState(settings?.templateName ? `${settings.templateName}|${settings.language}` : null);
  const [vars, setVars] = useState(() => {
    const o = {};
    (settings?.variables || []).forEach((v, i) => (o[i] = v));
    return o;
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const list = await wa.getTemplates();
        setTemplates(list.filter((t) => t.status === "APPROVED").map(wa.analyzeTemplate));
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const tpl = templates.find((t) => `${t.name}|${t.language}` === selected) || null;

  const addToken = (idx, key) =>
    setVars((p) => {
      const cur = (p[idx] || "").trim();
      return { ...p, [idx]: cur ? `${cur} {{${key}}}` : `{{${key}}}` };
    });

  const save = async () => {
    if (!tpl) return;
    const variables = tpl.varNums.map((_, i) => (vars[i] || "").trim());
    if (variables.some((v) => !v)) {
      wa.notify("Adhoori jaankari", "Har variable ke liye value ya order ki jaankari chuniye");
      return;
    }
    setSaving(true);
    try {
      const saved = await wa.saveOrderMessageSettings({ templateName: tpl.name, language: tpl.language, variables });
      onSaved({ ...saved, bodyText: tpl.bodyText });
    } catch (e) {
      wa.notify("Save nahi hua", e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.rowBetween}>
        <Text style={styles.cardTitle}>Message template set karein</Text>
        {settings ? (
          <TouchableOpacity onPress={onCancel}>
            <Text style={styles.link}>Cancel</Text>
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

      {templates.map((t) => {
        const on = selected === `${t.name}|${t.language}`;
        return (
          <TouchableOpacity
            key={`${t.name}|${t.language}`}
            activeOpacity={t.supported ? 0.7 : 1}
            onPress={() => {
              if (!t.supported) return;
              setSelected(`${t.name}|${t.language}`);
              if (!on) setVars({});
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
      })}

      {tpl ? (
        <View style={{ marginTop: 10 }}>
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
                value={vars[idx] || ""}
                onChangeText={(v) => setVars((p) => ({ ...p, [idx]: v }))}
                placeholder="Neeche se chuniye ya khud likhiye"
                placeholderTextColor={C.sub}
              />
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {TOKENS.map((t) => (
                  <TouchableOpacity key={t.key} style={styles.tokenChip} onPress={() => addToken(idx, t.key)}>
                    <Text style={styles.tokenText}>+ {t.label}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          ))}
          <TouchableOpacity style={[styles.primaryBtn, saving && styles.btnDisabled]} onPress={save} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Template save karein</Text>}
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN SCREEN
// ═══════════════════════════════════════════════════════════════════════════
export default function WhatsAppOrderMessageScreen() {
  const [date, setDate] = useState(istToday());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState(null);
  const [orders, setOrders] = useState([]);
  const [vendor, setVendor] = useState(null); // null = sab vendors
  const [selected, setSelected] = useState({});
  const [settings, setSettings] = useState(null); // saved template (+ bodyText)
  const [editing, setEditing] = useState(false);
  const [sending, setSending] = useState(false);
  const [run, setRun] = useState(null); // chal raha send job
  const reqId = useRef(0);

  // ── data load ─────────────────────────────────────────────────────────────
  const load = useCallback(async (forDate, silent = false) => {
    const id = ++reqId.current;
    if (!silent) setLoading(true);
    try {
      const [st, list] = await Promise.all([wa.getStatus(), wa.getOrdersByDate(forDate)]);
      if (id !== reqId.current) return; // purana response, ignore
      setStatus(st);
      setOrders(list);
      setError("");
      if (st.orderMessage) {
        // template ka body text chahiye preview ke liye
        setSettings((prev) => (prev && prev.templateName === st.orderMessage.templateName ? { ...st.orderMessage, bodyText: prev.bodyText } : st.orderMessage));
      } else {
        setSettings(null);
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

  // Preview ke liye saved template ka body text laao (ek baar)
  useEffect(() => {
    if (!status?.connected || !settings?.templateName || settings.bodyText) return;
    (async () => {
      try {
        const list = await wa.getTemplates();
        const t = list.find((x) => x.name === settings.templateName && x.language === settings.language);
        if (t) setSettings((p) => (p ? { ...p, bodyText: wa.analyzeTemplate(t).bodyText } : p));
      } catch (_) {}
    })();
  }, [status, settings]);

  // ── vendors / visible orders ──────────────────────────────────────────────
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

  // ── send ──────────────────────────────────────────────────────────────────
  const send = async () => {
    if (!settings?.templateName) {
      wa.notify("Template set nahi hai", "Pehle upar se message template set karein.");
      return;
    }
    if (selectedOrders.length === 0) return;
    const resend = selectedOrders.filter(isSent).length;
    const ok = await wa.confirmAsync(
      "Message bhejein?",
      `${vendor || "Sab vendors"} · ${prettyDate(date)}\n\n${selectedOrders.length} customers ko "${settings.templateName}" message jayega.` +
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
      });
      setRun({ id: r.campaignId, total: r.queued, sent: 0, failed: 0, status: "running" });
      const sk = r.skipped || {};
      const parts = [];
      if (sk.alreadySent) parts.push(`${sk.alreadySent} pehle bheje ja chuke`);
      if (sk.noPhone) parts.push(`${sk.noPhone} ka number nahi`);
      if (sk.optedOut) parts.push(`${sk.optedOut} ne STOP kiya hai`);
      if (sk.duplicatePhone) parts.push(`${sk.duplicatePhone} ka number repeat tha`);
      if (parts.length) wa.notify("Kuch orders skip hue", parts.join("\n"));
    } catch (e) {
      wa.notify("Message nahi gaye", e.message);
    } finally {
      setSending(false);
    }
  };

  // Progress poll
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
          wa.notify(
            c.status === "completed" ? "Messages bhej diye" : "Bhejna beech mein ruk gaya",
            `Bheje: ${c.sent || 0}  ·  Fail: ${c.failed || 0}` + (c.error ? `\n${c.error}` : ""),
          );
        }
      } catch (_) {}
    }, 3000);
    return () => clearInterval(t);
  }, [runId, runStatus, date, load]);

  // ── early states ──────────────────────────────────────────────────────────
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

  const sample = visible[0] || orders[0];
  const pct = run?.total ? Math.min(100, Math.round((((run.sent || 0) + (run.failed || 0)) / run.total) * 100)) : 0;
  const canSend = !!settings?.templateName && selectedOrders.length > 0 && !sending && runStatus !== "running";

  const header = (
    <View>
      {status?.tokenValid === false ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>⚠ WhatsApp token expire ho gaya hai. Settings mein naya token daalein.</Text>
        </View>
      ) : null}

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

      {/* Template */}
      {editing || !settings?.templateName ? (
        <TemplateEditor
          settings={settings}
          onCancel={() => setEditing(false)}
          onSaved={(s) => {
            setSettings(s);
            setEditing(false);
          }}
        />
      ) : (
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>Template: {settings.templateName}</Text>
            <TouchableOpacity onPress={() => setEditing(true)}>
              <Text style={styles.link}>Badlein</Text>
            </TouchableOpacity>
          </View>
          {settings.bodyText ? (
            <View style={styles.bubble}>
              <Text style={styles.bubbleText}>{renderPreview(settings.bodyText, settings.variables, sample)}</Text>
            </View>
          ) : null}
          {sample ? <Text style={styles.muted}>Preview: order #{sample.orderNo} ke hisaab se</Text> : null}
        </View>
      )}

      {/* Progress */}
      {run ? (
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
      ) : null}

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

  return (
    <View style={styles.screen}>
      {loading ? (
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
          ListHeaderComponent={header}
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
      )}

      {!loading && !error ? (
        <View style={styles.bottomBar}>
          <TouchableOpacity style={[styles.primaryBtn, !canSend && styles.btnDisabled]} onPress={send} disabled={!canSend}>
            {sending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>
                {runStatus === "running"
                  ? "Bhej rahe hain…"
                  : !settings?.templateName
                  ? "Pehle template set karein"
                  : `${selectedOrders.length} customers ko message bhejein`}
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
