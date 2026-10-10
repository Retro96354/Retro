'use strict';

/**
 * VENDOR: RAIL FOOD / REL FOOD
 * Sender domain : relfood.com  (orders@relfood.com)
 * Content-Type  : text/html; charset=us-ascii (pure HTML, no PDF attachment)
 * Transfer      : quoted-printable
 *
 * DOM PARSING: PATH A — domConfig below.
 * AI fallback (PATH B) used only when parsed.html is missing or DOM returns null.
 *
 * ── VERIFIED BUGS FIXED (2026-06-01) ────────────────────────────────────────
 *
 * BUG 1 — orderNo always null (orders never saved):
 *   OLD assumption: label td "REL FOOD Ref.No" + separate sibling value td.
 *   ACTUAL HTML:    <span>REL FOOD Ref.No : <b>1050866</b></span> — ONE td.
 *   parseDomOrder finds the label td, reads NEXT sibling as value → wrong td.
 *   FIX: selfContained:true tells parseDomOrder to regex the value from the
 *        label td's OWN text instead of reading a sibling td.
 *
 *   Same applies to fallback "IRCTC Order No." — also one td:
 *   <td style="color:#995043">IRCTC Order No. <b>2451624177</b></td>
 *
 * BUG 2 — totalAmount = 0 for Prepaid orders:
 *   "Payment to collect" is correctly 0 for PAID orders (nothing to collect
 *   at the door). But we need to store the order's monetary value for display.
 *   FIX: postProcess falls back to the items table "Total" footer row value
 *        when paymentType=Prepaid and totalAmount=0.
 *        The "Total" footer row value (e.g. 357) is captured as _itemsTotal
 *        via a special selfContained field on the footer label.
 *
 * ── VERIFIED BUGS FIXED (2026-06-21) ────────────────────────────────────────
 *
 * BUG 3 — deliveryDate/deliveryTime always null (forces AI call EVERY order):
 *   RailFood sends delivery date in TWO DIFFERENT FORMATS depending on the
 *   order/outlet — confirmed from live .eml samples:
 *     Format A (slash): "Delivery Date & Time : 6/21/2026 & 20:57"  → M/D/YYYY
 *     Format B (dash):   "Delivery Date & Time : 21-06-2026 & 21:54" → DD-MM-YYYY
 *   OLD regex only matched Format A (slash). Format B (dash) silently failed
 *   to match at all → deliveryDate/deliveryTime always null for those orders →
 *   getMissingFields() flagged them as missing → fillMissingFields() fired an
 *   AI/Bedrock call on EVERY dash-format order just to read the date/time.
 *   FIX: try slash format first (M/D/YYYY — month before day). If that fails,
 *        try dash format (DD-MM-YYYY — day before month). The two formats use
 *        OPPOSITE day/month ordering, so they are parsed as separate cases —
 *        a single merged regex would silently swap day/month for ambiguous
 *        dates (e.g. day ≤ 12) and produce a WRONG date instead of no date.
 *
 * BUG 4 — stray "Instructions :" row parsed as a fake item (qty=127, price=0):
 *   RailFood's items table has a row that begins the footer section but whose
 *   FIRST cell is "Instructions :" (in red) instead of being blank or a footer
 *   label — e.g.:
 *     <td style="color:red;">Instructions : </td>
 *     <td colspan="2">Sub Total</td>
 *     <td>127.00</td>
 *   OLD footerLabels list did not include "Instructions", and footer-row
 *   detection only checks cell[0]/cell[1] against footerLabels — so this row
 *   was never recognized as a footer row. It fell through to item-row parsing:
 *     itemName = "Instructions :" (cell 0)
 *     price    = parseFloat("Sub Total") → NaN → 0
 *     quantity = parseInt("127.00") → 127   (the Sub Total VALUE, misread as qty)
 *   → a fake item "Instructions :  | 127" was pushed into every order's item list.
 *   FIX: added "Instructions" to footerLabels so this row is now correctly
 *        recognized and skipped before item-row parsing ever sees it.
 */

