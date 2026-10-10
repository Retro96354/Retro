'use strict';

/**
 * VENDOR: IRCTC eCATERING
 * Sender domains: ecatering.irctc.co.in, foodontrack.com
 * Content-Type: text/html; charset=utf-8 — pure HTML single part, NO text/plain.
 * Transfer: quoted-printable
 *
 * VERIFIED AGAINST: real .eml Order No 2455334790 (12-Jun-2026)
 *
 * ── HTML LAYOUT ────────────────────────────────────────────────────────────
 *
 * ORDER DETAILS TABLE — 7 rows, 4 columns (label | value | label | value):
 *   Row 0: ORDER No        | 2455334790           | PNR No            | -
 *   Row 1: MOBILE No       | 7982227893           | TRAIN No          | 12904
 *   Row 2: ALTERNATE MOBILE No | -                | Comment           | -
 *   Row 3: JOURNEY DATE    | 12-06-2026           | ORDER DATE        | 12-06-2026
 *   Row 4: PAYMENT STATUS  | PRE_PAID             | COACH NO / SEAT NO| B4/ 22
 *   Row 5: DELIVERY STATION| VADODARA JN          | DELIVERY TIME     | 18:01
 *   Row 6: VENDOR          | Hotel Samrat         | ETA               | 12-Jun-2026 22:02
 *
 *   Detection: first cell = "ORDER No" (exact case).
 *
 * ITEMS TABLE — 4 columns: Item | Price | Quantity | Amount
 *   Header: ["Item", "Price", "Quantity", "Amount"]
 *   e.g. ["Paneer Butter Masala with Roti", "₹ 110", "1", "₹ 110"]
 *
 * FOOTER ROWS — colspan=3 on label + 1 value cell:
 *   "Sub Total"                            | ₹ 110.5
 *   "GST"                                  | ₹ 5.5
 *   "Delivery Charge"                      | ₹ 0
 *   "Discount*"                            | ₹
 *   "Grand Total (Inclusive of all taxes)" | ₹ 116  ← totalAmount
 *
 * ── KEY PARSING RULES ──────────────────────────────────────────────────────
 *
 * PRICE: "₹ 110" → strip "₹" → parseFloat("110")
 * COACH: "B4/ 22" → trim → normalize "/" → "B4/22"
 * DATE:  ETA field "12-Jun-2026 22:02" → deliveryDate = "2026-06-12", deliveryTime = "22:02"
 *        ⚠ Never trust "DELIVERY TIME" field — always use ETA for both date and time.
 * PAYMENT: "PRE_PAID" → "Prepaid", otherwise "COD"
 * CUSTOMER NAME: ⚠ Never present in IRCTC emails — email is addressed to the vendor.
 *        Fallback → contactNo present : "Customer (XXXXXXXXXX)"
 *                 → contactNo missing : "IRCTC Customer"
 */

