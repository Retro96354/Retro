"use strict";

/**
 * VENDOR: ZOOP INDIA
 * Sender domain : zoopindia.com  (noreply@zoopindia.com)
 * Transport     : Amazon SES
 * Content-Type  : text/html; charset=utf-8 — pure HTML single part, NO text/plain part.
 * Transfer      : quoted-printable
 *
 * VERIFIED AGAINST: real .eml ZO36317062087957 (03-Jun-2026)
 *
 * ── HTML LAYOUT ────────────────────────────────────────────────────────────
 *
 * The email is ONE giant nested table wrapper.
 * Do NOT match tables by index — match by locating the first 4-col row
 * whose first cell text equals "ZOOP Txn. No." for order details, and
 * the first 4-col header row whose cells are
 * ["Item Name","Price","Quantity","Amount"] for items.
 *
 * ORDER DETAILS TABLE — rows with exactly 4 cells, label+value pairs:
 *   Row 0: ["ZOOP Txn. No.",    ": ZO36317062087957",        "Type",          ": Prepaid"]
 *   Row 1: ["Customer Name",    ": Ram Prakash",              "Phone",         ": 7993415001"]
 *   Row 2: ["Train",            ": Hsr Bdts Sf Exp/ 22916",  "Coach/ Seat",   ": B5/ 68"]
 *   Row 3: ["Restaurants Name", ": (1466) Shri Krishna Food","ETA",           ": 03-Jun-2026 09:51"]
 *   Row 4: ["At",               ": Vadodara Jn/ BRC",         "Delivery Date", ": 03-Jun-2026 09:51"]
 *
 *   Value cells contain a <b>: </b> tag followed by the plain text value.
 *   The combined textContent of the cell is ": <value>" — always strip the ": " prefix.
 *   e.g. ": ZO36317062087957" → "ZO36317062087957"
 *
 * ITEMS TABLE — 4 columns: Item Name | Price | Quantity | Amount
 *   col widths: 60% | 15% | 10% | 15%
 *
 *   HEADER ROW (first <tr> of this table):
 *     cells: ["Item Name", "Price", "Quantity", "Amount"]  — all font-weight:bold, NO colspan
 *     *** THIS ROW MUST BE SKIPPED — it is a header, not a data row ***
 *     Detection: all 4 cells present AND cell[0].toLowerCase() === "item name"
 *                AND cell[1].toLowerCase() === "price"
 *
 *   DATA ROW(S) — exactly 4 cells, NO colspan, plain numbers (no ₹ symbol):
 *     e.g. ["Masala Dosa", "99", "2", "198"]
 *          → name="Masala Dosa", price=99, qty=2, amount=198
 *
 *   FOOTER ROWS — 2 cells only (colspan=3 on first cell + one value cell):
 *     "Base Price Total"           → ₹ 198
 *     "(+) GST on food"            → ₹ 9.9      ← may be decimal
 *     "(+) Delivery Charge"        → ₹ 25.42
 *     "(+) GST on Delivery Charge" → ₹ 4.58
 *     "(+) Gateway Platform Fees"  → ₹ 20
 *     "(-) Discount"               → ₹ 0
 *     "Order Total"                → ₹ 258      ← USE as totalAmount
 *     "(-) Paid Online"            → ₹ 258
 *     "BALANCE TO PAY"             → ₹ 0
 *
 * ITEM DESCRIPTION TABLE (IGNORE ENTIRELY):
 *   A separate 2-col table that follows items under the heading "Item Description:".
 *   Header: ["Item Name", "Description"]
 *   Data:   ["Masala Dosa", "1 Dosa + Sambhar + Chutney"]  ← serving info only
 *   *** NEVER extract items or quantities from this table ***
 *   Detection: skip any table whose header row has exactly 2 cells and
 *              cell[0].toLowerCase()==="item name" && cell[1].toLowerCase()==="description"
 *
 * ── KEY PARSING RULES ──────────────────────────────────────────────────────
 *
 * ORDER NO: "ZOOP Txn. No." label → full ZO... string exactly as-is.
 *   HTML: <b>: </b>ZO36317062087957  → textContent = ": ZO36317062087957"
 *   Strip ": " prefix → "ZO36317062087957"
 *
 * VALUE STRIPPING: Every value cell has textContent starting with ": ".
 *   Always strip exactly the first two characters ": " before using the value.
 *
 * COACH: "Coach/ Seat" label → value e.g. ": B5/ 68"
 *   Strip ": " → "B5/ 68" → normalize spaces around "/" → "B5/68"
 *
 * DATE & TIME: Use "Delivery Date" label (Row 4, RIGHT column) — NOT "ETA".
 *   Both ETA and Delivery Date contain the same value in this email.
 *   Format: DD-Mon-YYYY HH:MM
 *   Mon map: Jan=01 Feb=02 Mar=03 Apr=04 May=05 Jun=06
 *            Jul=07 Aug=08 Sep=09 Oct=10 Nov=11 Dec=12
 *   e.g. "03-Jun-2026 09:51" → deliveryDate="2026-06-03", deliveryTime="09:51"
 *   Pad single-digit day: "3-Jun-2026" → day="03"
 *   Pad single-digit hour: "9:51" → "09:51"
 *
 * PAYMENT: "Type" label → strip ": " → "Prepaid" or "COD"
 *   The value cell may bold the text: <b>: </b><b>Prepaid</b>
 *   textContent still equals ": Prepaid" — strip prefix as normal.
 *
 * ITEMS — CRITICAL HEADER-SKIP RULE:
 *   The items table's first <tr> has cells ["Item Name","Price","Quantity","Amount"].
 *   This is a HEADER row. It MUST be skipped before processing data rows.
 *   A data row has 4 cells where cell[0] is NOT "item name" / "price" / "quantity" / "amount".
 *   Failing to skip the header causes: itemName="Item Name", price=NaN, qty parsed wrong.
 *
 * ITEMS — COLUMNS (0-based):
 *   0 = Item Name  (string, no ₹)
 *   1 = Price      (plain number, no ₹ — e.g. "99")
 *   2 = Quantity   (plain integer — e.g. "2")
 *   3 = Amount     (plain number, no ₹ — e.g. "198", cross-check only)
 *
 * ITEMS — QTY CROSS-CHECK:
 *   Price × Qty should equal Amount (always exact for Zoop).
 *   If mismatch: Qty = round(Amount ÷ Price).
 *
 * TOTAL: "Order Total" footer row → strip "₹ " prefix → parseFloat → totalAmount.
 *   Footer value may be integer OR decimal — always parseFloat.
 * deliveryCharge: "(+) Delivery Charge" footer value → strip "₹ " → parseFloat.
 * tax: "(+) GST on food" footer value → strip "₹ " → parseFloat.
 */