const domConfig = {

  fields: {
    // ── BUG 1 FIX: selfContained:true ──────────────────────────────────────
    // parseDomOrder must check domConfig.fields[name].selfContained
    // If true: regex the value from the LABEL td's own text (not next sibling).
    // Pattern: find td containing labelText, extract first \d+ from its own text.
    orderNo: {
      labelText:     'REL FOOD Ref.No',
      fallback:      'IRCTC Order No',   // also selfContained (same one-td structure)
      selfContained: true,               // ← NEW FLAG
      transform: v => v.trim(),
    },

    customerName: {
      labelText: 'Customer Name',
      transform: v => v.trim(),
    },

    contactNo: {
      labelText: 'Contact Number',
      transform: v => {
        const raw = v.trim();
        const match = raw.match(/(?:^|[^\d])([6-9]\d{9})(?:[^\d]|$)/);
        if (match) return match[1];
        const digits = raw.replace(/\D/g, '');
        if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
        if (digits.length === 10) return digits;
        return raw;
      },
    },

    trainInfo: {
      labelText: 'Train No./Name',
      transform: v => v.trim(),
    },

    coach: {
      labelText: 'Coach/Seat',
      transform: v => v.trim(),
    },

    pnr: {
      labelText: 'PNR',
      transform: v => v.trim() || null,
    },

    // ── BUG 3 FIX: _deliveryRaw is captured RAW here — both date formats
    // (slash "6/21/2026" and dash "21-06-2026") are parsed in postProcess,
    // which branches on which separator is actually present in the string.
    _deliveryRaw: {
      labelText:     'Delivery Date',    // partial match covers "Delivery Date & Time"
      selfContained: true,               // "Delivery Date & Time : 6/21/2026 & 20:57" — same cell
      transform: v => v.trim(),
    },

    paymentType: {
      labelText: 'Payment Mode',
      transform: v => {
        const u = v.trim().toUpperCase();
        if (u === 'COD') return 'COD';
        if (['PAID','PRE_PAID','ONLINE','PREPAID'].includes(u)) return 'Prepaid';
        return u;
      },
    },

    // "Payment to collect" = cash the delivery person collects at door.
    // For COD: equals the order value. For PAID: always 0 (nothing to collect).
    // BUG 2 FIX: totalAmount is corrected in postProcess for Prepaid orders.
    totalAmount: {
      labelText: 'Payment to collect',
      transform: v => parseFloat(v.replace(/[^\d.]/g, '')) || 0,
    },

    // Capture items table "Total" footer value for Prepaid totalAmount fallback.
    // selfContained:true — the footer td "Total" + value are in separate cells
    // but we capture the value via footerTotalCapture flag in postProcess instead.
    // (No extra field needed — handled in postProcess via order._itemsTotal set
    //  by parseDomOrder when it encounters the 'Total' footerLabel row.)
  },

  itemsTable: {
    columnMap: {
      'item'    : 'rawItem',
      'price'   : 'price',
      'quantity': 'qty',
      'total'   : 'totalCol',   // IGNORED for items — equals unit price (billing bug)
                                 // BUT captured as _itemsTotal for BUG 2 FIX
    },

    itemCellSplit: 'br',

    // ── BUG 4 FIX: "Instructions" added so the stray red "Instructions :" row
    // (which precedes "Sub Total" in the same footer block) is recognized as
    // a footer/skip row instead of falling through to item-row parsing.
    footerLabels: ['Instructions', 'Sub Total', 'Delivery Fee', 'GST', 'Total'],

    // ── BUG 2 FIX ───────────────────────────────────────────────────────────
    // When parseDomOrder hits the 'Total' footer row, capture its value as
    // order._itemsTotal so postProcess can use it for Prepaid totalAmount.
    captureFooterTotal: 'Total',   // ← NEW FLAG: footer label whose value to capture
  },

  postProcess(order) {
    // ── BUG 3 FIX: parse _deliveryRaw → deliveryDate + deliveryTime ─────────
    // RailFood sends TWO different date formats depending on the order:
    //   Format A (slash): "6/21/2026 & 20:57"  → M/D/YYYY  (month FIRST)
    //   Format B (dash):   "21-06-2026 & 21:54" → DD-MM-YYYY (day FIRST)
    // These are tried as SEPARATE cases (not a merged regex) because the
    // day/month capture-group order is OPPOSITE between the two formats —
    // a single combined regex would silently swap day/month whenever the
    // day is ≤ 12, producing a wrong date instead of failing safely.
    const raw = order._deliveryRaw || '';
    let deliveryDate = null;
    let deliveryTime = null;

    // Try Format A first: M/D/YYYY (slash-separated)
    let m = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s*[&]\s*(\d{1,2}:\d{2}))?/);
    if (m) {
      const [, mo, dd, yyyy, time] = m;
      deliveryDate = `${yyyy}-${mo.padStart(2, '0')}-${dd.padStart(2, '0')}`;
      deliveryTime = time ? (time.length === 4 ? '0' + time : time) : null;
    } else {
      // Try Format B: DD-MM-YYYY (dash-separated)
      m = raw.match(/(\d{1,2})-(\d{1,2})-(\d{4})(?:\s*[&]\s*(\d{1,2}:\d{2}))?/);
      if (m) {
        const [, dd, mo, yyyy, time] = m;
        deliveryDate = `${yyyy}-${mo.padStart(2, '0')}-${dd.padStart(2, '0')}`;
        deliveryTime = time ? (time.length === 4 ? '0' + time : time) : null;
      }
    }

    order.deliveryDate = deliveryDate;
    order.deliveryTime = deliveryTime;
    delete order._deliveryRaw;

    // ── BUG 2 FIX: use items Total for Prepaid orders ────────────────────────
    // For COD: totalAmount = 'Payment to collect' value (correct — what to charge).
    // For PAID: totalAmount = 0 (correct for collection) but wrong for display.
    //   → use the captured items table Total footer value instead.
    if (order.paymentType === 'Prepaid' && (!order.totalAmount || order.totalAmount === 0)) {
      if (order._itemsTotal && order._itemsTotal > 0) {
        order.totalAmount = order._itemsTotal;
      }
    }
    delete order._itemsTotal;

    return order;
  },
};

