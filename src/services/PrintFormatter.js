// printFormatter.js
// Order ko "receipt ops" me badalta hai. Same ops:
//   - PrintPreviewModal me preview dikhane ke liye use hote hain
//   - print-bridge ko bheje jate hain (wahan ESC/POS bytes ban jate hain)
//
// Paper width ka koi logic nahi, printer me jo paper laga hai usi par print hoga.
//
// NOTE: order ke field names yahan tolerant rakhe hain (orderNo/trainInfo/items...).
// Dashboard me integrate karte waqt apne actual order fields ke hisaab se `pick(...)` lists adjust karenge.

const pick = (obj, keys, fallback = '') => {
  for (const k of keys) {
    const v = obj && obj[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return fallback;
};

const text = (t, opts = {}) => ({ t: 'text', text: String(t), ...opts });
const kv = (label, value) => (value === '' ? null : text(`${label}: ${value}`));

function formatItems(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  const ops = [];
  items.forEach((it) => {
    const name = pick(it, ['name', 'itemName', 'title'], 'Item');
    const qty = pick(it, ['qty', 'quantity'], 1);
    const price = pick(it, ['price', 'rate', 'amount'], '');
    ops.push(text(`${name}  x ${qty}${price !== '' ? `  - Rs.${price}` : ''}`));
  });
  return ops;
}

export function formatOrderReceipt(order = {}, options = {}) {
  const { title = 'ORDER', cut = true } = options;

  const orderNo = pick(order, ['orderNo', 'orderNumber', 'orderId', 'id']);
  const total = pick(order, ['total', 'totalAmount', 'amount', 'grandTotal']);

  const ops = [
    text(title, { align: 'center', bold: true, size: 2 }),
    orderNo !== '' ? text(`#${orderNo}`, { align: 'center', bold: true }) : null,
    { t: 'sep' },
    kv('Train', pick(order, ['trainInfo', 'train', 'trainNo'])),
    kv('Station', pick(order, ['station', 'deliveryStation', 'outlet'])),
    kv('Date', pick(order, ['deliveryDate', 'date'])),
    kv('Coach/Seat', pick(order, ['seat', 'coachSeat', 'coach'])),
    kv('PNR', pick(order, ['pnr'])),
    kv('Name', pick(order, ['customerName', 'passengerName', 'name'])),
    kv('Mobile', pick(order, ['mobile', 'phone', 'customerMobile'])),
    { t: 'sep' },
    ...formatItems(order),
    { t: 'sep' },
    total !== '' ? text(`TOTAL: Rs.${total}`, { bold: true, align: 'right' }) : null,
    kv('Payment', pick(order, ['paymentMode', 'payment', 'paymentType'])),
    kv('Note', pick(order, ['remarks', 'notes', 'note'])),
    { t: 'feed', n: 2 },
    cut ? { t: 'cut' } : null,
  ];

  return ops.filter(Boolean);
}

// Settings se "Test Print" ke liye (preview me bhi dikhta hai)
export function formatTestReceipt() {
  return [
    text('PRINTER TEST', { align: 'center', bold: true, size: 2 }),
    { t: 'sep' },
    text('Print connected', { align: 'center' }),
    text(new Date().toLocaleString('en-IN'), { align: 'center' }),
    { t: 'sep' },
    { t: 'feed', n: 2 },
    { t: 'cut' },
  ];
}

// Preview modal ke liye: ops -> displayable lines
export function receiptToPreviewLines(receipt = []) {
  return receipt
    .map((op) => {
      if (op.t === 'text') {
        return { text: op.text, align: op.align || 'left', bold: !!op.bold, big: op.size === 2 };
      }
      if (op.t === 'sep') {
        return { text: '-'.repeat(32), align: 'center', bold: false, big: false };
      }
      if (op.t === 'feed') {
        return { text: ' ', align: 'left', bold: false, big: false };
      }
      return null;
    })
    .filter(Boolean);
}
