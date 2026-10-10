"use strict";

/**
 * VENDOR: YATRIBHOJAN
 * Sender domain : yatribhojan.com  (vendors@yatribhojan.com)
 * Transport     : Zoho Mail (ZohoMail)
 * Content-Type  : text/html; charset=utf-8 — single <div>, NO <table>
 * Transfer      : 7bit / quoted-printable
 *
 * VERIFIED AGAINST: real .eml Order No 57562926 (20-Jun-2026)
 *
 * DOM PARSING: LINE-BASED PATH (parseLineBasedOrder in backend.js, FIX 7).
 * AI fallback used only when line-based parse returns null (e.g. 0 items found).
 *
 * ── HTML LAYOUT ────────────────────────────────────────────────────────────
 *
 * NOT a table. The entire email body is ONE <div> with <br/> tags separating
 * plain "KEY: VALUE" lines — structurally identical to Spicywagon's format.
 * After <br/> → newline conversion + tag-strip, exact line sequence is:
 *
 *   NEW ORDER !!
 *   -----
 *   ORDER NO: 57562926
 *   PAYMODE: COD
 *   -----
 *   DELIVERY: 20-06-2026, ETA: 22:30
 *   STATION: VADODARA (BRC)
 *   TRAIN: 06544, BKN YPR SPL
 *   COACH: S4, SEAT: 37
 *   -----
 *   ITEM DETAILS
 *   ************
 *   Saada Thali X 1
 *   ************
 *   DELIVERY CHARGE: Rs 0
 *   NET TOTAL: Rs 175
 *   -----
 *   CUSTOMER DETAILS
 *   -----
 *   NAME: Poona Ram
 *   MOB: 8690448306
 *   -----
 *   THANKYOU :) TEAM YATRIBHOJAN
 *
 * ── KEY PARSING RULES ──────────────────────────────────────────────────────
 *
 * ORDER NO: "ORDER NO:" line → digits → e.g. "57562926".
 *
 * PAYMENT: "PAYMODE:" line. Uses DASH not underscore: "CASH-ON-DELIVERY".
 *   "COD"→"COD", "CASH-ON-DELIVERY"→"COD", "ONLINE"/"PREPAID"→"Prepaid".
 *
 * DATE/TIME: "DELIVERY:" line format "DD-MM-YYYY, ETA: HH:MM"
 *   → deliveryDate=YYYY-MM-DD, deliveryTime=HH:MM (value after "ETA:").
 *   e.g. "20-06-2026, ETA: 22:30" → deliveryDate=2026-06-20, deliveryTime=22:30
 *
 * TRAIN: "TRAIN:" line → full string e.g. "06544, BKN YPR SPL" (comma separator).
 *
 * COACH: "COACH:" line — coach and seat on SAME line, comma-separated:
 *   "COACH: S4, SEAT: 37" → combine as "S4/37".
 *
 * ITEMS: Between "ITEM DETAILS" marker line and the "DELIVERY CHARGE:" line.
 *   "************" separator lines are noise — skip them.
 *   Each real item line format: "Item Name X qty" (capital or lowercase X).
 *   e.g. "Saada Thali X 1" → name="Saada Thali", qty=1
 *   Multiple items appear as consecutive lines (verified against Spicywagon's
 *   identical multi-item pattern — same vendor email template family).
 *   PRICE: No individual item prices given — set each item price=0.
 *
 * CUSTOMER: "NAME:" line.
 * CONTACT: "MOB:" line — 10-digit number.
 *
 * TOTAL: "NET TOTAL:" line — strip "Rs " prefix. e.g. "Rs 175" → 175.
 *   This is the only total shown (no separate "Amount to be collected" /
 *   "Grand Total" split like RailYatri — NET TOTAL is always the ground truth
 *   for both COD and Prepaid Yatribhojan orders).
 */