const matchers = [
  { match: 'relfood',  name: 'Rail Food', type: 'railfood' },
  { match: 'railfood', name: 'Rail Food', type: 'railfood' },
];

const type = 'railfood';

const rule = `VENDOR: RAIL FOOD / REL FOOD
ORDER NO: "REL FOOD Ref.No" label and value are in ONE <td> cell:
  <span>REL FOOD Ref.No : <b>1050866</b></span>
  Extract the number from the SAME cell — it is NOT in a separate sibling td.
  e.g. "REL FOOD Ref.No : 1050866" → orderNo = "1050866"
  Fallback: "IRCTC Order No. 2451624177" (same one-cell structure) → "2451624177".

EMAIL FORMAT: Pure HTML (no PDF). After HTML-to-text, fields are pipe-separated.

ITEMS TABLE: Item | Price | Quantity | Total
  Each item td has name + description separated by <br>.
  Quantity = 3rd column (never the description).
  DO NOT verify Price × Qty = Total (RailFood billing bug: Total always = unit Price).
  IGNORE any row starting with "Instructions :" — it is a footer/notes row, not an item.

TOTAL:
  COD orders:     use "Payment to collect" as totalAmount.
  PAID/Prepaid:   "Payment to collect" = 0. Use items table "Total" footer row instead.
  e.g. Sub Total=340, GST=17, Total=357 → totalAmount=357 for Prepaid orders.

- COACH: "Coach/Seat" field e.g. "H1/C/8"
- DATE: "Delivery Date & Time" appears in TWO possible formats — check which separator is used:
    Slash format: "6/21/2026 & 20:57" → M/D/YYYY → deliveryDate=2026-06-21, deliveryTime=20:57
    Dash format:  "21-06-2026 & 21:54" → DD-MM-YYYY → deliveryDate=2026-06-21, deliveryTime=21:54
  Never assume one format — detect the separator (/ or -) and parse day/month accordingly.
- TRAIN: "Train No./Name"
- CONTACT: first 10-digit number, strip +91/91 prefix
- PAYMENT: "COD"→"COD", "PAID"/"PRE_PAID"/"PAID"→"Prepaid"`;

module.exports = { matchers, type, rule, domConfig };