const domConfig = {

  fields: {
    orderNo: {
      labelText:   'ZOOP Txn. No.',
      valuePrefix: ': ',
      transform: v => v.trim() || null,
    },

    paymentType: {
      labelText:   'Type',
      valuePrefix: ': ',
      transform: v => {
        const u = v.trim().toUpperCase();
        if (u === 'COD' || u === 'CASH_ON_DELIVERY') return 'COD';
        if (['PREPAID', 'PRE_PAID', 'ONLINE', 'PAID'].includes(u)) return 'Prepaid';
        if (v.trim().toLowerCase() === 'prepaid') return 'Prepaid';
        return v.trim() || 'COD';
      },
    },

    customerName: {
      labelText:   'Customer Name',
      valuePrefix: ': ',
      transform: v => v.trim() || null,
    },

    contactNo: {
      labelText:   'Phone',
      valuePrefix: ': ',
      transform: v => {
        const digits = v.replace(/\D/g, '');
        if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
        if (digits.length === 10) return digits;
        return digits.slice(-10) || null;
      },
    },

    trainInfo: {
      labelText:   'Train',
      valuePrefix: ': ',
      // Save ONLY the train number — discard the train name entirely.
      // Raw value e.g. "Ddr Bkn Sf Exp/ 12490" or "Hsr Bdts Sf Exp/ 22916"
      // (name may appear before OR after the number) → extract the 4-5 digit
      // train number wherever it occurs in the string.
      // Falls back to the trimmed raw value only if no number is found at all,
      // so nothing silently disappears.
      transform: v => {
        const trimmed = v.trim();
        const match = trimmed.match(/(\d{4,5})/);
        return match ? match[1] : (trimmed || null);
      },
    },

    coach: {
      labelText:   'Coach/ Seat',
      valuePrefix: ': ',
      // "B5/ 68" → normalize all spaces around "/" → "B5/68"
      transform: v => v.trim().replace(/\s*\/\s*/g, '/') || null,
    },

    _deliveryRaw: {
      labelText:   'Delivery Date',   // Row 4 RIGHT column — not ETA
      valuePrefix: ': ',
      transform: v => v.trim(),
    },
    // totalAmount is captured from "Order Total" footer via captureFooterTotal
  },

  itemsTable: {
    /**
     * CONFIRMED column indexes (0-based) from actual HTML (widths: 60%|15%|10%|15%):
     *   0 = Item Name   1 = Price   2 = Quantity   3 = Amount
     *
     * Header row:  4 cells, all plain text, font-weight:bold, NO colspan.
     *   cell texts: ["Item Name", "Price", "Quantity", "Amount"]
     *   *** MUST BE SKIPPED — not a data row ***
     *
     * Data rows:   4 cells, no colspan, plain numbers (no ₹).
     *   e.g. ["Masala Dosa", "99", "2", "198"]
     *
     * Footer rows: 2 cells — first has colspan=3, second has the ₹ value.
     *
     * Item Description table (2 cols: "Item Name" | "Description") — SKIP ENTIRELY.
     */
    columnMap: {
      'item name': 'rawItem',   // col 0
      'price':     'price',     // col 1
      'quantity':  'qty',       // col 2
      'amount':    'amountCol', // col 3 (cross-check only)
    },

    // No description column inside the items table — item name is clean in col 0.
    itemCellSplit: null,

    /**
     * HEADER ROW SKIP — critical fix.
     * Before processing any row in the items table, check:
     *   const texts = cells.map(c => c.text().trim().toLowerCase());
     *   if (texts[0] === 'item name' && texts[1] === 'price') continue; // skip header
     *
     * A data row is identified by:
     *   - exactly 4 cells
     *   - NO colspan on any cell
     *   - cell[0] text is NOT one of the header label strings
     *   - cell[1] text is a parseable number (parseFloat succeeds)
     */
    headerSkipCheck: {
      colIndex: 0,
      labelLower: 'item name',
      confirmColIndex: 1,
      confirmLabelLower: 'price',
    },

    footerLabels: [
      'Base Price Total',
      '(+) GST on food',
      '(+) Delivery Charge',
      '(+) GST on Delivery Charge',
      '(+) Gateway Platform Fees',
      '(-) Discount',
      'Order Total',
      '(-) Paid Online',
      'BALANCE TO PAY',
    ],

    // Footer rows: cells.length === 2 after colspan collapse.
    // Value cell contains "₹ <number>" — strip "₹ " then parseFloat.
    // Values may be decimal (e.g. "₹ 9.9", "₹ 25.42") — always use parseFloat, not parseInt.
    captureFooterTotal: 'Order Total',  // → order._itemsTotal → totalAmount

    // Skip the Item Description table — detected by 2-col header.
    skipTableIfHeader: ['item name', 'description'],

    enableQtyCrossCheck: true,
    // Price (plain number) × Qty = Amount (exact for Zoop).
    // No ₹ in item data cells — parseFloat directly.
  },

  postProcess(order) {
    // ── Parse _deliveryRaw → deliveryDate + deliveryTime ───────────────────
    // Format: "DD-Mon-YYYY HH:MM"  e.g. "03-Jun-2026 09:51"
    const MONTHS = {
      jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06',
      jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12',
    };
    const raw = order._deliveryRaw || '';
    const m = raw.match(/(\d{1,2})-(\w{3})-(\d{4})\s+(\d{1,2}:\d{2})/);
    if (m) {
      const mo = MONTHS[m[2].toLowerCase()];
      order.deliveryDate = mo
        ? `${m[3]}-${mo}-${m[1].padStart(2, '0')}`
        : null;
      // Pad single-digit hour: "9:51" → "09:51"
      order.deliveryTime = m[4].length === 4 ? '0' + m[4] : m[4];
    } else {
      order.deliveryDate = null;
      order.deliveryTime = null;
    }
    delete order._deliveryRaw;

    // ── Qty cross-check ────────────────────────────────────────────────────
    if (Array.isArray(order.items)) {
      for (const item of order.items) {
        if (item._amount != null && item.price > 0) {
          const expected = item.price * item.quantity;
          if (Math.abs(expected - item._amount) > 1) {
            const corrected = Math.round(item._amount / item.price);
            if (corrected > 0) item.quantity = corrected;
          }
          delete item._amount;
        }
      }
    }

    // ── totalAmount from "Order Total" footer ──────────────────────────────
    if (order._itemsTotal && order._itemsTotal > 0) {
      order.totalAmount = order._itemsTotal;
    }
    delete order._itemsTotal;

    return order;
  },
};

