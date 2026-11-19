// services/PrintFormatter.js
// Order -> "receipt ops". Layout DashboardScreen.printViaBrowser (HTML receipt) ke hisaab se hai.
//
// Ops: text, sep, feed, cut, row, box, boxrow, qr, page
//   { t:'row',    left, right, bold?, size? }     -> left label + right value, ek hi line me
//   { t:'box',    text, size? }                   -> border wala box, text center (COD / ONLINE)
//   { t:'boxrow', cells:[a, b] }                  -> border wala 2-cell box (train | coach/seat)
//   { t:'qr',     data, size? }                   -> native ESC/POS QR, center
//   { t:'page',   marginLeft, printWidth }        -> GS L + GS W (dots), left/right margin

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
  if (TOP_PAD_LINES > 0) ops.push({ t: 'feed', n: TOP_PAD_LINES });

  ops.push(
    // Business name (browser: 18px, bold, center)
    text(name, { align: 'center', bold: true, size: nameSize }),
    gap(),

    // Details
    row('Order No.', order.orderNo || order.pnr || 'N/A'),
    row('Vendor',    order.vendorName || 'N/A'),
    row('Date',      fmtDate(order.deliveryDate)),
    row('Time',      order.deliveryTime || fmtNowTime()),
    row('Customer',  order.customerName || 'Customer'),
    row('Mobile',    order.contactNo || 'N/A'),
    gap(),

    // Items — dashed line sirf Item/Qty header ke upar-neeche (browser jaisa)
    sep(),
    row('Item', 'Qty', { bold: true }),
    sep(),
    ...(Array.isArray(order.items) ? order.items : []).map((it) =>
      row(pick(it, ['name', 'itemName', 'title'], 'Item'), pick(it, ['quantity', 'qty'], 1))
    ),
    gap(),

    // Totals
    row('Remarks:', remark),
    row('Total:', `Rs. ${totalAmount}`, { bold: true }),
    row('Amount to collect:', `Rs. ${amountToCollect}`, { bold: true }),

    // COD / ONLINE box + train box (dono ek dusre se juday hue)
    gap(),
    { t: 'box', text: spaced(paymentLabel), size: 2 },
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
      out.push({ text: padRow(op.left, op.right), align: 'left', bold: !!op.bold, big: false });
    } else if (op.t === 'sep') {
      out.push({ text: '-'.repeat(PW), align: 'center', bold: false, big: false });
    } else if (op.t === 'feed') {
      for (let i = 0; i < (op.n || 1); i++) {
        out.push({ text: ' ', align: 'left', bold: false, big: false });
      }
    } else if (op.t === 'box') {
      out.push({ text: '+' + '-'.repeat(PW - 2) + '+', align: 'center', bold: false, big: false });
      out.push({ text: op.text, align: 'center', bold: true, big: true });
      out.push({ text: '+' + '-'.repeat(PW - 2) + '+', align: 'center', bold: false, big: false });
    } else if (op.t === 'boxrow') {
      out.push({ text: `${op.cells[0]}  |  ${op.cells[1]}`, align: 'center', bold: true, big: false });
      out.push({ text: '+' + '-'.repeat(PW - 2) + '+', align: 'center', bold: false, big: false });
    } else if (op.t === 'qr') {
      out.push({ text: '[ UPI QR ]', align: 'center', bold: true, big: false });
    }
  });
  return out;
}
