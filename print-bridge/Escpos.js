// escpos.js
// Receipt ops (JSON) -> ESC/POS bytes.
//
// Paper width ki zarurat nahi: printer me jo paper laga hai usi par print hota hai.
// Is liye yahan koi column/width logic nahi hai, sirf align / bold / size / feed / cut.
//
// Receipt format (frontend printFormatter.js bhi yahi banata hai):
//   { t: 'text', text: 'abc', align: 'left'|'center'|'right', bold: true|false, size: 1|2 }
//   { t: 'sep' }                -> centered dashed line
//   { t: 'qr', data: 'upi://...', size: 6 } -> QR code (printer ka native QR command)
//   { t: 'feed', n: 3 }         -> n blank lines
//   { t: 'cut' }                -> paper cut (jo printers support nahi karte unpe ignore hota hai)

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

const ALIGN = { left: 0, center: 1, right: 2 };
const SEPARATOR = '-'.repeat(32);

// ESC/POS ke default codepage me Hindi/Unicode print nahi hota,
// isliye text ko safe ASCII me convert karte hain.
function sanitize(text) {
  return String(text == null ? '' : text)
    .replace(/\u20B9/g, 'Rs.')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\r/g, '')
    .replace(/[^\x20-\x7E\n]/g, '?');
}

function buildReceipt(receipt) {
  if (!Array.isArray(receipt) || receipt.length === 0) {
    throw new Error('receipt khali hai');
  }

  const chunks = [];
  const push = (...bytes) => chunks.push(Buffer.from(bytes));

  push(ESC, 0x40); // initialize printer

  for (const op of receipt) {
    if (!op || typeof op !== 'object') continue;

    switch (op.t) {
      case 'text': {
        push(ESC, 0x61, ALIGN[op.align] ?? 0);
        push(ESC, 0x45, op.bold ? 1 : 0);
        push(GS, 0x21, op.size === 2 ? 0x11 : 0x00);
        chunks.push(Buffer.from(sanitize(op.text), 'latin1'));
        push(LF);
        // reset
        push(ESC, 0x45, 0);
        push(GS, 0x21, 0x00);
        break;
      }
      case 'sep': {
        push(ESC, 0x61, 1);
        chunks.push(Buffer.from(SEPARATOR, 'latin1'));
        push(LF);
        break;
      }
      case 'qr': {
        const data = Buffer.from(sanitize(op.data), 'latin1');
        if (data.length === 0 || data.length > 700) break;
        const size = Math.min(Math.max(parseInt(op.size, 10) || 6, 1), 16);
        const len = data.length + 3;
        push(ESC, 0x61, 1); // center
        push(GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00); // QR model 2
        push(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, size); // module size
        push(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31); // error correction M
        push(GS, 0x28, 0x6b, len & 0xff, (len >> 8) & 0xff, 0x31, 0x50, 0x30); // store data
        chunks.push(data);
        push(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30); // print
        push(LF);
        break;
      }
      case 'feed': {
        const n = Math.min(Math.max(parseInt(op.n, 10) || 1, 1), 20);
        push(ESC, 0x64, n);
        break;
      }
      case 'cut': {
        push(ESC, 0x64, 3); // thoda paper aage
        push(GS, 0x56, 0x42, 0x00); // partial cut
        break;
      }
      default:
        break;
    }
  }

  push(ESC, 0x61, 0); // align left reset
  return Buffer.concat(chunks);
}
module.exports = { buildReceipt, sanitize }
