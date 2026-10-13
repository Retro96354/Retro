// ═══════════════════════════════════════════════════════════════════════════
// src/services/whatsappApi.js
// WhatsApp ke saare backend calls yahin hain. Har call client ke Firebase
// login token ke saath jaati hai — backend khud check karta hai ki client
// sirf apna hi data dekh/badal sake.
//
// ⚠️ 2 cheezein apne project se match karo:
//   1) `auth` — firebaseConfig.js se export hona chahiye (getAuth(app)).
//   2) BACKEND_URL — wahi URL jo api.js use karta hai.
// ═══════════════════════════════════════════════════════════════════════════
import { Alert, Platform } from "react-native";
import { auth } from "../firebaseConfig";

export const BACKEND_URL = (
  process.env.EXPO_PUBLIC_BACKEND_URL 
).replace(/\/$/, "");

const TIMEOUT_MS = 30000;

function clientId() {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Login nahi hai — dobara login karein");
  return uid;
}

async function request(path, { method = "GET", body } = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error("Login nahi hai — dobara login karein");
  const token = await user.getIdToken();

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BACKEND_URL}/api/whatsapp/clients/${clientId()}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    let json = null;
    try {
      json = await res.json();
    } catch (_) {}
    if (!res.ok) {
      throw new Error(json?.error || `Server error (${res.status})`);
    }
    return json;
  } catch (e) {
    if (e.name === "AbortError") throw new Error("Server ne time par jawab nahi diya, dobara try karein");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ── Connection ──────────────────────────────────────────────────────────────
export const getStatus = () => request("/status");
export const connectWhatsApp = ({ phoneNumberId, wabaId, accessToken, watchNumbers }) =>
  request("/config", { method: "POST", body: { phoneNumberId, wabaId, accessToken, watchNumbers } });
export const disconnectWhatsApp = () => request("/config", { method: "DELETE" });
export const saveWatchNumbers = (watchNumbers) =>
  request("/watch-numbers", { method: "PUT", body: { watchNumbers } });

// ── Templates ───────────────────────────────────────────────────────────────
export const getTemplates = () => request("/templates");

// ── Customers ───────────────────────────────────────────────────────────────
export const getCustomers = () => request("/customers");
export const importCustomers = (customers) =>
  request("/customers/import", { method: "POST", body: { customers } });
export const deleteCustomer = (phone) =>
  request(`/customers/${encodeURIComponent(phone)}`, { method: "DELETE" });

// ── Campaigns ───────────────────────────────────────────────────────────────
export const getCampaigns = () => request("/campaigns");
export const startCampaign = ({ templateName, language, variables, tag }) =>
  request("/campaigns", { method: "POST", body: { templateName, language, variables, tag } });

// ── Auto messages (print hote hi + review baad mein) ────────────────────────
export const getVendors = () => request("/vendors");
export const saveAutoMessages = (settings) =>
  request("/auto-messages", { method: "PUT", body: settings });

// Print wali screen se call karein — order print hone ke BAAD.
// Ye kabhi error throw nahi karta, taaki WhatsApp ki wajah se print kabhi na ruke.
// Return: { print: "sent"|"already_sent"|"no_phone"|"opted_out"|"vendor_off"|"failed"|"off",
//           review: "scheduled"|"vendor_off"|"no_phone"|... } ya null (error/off)
export async function notifyOrderPrinted(orderNo) {
  try {
    if (!orderNo) return null;
    return await request(`/orders/${encodeURIComponent(String(orderNo))}/printed`, { method: "POST" });
  } catch (e) {
    console.warn("WhatsApp print notify failed:", e.message);
    return null;
  }
}

// Order ki kaun si jaankari message template mein lag sakti hai
export const ORDER_TOKENS = [
  { key: "name", label: "Customer naam" },
  { key: "orderNo", label: "Order no" },
  { key: "trainInfo", label: "Train" },
  { key: "coach", label: "Coach/Seat" },
  { key: "deliveryTime", label: "Time" },
  { key: "vendor", label: "Vendor" },
  { key: "total", label: "Total ₹" },
];

// ── Inbox (watch numbers ke messages) ───────────────────────────────────────
export const getMessages = () => request("/messages");
export const markMessageRead = (msgId) =>
  request(`/messages/${encodeURIComponent(msgId)}/read`, { method: "PUT" });

// ── Cross-platform dialogs (Alert.alert web par buttons ke saath nahi chalta) ─
export function notify(title, message) {
  if (Platform.OS === "web") {
    // eslint-disable-next-line no-alert
    window.alert(message ? `${title}\n\n${message}` : title);
  } else {
    Alert.alert(title, message);
  }
}

export function confirmAsync(title, message, confirmText = "Haan, bhejein") {
  return new Promise((resolve) => {
    if (Platform.OS === "web") {
      // eslint-disable-next-line no-alert
      resolve(window.confirm(`${title}\n\n${message}`));
      return;
    }
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: confirmText, onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}

// ── Order messages (vendor + date ke orders ke customers ko template) ───────
export const getOrdersByDate = (date) => request(`/orders?date=${encodeURIComponent(date)}`);
export const saveOrderMessageSettings = ({ templateName, language, variables }) =>
  request("/order-message-settings", { method: "PUT", body: { templateName, language, variables } });
export const sendOrderMessages = ({ orderNos, force, vendor, date }) =>
  request("/order-messages", { method: "POST", body: { orderNos, force, vendor, date } });

// Meta template ko samajhna: body text, variables, aur kya support hai
export function analyzeTemplate(t) {
  const comps = t.components || [];
  const body = comps.find((c) => c.type === "BODY");
  const header = comps.find((c) => c.type === "HEADER");
  const buttons = comps.find((c) => c.type === "BUTTONS");
  const bodyText = body?.text || "";
  const nums = [...bodyText.matchAll(/\{\{(\d+)\}\}/g)].map((m) => parseInt(m[1], 10));
  const varNums = [...new Set(nums)].sort((a, b) => a - b);

  let supported = true;
  let reason = "";
  if (header && header.format !== "TEXT") {
    supported = false;
    reason = "Image/video/document header wale templates support nahi hain";
  } else if (header && /\{\{/.test(header.text || "")) {
    supported = false;
    reason = "Header mein variable wale templates support nahi hain";
  } else if ((buttons?.buttons || []).some((b) => b.type === "URL" && /\{\{/.test(b.url || ""))) {
    supported = false;
    reason = "Dynamic link button wale templates support nahi hain";
  }
  return {
    name: t.name,
    language: t.language,
    category: t.category,
    status: t.status,
    bodyText,
    footer: comps.find((c) => c.type === "FOOTER")?.text || "",
    varNums,
    supported,
    reason,
  };
}
