import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, ScrollView, Platform, Dimensions, Image, Switch
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { Audio } from 'expo-av';
import { db } from '../firebaseConfig';
import * as wa from '../services/Whatsappapi';
import { subscribePrinters, savePrinter, removePrinter, validatePrinter, addDiscoveredPrinter, isDiscoveredAdded } from '../services/PrinterStore'; 
import { checkBridge, listSystemPrinters, testPrinter, discoverPrinters } from '../services/PrintService'; 

const SOUND_OPTIONS = [
  { name: 'Classic Bell', icon: 'notifications-outline', url: 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3' },
  { name: 'Soft Chime', icon: 'musical-notes-outline', url: 'https://assets.mixkit.co/active_storage/sfx/2875/2875-preview.mp3' },
  { name: 'Digital Alert', icon: 'pulse-outline', url: 'https://assets.mixkit.co/active_storage/sfx/2870/2870-preview.mp3' },
  { name: 'Notification Tone', icon: 'volume-medium-outline', url: 'https://assets.mixkit.co/active_storage/sfx/2872/2872-preview.mp3' },
];

const PRINT_BRIDGE_URL = 'https://drive.google.com/file/d/1915o9N0a904ZGvZFQwfyfsnMzgFPaVta/view?usp=sharing';  // PrintBridge-Setup.exe ka link

const PRINTER_MODES = [
  { key: 'network', label: 'WiFi printer' },
  { key: 'usb_silent', label: 'USB (direct print)' },
  { key: 'browser', label: 'Browser print' },
];
const PRINTER_MODE_LABEL = { network: 'WIFI', usb_silent: 'USB', browser: 'BROWSER' };
const blankPrinter = () => ({
  id: '', name: '', mode: 'network', ip: '', port: '9100',
  systemPrinterName: '', outletId: '', isDefault: false, fallbackToBrowser: true,
});

// Build a QR code image URL from Google Charts API (no extra dependency needed)
const getQRUrl = (text) =>
  `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(text)}&color=0f172a&bgcolor=ffffff&qzone=2`;

// ── Auto messages: default / merge helpers ───────────────────────────────────
const blankBlock = (extra = {}) => ({
  enabled: false, templateName: '', language: '', variables: [],
  allVendors: true, vendors: [], headerUrl: '', headerFilename: '', ...extra,
});
const defaultAuto = () => ({
  enabled: false,
  print: blankBlock(),
  review: blankBlock({ allVendors: false, delayMinutes: '120', goodUrl: '', goodText: '', badText: '' }),
});
function mergeAuto(saved) {
  const d = defaultAuto();
  if (!saved) return d;
  const print = { ...d.print, ...(saved.print || {}) };
  const review = { ...d.review, ...(saved.review || {}) };
  review.delayMinutes = String(review.delayMinutes || 120);
  return { enabled: !!saved.enabled, print, review };
}
const DELAY_PRESETS = [30, 60, 120, 180];
const MAX_WATCH = 4;
const normNum = (n) => String(n || '').replace(/\D/g, '');

function useScreenWidth() {
  const [width, setWidth] = useState(Dimensions.get('window').width);
  useEffect(() => {
    const sub = Dimensions.addEventListener('change', ({ window }) => setWidth(window.width));
    return () => sub?.remove?.();
  }, []);
  return width;
}

export default function ClientSettingsScreen({ clientId, clientEmail, onNavigate }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Payment state
  const [paymentId, setPaymentId] = useState('');
  const [savedPaymentId, setSavedPaymentId] = useState(''); // what's committed in DB
  const [editingPayment, setEditingPayment] = useState(false);

  // Sound state
  const [selectedSound, setSelectedSound] = useState(SOUND_OPTIONS[0].url);
  const [playingSound, setPlayingSound] = useState(null);

  // WhatsApp state
  // Token kabhi Firestore mein seedha nahi likha jata — backend ke through
  // jata hai jo use encrypt karke save karta hai. Yahan sirf form state hai,
  // save ke turant baad clear ho jati hai.
  const [waLoading, setWaLoading] = useState(true);
  const [waError, setWaError] = useState('');
  const [waStatus, setWaStatus] = useState(null);
  const [waEditing, setWaEditing] = useState(false);
  const [waSaving, setWaSaving] = useState(false);
  const [waDisconnecting, setWaDisconnecting] = useState(false);
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [watchList, setWatchList] = useState(['']);     // sirf naye numbers ka input
  const [savedWatch, setSavedWatch] = useState([]);     // DB me saved numbers
  const [savingWatch, setSavingWatch] = useState(false);

  // Auto messages state
  const [auto, setAuto] = useState(defaultAuto());
  const [templates, setTemplates] = useState([]);       // approved + analyzed
  const [vendorList, setVendorList] = useState([]);
  const [autoMetaError, setAutoMetaError] = useState('');
  const [openPicker, setOpenPicker] = useState(null);   // 'print' | 'review' | null
  const [savingAuto, setSavingAuto] = useState(false);

  // Printers state
  const [printers, setPrinters] = useState([]);
  const [bridgeOnline, setBridgeOnline] = useState(null); // null = check ho raha hai
  const [printerForm, setPrinterForm] = useState(null);   // null = form band
  const [printerSaving, setPrinterSaving] = useState(false);
  const [testingId, setTestingId] = useState('');
  const [systemPrinters, setSystemPrinters] = useState([]);
  const [sysOpen, setSysOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [found, setFound] = useState(null);   // null = abhi search nahi hua
  const [addingKey, setAddingKey] = useState('');

  const screenWidth = useScreenWidth();
  const isWide = screenWidth >= 768;

  useEffect(() => {
    if (!clientId) return;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'clients', clientId));
        if (snap.exists()) {
          const data = snap.data();
          const pid = data.paymentId || '';
          setPaymentId(pid);
          setSavedPaymentId(pid);
          setEditingPayment(!pid); // auto-open editor if no ID yet
          setSelectedSound(data.alertSound || SOUND_OPTIONS[0].url);
        }
      } catch (e) {
        console.error('ClientSettingsScreen load error:', e.message);
      }
      setLoading(false);
    })();
  }, [clientId]);

  /* ── Auto messages: templates + vendors load ──
     IMPORTANT: Ye function refreshWa se PEHLE define hona chahiye (aur
     `if (loading) return` se bhi pehle), warna pehle render me useEffect
     isse call karta hai aur "Cannot access before initialization" aata hai. */
  const loadAutoMeta = async () => {
    setAutoMetaError('');
    try {
      const list = await wa.getTemplates();
      setTemplates(list.filter((t) => t.status === 'APPROVED').map((t) => wa.analyzeTemplate(t, { allowMediaHeader: true })));
    } catch (e) {
      setAutoMetaError(e.message);
    }
    try {
      setVendorList(await wa.getVendors());
    } catch (e) {}
  };

  /* ── WhatsApp: status load ── */
  const refreshWa = async () => {
    setWaLoading(true);
    try {
      const st = await wa.getStatus();
      setWaStatus(st);
      setWaError('');
      setWaEditing(!st.connected); // connect nahi hai to form khud khul jaye
      const nums = (st.watchNumbers || []).filter(Boolean);
      setSavedWatch(nums);
      setWatchList(['']);
      if (st.connected) {
        setAuto(mergeAuto(st.autoMessages));
        loadAutoMeta();
      }
    } catch (e) {
      setWaError(e.message);
    }
    setWaLoading(false);
  };

  useEffect(() => {
    if (!clientId) return;
    refreshWa();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  useEffect(() => {
    if (!clientId) return;
    const unsub = subscribePrinters(clientId, setPrinters, (e) => console.error('printers load error:', e.message));
    checkBridge().then(setBridgeOnline);
    return () => unsub();
  }, [clientId]);

  /* ── WhatsApp: connect / update ── */
  const handleConnectWhatsApp = async () => {
    const pid = phoneNumberId.trim();
    const wid = wabaId.trim();
    const tok = accessToken.trim();
    if (!pid || !wid || !tok) {
      wa.notify('Missing Fields', 'Phone Number ID, WABA ID aur Access Token teeno bharna zaroori hai');
      return;
    }
    if (!/^\d{8,20}$/.test(pid)) {
      wa.notify('Phone Number ID galat hai', 'Ye sirf digits hota hai (aapka mobile number nahi). Meta → WhatsApp → API Setup page se copy karein.');
      return;
    }
    if (!/^\d{8,20}$/.test(wid)) {
      wa.notify('WABA ID galat hai', 'WhatsApp Business Account ID sirf digits hota hai.');
      return;
    }
    if (tok.length < 40 || /\s/.test(tok)) {
      wa.notify('Access Token galat lag raha hai', 'Token lamba hota hai aur usme space nahi hoti. Poora copy karke paste karein.');
      return;
    }
    setWaSaving(true);
    try {
      const r = await wa.connectWhatsApp({ phoneNumberId: pid, wabaId: wid, accessToken: tok });
      // Token ko memory se turant hata do
      setAccessToken('');
      setShowToken(false);
      setPhoneNumberId('');
      setWabaId('');
      await refreshWa();
      if (r && r.webhookSubscribed === false) {
        wa.notify(
          '✓ Connected, par ek warning',
          'Messages bhej sakte hain, lekin incoming messages abhi nahi aayenge. Token mein "whatsapp_business_management" permission check karke dobara connect karein.'
        );
      } else {
        wa.notify('✓ WhatsApp Connected', `${r?.displayNumber || 'Aapka number'} connect ho gaya hai.`);
      }
    } catch (e) {
      wa.notify('Connect nahi hua', e.message);
    }
    setWaSaving(false);
  };

  /* ── WhatsApp: disconnect ── */
  const handleDisconnectWhatsApp = async () => {
    const ok = await wa.confirmAsync(
      'WhatsApp Disconnect karein?',
      'Saved token delete ho jayega aur messages bhejna band ho jayega. Dobara connect karne ke liye token phir se daalna padega.',
      'Disconnect'
    );
    if (!ok) return;
    setWaDisconnecting(true);
    try {
      await wa.disconnectWhatsApp();
      await refreshWa();
    } catch (e) {
      wa.notify('Error', e.message);
    }
    setWaDisconnecting(false);
  };

  /* ── WhatsApp: watch numbers ── */
  const remainingSlots = MAX_WATCH - savedWatch.length;

  const updateWatch = (i, v) => setWatchList((p) => p.map((x, idx) => (idx === i ? v : x)));
  const removeWatch = (i) =>
    setWatchList((p) => {
      const next = p.filter((_, idx) => idx !== i);
      return next.length ? next : [''];
    });
  const addWatch = () => setWatchList((p) => (p.length < remainingSlots ? [...p, ''] : p));

  const persistWatch = async (nums) => {
    const r = await wa.saveWatchNumbers(nums);
    setSavedWatch((r?.watchNumbers || nums).filter(Boolean));
    setWatchList(['']); // input field blank
  };

  const handleSaveWatch = async () => {
    const newNums = watchList.map((n) => n.trim()).filter(Boolean);
    if (!newNums.length) {
      wa.notify('Number khali hai', 'Pehle koi number daalein');
      return;
    }
    if (newNums.some((n) => normNum(n).length < 10)) {
      wa.notify('Number galat hai', 'Har number kam se kam 10 digit ka hona chahiye');
      return;
    }
    const merged = [...savedWatch];
    newNums.forEach((n) => {
      if (!merged.some((m) => normNum(m) === normNum(n))) merged.push(n);
    });
    if (merged.length > MAX_WATCH) {
      wa.notify('Limit poori', 'Maximum 4 numbers hi ho sakte hain');
      return;
    }
    setSavingWatch(true);
    try {
      await persistWatch(merged);
      wa.notify('✓ Saved', 'In numbers ke messages ab aapko dikhenge.');
    } catch (e) {
      wa.notify('Error', e.message);
    }
    setSavingWatch(false);
  };

  const handleRemoveSavedWatch = async (num) => {
    const ok = await wa.confirmAsync('Number hatayein?', `${num} ke messages ab save nahi honge.`, 'Hatayein');
    if (!ok) return;
    setSavingWatch(true);
    try {
      await persistWatch(savedWatch.filter((n) => n !== num));
    } catch (e) {
      wa.notify('Error', e.message);
    }
    setSavingWatch(false);
  };

  /* ── Payment ID save / update ── */
  const handleSavePaymentId = async () => {
    const trimmed = paymentId.trim();
    if (!trimmed) {
      wa.notify('Empty ID', 'Please enter a UPI ID before saving');
      return;
    }
    setSaving(true);
    try {
      await updateDoc(doc(db, 'clients', clientId), { paymentId: trimmed });
      setSavedPaymentId(trimmed);
      setPaymentId(trimmed);
      setEditingPayment(false);
      wa.notify('✓ Saved', 'Payment ID saved. QR code is now visible below.');
    } catch (e) {
      wa.notify('Error', e.message);
    }
    setSaving(false);
  };

  /* ── Payment ID remove ── */
  const handleRemovePaymentId = async () => {
    const ok = await wa.confirmAsync(
      'Remove Payment ID',
      'This will delete your UPI ID and QR code from bills. Continue?',
      'Remove'
    );
    if (!ok) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'clients', clientId), { paymentId: '' });
      setSavedPaymentId('');
      setPaymentId('');
      setEditingPayment(true);
    } catch (e) {
      wa.notify('Error', e.message);
    }
    setSaving(false);
  };

  /* ── Cancel edit ── */
  const handleCancelEdit = () => {
    setPaymentId(savedPaymentId);
    setEditingPayment(false);
  };

  /* ── Sound ── */
  const handleSoundSelect = async (opt) => {
    setSelectedSound(opt.url);
    setPlayingSound(opt.url);
    try {
      if (Platform.OS === 'web') {
        const a = new window.Audio(opt.url);
        a.volume = 0.5;
        a.play().catch(() => {});
        setTimeout(() => setPlayingSound(null), 2000);
      } else {
        const { sound } = await Audio.Sound.createAsync({ uri: opt.url });
        await sound.setVolumeAsync(0.5);
        await sound.playAsync();
        setTimeout(() => setPlayingSound(null), 2000);
      }
    } catch (e) {}
    try {
      await updateDoc(doc(db, 'clients', clientId), { alertSound: opt.url });
    } catch (e) {}
  };

  /* ── Auto messages: helpers (early return se pehle) ── */
  const setBlock = (key, patch) =>
    setAuto((p) => ({ ...p, [key]: { ...p[key], ...patch } }));

  const pickTemplate = (key, t) => {
    setBlock(key, {
      templateName: t.name,
      language: t.language,
      variables: t.varNums.map(() => ''),
    });
    setOpenPicker(null);
  };

  const setVar = (key, i, v) =>
    setAuto((p) => {
      const vars = [...p[key].variables];
      vars[i] = v;
      return { ...p, [key]: { ...p[key], variables: vars } };
    });

  const addVarToken = (key, i, tokenKey) =>
    setAuto((p) => {
      const vars = [...p[key].variables];
      const cur = (vars[i] || '').trim();
      vars[i] = cur ? `${cur} {{${tokenKey}}}` : `{{${tokenKey}}}`;
      return { ...p, [key]: { ...p[key], variables: vars } };
    });

  const toggleVendor = (key, name) =>
    setAuto((p) => {
      const cur = p[key].vendors;
      const next = cur.includes(name) ? cur.filter((x) => x !== name) : [...cur, name];
      return { ...p, [key]: { ...p[key], vendors: next } };
    });

  const validateBlock = (key, label) => {
    const b = auto[key];
    if (!b.enabled) return null;
    if (!b.templateName) return `${label}: template chuniye`;
    if (b.variables.some((v) => !String(v || '').trim())) return `${label}: har variable ke liye value chuniye`;
    const tplInfo = templates.find((t) => t.name === b.templateName && t.language === b.language);
    if (tplInfo && tplInfo.headerFormat) {
      const what = tplInfo.headerFormat === 'DOCUMENT' ? 'PDF' : 'photo';
      if (!/^https:\/\//.test((b.headerUrl || '').trim())) return `${label}: ${what} ka https link daalein`;
    }
    if (!b.allVendors && b.vendors.length === 0) return `${label}: kam se kam ek vendor chuniye ya "Sab vendors" on karein`;
    return null;
  };

  const handleSaveAuto = async () => {
    const problem = validateBlock('print', 'Print message') || validateBlock('review', 'Review message');
    if (problem) {
      wa.notify('Adhoori jaankari', problem);
      return;
    }
    const r = auto.review;
    if (r.enabled) {
      const mins = parseInt(r.delayMinutes, 10);
      if (!mins || mins < 1 || mins > 1440) {
        wa.notify('Time galat hai', 'Review kitni der baad jayega ye 1 se 1440 minute ke beech daalein');
        return;
      }
    }
    setSavingAuto(true);
    try {
      const payload = {
        enabled: auto.enabled,
        print: {
          enabled: auto.print.enabled,
          templateName: auto.print.templateName,
          language: auto.print.language,
          variables: auto.print.variables,
          allVendors: auto.print.allVendors,
          vendors: auto.print.vendors,
          headerUrl: auto.print.headerUrl,
          headerFilename: auto.print.headerFilename,
        },
        review: {
          enabled: r.enabled,
          templateName: r.templateName,
          language: r.language,
          variables: r.variables,
          allVendors: r.allVendors,
          vendors: r.vendors,
          headerUrl: r.headerUrl,
          headerFilename: r.headerFilename,
          delayMinutes: parseInt(r.delayMinutes, 10) || 120,
          goodUrl: r.goodUrl,
          goodText: r.goodText,
          badText: r.badText,
        },
      };
      const saved = await wa.saveAutoMessages(payload);
      setAuto(mergeAuto(saved));
      wa.notify('✓ Saved', saved.enabled
        ? 'Auto messages chalu hain. Ab order print karte hi ye apne aap chalenge.'
        : 'Settings save ho gayi, par abhi upar ka master switch band hai.');
    } catch (e) {
      wa.notify('Save nahi hua', e.message);
    }
    setSavingAuto(false);
  };

    /* ── Printers ── */
  const refreshBridge = async () => {
    setBridgeOnline(null);
    setBridgeOnline(await checkBridge());
  };

  const openPrinterForm = (p) => {
    setPrinterForm(p ? { ...blankPrinter(), ...p, port: String(p.port || 9100) } : blankPrinter());
    setSysOpen(false);
  };

  const loadSystemPrinters = async () => {
    try {
      setSystemPrinters(await listSystemPrinters());
    } catch (e) {
      setSystemPrinters([]);
      wa.notify('Bridge nahi mila', e.message);
    }
  };

  const handleSavePrinter = async () => {
    const problem = validatePrinter(printerForm);
    if (problem) { wa.notify('Adhoori jaankari', problem); return; }
    setPrinterSaving(true);
    try {
      await savePrinter(clientId, printerForm, printers);
      setPrinterForm(null);
    } catch (e) {
      wa.notify('Save nahi hua', e.message);
    }
    setPrinterSaving(false);
  };

  const handleDeletePrinter = async (p) => {
    const ok = await wa.confirmAsync('Printer hatayein?', `"${p.name}" hata diya jayega.`, 'Hatayein');
    if (!ok) return;
    try { await removePrinter(p.id); } catch (e) { wa.notify('Error', e.message); }
  };

  const handleTestPrinter = async (p) => {
    setTestingId(p.id);
    const r = await testPrinter(p);
    setTestingId('');
    wa.notify(
      r.ok ? '✓ Test print bheja' : 'Test print fail',
      r.ok ? 'Printer se test slip nikalni chahiye.' : r.error
    );
  };

    const handleScanPrinters = async () => {
    setScanning(true);
    setFound(null);
    try {
      const r = await discoverPrinters();
      setFound(r);
      setBridgeOnline(true);
    } catch (e) {
      setBridgeOnline(false);
      wa.notify('Printer search nahi hua', e.message);
    }
    setScanning(false);
  };

  const handleAddFound = async (item, key) => {
    setAddingKey(key);
    try {
      await addDiscoveredPrinter(clientId, item, printers);
      wa.notify('✓ Printer add ho gaya', `"${item.name}" ab aapka default printer hai. "Test" dabake ek slip nikal ke check kar lein.`);
    } catch (e) {
      wa.notify('Add nahi hua', e.message);
    }
    setAddingKey('');
  };

  const handleDownloadBridge = () => {
    if (Platform.OS === 'web') window.open(PRINT_BRIDGE_URL, '_blank');
    else wa.notify('Computer se kholein', 'Print Bridge sirf Windows laptop/desktop par install hota hai. Dashboard ko computer ke browser me kholein.');
  };

  useEffect(() => {
    if (bridgeOnline !== false) return;
    const t = setInterval(async () => {
      if (await checkBridge()) setBridgeOnline(true);
    }, 4000);
    return () => clearInterval(t);
  }, [bridgeOnline]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#6366f1" />
        <Text style={styles.loadingText}>Loading settings...</Text>
      </View>
    );
  }

  /* ── QR Preview Section ──
     NOTE: Inner sections ko <Component /> ki jagah function ki tarah call
     kiya gaya hai (renderX()), warna har keystroke par TextInput dobara
     ban jata hai aur focus chala jata hai. */
  const renderQRSection = () => (
    <View style={styles.qrWrapper}>
      <View style={styles.qrBadgeRow}>
        <View style={styles.qrBadge}>
          <Ionicons name="flash" size={11} color="#16a34a" />
          <Text style={styles.qrBadgeText}>UPI</Text>
        </View>
        <Text style={styles.qrLabel}>Scan to Pay</Text>
      </View>

      <View style={styles.qrImageWrap}>
        <Image
          source={{ uri: getQRUrl(savedPaymentId) }}
          style={styles.qrImage}
          resizeMode="contain"
        />
      </View>

      <View style={styles.qrUpiRow}>
        <Ionicons name="wallet-outline" size={13} color="#64748b" />
        <Text style={styles.qrUpiText} numberOfLines={1}>{savedPaymentId}</Text>
      </View>

      <Text style={styles.qrNote}>
        This QR will appear on printed bills for instant customer payments.
      </Text>

      <View style={styles.qrActions}>
        <TouchableOpacity
          style={styles.qrEditBtn}
          onPress={() => {
            setPaymentId(savedPaymentId);
            setEditingPayment(true);
          }}
        >
          <Ionicons name="pencil-outline" size={13} color="#6366f1" />
          <Text style={styles.qrEditText}>Update ID</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.qrRemoveBtn}
          onPress={handleRemovePaymentId}
          disabled={saving}
        >
          {saving
            ? <ActivityIndicator size="small" color="#ef4444" />
            : <>
                <Ionicons name="trash-outline" size={13} color="#ef4444" />
                <Text style={styles.qrRemoveText}>Remove</Text>
              </>
          }
        </TouchableOpacity>
      </View>
    </View>
  );

  /* ── Payment Editor ── */
  const renderPaymentEditor = () => (
    <>
      <Text style={styles.fieldLabel}>UPI ID / Payment Address</Text>
      <View style={styles.inputWrapper}>
        <Ionicons name="wallet-outline" size={15} color="#94a3b8" style={styles.inputIcon} />
        <TextInput
          style={[styles.fieldInput, { paddingLeft: 36 }]}
          placeholder="e.g. name@upi or 98765@paytm"
          placeholderTextColor="#c7d0dc"
          value={paymentId}
          onChangeText={setPaymentId}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
        />
      </View>

      <View style={styles.hintBox}>
        <Ionicons name="information-circle-outline" size={14} color="#16a34a" style={{ marginTop: 1 }} />
        <Text style={styles.hintText}>
          This ID will appear as a scannable QR code on printed bills, so customers can pay instantly.
        </Text>
      </View>

      <View style={styles.paymentBtnRow}>
        {savedPaymentId ? (
          <TouchableOpacity
            style={[styles.btn, styles.btnOutline, { flex: 1 }]}
            onPress={handleCancelEdit}
          >
            <Ionicons name="close-outline" size={15} color="#64748b" style={{ marginRight: 4 }} />
            <Text style={styles.btnOutlineText}>Cancel</Text>
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity
          style={[styles.btn, styles.btnGreen, { flex: savedPaymentId ? 2 : 1 }, saving && styles.btnDisabled]}
          onPress={handleSavePaymentId}
          disabled={saving}
        >
          {saving
            ? <ActivityIndicator size="small" color="#fff" />
            : <>
                <Ionicons name="save-outline" size={15} color="#fff" style={{ marginRight: 6 }} />
                <Text style={styles.btnText}>{savedPaymentId ? 'Update Payment ID' : 'Save Payment ID'}</Text>
              </>
          }
        </TouchableOpacity>
      </View>
    </>
  );

  /* ── WhatsApp: connected status view ── */
  const renderWaStatus = () => {
    const tokenBad = waStatus.tokenValid === false;
    return (
      <View>
        <View style={styles.waPillRow}>
          <View style={[styles.waPill, tokenBad ? styles.waPillBad : styles.waPillOk]}>
            <Ionicons
              name={tokenBad ? 'alert-circle' : 'checkmark-circle'}
              size={13}
              color={tokenBad ? '#dc2626' : '#16a34a'}
            />
            <Text style={[styles.waPillText, { color: tokenBad ? '#dc2626' : '#15803d' }]}>
              {tokenBad ? 'Token expire / invalid' : 'Connected'}
            </Text>
          </View>
        </View>

        {tokenBad ? (
          <View style={styles.warnBox}>
            <Ionicons name="warning-outline" size={14} color="#b45309" style={{ marginTop: 1 }} />
            <Text style={styles.warnText}>
              Aapka WhatsApp token ab kaam nahi kar raha, isliye messages nahi ja rahe. Neeche "Token badlein" se
              naya (permanent) token daalein.
            </Text>
          </View>
        ) : null}

        <View style={styles.kvRow}>
          <Text style={styles.kvKey}>Number</Text>
          <Text style={styles.kvVal}>{waStatus.displayNumber || '—'}</Text>
        </View>
        <View style={styles.kvRow}>
          <Text style={styles.kvKey}>Business naam</Text>
          <Text style={styles.kvVal}>{waStatus.verifiedName || '—'}</Text>
        </View>
        <View style={styles.kvRow}>
          <Text style={styles.kvKey}>Incoming messages</Text>
          <Text style={[styles.kvVal, { color: waStatus.webhookSubscribed ? '#15803d' : '#b45309' }]}>
            {waStatus.webhookSubscribed ? 'Chalu ✓' : 'Band ⚠'}
          </Text>
        </View>
        <View style={styles.kvRow}>
          <Text style={styles.kvKey}>Access Token</Text>
          <Text style={styles.kvVal}>•••••••• (encrypted)</Text>
        </View>

        <View style={styles.qrActions}>
          <TouchableOpacity style={styles.qrEditBtn} onPress={() => setWaEditing(true)}>
            <Ionicons name="key-outline" size={13} color="#6366f1" />
            <Text style={styles.qrEditText}>Token badlein</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.qrRemoveBtn} onPress={handleDisconnectWhatsApp} disabled={waDisconnecting}>
            {waDisconnecting
              ? <ActivityIndicator size="small" color="#ef4444" />
              : <>
                  <Ionicons name="unlink-outline" size={13} color="#ef4444" />
                  <Text style={styles.qrRemoveText}>Disconnect</Text>
                </>
            }
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  /* ── WhatsApp: connect form ── */
  const renderWaEditor = () => (
    <>
      <Text style={styles.fieldLabel}>Phone Number ID</Text>
      <View style={styles.inputWrapper}>
        <Ionicons name="call-outline" size={15} color="#94a3b8" style={styles.inputIcon} />
        <TextInput
          style={[styles.fieldInput, { paddingLeft: 36 }]}
          placeholder="e.g. 1374230422440246"
          placeholderTextColor="#c7d0dc"
          value={phoneNumberId}
          onChangeText={setPhoneNumberId}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="number-pad"
        />
      </View>

      <Text style={styles.fieldLabel}>WhatsApp Business Account ID (WABA)</Text>
      <View style={styles.inputWrapper}>
        <Ionicons name="business-outline" size={15} color="#94a3b8" style={styles.inputIcon} />
        <TextInput
          style={[styles.fieldInput, { paddingLeft: 36 }]}
          placeholder="e.g. 1783106019477806"
          placeholderTextColor="#c7d0dc"
          value={wabaId}
          onChangeText={setWabaId}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="number-pad"
        />
      </View>

      <Text style={styles.fieldLabel}>Access Token (permanent)</Text>
      <View style={styles.inputWrapper}>
        <Ionicons name="key-outline" size={15} color="#94a3b8" style={styles.inputIcon} />
        <TextInput
          style={[styles.fieldInput, { paddingLeft: 36, paddingRight: 40 }]}
          placeholder="EAAG..."
          placeholderTextColor="#c7d0dc"
          secureTextEntry={!showToken}
          value={accessToken}
          onChangeText={setAccessToken}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          textContentType="none"
        />
        <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowToken((v) => !v)}>
          <Ionicons name={showToken ? 'eye-off-outline' : 'eye-outline'} size={16} color="#94a3b8" />
        </TouchableOpacity>
      </View>

      <View style={styles.hintBox}>
        <Ionicons name="shield-checkmark-outline" size={14} color="#16a34a" style={{ marginTop: 1 }} />
        <Text style={styles.hintText}>
          Token encrypt hokar save hota hai aur save ke baad dobara kabhi dikhaya nahi jata. Ye teeno cheezein Meta →
          WhatsApp → API Setup page par milti hain. Production ke liye "System User" ka permanent token use karein
          (temporary token 24 ghante mein expire ho jata hai).
        </Text>
      </View>

      <View style={styles.paymentBtnRow}>
        {waStatus?.connected ? (
          <TouchableOpacity
            style={[styles.btn, styles.btnOutline, { flex: 1 }]}
            onPress={() => {
              setWaEditing(false);
              setAccessToken('');
              setPhoneNumberId('');
              setWabaId('');
            }}
          >
            <Ionicons name="close-outline" size={15} color="#64748b" style={{ marginRight: 4 }} />
            <Text style={styles.btnOutlineText}>Cancel</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          style={[styles.btn, styles.btnGreen, { flex: waStatus?.connected ? 2 : 1 }, waSaving && styles.btnDisabled]}
          onPress={handleConnectWhatsApp}
          disabled={waSaving}
        >
          {waSaving
            ? <ActivityIndicator size="small" color="#fff" />
            : <>
                <Ionicons name="logo-whatsapp" size={15} color="#fff" style={{ marginRight: 6 }} />
                <Text style={styles.btnText}>{waStatus?.connected ? 'Update karein' : 'Connect WhatsApp'}</Text>
              </>
          }
        </TouchableOpacity>
      </View>
    </>
  );

  /* ── WhatsApp card body ── */
  const renderWaBody = () => {
    if (waLoading) {
      return <ActivityIndicator size="small" color="#16a34a" style={{ marginVertical: 24 }} />;
    }
    if (waError) {
      return (
        <View>
          <Text style={styles.errText}>{waError}</Text>
          <TouchableOpacity style={[styles.btn, styles.btnOutline, { marginTop: 12 }]} onPress={refreshWa}>
            <Text style={styles.btnOutlineText}>Dobara try karein</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return waStatus?.connected && !waEditing ? renderWaStatus() : renderWaEditor();
  };

  /* ── Watch numbers card (sirf connected hone par) ── */
  const renderWatchCard = () => (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={[styles.cardIconWrap, { backgroundColor: '#e0f2fe' }]}>
          <Ionicons name="chatbubbles-outline" size={18} color="#0284c7" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>Messages padhne wale numbers</Text>
          <Text style={styles.cardSubtitle}>Max 4 — sirf inhi numbers ke messages save honge</Text>
        </View>
      </View>

      <View style={styles.divider} />

      {remainingSlots > 0 ? (
        <>
          {watchList.map((n, i) => (
            <View key={i} style={styles.watchRow}>
              <View style={[styles.inputWrapper, { flex: 1, marginBottom: 0 }]}>
                <Ionicons name="call-outline" size={15} color="#94a3b8" style={styles.inputIcon} />
                <TextInput
                  style={[styles.fieldInput, { paddingLeft: 36 }]}
                  placeholder="e.g. 9876543210"
                  placeholderTextColor="#c7d0dc"
                  value={n}
                  onChangeText={(v) => updateWatch(i, v)}
                  keyboardType="phone-pad"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              {watchList.length > 1 ? (
                <TouchableOpacity style={styles.watchRemove} onPress={() => removeWatch(i)}>
                  <Ionicons name="close-circle-outline" size={20} color="#ef4444" />
                </TouchableOpacity>
              ) : null}
            </View>
          ))}

          {watchList.length < remainingSlots ? (
            <TouchableOpacity style={styles.addWatchBtn} onPress={addWatch}>
              <Ionicons name="add-circle-outline" size={15} color="#6366f1" />
              <Text style={styles.addWatchText}>Number jodein</Text>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary, savingWatch && styles.btnDisabled]}
            onPress={handleSaveWatch}
            disabled={savingWatch}
          >
            {savingWatch
              ? <ActivityIndicator size="small" color="#fff" />
              : <>
                  <Ionicons name="save-outline" size={15} color="#fff" style={{ marginRight: 6 }} />
                  <Text style={styles.btnText}>Numbers save karein</Text>
                </>
            }
          </TouchableOpacity>
        </>
      ) : (
        <Text style={styles.autoSub}>4 numbers ho gaye. Naya jodne ke liye neeche se koi number hatayein.</Text>
      )}

      {savedWatch.length > 0 ? (
        <View style={{ marginTop: 18 }}>
          <View style={styles.divider} />
          <Text style={styles.fieldLabel}>SAVED NUMBERS ({savedWatch.length}/{MAX_WATCH})</Text>
          {savedWatch.map((num) => (
            <View key={num} style={styles.savedRow}>
              <Ionicons name="checkmark-circle" size={16} color="#16a34a" />
              <Text style={styles.savedText}>{num}</Text>
              <TouchableOpacity onPress={() => handleRemoveSavedWatch(num)} disabled={savingWatch} style={styles.watchRemove}>
                <Ionicons name="trash-outline" size={16} color="#ef4444" />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );

  /* ── Auto messages: ek block (print / review) ── */
  const renderAutoBlock = (key, title, subtitle) => {
    const b = auto[key];
    const isReview = key === 'review';
    const tpl = templates.find((t) => t.name === b.templateName && t.language === b.language) || null;
    const varCount = tpl ? tpl.varNums.length : b.variables.length;
    const pickerOpen = openPicker === key;

    return (
      <View style={styles.autoBlock}>
        <View style={styles.autoHead}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={styles.autoTitle}>{title}</Text>
            <Text style={styles.autoSub}>{subtitle}</Text>
          </View>
          <Switch
            value={b.enabled}
            onValueChange={(v) => setBlock(key, { enabled: v })}
            trackColor={{ true: '#16a34a', false: '#e2e8f0' }}
          />
        </View>

        {b.enabled ? (
          <View style={{ marginTop: 14 }}>
            {/* Template picker */}
            <Text style={styles.fieldLabel}>Template</Text>
            <TouchableOpacity
              style={styles.tplSelect}
              onPress={() => setOpenPicker(pickerOpen ? null : key)}
              activeOpacity={0.7}
            >
              <Text
                style={[styles.tplSelectText, !b.templateName && { color: '#94a3b8' }]}
                numberOfLines={1}
              >
                {b.templateName || 'Template chuniye'}
              </Text>
              <Ionicons name={pickerOpen ? 'chevron-up' : 'chevron-down'} size={16} color="#64748b" />
            </TouchableOpacity>

            {pickerOpen ? (
              <View style={styles.tplList}>
                {autoMetaError ? <Text style={styles.errText}>Templates load nahi hue: {autoMetaError}</Text> : null}
                {!autoMetaError && templates.length === 0 ? (
                  <Text style={styles.cardSubtitle}>
                    Koi approved template nahi mila. WhatsApp Manager mein template banayein; approve hone mein kuch
                    minute se 24 ghante lagte hain.
                  </Text>
                ) : null}
                {templates.map((t) => (
                  <TouchableOpacity
                    key={`${t.name}|${t.language}`}
                    style={[styles.tplItem, !t.supported && { opacity: 0.45 }]}
                    disabled={!t.supported}
                    onPress={() => pickTemplate(key, t)}
                  >
                    <View style={styles.tplItemTop}>
                      <Text style={styles.tplItemName} numberOfLines={1}>{t.name}</Text>
                      <Text style={styles.tplPill}>{t.category}</Text>
                    </View>
                    <Text style={styles.tplItemBody} numberOfLines={2}>{t.bodyText}</Text>
                    {!t.supported ? <Text style={styles.tplWarn}>⚠ {t.reason}</Text> : null}
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}

            {/* Preview + variables */}
            {tpl ? (
              <View style={styles.bubble}>
                <Text style={styles.bubbleText}>{tpl.bodyText}</Text>
              </View>
            ) : null}

            {/* PDF / photo header wale template ke liye file ka link */}
            {tpl && tpl.headerFormat ? (
              <View style={styles.mediaBox}>
                <Text style={styles.fieldLabel}>
                  {tpl.headerFormat === 'DOCUMENT' ? 'Menu PDF ka link (https)' : 'Photo ka link (https)'}
                </Text>
                <TextInput
                  style={[styles.fieldInput, { marginBottom: 6 }]}
                  value={b.headerUrl}
                  onChangeText={(v) => setBlock(key, { headerUrl: v })}
                  placeholder={tpl.headerFormat === 'DOCUMENT' ? 'https://.../menu.pdf' : 'https://.../menu.jpg'}
                  placeholderTextColor="#c7d0dc"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                />
                {tpl.headerFormat === 'DOCUMENT' ? (
                  <>
                    <Text style={styles.fieldLabel}>Customer ko file ka naam kya dikhe</Text>
                    <TextInput
                      style={[styles.fieldInput, { marginBottom: 6 }]}
                      value={b.headerFilename}
                      onChangeText={(v) => setBlock(key, { headerFilename: v })}
                      placeholder="Retro Menu"
                      placeholderTextColor="#c7d0dc"
                    />
                  </>
                ) : null}
                <Text style={styles.autoSub}>
                  Link public hona chahiye (login ke bina khule). Save karte waqt hum check karte hain ki link se{' '}
                  {tpl.headerFormat === 'DOCUMENT' ? 'PDF' : 'photo'} sach mein mil rahi hai ya nahi. Menu badalna ho
                  to naya link yahan daal kar dobara save karein.
                </Text>
              </View>
            ) : null}

            {Array.from({ length: varCount }).map((_, i) => (
              <View key={i} style={{ marginBottom: 10 }}>
                <Text style={styles.varLabel}>{`{{${tpl ? tpl.varNums[i] : i + 1}}} mein kya jaye`}</Text>
                <TextInput
                  style={[styles.fieldInput, { marginBottom: 6 }]}
                  placeholder="Neeche se chuniye ya khud likhiye"
                  placeholderTextColor="#c7d0dc"
                  value={b.variables[i] || ''}
                  onChangeText={(v) => setVar(key, i, v)}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {wa.ORDER_TOKENS.map((t) => (
                    <TouchableOpacity key={t.key} style={styles.tokenChip} onPress={() => addVarToken(key, i, t.key)}>
                      <Text style={styles.tokenChipText}>+ {t.label}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            ))}

            {/* Vendors */}
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Sab vendors ke orders par</Text>
              <Switch
                value={b.allVendors}
                onValueChange={(v) => setBlock(key, { allVendors: v })}
                trackColor={{ true: '#16a34a', false: '#e2e8f0' }}
              />
            </View>
            {!b.allVendors ? (
              <View style={{ marginBottom: 8 }}>
                <Text style={[styles.cardSubtitle, { marginBottom: 8 }]}>
                  Jin vendors ke orders par chalana hai unhe chuniye:
                </Text>
                <View style={styles.chipWrap}>
                  {vendorList.map((v) => {
                    const on = b.vendors.includes(v);
                    return (
                      <TouchableOpacity
                        key={v}
                        style={[styles.vChip, on && styles.vChipOn]}
                        onPress={() => toggleVendor(key, v)}
                      >
                        <Text style={[styles.vChipText, on && styles.vChipTextOn]}>{on ? '✓ ' : ''}{v}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {vendorList.length === 0 ? (
                  <Text style={styles.errText}>Vendor list load nahi hui. Neeche "Sab vendors" on rakh sakte hain.</Text>
                ) : null}
              </View>
            ) : null}

            {/* Review extras */}
            {isReview ? (
              <View style={{ marginTop: 6 }}>
                <Text style={styles.fieldLabel}>Print ke kitni der baad bhejna hai (minute)</Text>
                <TextInput
                  style={[styles.fieldInput, { marginBottom: 6 }]}
                  value={b.delayMinutes}
                  onChangeText={(v) => setBlock(key, { delayMinutes: v.replace(/[^0-9]/g, '') })}
                  keyboardType="number-pad"
                  placeholder="120"
                  placeholderTextColor="#c7d0dc"
                />
                <View style={[styles.chipWrap, { marginBottom: 14 }]}>
                  {DELAY_PRESETS.map((m) => {
                    const on = String(m) === String(b.delayMinutes);
                    return (
                      <TouchableOpacity
                        key={m}
                        style={[styles.vChip, on && styles.vChipOn]}
                        onPress={() => setBlock(key, { delayMinutes: String(m) })}
                      >
                        <Text style={[styles.vChipText, on && styles.vChipTextOn]}>
                          {m >= 60 ? `${m / 60} ghante` : `${m} min`}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* "Satisfied" wala link/message sirf tab, jab wo template mein quick-reply button ho.
                    Agar "Satisfied" URL button hai to link template ke andar hi hai — yahan kuch nahi. */}
                {(!tpl || (tpl.quickReplyButtons || []).some((q) => q.kind === 'good')) ? (
                  <>
                    <Text style={styles.fieldLabel}>"Satisfied" button dabane par kholne wala link (https)</Text>
                    <TextInput
                      style={styles.fieldInput}
                      value={b.goodUrl}
                      onChangeText={(v) => setBlock(key, { goodUrl: v })}
                      placeholder="https://www.ecatering.irctc.co.in"
                      placeholderTextColor="#c7d0dc"
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="url"
                    />

                    <Text style={styles.fieldLabel}>"Satisfied" dabane ke baad ka message (optional)</Text>
                    <TextInput
                      style={[styles.fieldInput, styles.textArea]}
                      value={b.goodText}
                      onChangeText={(v) => setBlock(key, { goodText: v })}
                      placeholder="Khali chhodne par default message jayega"
                      placeholderTextColor="#c7d0dc"
                      multiline
                      textAlignVertical="top"
                    />
                  </>
                ) : (
                  <View style={styles.mediaBox}>
                    <Text style={styles.autoSub}>
                      ✓ Is template ka "Satisfied" button URL button hai, uska link template ke andar hi set hai.
                      Yahan kuch daalne ki zaroorat nahi.
                    </Text>
                  </View>
                )}

                {(!tpl || (tpl.quickReplyButtons || []).some((q) => q.kind === 'bad')) ? (
                  <>
                    <Text style={styles.fieldLabel}>
                      {tpl && (tpl.quickReplyButtons || []).find((q) => q.kind === 'bad')
                        ? `"${(tpl.quickReplyButtons || []).find((q) => q.kind === 'bad').text}" button dabane par jaane wala message`
                        : '"Not Satisfied" button dabane par jaane wala message'}
                    </Text>
                    <TextInput
                      style={[styles.fieldInput, styles.textArea]}
                      value={b.badText}
                      onChangeText={(v) => setBlock(key, { badText: v })}
                      placeholder="Khali chhodne par default apology jayegi"
                      placeholderTextColor="#c7d0dc"
                      multiline
                      textAlignVertical="top"
                    />
                    <Text style={styles.autoSub}>
                      Customer ke button dabate hi ye message us customer ko apne aap chala jayega.
                    </Text>
                  </>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    );
  };

  /* ── Auto messages card ── */
  const renderAutoCard = () => (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={[styles.cardIconWrap, { backgroundColor: '#fef3c7' }]}>
          <Ionicons name="flash-outline" size={18} color="#d97706" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>Auto WhatsApp Messages</Text>
          <Text style={styles.cardSubtitle}>Order print hone par apne aap message</Text>
        </View>
        <Switch
          value={auto.enabled}
          onValueChange={(v) => setAuto((p) => ({ ...p, enabled: v }))}
          trackColor={{ true: '#16a34a', false: '#e2e8f0' }}
        />
      </View>

      <View style={styles.divider} />

      <View style={styles.hintBox}>
        <Ionicons name="information-circle-outline" size={14} color="#16a34a" style={{ marginTop: 1 }} />
        <Text style={styles.hintText}>
          Dashboard se order print karte hi customer ke number par message jayega. Sirf wahi orders jinme number ho
          aur customer ne STOP na likha ho. Ek order par har message sirf ek baar jata hai, dobara print karne par
          nahi.
        </Text>
      </View>

      <View style={!auto.enabled ? { opacity: 0.55 } : null}>
        {renderAutoBlock('print', '1. Print hote hi message', 'Order print karte hi turant customer ko')}
        <View style={styles.divider} />
        {renderAutoBlock('review', '2. Review message', 'Print ke kuch der baad apne aap')}
      </View>

      <TouchableOpacity
        style={[styles.btn, styles.btnGreen, { marginTop: 16 }, savingAuto && styles.btnDisabled]}
        onPress={handleSaveAuto}
        disabled={savingAuto}
      >
        {savingAuto
          ? <ActivityIndicator size="small" color="#fff" />
          : <>
              <Ionicons name="save-outline" size={15} color="#fff" style={{ marginRight: 6 }} />
              <Text style={styles.btnText}>Auto messages save karein</Text>
            </>
        }
      </TouchableOpacity>
    </View>
  );

    /* ── Mile hue printers ── */
  const renderFoundPrinters = () => {
    if (!found) return null;
    const rows = [
      ...found.usb.map((p) => ({
        key: `u:${p.name}`,
        label: 'USB',
        name: p.name,
        sub: p.kind === 'usb' ? 'USB se juda hua' : 'Is computer me installed',
        item: { type: 'usb', name: p.name },
      })),
      ...found.network.map((p) => ({
        key: `n:${p.ip}`,
        label: 'WIFI',
        name: p.name,
        sub: `WiFi · ${p.ip}`,
        item: { type: 'network', name: p.name, ip: p.ip, port: p.port },
      })),
    ];

    return (
      <View style={{ marginTop: 14 }}>
        <Text style={styles.fieldLabel}>Mile hue printers: jo chahiye use "Add" karein</Text>
        {rows.length === 0 ? (
          <Text style={styles.errText}>
            Koi printer nahi mila. Printer ON hai aur is computer ke same WiFi / network par hai? USB printer ho to
            uska driver install hona chahiye.
          </Text>
        ) : (
          rows.map((r) => {
            const added = isDiscoveredAdded(r.item, printers);
            return (
              <View key={r.key} style={styles.inboxSenderRow}>
                <View style={styles.inboxSenderLeft}>
                  <View style={styles.inboxVendorBadge}>
                    <Text style={styles.inboxVendorBadgeText}>{r.label}</Text>
                  </View>
                  <View style={{ marginLeft: 8, flex: 1 }}>
                    <Text style={styles.inboxSenderNum} numberOfLines={1}>{r.name}</Text>
                    <Text style={styles.inboxSenderDate} numberOfLines={1}>{r.sub}</Text>
                  </View>
                </View>
                {added ? (
                  <Text style={[styles.printerMiniText, { color: '#16a34a' }]}>✓ Added</Text>
                ) : (
                  <TouchableOpacity
                    style={[styles.printerMiniBtn, { backgroundColor: '#16a34a', borderColor: '#16a34a' }]}
                    onPress={() => handleAddFound(r.item, r.key)}
                    disabled={!!addingKey}
                  >
                    {addingKey === r.key
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Text style={[styles.printerMiniText, { color: '#fff' }]}>Add</Text>}
                  </TouchableOpacity>
                )}
              </View>
            );
          })
        )}
      </View>
    );
  };

  /* ── Printers card ── */
  const renderPrinters = () => {
    const f = printerForm;
    const setF = (patch) => setPrinterForm((p) => ({ ...p, ...patch }));

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={[styles.cardIconWrap, { backgroundColor: '#eff6ff' }]}>
            <Ionicons name="print-outline" size={18} color="#3b82f6" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Printers</Text>
            <Text style={styles.cardSubtitle}>
              WiFi ya USB printer jodein. Koi printer nahi jodenge to pehle ki tarah browser se print hoga
            </Text>
          </View>
        </View>

        <View style={styles.divider} />

        <View style={styles.bridgeRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
            <View style={[styles.bridgeDot, { backgroundColor: bridgeOnline === null ? '#94a3b8' : bridgeOnline ? '#16a34a' : '#ef4444' }]} />
            <Text style={styles.kvKey}>
              Print Bridge: {bridgeOnline === null ? 'check ho raha hai…' : bridgeOnline ? 'Online' : 'Offline'}
            </Text>
          </View>
          <TouchableOpacity onPress={refreshBridge}>
            <Text style={styles.qrEditText}>Dobara check</Text>
          </TouchableOpacity>
        </View>

        {bridgeOnline === false ? (
          <View style={styles.warnBox}>
            <Ionicons name="warning-outline" size={14} color="#b45309" style={{ marginTop: 1 }} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.warnText, { flex: 0 }]}>
                WiFi / USB (direct) printer ke liye is computer par "Print Bridge" chahiye. Download karke file par
                double-click karein. Install hote hi ye status apne aap "Online" ho jayega.
              </Text>
              <TouchableOpacity style={[styles.btn, styles.btnPrimary, { marginTop: 10 }]} onPress={handleDownloadBridge}>
                <Ionicons name="download-outline" size={15} color="#fff" style={{ marginRight: 6 }} />
                <Text style={styles.btnText}>Print Bridge Download Karein</Text>
              </TouchableOpacity>
              <Text style={[styles.warnText, { flex: 0, marginTop: 8 }]}>
                Browser "Keep" puche to Keep karein. "Windows protected your PC" aaye to "More info" dabakar "Run anyway" karein.
              </Text>
            </View>
          </View>
        ) : null}

        {printers.length === 0 ? (
          <View style={styles.inboxEmptyBox}>
            <Ionicons name="print-outline" size={22} color="#94a3b8" />
            <Text style={styles.inboxEmptyText}>Abhi koi printer add nahi hai</Text>
          </View>
        ) : (
          printers.map((p) => (
            <View key={p.id} style={styles.inboxSenderRow}>
              <View style={styles.inboxSenderLeft}>
                <View style={styles.inboxVendorBadge}>
                  <Text style={styles.inboxVendorBadgeText}>{PRINTER_MODE_LABEL[p.mode] || p.mode}</Text>
                </View>
                <View style={{ marginLeft: 8, flex: 1 }}>
                  <Text style={styles.inboxSenderNum} numberOfLines={1}>
                    {p.name}{p.isDefault ? '  ★ default' : ''}
                  </Text>
                  <Text style={styles.inboxSenderDate} numberOfLines={1}>
                    {p.mode === 'network' ? `${p.ip}:${p.port || 9100}` : p.mode === 'usb_silent' ? p.systemPrinterName : 'Browser print'}
                    {p.outletId ? ` · ${p.outletId}` : ''}
                  </Text>
                </View>
              </View>
              <View style={styles.printerBtns}>
                {p.mode !== 'browser' ? (
                  <TouchableOpacity style={styles.printerMiniBtn} onPress={() => handleTestPrinter(p)} disabled={testingId === p.id}>
                    {testingId === p.id
                      ? <ActivityIndicator size="small" color="#475569" />
                      : <Text style={styles.printerMiniText}>Test</Text>}
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity style={styles.printerMiniBtn} onPress={() => openPrinterForm(p)}>
                  <Text style={styles.printerMiniText}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.inboxSenderRemoveBtn} onPress={() => handleDeletePrinter(p)}>
                  <Ionicons name="trash-outline" size={15} color="#ef4444" />
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}

        {f ? (
          <View style={{ marginTop: 14 }}>
            <Text style={[styles.fieldLabel, { fontSize: 12 }]}>{f.id ? 'Printer edit karein' : 'Naya printer'}</Text>

            <Text style={styles.fieldLabel}>Printer ka naam</Text>
            <TextInput
              style={[styles.fieldInput, { marginBottom: 12 }]}
              value={f.name}
              onChangeText={(v) => setF({ name: v })}
              placeholder="Jaise: Counter printer"
              placeholderTextColor="#c7d0dc"
            />

            <Text style={styles.fieldLabel}>Printer ka type</Text>
            <View style={[styles.chipWrap, { marginBottom: 6 }]}>
              {PRINTER_MODES.map((m) => {
                const on = f.mode === m.key;
                return (
                  <TouchableOpacity key={m.key} style={[styles.vChip, on && styles.vChipOn]} onPress={() => { setF({ mode: m.key }); setSysOpen(false); }}>
                    <Text style={[styles.vChipText, on && styles.vChipTextOn]}>{m.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {f.mode === 'network' ? (
              <>
                <Text style={styles.fieldLabel}>Printer ka IP address aur port</Text>
                <View style={[styles.inboxInputRow, { marginBottom: 12 }]}>
                  <TextInput
                    style={[styles.fieldInput, { flex: 1 }]}
                    value={f.ip}
                    onChangeText={(v) => setF({ ip: v.replace(/[^0-9.]/g, '') })}
                    placeholder="192.168.1.50"
                    placeholderTextColor="#c7d0dc"
                    keyboardType="decimal-pad"
                    autoCorrect={false}
                  />
                  <TextInput
                    style={[styles.fieldInput, { width: 90 }]}
                    value={f.port}
                    onChangeText={(v) => setF({ port: v.replace(/[^0-9]/g, '').slice(0, 5) })}
                    placeholder="9100"
                    placeholderTextColor="#c7d0dc"
                    keyboardType="number-pad"
                  />
                </View>
              </>
            ) : null}

            {f.mode === 'usb_silent' ? (
              <>
                <Text style={styles.fieldLabel}>Is computer me installed printer</Text>
                <TouchableOpacity
                  style={[styles.vendorSelect, { marginBottom: 8 }, sysOpen && styles.vendorSelectOpen]}
                  onPress={async () => { const open = !sysOpen; setSysOpen(open); if (open) await loadSystemPrinters(); }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.vendorSelectText, !f.systemPrinterName && { color: '#94a3b8' }]} numberOfLines={1}>
                    {f.systemPrinterName || 'Printer chuniye'}
                  </Text>
                  <Ionicons name={sysOpen ? 'chevron-up' : 'chevron-down'} size={16} color="#64748b" />
                </TouchableOpacity>
                {sysOpen ? (
                  <View style={[styles.vendorList, { marginBottom: 12 }]}>
                    {systemPrinters.length === 0 ? (
                      <Text style={styles.errText}>Koi printer nahi mila. Print Bridge chal raha hai?</Text>
                    ) : (
                      systemPrinters.map((sp) => {
                        const on = sp.name === f.systemPrinterName;
                        return (
                          <TouchableOpacity
                            key={sp.name}
                            style={[styles.vendorOption, on && styles.vendorOptionActive]}
                            onPress={() => { setF({ systemPrinterName: sp.name }); setSysOpen(false); }}
                          >
                            <Text style={[styles.vendorOptionText, on && styles.vendorOptionTextActive]}>{sp.name}</Text>
                            {on ? <Ionicons name="checkmark" size={16} color="#1d4ed8" /> : null}
                          </TouchableOpacity>
                        );
                      })
                    )}
                  </View>
                ) : null}
              </>
            ) : null}

            <Text style={styles.fieldLabel}>Outlet / Station (optional)</Text>
            <TextInput
              style={[styles.fieldInput, { marginBottom: 6 }]}
              value={f.outletId}
              onChangeText={(v) => setF({ outletId: v })}
              placeholder="Khali = sab orders ke liye"
              placeholderTextColor="#c7d0dc"
            />

            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Default printer</Text>
              <Switch value={!!f.isDefault} onValueChange={(v) => setF({ isDefault: v })} trackColor={{ true: '#16a34a', false: '#e2e8f0' }} />
            </View>
            {f.mode !== 'browser' ? (
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>Printer na mile to browser print chalayein</Text>
                <Switch value={f.fallbackToBrowser !== false} onValueChange={(v) => setF({ fallbackToBrowser: v })} trackColor={{ true: '#16a34a', false: '#e2e8f0' }} />
              </View>
            ) : null}

            <View style={styles.paymentBtnRow}>
              <TouchableOpacity style={[styles.btn, styles.btnOutline, { flex: 1 }]} onPress={() => setPrinterForm(null)}>
                <Text style={styles.btnOutlineText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.btnGreen, { flex: 2 }, printerSaving && styles.btnDisabled]}
                onPress={handleSavePrinter}
                disabled={printerSaving}
              >
                {printerSaving
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <><Ionicons name="save-outline" size={15} color="#fff" style={{ marginRight: 6 }} /><Text style={styles.btnText}>Save Printer</Text></>}
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <>
            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary, { marginTop: 12 }, scanning && styles.btnDisabled]}
              onPress={handleScanPrinters}
              disabled={scanning}
            >
              {scanning ? (
                <>
                  <ActivityIndicator size="small" color="#fff" />
                  <Text style={[styles.btnText, { marginLeft: 8 }]}>Printers dhundh rahe hain…</Text>
                </>
              ) : (
                <>
                  <Ionicons name="search-outline" size={15} color="#fff" style={{ marginRight: 6 }} />
                  <Text style={styles.btnText}>Printers Dhundhein</Text>
                </>
              )}
            </TouchableOpacity>

            {renderFoundPrinters()}

            <TouchableOpacity onPress={() => openPrinterForm(null)} style={{ alignSelf: 'center', marginTop: 14 }}>
              <Text style={styles.qrEditText}>Printer nahi mila? Manually add karein</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => onNavigate('Dashboard')} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={17} color="#475569" />
        </TouchableOpacity>
        <View>
          <Text style={styles.headerTitle}>Settings</Text>
          <Text style={styles.headerSub}>{clientEmail}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, isWide && styles.scrollContentWide]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.sectionLabel}>BILLING & WHATSAPP</Text>

        {/* Payment + WhatsApp side by side on wide */}
        <View style={[styles.row, !isWide && { flexDirection: 'column', gap: 0 }]}>

          {/* ── Payment Card ── */}
          <View style={[styles.card, isWide && styles.cardHalf]}>
            <View style={styles.cardHeader}>
              <View style={[styles.cardIconWrap, { backgroundColor: '#dcfce7' }]}>
                <Ionicons name="qr-code-outline" size={18} color="#16a34a" />
              </View>
              <View>
                <Text style={styles.cardTitle}>Payment ID</Text>
                <Text style={styles.cardSubtitle}>UPI / QR code for bills</Text>
              </View>
            </View>

            <View style={styles.divider} />

            {savedPaymentId && !editingPayment
              ? renderQRSection()
              : renderPaymentEditor()
            }
          </View>

          {/* ── WhatsApp Card ── */}
          <View style={[styles.card, isWide && styles.cardHalf]}>
            <View style={styles.cardHeader}>
              <View style={[styles.cardIconWrap, { backgroundColor: '#dcfce7' }]}>
                <Ionicons name="logo-whatsapp" size={18} color="#16a34a" />
              </View>
              <View>
                <Text style={styles.cardTitle}>WhatsApp Business</Text>
                <Text style={styles.cardSubtitle}>Apna number connect karein</Text>
              </View>
            </View>

            <View style={styles.divider} />

            {renderWaBody()}
          </View>

        </View>

        {/* ── Watch numbers (connected hone par) ── */}
        {waStatus?.connected && !waError ? renderWatchCard() : null}

        {/* ── Auto messages (connected hone par) ── */}
        {waStatus?.connected && !waError ? (
          <>
            <Text style={[styles.sectionLabel, { marginTop: 8 }]}>AUTO MESSAGES</Text>
            {renderAutoCard()}
          </>
        ) : null}

        <Text style={[styles.sectionLabel, { marginTop: 8 }]}>PRINTERS</Text>
        {renderPrinters()}

        {/* ── Notification Sound ── */}
        <Text style={[styles.sectionLabel, { marginTop: 8 }]}>NOTIFICATIONS</Text>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={[styles.cardIconWrap, { backgroundColor: '#fff7ed' }]}>
              <Ionicons name="musical-note-outline" size={18} color="#f59e0b" />
            </View>
            <View>
              <Text style={styles.cardTitle}>Alert Sound</Text>
              <Text style={styles.cardSubtitle}>Plays when a new order arrives</Text>
            </View>
          </View>

          <View style={styles.divider} />

          <View style={[styles.soundGrid, isWide && styles.soundGridWide]}>
            {SOUND_OPTIONS.map((opt, i) => {
              const isSelected = selectedSound === opt.url;
              const isPlaying = playingSound === opt.url;
              return (
                <TouchableOpacity
                  key={i}
                  style={[styles.soundTile, isSelected && styles.soundTileSelected]}
                  onPress={() => handleSoundSelect(opt)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.soundIconWrap, isSelected && styles.soundIconWrapSelected]}>
                    <Ionicons
                      name={isPlaying ? 'volume-high' : opt.icon}
                      size={20}
                      color={isSelected ? '#f59e0b' : '#94a3b8'}
                    />
                  </View>
                  <Text style={[styles.soundName, isSelected && styles.soundNameSelected]}>{opt.name}</Text>
                  {isSelected && (
                    <View style={styles.soundCheck}>
                      <Ionicons name="checkmark" size={11} color="#fff" />
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f1f5f9' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f1f5f9', gap: 12 },
  loadingText: { fontSize: 13, color: '#94a3b8' },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 20, paddingVertical: 14,
    backgroundColor: '#fff', borderBottomWidth: 1, borderColor: '#e2e8f0',
  },
  backBtn: {
    width: 34, height: 34, borderRadius: 8, borderWidth: 1,
    borderColor: '#e2e8f0', justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8fafc',
  },
  headerTitle: { fontSize: 15, fontWeight: '700', color: '#0f172a', lineHeight: 20 },
  headerSub: { fontSize: 11, color: '#94a3b8', lineHeight: 16 },

  scrollContent: { padding: 16, paddingBottom: 40 },
  scrollContentWide: { padding: 24, paddingBottom: 48 },

  sectionLabel: { fontSize: 10, fontWeight: '700', color: '#94a3b8', letterSpacing: 1.2, marginBottom: 10, marginLeft: 2 },

  row: { flexDirection: 'row', gap: 16, marginBottom: 16, alignItems: 'flex-start' },

  card: { backgroundColor: '#fff', borderRadius: 12, padding: 20, borderWidth: 1, borderColor: '#e2e8f0', marginBottom: 16 },
  cardHalf: { flex: 1, marginBottom: 0 },

  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  cardIconWrap: { width: 38, height: 38, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  cardTitle: { fontSize: 14, fontWeight: '700', color: '#0f172a', lineHeight: 20 },
  cardSubtitle: { fontSize: 11, color: '#94a3b8', lineHeight: 16 },

  divider: { height: 1, backgroundColor: '#f1f5f9', marginBottom: 16 },

  fieldLabel: { fontSize: 11, fontWeight: '600', color: '#475569', marginBottom: 6, letterSpacing: 0.3 },

  inputWrapper: { position: 'relative', marginBottom: 14 },
  inputIcon: { position: 'absolute', left: 11, top: 11, zIndex: 1 },
  eyeBtn: { position: 'absolute', right: 10, top: 10, padding: 2 },

  fieldInput: {
    borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8,
    paddingVertical: 10, paddingHorizontal: 12,
    fontSize: 13, color: '#0f172a', backgroundColor: '#f8fafc',
  },

  hintBox: {
    flexDirection: 'row', gap: 7, backgroundColor: '#f0fdf4',
    borderRadius: 8, padding: 10, marginBottom: 16,
    borderWidth: 1, borderColor: '#bbf7d0',
  },
  hintText: { fontSize: 11, color: '#15803d', lineHeight: 16, flex: 1 },

  warnBox: {
    flexDirection: 'row', gap: 7, backgroundColor: '#fffbeb',
    borderRadius: 8, padding: 10, marginBottom: 14,
    borderWidth: 1, borderColor: '#fde68a',
  },
  warnText: { fontSize: 11, color: '#92400e', lineHeight: 16, flex: 1 },
  errText: { fontSize: 12, color: '#dc2626', lineHeight: 18 },

  paymentBtnRow: { flexDirection: 'row', gap: 10, marginTop: 4 },

  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: 8 },
  btnPrimary: { backgroundColor: '#6366f1', marginTop: 4 },
  btnGreen: { backgroundColor: '#16a34a' },
  btnOutline: {
    backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#e2e8f0',
  },
  btnDisabled: { opacity: 0.55 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 13, letterSpacing: 0.3 },
  btnOutlineText: { color: '#64748b', fontWeight: '600', fontSize: 13 },

  // ── QR Section ──
  qrWrapper: {
    alignItems: 'center',
    paddingTop: 4,
    paddingBottom: 4,
  },
  qrBadgeRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14,
    alignSelf: 'stretch', justifyContent: 'center',
  },
  qrBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#dcfce7', borderRadius: 20,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: '#bbf7d0',
  },
  qrBadgeText: { fontSize: 10, fontWeight: '700', color: '#15803d', letterSpacing: 0.5 },
  qrLabel: { fontSize: 13, fontWeight: '600', color: '#0f172a' },

  qrImageWrap: {
    padding: 10,
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 3,
    marginBottom: 14,
  },
  qrImage: { width: 160, height: 160 },

  qrUpiRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#f8fafc', borderRadius: 8, borderWidth: 1, borderColor: '#e2e8f0',
    paddingHorizontal: 12, paddingVertical: 8, marginBottom: 10,
    alignSelf: 'stretch',
  },
  qrUpiText: { fontSize: 12, color: '#475569', fontWeight: '600', flex: 1 },

  qrNote: {
    fontSize: 11, color: '#94a3b8', textAlign: 'center',
    lineHeight: 16, marginBottom: 16, paddingHorizontal: 8,
  },

  qrActions: { flexDirection: 'row', gap: 10, alignSelf: 'stretch', marginTop: 6 },
  qrEditBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 5, paddingVertical: 10, borderRadius: 8,
    backgroundColor: '#ede9fe', borderWidth: 1, borderColor: '#c4b5fd',
  },
  qrEditText: { fontSize: 12, fontWeight: '700', color: '#6366f1' },
  qrRemoveBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 5, paddingVertical: 10, borderRadius: 8,
    backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca',
  },
  qrRemoveText: { fontSize: 12, fontWeight: '700', color: '#ef4444' },

  // ── WhatsApp status ──
  waPillRow: { flexDirection: 'row', marginBottom: 14 },
  waPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1,
  },
  waPillOk: { backgroundColor: '#dcfce7', borderColor: '#bbf7d0' },
  waPillBad: { backgroundColor: '#fef2f2', borderColor: '#fecaca' },
  waPillText: { fontSize: 11, fontWeight: '700' },

  kvRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#f1f5f9',
  },
  kvKey: { fontSize: 12, color: '#64748b' },
  kvVal: { fontSize: 12.5, color: '#0f172a', fontWeight: '600', flexShrink: 1, textAlign: 'right', marginLeft: 12 },

  // ── Watch numbers ──
  watchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  watchRemove: { padding: 4 },
  addWatchBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    alignSelf: 'flex-start', paddingVertical: 6, marginBottom: 10,
  },
  addWatchText: { fontSize: 12, fontWeight: '700', color: '#6366f1' },
  savedRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0',
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 8,
  },
  savedText: { flex: 1, fontSize: 13, fontWeight: '600', color: '#0f172a' },

  // ── Auto messages ──
  autoBlock: { paddingVertical: 4 },
  autoHead: { flexDirection: 'row', alignItems: 'center' },
  autoTitle: { fontSize: 13.5, fontWeight: '700', color: '#0f172a' },
  autoSub: { fontSize: 11, color: '#94a3b8', lineHeight: 16, marginTop: 2 },
  varLabel: { fontSize: 12, fontWeight: '700', color: '#075e54', marginBottom: 4 },
  textArea: { minHeight: 64, marginBottom: 12 },
  mediaBox: {
    backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fde68a',
    borderRadius: 8, padding: 12, marginBottom: 12,
  },

  tplSelect: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8,
    paddingVertical: 11, paddingHorizontal: 12, backgroundColor: '#f8fafc', marginBottom: 10,
  },
  tplSelectText: { fontSize: 13, color: '#0f172a', flex: 1, marginRight: 8 },
  tplList: {
    borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8,
    padding: 8, marginBottom: 12, backgroundColor: '#fff',
  },
  tplItem: {
    borderWidth: 1, borderColor: '#f1f5f9', borderRadius: 8,
    padding: 10, marginBottom: 6, backgroundColor: '#f8fafc',
  },
  tplItemTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tplItemName: { fontSize: 13, fontWeight: '700', color: '#0f172a', flex: 1, marginRight: 8 },
  tplPill: {
    fontSize: 10, color: '#15803d', backgroundColor: '#dcfce7',
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10, overflow: 'hidden',
  },
  tplItemBody: { fontSize: 12, color: '#475569', marginTop: 4, lineHeight: 17 },
  tplWarn: { fontSize: 11, color: '#b45309', marginTop: 4 },

  bubble: { backgroundColor: '#dcf8c6', borderRadius: 10, borderTopLeftRadius: 2, padding: 10, marginBottom: 12 },
  bubbleText: { fontSize: 12.5, color: '#111', lineHeight: 18 },

  tokenChip: {
    borderWidth: 1, borderColor: '#16a34a', borderRadius: 16,
    paddingHorizontal: 11, paddingVertical: 5, marginRight: 7, backgroundColor: '#f0fdf4',
  },
  tokenChipText: { fontSize: 11.5, color: '#15803d', fontWeight: '600' },

  switchRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 8, marginBottom: 4,
  },
  switchLabel: { fontSize: 12.5, fontWeight: '600', color: '#475569', flex: 1, marginRight: 10 },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap' },
  vChip: {
    borderWidth: 1, borderColor: '#e2e8f0', backgroundColor: '#f8fafc',
    borderRadius: 18, paddingHorizontal: 13, paddingVertical: 7, marginRight: 8, marginBottom: 8,
  },
  vChipOn: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  vChipText: { fontSize: 12.5, color: '#475569' },
  vChipTextOn: { color: '#fff', fontWeight: '700' },

  // ── Sound ──
  soundGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  soundGridWide: {},

  // ── Printers ──
  bridgeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  bridgeDot: { width: 8, height: 8, borderRadius: 4, marginRight: 7 },
  printerBtns: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  printerMiniBtn: {
    minWidth: 44, alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 6, borderWidth: 1, borderColor: '#e2e8f0', backgroundColor: '#f8fafc',
  },
  printerMiniText: { fontSize: 11, fontWeight: '700', color: '#475569' },

  soundTile: {
    flex: 1, minWidth: 120, alignItems: 'center',
    paddingVertical: 16, paddingHorizontal: 8,
    borderRadius: 10, borderWidth: 1.5, borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc', gap: 8, position: 'relative',
  },
  soundTileSelected: { backgroundColor: '#fffbeb', borderColor: '#fbbf24' },
  soundIconWrap: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#f1f5f9', justifyContent: 'center', alignItems: 'center' },
  soundIconWrapSelected: { backgroundColor: '#fef3c7' },
  soundName: { fontSize: 12, fontWeight: '500', color: '#64748b', textAlign: 'center' },
  soundNameSelected: { color: '#b45309', fontWeight: '700' },
  soundCheck: {
    position: 'absolute', top: 8, right: 8,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: '#f59e0b', justifyContent: 'center', alignItems: 'center',
  },
});
