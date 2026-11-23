// services/PrintFormatter.js
// Order -> "receipt ops". Layout DashboardScreen.printViaBrowser (HTML receipt) ke hisaab se hai.
//
// Ops: text, sep, feed, cut, row, box, boxrow, qr, page, spacing
//   { t:'row',     left, right, bold?, tall? }    -> left label + right value, ek hi line me (tall = double height)
//   { t:'box',     text, size?, join? }           -> border wala box, text center (COD / ONLINE). join = neeche boxrow se judega
//   { t:'boxrow',  cells:[a, b] }                 -> border wala 2-cell box (train | coach/seat)
//   { t:'qr',      data, size? }                  -> native ESC/POS QR, center
//   { t:'page',    marginLeft, printWidth }       -> GS L + GS W (dots), left/right margin
//   { t:'spacing', n }                            -> line spacing (dots) -> rows ke beech gap

// ─────────────────────────────────────────────────────────────────────────────
// Page setup — browser receipt ka size/margin yahin se control hota hai.
// Browser: @page 80mm, body 72mm, padding 10px (left) / 16px (right).
//   → 80mm printer pe: left margin ≈ 21 dots, right ≈ 34 dots.
// ─────────────────────────────────────────────────────────────────────────────
const PAPER_MM = 80; // 80 → 576 dots / 48 chars | 58 → 384 dots / 32 chars
const PAPER = PAPER_MM === 58 ? { chars: 32, dots: 384 } : { chars: 48, dots: 576 };

const MARGIN_LEFT_DOTS  = 21;   // ≈ padding-left 10px
const MARGIN_RIGHT_DOTS = 34;   // ≈ padding-right 16px
const USE_PAGE_MARGIN   = true; // escpos.js me 'page' handler hai
const TOP_PAD_LINES     = 1;    // ≈ padding-top 10px
const BOLD_ALL          = true; // browser body font-weight: 900 → poori receipt bold

// ── Spacing / size tuning ──
const LINE_SPACING = 40;    // dots (printer default ~30). Zyada = rows me zyada gap
const ITEM_TALL    = true;  // Item/Qty + items rows double-height (browser 15px jaisa)
const TOTAL_TALL   = true;  // Total / Amount to collect double-height
const DETAIL_TALL  = false; // Order No/Vendor/Date... (true karoge to ye bhi bade honge)

// Line width (chars). Margin on ho to bridge ki width ke barabar (even) rakhi hai.
const PW = USE_PAGE_MARGIN
  ? Math.floor((PAPER.dots - MARGIN_LEFT_DOTS - MARGIN_RIGHT_DOTS) / 12) & ~1
  : PAPER.chars;

const pick = (obj, keys, fallback = '') => {
  for (const k of keys) {
    const v = obj && obj[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return fallback;
};

const text = (t, opts = {}) => ({ t: 'text', text: String(t), bold: BOLD_ALL, ...opts });
const row  = (left, right, opts = {}) => ({ t: 'row', left: String(left), right: String(right), bold: BOLD_ALL, ...opts });
const sep  = () => ({ t: 'sep' });
const gap  = () => ({ t: 'feed', n: 1 }); // browser ke <hr> ka 7px+7px margin ≈ 1 line

// "COD" -> "C O D"  (browser payment-box ka letter-spacing: 4px)
const spaced = (s) => String(s).split('').join(' ');

// Dashboard ke extractTrainNo jaisa hi
export const extractTrainNo = (trainInfo) => {
  if (!trainInfo) return 'N/A';
  const match = String(trainInfo).match(/\d{3,5}/);
  return match ? match[0] : String(trainInfo);
};

const fmtDate = (v) => {
  try {
    const d = v ? (v.toDate ? v.toDate() : new Date(v)) : new Date();
    return d.toLocaleDateString('en-GB');
  } catch { return new Date().toLocaleDateString('en-GB'); }
};

const fmtNowTime = () =>
  new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });

const COD_TYPES = ['COD', 'CASH', 'CASH_ON_DELIVERY'];

