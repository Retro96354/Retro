// services/PrintFormatter.js
// Order -> "receipt ops". Layout purane browser/HTML receipt (DashboardScreen.printViaBrowser) jaisa hi hai.
//
// Purane ops: text, sep, feed, cut
// NAYE ops (print-bridge ke Escpos.js me support chahiye):
//   { t:'row',    left, right, bold?, size? }     -> left label + right value, ek hi line me
//   { t:'box',    text, size? }                   -> border wala box, text center (COD / ONLINE)
//   { t:'boxrow', cells:[a, b] }                  -> border wala 2-cell box (train | coach/seat)
//   { t:'qr',     data, size? }                   -> native ESC/POS QR, center

const pick = (obj, keys, fallback = '') => {
  for (const k of keys) {
    const v = obj && obj[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return fallback;
};

const text  = (t, opts = {}) => ({ t: 'text', text: String(t), ...opts });
const row   = (left, right, opts = {}) => ({ t: 'row', left: String(left), right: String(right), ...opts });
const sep   = () => ({ t: 'sep' });

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

  // ── payment ──
  const rawPayType = String(order.paymentType || 'ONLINE').toUpperCase().replace(/\s+/g, '_');
  const isCOD = COD_TYPES.includes(rawPayType);
  const paymentLabel = isCOD ? 'COD' : 'ONLINE';
  const totalAmount = order.totalAmount || 0;
  const amountToCollect = isCOD ? totalAmount : 0;

  // ── train / coach ──
  const trainNo = extractTrainNo(order.trainInfo);
  const coachSeat = `${order.coach || '-'}/${order.seat || '-'}`;

  // ── UPI QR: sirf COD + paymentId ho tabhi ──
  const showQr = !!paymentId && isCOD;
  const upiUrl = `upi://pay?pa=${paymentId}&pn=${order.vendorName || 'Vendor'}&am=${amountToCollect}&cu=INR`;

  const remark = order.remark && String(order.remark).trim() !== '' ? String(order.remark).trim() : '';

  const ops = [
    // Restaurant / business name
    text(businessName || 'E-Catering Orders', { align: 'center', bold: true, size: 2 }),
    sep(),

    // Details
    row('Order No.', order.orderNo || order.pnr || 'N/A'),
    row('Vendor',    order.vendorName || 'N/A'),
    row('Date',      fmtDate(order.deliveryDate)),
    row('Time',      order.deliveryTime || fmtNowTime()),
    row('Customer',  order.customerName || 'Customer'),
    row('Mobile',    order.contactNo || 'N/A'),
    sep(),

    // Items
    row('Item', 'Qty', { bold: true }),
    sep(),
    ...(Array.isArray(order.items) ? order.items : []).map((it) =>
      row(pick(it, ['name', 'itemName', 'title'], 'Item'), pick(it, ['quantity', 'qty'], 1))
    ),
    sep(),

    // Totals
    row('Remarks:', remark),
    row('Total:', `Rs. ${totalAmount}`, { bold: true }),
    row('Amount to collect:', `Rs. ${amountToCollect}`, { bold: true }),

    // COD / ONLINE box + train box
    { t: 'feed', n: 1 },
    { t: 'box', text: paymentLabel, size: 2 },
    { t: 'boxrow', cells: [trainNo, coachSeat] },
  ];

  if (showQr) {
    ops.push(
      { t: 'feed', n: 1 },
      { t: 'qr', data: upiUrl, size: 6 },
      text('Scan & Pay', { align: 'center', bold: true }),
      text(paymentId, { align: 'center' }),
    );
  }

  ops.push(
    { t: 'feed', n: 1 },
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

// Preview modal ke liye: ops -> displayable lines (32 char monospace)
const PW = 32;
const padRow = (l, r) => {
  const gap = Math.max(1, PW - l.length - r.length);
  return l + ' '.repeat(gap) + r;
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
      out.push({ text: ' ', align: 'left', bold: false, big: false });
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