const domConfig = {
  lineBased: true,

  lineBasedFields: {
    orderNo: {
      match: /^ORDER NO:\s*(.+)$/i,
      transform: v => v.replace(/\D/g, '') || v.trim(),
    },

    paymentType: {
      match: /^PAYMODE:\s*(.+)$/i,
      transform: v => {
        const u = v.trim().toUpperCase();
        if (u === 'COD' || u === 'CASH-ON-DELIVERY' || u === 'CASH_ON_DELIVERY') return 'COD';
        if (['PREPAID', 'PRE-PAID', 'ONLINE', 'PAID'].includes(u)) return 'Prepaid';
        return 'COD';
      },
    },

    _deliveryRaw: {
      match: /^DELIVERY:\s*(.+)$/i,
      transform: v => v.trim(),
    },

    trainInfo: {
      match: /^TRAIN:\s*(.+)$/i,
      transform: v => v.trim() || null,
    },

    _coachRaw: {
      match: /^COACH:\s*(.+)$/i,
      transform: v => v.trim(),
    },

    customerName: {
      match: /^NAME:\s*(.+)$/i,
      transform: v => v.trim() || null,
    },

    contactNo: {
      match: /^MOB:\s*(.+)$/i,
      transform: v => {
        const digits = v.replace(/\D/g, '');
        if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
        if (digits.length === 10) return digits;
        return digits.slice(-10) || null;
      },
    },

    totalAmount: {
      match: /^NET TOTAL:\s*(.+)$/i,
      transform: v => parseFloat(v.replace(/[^\d.]/g, '')) || 0,
    },

    deliveryCharge: {
      match: /^DELIVERY CHARGE:\s*(.+)$/i,
      transform: v => parseFloat(v.replace(/[^\d.]/g, '')) || 0,
    },
  },

  lineBasedItems: {
    startMarker: 'ITEM DETAILS',
    endMarker: /^DELIVERY CHARGE:/i,
    skipPattern: /^\*+$/,
    itemLineMatch: /^(.+?)\s*[xX]\s*(\d+)\s*$/,
  },

  postProcess(order) {
    // ── Split _deliveryRaw "20-06-2026, ETA: 22:30" → deliveryDate + deliveryTime ──
    const raw = order._deliveryRaw || '';
    const m = raw.match(/(\d{2})-(\d{2})-(\d{4}),\s*ETA:\s*(\d{1,2}:\d{2})/i);
    if (m) {
      order.deliveryDate = `${m[3]}-${m[2]}-${m[1]}`; // YYYY-MM-DD
      order.deliveryTime = m[4].length === 4 ? '0' + m[4] : m[4];
    } else {
      order.deliveryDate = null;
      order.deliveryTime = null;
    }
    delete order._deliveryRaw;

    // ── Combine _coachRaw "S4, SEAT: 37" → "S4/37" ─────────────────────────
    const coachRaw = order._coachRaw || '';
    const cm = coachRaw.match(/^(.+?),\s*SEAT:\s*(\S+)/i);
    order.coach = cm ? `${cm[1].trim()}/${cm[2].trim()}` : (coachRaw || null);
    delete order._coachRaw;

    return order;
  },
};

const matchers = [
  { match: "yatribhojan", name: "YatriBhojan", type: "yatribhojan" },
];

const type = "yatribhojan";

const rule = `VENDOR: YATRIBHOJAN
ORDER NO: Field label is "ORDER NO" — value is a plain integer like "57510466". Use this as orderNo.

EMAIL FORMAT: Plain text email (no HTML). Fields are on separate lines with "KEY: VALUE" format.

EXACT EMAIL STRUCTURE:
  ORDER NO: 57510466
  PAYMODE: CASH-ON-DELIVERY
  -----
  DELIVERY: 03-03-2026, ETA: 21:35
  STATION: VADODARA (BRC)
  TRAIN: 09562, OKHA BDTS SPL
  COACH: S2, SEAT: 1
  -----
  ITEM DETAILS
  ************
  Veg Hydrabadi Biriyani X 3
  ************
  DELIVERY CHARGE: Rs 0
  NET TOTAL: Rs 594
  -----
  CUSTOMER DETAILS
  NAME: SUMIT SANJAY CHAVAN
  MOB: 9321434178

- ORDER NO: "ORDER NO" field — strip any leading #.
- PAYMENT: "PAYMODE" field. "CASH-ON-DELIVERY"→"COD", "ONLINE"→"Prepaid".
  Note: uses DASH not underscore: "CASH-ON-DELIVERY".
- DATE: "DELIVERY" field format is "DD-MM-YYYY, ETA: HH:MM"
  → deliveryDate=YYYY-MM-DD, deliveryTime=HH:MM (after "ETA:").
- TRAIN: "TRAIN" field — full string e.g. "09562, OKHA BDTS SPL".
- COACH: "COACH" and "SEAT" appear on THE SAME LINE separated by comma:
  "COACH: S2, SEAT: 1" → combine as "S2/1".
  Extract value after "COACH:" as coach, value after "SEAT:" as seat, join with "/".
- ITEMS: Each item is on its own line as "Item Name X quantity"
  → qty is the number AFTER the "X" (or "x"). e.g. "Veg Biriyani X 3" → qty=3.
- PRICE: No individual item prices given. Set each item price=0.
- CUSTOMER: "NAME" field.
- CONTACT: "MOB" field — 10-digit number.
- TOTAL: "NET TOTAL" field — strip "Rs " prefix. e.g. "Rs 594" → 594.`;

module.exports = { matchers, type, rule, domConfig };