export function formatOrderReceipt(order = {}, options = {}) {
  const { businessName = '', paymentId = '', cut = true } = options;

  // ── business name: lamba ho to normal size, warna double ──
  const name = businessName || 'E-Catering Orders';
  const nameSize = name.length > PW / 2 ? 1 : 2;

  // ── payment ──
  const rawPayType = String(order.paymentType || 'ONLINE').toUpperCase().replace(/\s+/g, '_');
  const isCOD = COD_TYPES.includes(rawPayType);
  const paymentLabel = isCOD ? 'COD' : 'ONLINE';
  const totalAmount = order.totalAmount || 0;
  const amountToCollect = isCOD ? totalAmount : 0;

  // ── train / coach ──
  const trainNo = extractTrainNo(order.trainInfo);
  const coachSeat = `${order.coach || '-'}/${order.seat || '-'}`;

  // ── UPI QR: sirf COD + paymentId ho tabhi (browser jaisa) ──
  const showQr = !!paymentId && isCOD;
  const upiUrl =
    `upi://pay?pa=${paymentId}&pn=${encodeURIComponent(order.vendorName || 'Vendor')}` +
    `&am=${amountToCollect}&cu=INR`;

  const remark = order.remark && String(order.remark).trim() !== '' ? String(order.remark).trim() : '';

  const ops = [];

  if (USE_PAGE_MARGIN) {
    ops.push({
      t: 'page',
      marginLeft: MARGIN_LEFT_DOTS,
      printWidth: PAPER.dots - MARGIN_LEFT_DOTS - MARGIN_RIGHT_DOTS,
    });
  }
  ops.push({ t: 'spacing', n: LINE_SPACING });
  if (TOP_PAD_LINES > 0) ops.push({ t: 'feed', n: TOP_PAD_LINES });

  ops.push(
    // Business name (browser: 18px, bold, center)
    text(name, { align: 'center', bold: true, size: nameSize }),
    gap(),

    // Details
    row('Order No.', order.orderNo || order.pnr || 'N/A', { tall: DETAIL_TALL }),
    row('Vendor',    order.vendorName || 'N/A',           { tall: DETAIL_TALL }),
    row('Date',      fmtDate(order.deliveryDate),         { tall: DETAIL_TALL }),
    row('Time',      order.deliveryTime || fmtNowTime(),  { tall: DETAIL_TALL }),
    row('Customer',  order.customerName || 'Customer',    { tall: DETAIL_TALL }),
    row('Mobile',    order.contactNo || 'N/A',            { tall: DETAIL_TALL }),
    gap(),

    // Items — dashed line sirf Item/Qty header ke upar-neeche (browser jaisa)
    sep(),
    row('Item', 'Qty', { bold: true, tall: ITEM_TALL }),
    sep(),
    ...(Array.isArray(order.items) ? order.items : []).map((it) =>
      row(
        pick(it, ['name', 'itemName', 'title'], 'Item'),
        pick(it, ['quantity', 'qty'], 1),
        { tall: ITEM_TALL }
      )
    ),
    gap(),

    // Totals
    row('Remarks:', remark, { tall: DETAIL_TALL }),
    row('Total:', `Rs. ${totalAmount}`, { bold: true, tall: TOTAL_TALL }),
    row('Amount to collect:', `Rs. ${amountToCollect}`, { bold: true, tall: TOTAL_TALL }),

    // COD / ONLINE box + train box (dono ek dusre se juday hue)
    gap(),
    { t: 'box', text: spaced(paymentLabel), size: 2, join: true },
    { t: 'boxrow', cells: [trainNo, coachSeat] },
  );

  if (showQr) {
    ops.push(
      gap(),
      { t: 'qr', data: upiUrl, size: 6 },
      text('Scan & Pay', { align: 'center', bold: true }),
      text(paymentId, { align: 'center' }),
    );
  }

  ops.push(
    gap(),
    text('www.imperiial.tech', { align: 'center' }),
    { t: 'feed', n: 3 },
  );
  if (cut) ops.push({ t: 'cut' });

  // NOTE: ops seedhe return hote hain (toTextOps nahi) taaki escpos.js
  // ke row/box/boxrow/page/spacing handlers chalein.
  return ops;
}

// Settings ka "Test Print"
export function formatTestReceipt() {
  return [
    text('PRINTER TEST', { align: 'center', bold: true, size: 2 }),
    sep(),
    text('Print connected', { align: 'center' }),
    text(new Date().toLocaleString('en-IN'), { align: 'center' }),
    sep(),
    { t: 'feed', n: 2 },
    { t: 'cut' },
  ];
}

// Preview modal ke liye: ops -> displayable lines (monospace)
const padRow = (l, r) => {
  const g = Math.max(1, PW - l.length - r.length);
  return l + ' '.repeat(g) + r;
};

