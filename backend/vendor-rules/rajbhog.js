"use strict";

/**
 * VENDOR: RAJBHOG (RajBhog Khana)
 * Sender domain : rajbhogkhana.com  (orders@rajbhogkhana.com)
 * Transport     : Microsoft Outlook / Exchange → Gmail
 * Content-Type  : text/html; charset=utf-8  — pure HTML single part, NO text/plain part.
 * Transfer      : quoted-printable
 *
 * VERIFIED AGAINST:
 *   - Real .eml RBK001713441 / 2451996597  (02 Jun 2026)
 *   - Real PDF  RBK001699782 / 2443864301  (06 May 2026)
 *
 * DOM PARSING: PATH A — domConfig below.
 * AI fallback  (PATH B) used only when parsed.html is missing or DOM returns null.
 *
 * ── HTML LAYOUT (confirmed from live .eml) ─────────────────────────────────
 *
 * TABLE 1 — Bootstrap header table (no border, class="table table-striped")
 *   <thead><tr> with 3 <th> cells:
 *
 *   TH[0] — left column (35%):
 *     "Booking Date: 02 Jun 2026,  10:29"
 *     "Delivery Date: 02 Jun 2026,  07:42"
 *     "FSSAI NO.: 10717032001326"
 *     All plain text separated by <br> tags.
 *
 *   TH[1] — centre column (30%):
 *     <img> logo
 *     "To"
 *     <strong>Customer Name : <span style="text-transform:uppercase">Ranjit Deshmukh</span></strong>
 *     "Customer Contact : 8600403319"
 *     "Customer Email :"
 *
 *   TH[2] — right column (35%):
 *     <b>Invoice RBK001713441 / 2451996597</b>
 *     <b>Payment:</b> CASH_ON_DELIVERY
 *     <b>Coach / Berth:</b> B1 / 40
 *     <b>Train:</b> 22940 / BSP OKHA SF EXP
 *     <b>Delivery Station:</b> BRC / VADODARA JN
 *
 * TABLE 2 — Items table (border="1", class="table table-striped")
 *   <thead><tr> with 7 <th> columns:
 *     [0] SL#  [1] Item  [2] Description  [3] Qty  [4] Price  [5] GST  [6] Amount
 *
 *   <tbody> item rows — each row has 7 <td> cells (NO colspan):
 *     [0] serial   [1] item name   [2] description (serving details — NEVER a quantity)
 *     [3] qty      [4] unit price  [5] gst per unit  [6] row total
 *
 *   <tbody> footer rows — colspan="6" on <th>, value in last <td>:
 *     Subtotal: | <value>
 *     GST (5%)  | <value>
 *     Discount  | <value>
 *     Delivery: | <value>
 *     Total:    | <value>   ← use as totalAmount
 *
 * ── KEY PARSING RULES ──────────────────────────────────────────────────────
 *
 * ORDER NO:
 *   TH[2] text contains "Invoice RBK001713441 / 2451996597"
 *   Use the number AFTER " / " — the IRCTC order ID ("2451996597").
 *   The "RBK..." prefix is Rajbhog's internal ref — never use it as orderNo.
 *
 * QUANTITY:
 *   Column index 3 in each item row — a plain integer, direct read.
 *   Column index 2 (Description) is serving info ("4 Butter chapati, mix veg...").
 *   It is STRUCTURALLY IMPOSSIBLE to confuse description with qty in DOM mode:
 *   qty = cells.eq(3).text() — separate cell, never touches description.
 *
 * QUANTITY CROSS-CHECK:
 *   For every item row: assert Price × Qty ≈ Amount (tolerance ±1).
 *   If mismatch: recalculate Qty = round(Amount ÷ Price).
 *   This catches edge cases where Qty cell contains a typo.
 *
 * DATE / TIME:
 *   TH[0] text: "Delivery Date: 02 Jun 2026,  07:42"
 *   Parse via regex: /Delivery Date:\s*(\d{1,2})\s+(\w+)\s+(\d{4}),\s*(\d{1,2}:\d{2})/
 *   Month names: Jan=01 Feb=02 Mar=03 Apr=04 May=05 Jun=06 Jul=07 Aug=08 Sep=09 Oct=10 Nov=11 Dec=12
 *   → deliveryDate = "YYYY-MM-DD", deliveryTime = "HH:MM"
 *   Use "Delivery Date" NOT "Booking Date".
 *
 * COACH:
 *   TH[2] text: "Coach / Berth: B1 / 40"
 *   Extract value after "Coach / Berth:" → strip spaces around "/" → "B1/40"
 *
 * PAYMENT:
 *   TH[2] text: "Payment: CASH_ON_DELIVERY"
 *   "CASH_ON_DELIVERY" or "COD" → "COD"
 *   "PREPAID" or "PRE_PAID" or "ONLINE" or "PAID" → "Prepaid"
 *
 * TOTAL AMOUNT:
 *   Footer "Total:" row value — strip commas → parseFloat.
 *   For COD: totalAmount = Total footer value (what vendor collects at door).
 *   For Prepaid: totalAmount = Total footer value (order monetary value).
 *   Either way: always use the "Total:" footer row.
 */

