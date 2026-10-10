import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, ScrollView, Platform, Dimensions, Image
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { Audio } from 'expo-av';
import { db } from '../firebaseConfig';
import * as wa from '../services/whatsappApi';

const SOUND_OPTIONS = [
  { name: 'Classic Bell', icon: 'notifications-outline', url: 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3' },
  { name: 'Soft Chime', icon: 'musical-notes-outline', url: 'https://assets.mixkit.co/active_storage/sfx/2875/2875-preview.mp3' },
  { name: 'Digital Alert', icon: 'pulse-outline', url: 'https://assets.mixkit.co/active_storage/sfx/2870/2870-preview.mp3' },
  { name: 'Notification Tone', icon: 'volume-medium-outline', url: 'https://assets.mixkit.co/active_storage/sfx/2872/2872-preview.mp3' },
];

// Build a QR code image URL from Google Charts API (no extra dependency needed)
const getQRUrl = (text) =>
  `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(text)}&color=0f172a&bgcolor=ffffff&qzone=2`;

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