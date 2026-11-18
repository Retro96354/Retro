// services/printerStore.js
// `printers` collection (Firestore) - frontend se seedha, payment ID / alert sound ki tarah.
// Security Firestore rules se: client sirf apne clientId ke printers padh/likh sakta hai.
//
// Document: printers/{id}
//   clientId, name, mode ('browser' | 'usb_silent' | 'network'),
//   ip, port, systemPrinterName, outletId, isDefault, active, fallbackToBrowser,
//   createdAt, updatedAt

import { collection, query, where, onSnapshot, deleteDoc, doc, writeBatch } from 'firebase/firestore';
import { db } from '../firebaseConfig';

const COL = 'printers';
const MODES = ['browser', 'usb_silent', 'network'];
const norm = (v) => String(v == null ? '' : v).trim().toLowerCase();

const isPrivateIp = (ip) => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(ip || '').trim());
  if (!m) return false;
  const [a, b, c, d] = m.slice(1).map(Number);
  if ([a, b, c, d].some((n) => n > 255)) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
};

// Form validate. Problem ho to message (string), sab theek ho to null.
export function validatePrinter(f) {
  if (!f || !String(f.name || '').trim()) return 'Printer ka naam daalein';
  if (!MODES.includes(f.mode)) return 'Printer ka type chuniye';
  if (f.mode === 'network') {
    if (!isPrivateIp(f.ip)) return 'Sahi local IP daalein (jaise 192.168.1.50)';
    const port = parseInt(f.port, 10);
    if (!(port >= 1 && port <= 65535)) return 'Port 1 se 65535 ke beech hona chahiye (aam taur par 9100)';
  }
  if (f.mode === 'usb_silent' && !String(f.systemPrinterName || '').trim()) {
    return 'Computer me installed printer chuniye';
  }
  return null;
}

// Live list. Unsubscribe function return karta hai.
export function subscribePrinters(clientId, onData, onError) {
  const q = query(collection(db, COL), where('clientId', '==', clientId));
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError,
  );
}

// Add (form.id khali) ya update (form.id ho). allPrinters = abhi ki list, default sambhalne ke liye.
export async function savePrinter(clientId, form, allPrinters = []) {
  const now = new Date().toISOString();
  const data = {
    clientId,
    name: String(form.name).trim().slice(0, 60),
    mode: form.mode,
    ip: form.mode === 'network' ? String(form.ip).trim() : '',
    port: form.mode === 'network' ? parseInt(form.port, 10) || 9100 : 9100,
    systemPrinterName: form.mode === 'usb_silent' ? String(form.systemPrinterName).trim() : '',
    outletId: String(form.outletId || '').trim(),
    isDefault: !!form.isDefault,
    fallbackToBrowser: form.fallbackToBrowser !== false,
    active: form.active !== false,
    updatedAt: now,
  };

  const batch = writeBatch(db);
  let ref;
  if (form.id) {
    ref = doc(db, COL, form.id);
    batch.update(ref, data);
  } else {
    ref = doc(collection(db, COL));
    batch.set(ref, { ...data, createdAt: now });
  }

  // Ek outlet ka ek hi default printer
  if (data.isDefault) {
    allPrinters.forEach((p) => {
      if (p.id !== ref.id && p.isDefault && norm(p.outletId) === norm(data.outletId)) {
        batch.update(doc(db, COL, p.id), { isDefault: false, updatedAt: now });
      }
    });
  }

  await batch.commit();
}

export async function removePrinter(id) {
  await deleteDoc(doc(db, COL, id));
}

// ---------- Auto-detect (bridge /discover) se add ----------
// found: { type: 'usb', name } ya { type: 'network', name, ip, port }

// Ye printer pehle se add hai?
export function isDiscoveredAdded(found, printers = []) {
  if (found.type === 'usb') {
    return printers.some((p) => p.mode === 'usb_silent' && p.systemPrinterName === found.name);
  }
  return printers.some((p) => p.mode === 'network' && p.ip === found.ip);
}

// Ek tap me add. Jo printer add hota hai wo default ban jata hai.
export async function addDiscoveredPrinter(clientId, found, allPrinters = []) {
  const form =
    found.type === 'usb'
      ? { mode: 'usb_silent', name: found.name, systemPrinterName: found.name }
      : { mode: 'network', name: found.name, ip: found.ip, port: found.port || 9100 };
  await savePrinter(
    clientId,
    { ...form, outletId: '', isDefault: true, fallbackToBrowser: true },
    allPrinters,
  );
}