const domConfig = {
  fields: {
    orderNo: {
      labelText: 'ORDER No',
      transform: v => v.trim() || null,
    },

    contactNo: {
      labelText: 'MOBILE No',
      transform: v => {
        const digits = v.replace(/\D/g, '');
        if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
        if (digits.length === 10) return digits;
        return digits.slice(-10) || null;
      },
    },

    trainInfo: {
      labelText: 'TRAIN No',
      transform: v => v.trim() || null,
    },

    _etaRaw: {
      labelText: 'ETA',
      transform: v => v.trim(),
    },

    coach: {
      labelText: 'COACH NO / SEAT NO',
      transform: v => v.trim().replace(/\s*\/\s*/g, '/') || null,
    },

    paymentType: {
      labelText: 'PAYMENT STATUS',
      transform: v => {
        const u = v.trim().toUpperCase();
        if (u === 'PRE_PAID' || u === 'PREPAID' || u === 'ONLINE' || u === 'PAID') return 'Prepaid';
        return 'COD';
      },
    },
  },

  itemsTable: {
    columnMap: {
      'item':     'rawItem',   // index 0 — item name
      'price':    'price',     // index 1 — "₹ 110"
      'quantity': 'qty',       // index 2 — plain integer
      'amount':   'amountCol', // index 3 — "₹ 110" (cross-check)
    },

    stripCurrencyPrefix: '₹',

    footerLabels: ['Sub Total', 'GST', 'Delivery Charge', 'Discount*', 'Grand Total'],

    captureFooterTotal: 'Grand Total',

    enableQtyCrossCheck: true,
  },

  postProcess(order) {
    // ETA format: "12-Jun-2026 22:02" — always reliable. Ignore "DELIVERY TIME" and "JOURNEY DATE".
    const eta = order._etaRaw || '';
    const m = eta.match(/(\d{2})-([A-Za-z]{3})-(\d{4})\s+(\d{2}:\d{2})/);
    if (m) {
      const months = { Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',
                       Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12' };
      order.deliveryDate = `${m[3]}-${months[m[2]] || '01'}-${m[1]}`;
      order.deliveryTime = m[4];
    } else {
      order.deliveryDate = null;
      order.deliveryTime = null;
    }
    delete order._etaRaw;

    if (order._itemsTotal && order._itemsTotal > 0) {
      order.totalAmount = order._itemsTotal;
    }
    delete order._itemsTotal;

    // CUSTOMER NAME: never present in IRCTC emails — email is addressed to the vendor.
    // Always apply fallback — do not attempt to fetch from email.
    if (!order.customerName) {
      order.customerName = order.contactNo
        ? `Customer (${order.contactNo})`
        : 'IRCTC Customer';
    }

    return order;
  },
};

const skipSubjects = ['delivery time passed', 'delivered'];

const matchers = [
  { match: 'ecatering',  name: 'IRCTC', type: 'irctc' },
  { match: 'foodontrack', name: 'IRCTC', type: 'irctc' },
];

const type = 'irctc';

const rule = `VENDOR: IRCTC eCATERING (EMAIL)
SENDER: ecatering@irctc.co.in | FORMAT: Pure HTML single-part (no text/plain).

ORDER NO: "ORDER No" label — plain integer e.g. "2455334790".

ORDER DETAILS TABLE — 7 rows, 4 columns (label | value | label | value):
  Row 0: ORDER No        | 2455334790 | PNR No            | -
  Row 1: MOBILE No       | 7982227893 | TRAIN No          | 12904
  Row 2: ALTERNATE MOBILE No | -      | Comment           | -
  Row 3: JOURNEY DATE    | 12-06-2026 | ORDER DATE        | 12-06-2026
  Row 4: PAYMENT STATUS  | PRE_PAID   | COACH NO / SEAT NO| B4/ 22
  Row 5: DELIVERY STATION| VADODARA JN| DELIVERY TIME     | 18:01
  Row 6: VENDOR          | Hotel Samrat| ETA              | 12-Jun-2026 22:02

- ORDER NO:   "ORDER No" → plain integer string.
- CONTACT:    "MOBILE No" → 10-digit number.
- TRAIN:      "TRAIN No" → number string.
- DATE:       *** ALWAYS use ETA field for date and time ***
              ETA format "12-Jun-2026 22:02" → deliveryDate=2026-06-12, deliveryTime=22:02.
              Ignore "DELIVERY TIME" (18:01 is wrong) and "JOURNEY DATE" — ETA is the reliable source.
- COACH:      "COACH NO / SEAT NO" → trim → normalize "/" → "B4/22".
- PAYMENT:    "PAYMENT STATUS" → "PRE_PAID"/"PREPAID"/"ONLINE"/"PAID"→"Prepaid" || "COD".
- CUSTOMER NAME: *** NOT PRESENT in IRCTC emails — field does not exist ***.
              Email is addressed to the vendor ("Dear Hotel Samrat"), NOT the customer.
              Do NOT attempt to fetch from email — always use fallback:
              Fallback → contactNo present : "Customer (XXXXXXXXXX)"
                       → contactNo missing : "IRCTC Customer"

ITEMS TABLE — 4 columns: Item | Price | Quantity | Amount
  Column 0 = Item name.
  Column 1 = Price (format "₹ 110" — strip "₹" → 110).
  Column 2 = Quantity (plain integer — "1" → 1).
  Column 3 = Amount (format "₹ 110" — cross-check only so qty × price = total).

FOOTER ROWS (colspan=3 on label, value in last cell — ₹ present):
  Sub Total                            | ₹ 110.5
  GST                                  | ₹ 5.5
  Delivery Charge                      | ₹ 0
  Discount*                            | ₹
  Grand Total (Inclusive of all taxes) | ₹ 116  ← totalAmount (strip ₹)

- totalAmount: "Grand Total (Inclusive of all taxes)" value.
- tax: "GST" value.`;

module.exports = { matchers, type, rule, domConfig, skipSubjects };