const matchers = [
  { match: 'zoopindia', name: 'Zoop India', type: 'zoop' },
  { match: 'zoop',      name: 'Zoop India', type: 'zoop' },
];

const type = 'zoop';

const rule = `VENDOR: ZOOP INDIA
SENDER: noreply@zoopindia.com | FORMAT: Pure HTML single-part (no text/plain). Amazon SES.

═══════════════════════════════════════════════════════════════════
ORDER DETAILS TABLE — 5 rows × 4 columns (label | ": value" | label | ": value")
═══════════════════════════════════════════════════════════════════
  Row 0: ZOOP Txn. No.    | : ZO36317062087957         | Type          | : Prepaid
  Row 1: Customer Name    | : Ram Prakash               | Phone         | : 7993415001
  Row 2: Train            | : Hsr Bdts Sf Exp/ 22916   | Coach/ Seat   | : B5/ 68
  Row 3: Restaurants Name | : (1466) Shri Krishna Food  | ETA           | : 03-Jun-2026 09:51
  Row 4: At               | : Vadodara Jn/ BRC          | Delivery Date | : 03-Jun-2026 09:51

ALL VALUE CELLS: HTML is <b>: </b><value> — textContent = ": <value>"
ALWAYS strip the leading ": " (colon + space) before using the value.

- ORDER NO:  "ZOOP Txn. No." → strip ": " → full ZO... string. e.g. "ZO36317062087957"
- PAYMENT:   "Type" → strip ": " → "Prepaid" or "COD".
             Note: value cell may double-bold: <b>: </b><b>Prepaid</b> — textContent still ": Prepaid".
- CUSTOMER:  "Customer Name" → strip ": ".
- CONTACT:   "Phone" → strip ": " → 10-digit number. Strip +91/91 prefix if present.
- TRAIN:     "Train" → strip ": " → extract ONLY the numeric train number (4-5 digits),
             discard the train name completely. The number may appear before OR
             after the name in the raw value — always extract just the digits.
             e.g. ": Hsr Bdts Sf Exp/ 22916" → strip ": " → "Hsr Bdts Sf Exp/ 22916"
                  → extract number → "22916"
             e.g. ": Ddr Bkn Sf Exp/ 12490" → strip ": " → extract number → "12490"
             e.g. ": 22946" (already just a number) → "22946"
- COACH:     "Coach/ Seat" → strip ": " → normalize spaces around / → "B5/68".
             e.g. ": B5/ 68" → strip → "B5/ 68" → replace /\s*\/\s*/g with "/" → "B5/68"
- DATE/TIME: Use "Delivery Date" (Row 4 RIGHT). NOT "ETA". Both hold the same value.
             Format: DD-Mon-YYYY HH:MM → deliveryDate=YYYY-MM-DD, deliveryTime=HH:MM
             Pad day and hour to 2 digits.
             e.g. "03-Jun-2026 09:51" → deliveryDate="2026-06-03", deliveryTime="09:51"
             Month map: Jan=01 Feb=02 Mar=03 Apr=04 May=05 Jun=06
                        Jul=07 Aug=08 Sep=09 Oct=10 Nov=11 Dec=12

═══════════════════════════════════════════════════════════════════
ITEMS TABLE — 4 columns: Item Name | Price | Quantity | Amount
Column widths: 60% | 15% | 10% | 15%
═══════════════════════════════════════════════════════════════════

  ┌─────────────────────────────────────────────────────┐
  │ *** CRITICAL: SKIP THE HEADER ROW ***               │
  │ The FIRST <tr> of the items table is a header row.  │
  │ Its cells are: ["Item Name","Price","Qty","Amount"]  │
  │ It has NO colspan. It looks like a data row.        │
  │ YOU MUST SKIP IT or you will parse garbage.         │
  │ Skip check: cells[0].toLowerCase() === "item name"  │
  │             && cells[1].toLowerCase() === "price"   │
  └─────────────────────────────────────────────────────┘

DATA ROW identification:
  - Exactly 4 cells, no colspan on any cell.
  - cell[0] is NOT "item name" / "price" / "quantity" / "amount".
  - cell[1] is a parseable number (parseFloat(cell[1]) > 0).
  - NO ₹ symbol in any cell — all values are plain numbers.

Example data row from ZO36317062087957:
  ["Masala Dosa", "99", "2", "198"]
  → name="Masala Dosa", price=99, qty=2, amount=198

Column index mapping (0-based):
  0 = Item Name   (string)
  1 = Price       (plain number, no ₹)
  2 = Quantity    (plain integer)
  3 = Amount      (plain number, no ₹ — for cross-check only)

MANDATORY cross-check: Price × Qty must equal Amount.
  If mismatch: Qty = round(Amount ÷ Price).

FOOTER ROWS — 2 cells (first has colspan=3, second has "₹ <value>"):
  Strip "₹ " prefix then parseFloat (values may be decimal).
  Base Price Total           | ₹ <number>
  (+) GST on food            | ₹ <number>   ← may be decimal e.g. 9.9
  (+) Delivery Charge        | ₹ <number>   ← may be decimal e.g. 25.42
  (+) GST on Delivery Charge | ₹ <number>
  (+) Gateway Platform Fees  | ₹ <number>
  (-) Discount               | ₹ <number>
  Order Total                | ₹ <number>   ← USE as totalAmount
  (-) Paid Online            | ₹ <number>
  BALANCE TO PAY             | ₹ <number>

- totalAmount   : "Order Total" value → strip "₹ " → parseFloat.
- deliveryCharge: "(+) Delivery Charge" value → strip "₹ " → parseFloat.
- tax           : "(+) GST on food" value → strip "₹ " → parseFloat.

═══════════════════════════════════════════════════════════════════
ITEM DESCRIPTION TABLE — IGNORE COMPLETELY
═══════════════════════════════════════════════════════════════════
Appears BELOW the items table under the heading "Item Description:".
Header: ["Item Name", "Description"]  ← exactly 2 columns
Data:   ["Masala Dosa", "1 Dosa + Sambhar + Chutney"]  ← serving info
NEVER extract items, names, or quantities from this table.
Detection: skip any table whose header row has exactly 2 cells where
           cell[0].toLowerCase()==="item name" && cell[1].toLowerCase()==="description"

═══════════════════════════════════════════════════════════════════
EXPECTED PARSE OUTPUT for ZO36317062087957
═══════════════════════════════════════════════════════════════════
  orderNo       : "ZO36317062087957"
  paymentType   : "Prepaid"
  customerName  : "Ram Prakash"
  contactNo     : "7993415001"
  trainInfo     : "22916"
  coach         : "B5/68"
  deliveryDate  : "2026-06-03"
  deliveryTime  : "09:51"
  items         : [{ name:"Masala Dosa", price:99, qty:2 }]
  totalAmount   : 258`;

module.exports = { matchers, type, rule, domConfig };
