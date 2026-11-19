// escpos.js
// Receipt ops (JSON) -> ESC/POS bytes.
//
// Ops:
//   { t:'text', text, align, bold, size }   { t:'sep' }   { t:'feed', n }   { t:'cut' }
//   { t:'qr', data, size }                  -> native QR (GS ( k)
//   { t:'row', left, right, bold }          -> left label + right value, ek line me (lamba ho to wrap)
//   { t:'box', text, size }                 -> border + center text (COD / ONLINE)
//   { t:'boxrow', cells:[a,b] }             -> 2-cell box (train | coach/seat), box ke neeche judta hai
//   { t:'page', marginLeft, printWidth }    -> GS L + GS W (dots), left/right margin
//
// Row/box ke liye line width (chars) chahiye: 80mm = 48, 58mm = 32.
// config.json me "paperChars" se aata hai (default 48). 'page' op aaye to width uske hisaab se ghat jaati hai.

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

const ALIGN = { left: 0, center: 1, right: 2 };
const DEFAULT_CHARS = 48;
const DOT_PER_CHAR = 12; // Font A

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

const oneLine = (t) => sanitize(t).replace(/\n/g, ' ');

const center = (s, w) => {
  s = s.slice(0, w);
  const l = Math.floor((w - s.length) / 2);
  return ' '.repeat(l) + s + ' '.repeat(w - s.length - l);
};

// word-wrap, bahut lamba word ho to tod deta hai
function wrap(text, w) {
  const out = [];
  let line = '';
  for (let word of text.split(' ')) {
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
}

function rowLines(left, right, w) {
  left = oneLine(left);
  right = oneLine(right);
  if (!right) return wrap(left, w);
  if (left.length + right.length + 1 <= w) {
    return [left + ' '.repeat(w - left.length - right.length) + right];
  }
  if (right.length <= Math.floor(w * 0.4)) {
    // lamba label wrap hoga, value last line pe right me
    const parts = wrap(left, w - right.length - 1);
    const last = parts.pop();
    return [...parts, last + ' '.repeat(w - last.length - right.length) + right];
  }
  // lambi value (jaise Remarks): label ek line, value neeche right-aligned
  return [left, ...wrap(right, w).map((l) => ' '.repeat(w - l.length) + l)];
}

function buildReceipt(receipt, opts = {}) {
  if (!Array.isArray(receipt) || receipt.length === 0) {
    throw new Error('receipt khali hai');
  }

  let chars = parseInt(opts.chars, 10) || DEFAULT_CHARS;

  const chunks = [];
  const push = (...bytes) => chunks.push(Buffer.from(bytes));
  const line = (s) => { chunks.push(Buffer.from(s, 'latin1')); push(LF); };
  const style = (bold, big) => {
    push(ESC, 0x45, bold ? 1 : 0);
    push(GS, 0x21, big ? 0x11 : 0x00);
  };
  const reset = () => style(false, false);
  const border = () => '+' + '-'.repeat(chars - 2) + '+';

  push(ESC, 0x40); // initialize printer

  for (const op of receipt) {
    if (!op || typeof op !== 'object') continue;

    switch (op.t) {
      case 'text': {
        push(ESC, 0x61, ALIGN[op.align] ?? 0);
        style(op.bold, op.size === 2);
        line(sanitize(op.text));
        reset();
        break;
      }
      case 'sep': {
        push(ESC, 0x61, 1);
        line('-'.repeat(chars));
        break;
      }
      case 'row': {
        push(ESC, 0x61, 0);
        style(op.bold, false);
        for (const l of rowLines(op.left, op.right, chars)) line(l);
        reset();
        break;
      }
      case 'box': {
        const txt = oneLine(op.text);
        const big = op.size === 2 && txt.length <= Math.floor(chars / 2) - 2;
        const w = big ? Math.floor(chars / 2) : chars; // double size me ek char = 2 columns
        push(ESC, 0x61, 0);
        style(false, false);
        line(border());
        style(true, big);
        line('|' + center(txt, w - 2) + '|');
        reset();
        line(border());
        break;
      }
      case 'boxrow': {
        const cells = Array.isArray(op.cells) ? op.cells : [];
        const inner = chars - 3; // '|' + a + '|' + b + '|'
        const lw = Math.floor(inner / 2);
        const rw = inner - lw;
        push(ESC, 0x61, 0);
        style(true, false);
        line('|' + center(oneLine(cells[0]), lw) + '|' + center(oneLine(cells[1]), rw) + '|');
        reset();
        line(border());
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
      case 'page': {
        const ml = Math.max(0, parseInt(op.marginLeft, 10) || 0);
        const pw = Math.max(0, parseInt(op.printWidth, 10) || 0);
        push(GS, 0x4c, ml & 0xff, (ml >> 8) & 0xff); // GS L: left margin
        if (pw > 0) {
          push(GS, 0x57, pw & 0xff, (pw >> 8) & 0xff); // GS W: print area width
          chars = Math.floor(pw / DOT_PER_CHAR) & ~1; // even rakho
        }
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
        console.warn('[escpos] unknown op skip hua:', op.t);
        break;
    }
  }

  push(ESC, 0x61, 0); // align left reset
  return Buffer.concat(chunks);
}

module.exports = { buildReceipt, sanitize };