export function receiptToPreviewLines(receipt = []) {
  const out = [];
  receipt.forEach((op) => {
    if (op.t === 'text') {
      out.push({ text: op.text, align: op.align || 'left', bold: !!op.bold, big: op.size === 2 });
    } else if (op.t === 'row') {
      out.push({ text: padRow(op.left, op.right), align: 'left', bold: !!op.bold, big: !!op.tall });
    } else if (op.t === 'sep') {
      out.push({ text: '-'.repeat(PW), align: 'center', bold: false, big: false });
    } else if (op.t === 'feed') {
      for (let i = 0; i < (op.n || 1); i++) {
        out.push({ text: ' ', align: 'left', bold: false, big: false });
      }
    } else if (op.t === 'box') {
      out.push({ text: '+' + '-'.repeat(PW - 2) + '+', align: 'center', bold: false, big: false });
      out.push({ text: op.text, align: 'center', bold: true, big: true });
      if (!op.join) {
        out.push({ text: '+' + '-'.repeat(PW - 2) + '+', align: 'center', bold: false, big: false });
      }
    } else if (op.t === 'boxrow') {
      out.push({ text: `${op.cells[0]}  |  ${op.cells[1]}`, align: 'center', bold: true, big: false });
      out.push({ text: '+' + '-'.repeat(PW - 2) + '+', align: 'center', bold: false, big: false });
    } else if (op.t === 'qr') {
      out.push({ text: '[ UPI QR ]', align: 'center', bold: true, big: false });
    }
  });
  return out;
}

// ── Purane bridge ke liye (optional): row/box/boxrow ko text lines me badalna ──
// Ab formatOrderReceipt ise use nahi karta. Agar kisi purane bridge ko
// support karna ho to: toTextOps(formatOrderReceipt(...)) call karo.
const LW = 46; // 48-col printer pe safe width

const wrapWords = (s, w) => {
  const out = [];
  let line = '';
  for (let word of String(s).split(' ')) {
    while (word.length > w) {
      if (line) { out.push(line); line = ''; }
      out.push(word.slice(0, w));
      word = word.slice(w);
    }
    if (!word) continue;
    if (!line) line = word;
    else if (line.length + 1 + word.length <= w) line += ' ' + word;
    else { out.push(line); line = word; }
  }
  out.push(line);
  return out;
};

const rowToLines = (l, r, w) => {
  l = String(l); r = String(r);
  if (!r) return wrapWords(l, w);
  if (l.length + r.length + 1 <= w) return [l + ' '.repeat(w - l.length - r.length) + r];
  if (r.length <= Math.floor(w * 0.4)) {
    const parts = wrapWords(l, w - r.length - 1);
    const last = parts.pop();
    return [...parts, last + ' '.repeat(w - last.length - r.length) + r];
  }
  return [l, ...wrapWords(r, w).map((x) => ' '.repeat(w - x.length) + x)];
};

const ctr = (s, w) => {
  s = String(s).slice(0, w);
  const l = Math.floor((w - s.length) / 2);
  return ' '.repeat(l) + s + ' '.repeat(w - s.length - l);
};

export function toTextOps(ops, w = LW) {
  const out = [];
  const T = (t, o = {}) => out.push({ t: 'text', text: t, align: 'left', bold: true, ...o });
  const border = '+' + '-'.repeat(w - 2) + '+';

  for (const op of ops) {
    switch (op.t) {
      case 'page':
      case 'spacing':
        break; // purane bridge me nahi chalta, skip
      case 'sep':
        T('-'.repeat(w), { bold: false });
        break;
      case 'row':
        rowToLines(op.left, op.right, w).forEach((l) => T(l, { bold: !!op.bold }));
        break;
      case 'box': {
        const hw = Math.floor(w / 2); // double size me 1 char = 2 columns
        T(border, { bold: false });
        T('|' + ctr(op.text, hw - 2) + '|', { size: 2 });
        T(border, { bold: false });
        break;
      }
      case 'boxrow': {
        const inner = w - 3;
        const lw = Math.floor(inner / 2);
        const rw = inner - lw;
        T('|' + ctr(op.cells[0], lw) + '|' + ctr(op.cells[1], rw) + '|');
        T(border, { bold: false });
        break;
      }
      default:
        out.push(op); // text, feed, qr, cut jaise ke taise
    }
  }
  return out;
}
