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

const SOUND_OPTIONS = [
  { name: 'Classic Bell', icon: 'notifications-outline', url: 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3' },
  { name: 'Soft Chime', icon: 'musical-notes-outline', url: 'https://assets.mixkit.co/active_storage/sfx/2875/2875-preview.mp3' },
  { name: 'Digital Alert', icon: 'pulse-outline', url: 'https://assets.mixkit.co/active_storage/sfx/2870/2870-preview.mp3' },
  { name: 'Notification Tone', icon: 'volume-medium-outline', url: 'https://assets.mixkit.co/active_storage/sfx/2872/2872-preview.mp3' },
];

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
  const [watchList, setWatchList] = useState(['']);
  const [savingWatch, setSavingWatch] = useState(false);

  // Auto messages state
  const [auto, setAuto] = useState(defaultAuto());
  const [templates, setTemplates] = useState([]);       // approved + analyzed
  const [vendorList, setVendorList] = useState([]);
  const [autoMetaError, setAutoMetaError] = useState('');
  const [openPicker, setOpenPicker] = useState(null);   // 'print' | 'review' | null
  const [savingAuto, setSavingAuto] = useState(false);

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

  /* ── WhatsApp: status load ── */
  const refreshWa = async () => {
    setWaLoading(true);
    try {
      const st = await wa.getStatus();
      setWaStatus(st);
      setWaError('');
      setWaEditing(!st.connected); // connect nahi hai to form khud khul jaye
      const nums = (st.watchNumbers || []).filter(Boolean);
      setWatchList(nums.length ? nums : ['']);
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
  const updateWatch = (i, v) => setWatchList((p) => p.map((x, idx) => (idx === i ? v : x)));
  const removeWatch = (i) =>
    setWatchList((p) => {
      const next = p.filter((_, idx) => idx !== i);
      return next.length ? next : [''];
    });
  const addWatch = () => setWatchList((p) => (p.length < 4 ? [...p, ''] : p));

  const handleSaveWatch = async () => {
    const nums = watchList.map((n) => n.trim()).filter(Boolean);
    if (nums.some((n) => n.replace(/\D/g, '').length < 10)) {
      wa.notify('Number galat hai', 'Har number kam se kam 10 digit ka hona chahiye');
      return;
    }
    setSavingWatch(true);
    try {
      const r = await wa.saveWatchNumbers(nums);
      setWatchList(r.watchNumbers && r.watchNumbers.length ? r.watchNumbers : ['']);
      wa.notify('✓ Saved', 'In numbers ke messages ab aapko dikhenge.');
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
          <TouchableOpacity style={styles.watchRemove} onPress={() => removeWatch(i)}>
            <Ionicons name="close-circle-outline" size={20} color="#ef4444" />
          </TouchableOpacity>
        </View>
      ))}

      {watchList.length < 4 ? (
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
    </View>
  );

  /* ── Auto messages: templates + vendors load ── */
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

                <Text style={styles.fieldLabel}>"Accha tha" par kholne wala link (https)</Text>
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

                <Text style={styles.fieldLabel}>"Accha tha" ke baad ka message (optional)</Text>
                <TextInput
                  style={[styles.fieldInput, styles.textArea]}
                  value={b.goodText}
                  onChangeText={(v) => setBlock(key, { goodText: v })}
                  placeholder="Khali chhodne par default message jayega"
                  placeholderTextColor="#c7d0dc"
                  multiline
                  textAlignVertical="top"
                />

                <Text style={styles.fieldLabel}>"Accha nahi tha" par apology message (optional)</Text>
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
                  Link aur dono jawab tab kaam aate hain jab template mein "Accha tha" / "Accha nahi tha" jaise
                  quick-reply buttons hon.
                </Text>
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