const domConfig = {

  /**
   * headerCell(n): helper used in postProcess — TH text is extracted once
   * into order._th0, order._th1, order._th2 by the custom headerExtract
   * function below, then postProcess reads from those.
   *
   * All header fields use selfContained:true (entire data is in ONE <th>).
   * parseDomOrder's selfContained path must regex from the element's own text.
   */

  fields: {
    // ── TH[2] fields — selfContained, regex from TH[2] own text ────────────

    orderNo: {
      // "Invoice RBK001713441 / 2451996597" → take AFTER "/ " (IRCTC order ID)
      headerThIndex: 2,
      selfContained: true,
      labelText: 'Invoice',
      transform: v => {
        // v = full TH[2] text (collapsed whitespace)
        const m = v.match(/Invoice\s+RBK\d+\s*\/\s*(\d+)/i);
        return m ? m[1].trim() : null;
      },
    },

    paymentType: {
      headerThIndex: 2,
      selfContained: true,
      labelText: 'Payment:',
      transform: v => {
        const m = v.match(/Payment:\s*([A-Z_]+)/i);
        if (!m) return 'COD';
        const u = m[1].toUpperCase();
        if (u === 'CASH_ON_DELIVERY' || u === 'COD') return 'COD';
        if (['PREPAID','PRE_PAID','ONLINE','PAID'].includes(u)) return 'Prepaid';
        return u;
      },
    },

    coach: {
      headerThIndex: 2,
      selfContained: true,
      labelText: 'Coach / Berth:',
      transform: v => {
        // "Coach / Berth: B1 / 40" → "B1/40" or "RAC/S3 / 55" → "RAC/S3/55"
        const m = v.match(/Coach\s*\/\s*Berth:\s*([A-Z0-9/]+)\s*\/\s*(\d+)/i);
        return m ? `${m[1]}/${m[2]}` : null;
      },
    },

    trainInfo: {
      headerThIndex: 2,
      selfContained: true,
      labelText: 'Train:',
      transform: v => {
        // "Train: 22940 / BSP OKHA SF EXP" — capture everything after "Train:"
        // up to next <b> label (Delivery Station) or end
        const m = v.match(/Train:\s*(.+?)(?:\s*Delivery Station:|$)/i);
        return m ? m[1].replace(/\s+/g, ' ').trim() : null;
      },
    },

    // ── TH[1] fields ─────────────────────────────────────────────────────────

    customerName: {
      headerThIndex: 1,
      selfContained: true,
      labelText: 'Customer Name',
      transform: v => {
        const m = v.match(/Customer Name\s*:\s*([^\n]+?)(?=\s*Customer Contact|$)/i);
        return m ? m[1].replace(/\s+/g, ' ').trim() : null;
      },
    },

    contactNo: {
      headerThIndex: 1,
      selfContained: true,
      labelText: 'Customer Contact',
      transform: v => {
        const m = v.match(/Customer Contact\s*:\s*(\d[\d\s]*)/i);
        if (!m) return null;
        const digits = m[1].replace(/\D/g, '');
        if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
        if (digits.length === 10) return digits;
        return digits.slice(-10) || null;
      },
    },

    // ── TH[0] fields ─────────────────────────────────────────────────────────

    _deliveryRaw: {
      headerThIndex: 0,
      selfContained: true,
      labelText: 'Delivery Date',
      transform: v => {
        // "Delivery Date: 02 Jun 2026,  07:42"
        const m = v.match(/Delivery Date:\s*(\d{1,2})\s+(\w{3})\s+(\d{4}),\s*(\d{1,2}:\d{2})/i);
        return m ? `${m[1]} ${m[2]} ${m[3]} ${m[4]}` : null;
      },
    },

    // totalAmount is captured from footer (captureFooterTotal), not a field here
  },

  itemsTable: {
    /**
     * CONFIRMED column indexes (0-based) from live .eml:
     *   0=SL#  1=Item  2=Description  3=Qty  4=Price  5=GST  6=Amount
     *
     * columnMap maps header text → internal field name for dynamic detection.
     * parseDomOrder resolves column indexes at runtime by matching header text.
     */
    columnMap: {
      'sl#':         'slNo',       // index 0 — skip, not used
      'item':        'rawItem',    // index 1 — item name
      'description': 'desc',       // index 2 — serving info, NEVER qty
      'qty':         'qty',        // index 3 — actual ordered quantity
      'price':       'price',      // index 4 — unit price
      'gst':         'gstCol',     // index 5 — ignored
      'amount':      'amountCol',  // index 6 — used for qty cross-check only
    },

    // Description column is serving info — never treat as item name or qty.
    // Item name comes from 'rawItem' (index 1). Description is appended for context.
    itemCellSplit: null,       // item name is already clean in its own <td>; no <br> split needed

    footerLabels: ['Subtotal', 'GST', 'Discount', 'Delivery', 'Total'],

    // Footer row detection: row has a <th> with colspan="6" + one <td> for value.
    // parseDomOrder should detect footer when cells[0] has colspan ≥ 2 or
    // when cells.length === 2 (th with colspan + value td).
    captureFooterTotal: 'Total',  // capture this footer row's value as order._itemsTotal

    /**
     * QUANTITY CROSS-CHECK (implemented in postProcess):
     * For each item: if |Price × Qty - Amount| > 1, recalculate Qty = round(Amount ÷ Price).
     * Verified:
     *   EML: 260.00 × 1 = 260.00 ✓
     *   PDF: 232.00 × 2 = 464.00 ✓ (Veg Special Thali qty=2 from PDF)
     */
    enableQtyCrossCheck: true,
  },

  postProcess(order) {
    // ── Parse _deliveryRaw → deliveryDate + deliveryTime ───────────────────
    // Format: "02 Jun 2026 07:42" (assembled by _deliveryRaw.transform)
    const MONTHS = {
      jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
      jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12',
    };
    const raw = order._deliveryRaw || '';
    const m = raw.match(/(\d{1,2})\s+(\w{3})\s+(\d{4})\s+(\d{1,2}:\d{2})/i);
    if (m) {
      const mo = MONTHS[m[2].toLowerCase()];
      if (mo) {
        order.deliveryDate = `${m[3]}-${mo}-${m[1].padStart(2, '0')}`;
        order.deliveryTime = m[4].length === 4 ? '0' + m[4] : m[4];
      } else {
        order.deliveryDate = null;
        order.deliveryTime = null;
      }
    } else {
      order.deliveryDate = null;
      order.deliveryTime = null;
    }
    delete order._deliveryRaw;

    // ── Quantity cross-check ───────────────────────────────────────────────
    // For each item: Price × Qty should ≈ Amount (tolerance ±1).
    // If mismatch, correct Qty = round(Amount ÷ Price).
    // This guards against typos in the Qty cell without being fragile.
    if (order.items && Array.isArray(order.items)) {
      for (const item of order.items) {
        if (item._amount && item.price > 0) {
          const expected = item.price * item.quantity;
          if (Math.abs(expected - item._amount) > 1) {
            const corrected = Math.round(item._amount / item.price);
            if (corrected > 0) {
              // Only correct if it makes sense (corrected differs from parsed qty)
              item.quantity = corrected;
            }
          }
          delete item._amount; // clean up internal cross-check field
        }
      }
    }

    // ── totalAmount: always use items table "Total" footer ─────────────────
    if (order._itemsTotal && order._itemsTotal > 0) {
      order.totalAmount = order._itemsTotal;
    }
    delete order._itemsTotal;

    return order;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// parseDomOrder changes required for Rajbhog's header structure:
//
// Rajbhog uses <th> cells (not <td>) for its header table.
// The 3 <th> cells contain ALL order metadata as plain text (no label/value split).
// parseDomOrder must:
//
//   1. HEADER EXTRACTION (new, Rajbhog-specific):
//      Before the fields loop, extract the 3 header <th> texts:
//        const thCells = [];
//        $('thead th').slice(0,3).each((i,el) => {
//          thCells.push($(el).text().replace(/\s+/g,' ').trim());
//        });
//      Store as order._thCells = thCells;
//
//   2. selfContained fields with headerThIndex:
//      In the fields loop, if cfg.headerThIndex is defined:
//        rawValue = order._thCells[cfg.headerThIndex] || '';
//        order[fieldName] = cfg.transform(rawValue);
//      (The transform receives the entire TH text and extracts via regex.)
//
//   3. Items table — footer detection:
//      Rajbhog footer rows have a <th colspan="6"> (not <td>) + one <td> value.
//      Detect footer when: row has a cell with colspan >= 2.
//      Parse footer as: label = cells.first().text().trim(), value = cells.last().text().trim()
//
//   4. Items table — qty cross-check via _amount:
//      When parsing each item row, also capture amountCol as item._amount:
//        item._amount = parseFloat(cells.eq(colIndex['amountCol']).text()) || 0;
//      postProcess then validates Price × Qty ≈ _amount and corrects Qty if needed.
//
//   5. Cleanup:
//      After all fields processed, delete order._thCells.
// ─────────────────────────────────────────────────────────────────────────────

const matchers = [
  { match: 'rajbhog',     name: 'Rajbhog', type: 'rajbhog' },
  { match: 'rajbhogkhana', name: 'Rajbhog', type: 'rajbhog' },
  { match: 'rajbhaog',    name: 'Rajbhog', type: 'rajbhog' },
];

const type = 'rajbhog';

const rule = `VENDOR: RAJBHOG (RajBhog Khana)
SENDER: orders@rajbhogkhana.com | FORMAT: Pure HTML single-part (no text/plain). Outlook/Exchange.

ORDER NO:
  Top-right cell contains: "Invoice RBK001713441 / 2451996597"
  Use the number AFTER the slash — "2451996597" — as orderNo (this is the IRCTC order ID).
  NEVER use the "RBK..." prefix as orderNo.

HEADER LAYOUT (3 columns in a Bootstrap <thead><tr> with <th> cells):
  TH[0] — left:
    "Booking Date: 02 Jun 2026,  10:29"
    "Delivery Date: 02 Jun 2026,  07:42"
    "FSSAI NO.: 10717032001326"
  TH[1] — centre:
    "Customer Name : Ranjit Deshmukh"  (may have CSS uppercase — preserve as-is)
    "Customer Contact : 8600403319"
    "Customer Email :"
  TH[2] — right:
    "Invoice RBK001713441 / 2451996597"
    "Payment: CASH_ON_DELIVERY"
    "Coach / Berth: B1 / 40"
    "Train: 22940 / BSP OKHA SF EXP"
    "Delivery Station: BRC / VADODARA JN"

ITEMS TABLE — 7 columns (SL# | Item | Description | Qty | Price | GST | Amount):
  Column 0 = SL# (serial number — SKIP, do not use)
  Column 1 = Item name (e.g. "SPECIAL THALI")
  Column 2 = Description (serving details e.g. "4 Butter chapati, mix veg, paneer...")
             *** THIS IS NEVER A QUANTITY. NEVER treat description as an item. ***
             Append to item name for display: "SPECIAL THALI - 4 Butter chapati..."
  Column 3 = Qty (plain integer — the actual ordered quantity, e.g. 1, 2, 5, 8)
  Column 4 = Price (unit price, e.g. "260.00")
  Column 5 = GST (ignore)
  Column 6 = Amount (row total — use ONLY for cross-check: Price × Qty = Amount)

QUANTITY CROSS-CHECK (mandatory):
  For every item row: verify Price × Qty = Amount (tolerance ±1).
  If mismatch: Qty = round(Amount ÷ Price).
  Example from verified PDF: Veg Special Thali | Price=232.00 | Qty=2 | Amount=464.00 → 232×2=464 ✓
  Example from verified EML: SPECIAL THALI     | Price=260.00 | Qty=1 | Amount=260.00 → 260×1=260 ✓

FOOTER ROWS (colspan="6" on label, value in last cell):
  Subtotal: | <value>
  GST (5%)  | <value>
  Discount  | <value>
  Delivery: | <value>
  Total:    | <value>  ← use as totalAmount (strip commas, parseFloat)

FIELD EXTRACTION RULES:
- DATE: "Delivery Date: 02 Jun 2026,  07:42" → deliveryDate=2026-06-02, deliveryTime=07:42
  Use "Delivery Date" NOT "Booking Date".
  Month: Jan=01 Feb=02 Mar=03 Apr=04 May=05 Jun=06 Jul=07 Aug=08 Sep=09 Oct=10 Nov=11 Dec=12
- COACH: "Coach / Berth: B1 / 40" → normalise to "B1/40" (remove spaces around /)
- TRAIN: "Train: 22940 / BSP OKHA SF EXP" → full string as-is
- CONTACT: extract 10-digit number, strip +91/91 prefix if present
- PAYMENT: "CASH_ON_DELIVERY"/"COD" → "COD" | "PREPAID"/"PRE_PAID"/"ONLINE"/"PAID" → "Prepaid"
- TOTAL: always use "Total:" footer row value as totalAmount (both COD and Prepaid)`;

module.exports = { matchers, type, rule, domConfig };
