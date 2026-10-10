import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, Platform
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { doc, updateDoc, arrayRemove, arrayUnion, onSnapshot } from 'firebase/firestore';
import { db } from '../src/firebaseConfig';

// ─── Glassmorphism Token System ───────────────────────────────────────────────
const G = {
  bg1: '#0d1117',          // deepest background
  bg2: '#111827',          // surface
  accent: '#6366f1',       // indigo glow
  accentSoft: 'rgba(99,102,241,0.18)',
  accentBorder: 'rgba(99,102,241,0.35)',
  glassWhite: 'rgba(255,255,255,0.06)',
  glassBorder: 'rgba(255,255,255,0.10)',
  glassBorderStrong: 'rgba(255,255,255,0.16)',
  green: '#22c55e',
  greenGlass: 'rgba(34,197,94,0.15)',
  greenBorder: 'rgba(34,197,94,0.35)',
  red: '#f87171',
  redGlass: 'rgba(248,113,113,0.12)',
  redBorder: 'rgba(248,113,113,0.30)',
  amber: '#fbbf24',
  amberGlass: 'rgba(251,191,36,0.12)',
  amberBorder: 'rgba(251,191,36,0.30)',
  blue: '#60a5fa',
  blueGlass: 'rgba(96,165,250,0.10)',
  blueBorder: 'rgba(96,165,250,0.25)',
  textPrimary: '#f1f5f9',
  textSecondary: '#94a3b8',
  textMuted: '#475569',
};

// ─── Reusable GlassCard ───────────────────────────────────────────────────────
function GlassCard({ children, style, accentColor }) {
  return (
    <View style={[styles.glassCard, accentColor && { borderTopColor: accentColor, borderTopWidth: 1.5 }, style]}>
      {children}
    </View>
  );
}

// ─── Section Header ───────────────────────────────────────────────────────────
function SectionHeader({ label, dot, count }) {
  return (
    <View style={styles.sectionHeader}>
      <View style={[styles.sectionDot, { backgroundColor: dot || G.accent }]} />
      <Text style={styles.sectionTitle}>{label}</Text>
      {count !== undefined && (
        <View style={styles.countPill}>
          <Text style={styles.countText}>{count}</Text>
        </View>
      )}
    </View>
  );
}

// ─── Toggle Button ────────────────────────────────────────────────────────────
function GlassToggle({ isOn, onPress, labelOn, labelOff, colorOn, colorOff, saving }) {
  const bg = isOn
    ? (colorOn || G.greenGlass)
    : (colorOff || G.redGlass);
  const border = isOn
    ? (colorOn ? colorOn.replace('0.15', '0.40') : G.greenBorder)
    : (colorOff ? colorOff.replace('0.12', '0.35') : G.redBorder);
  const textColor = isOn ? G.green : G.red;

  return (
    <TouchableOpacity
      style={[styles.glassToggle, { backgroundColor: bg, borderColor: border }]}
      onPress={onPress}
      disabled={saving}
      activeOpacity={0.75}
    >
      {saving ? (
        <ActivityIndicator size="small" color={textColor} />
      ) : (
        <>
          <View style={[styles.toggleDot, { backgroundColor: textColor }]} />
          <Text style={[styles.toggleLabel, { color: textColor }]}>
            {isOn ? labelOn : labelOff}
          </Text>
        </>
      )}
    </TouchableOpacity>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function ClientDetailScreen({ client, onBack }) {
  const [liveClient, setLiveClient] = useState(client);
  const [saving, setSaving] = useState(false);
  const [newBlockedEmail, setNewBlockedEmail] = useState('');
  const [vendors, setVendors] = useState([]);
  const [vendorSaving, setVendorSaving] = useState(null);

  const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || 'http://localhost:3000';

  useEffect(() => {
    if (!client?.id) return;
    const unsub = onSnapshot(doc(db, 'clients', client.id), (snap) => {
      if (snap.exists()) setLiveClient({ id: snap.id, ...snap.data() });
    });
    fetch(`${BACKEND_URL}/api/vendors`, {
      headers: { 'x-admin-key': process.env.EXPO_PUBLIC_ADMIN_API_KEY || '' },
    })
      .then(r => r.json())
      .then(setVendors)
      .catch(() => {});
    return () => unsub();
  }, [client?.id]);

  const togglePause = async () => {
    if (!liveClient?.id) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'clients', liveClient.id), {
        emailPaused: liveClient.emailPaused !== true,
      });
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setSaving(false);
  };

  const toggleActive = async () => {
    if (!liveClient?.id) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'clients', liveClient.id), {
        active: liveClient.active !== false,
      });
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setSaving(false);
  };

  const addBlockedEmail = async () => {
    const email = newBlockedEmail.trim().toLowerCase();
    if (!email || !liveClient?.id) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'clients', liveClient.id), {
        blockedSenders: arrayUnion(email),
      });
      setNewBlockedEmail('');
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setSaving(false);
  };

  const removeBlockedEmail = async (email) => {
    if (!liveClient?.id) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'clients', liveClient.id), {
        blockedSenders: arrayRemove(email),
      });
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setSaving(false);
  };

  const toggleVendorBlock = async (vendorType) => {
    if (!liveClient?.id) return;
    setVendorSaving(vendorType);
    try {
      const blocked = liveClient.blockedVendors || [];
      if (blocked.includes(vendorType)) {
        await updateDoc(doc(db, 'clients', liveClient.id), {
          blockedVendors: arrayRemove(vendorType),
        });
      } else {
        await updateDoc(doc(db, 'clients', liveClient.id), {
          blockedVendors: arrayUnion(vendorType),
        });
      }
    } catch (e) {
      Alert.alert('Error', e.message);
    }
    setVendorSaving(null);
  };

  if (!liveClient) return null;

  const isPaused    = liveClient.emailPaused === true;
  const isActive    = liveClient.active !== false;
  const blockedEmails = liveClient.blockedSenders || [];

  const displayPassword = liveClient.password || (liveClient.passwordHash ? '•••••••• (hashed)' : '—');

  const detailRows = [
    { label: 'Business Name', value: liveClient.businessName },
    { label: 'Gmail',         value: liveClient.email },
    { label: 'Password',      value: displayPassword },
    { label: 'Created',       value: liveClient.createdAt
        ? new Date(liveClient.createdAt).toLocaleDateString('en-GB')
        : '—' },
  ];

  return (
    <View style={styles.root}>

      {/* ── Ambient glow orbs ── */}
      <View style={styles.orb1} />
      <View style={styles.orb2} />

      {/* ── Top Bar ── */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={16} color={G.textSecondary} />
        </TouchableOpacity>

        <View style={styles.topBarCenter}>
          <View style={styles.topBarAvatar}>
            <Text style={styles.topBarAvatarText}>
              {liveClient.businessName?.charAt(0).toUpperCase()}
            </Text>
          </View>
          <View>
            <Text style={styles.topBarName}>{liveClient.businessName}</Text>
            <Text style={styles.topBarSub}>{liveClient.email}</Text>
          </View>
        </View>

        <View style={[styles.statusPill,
          isActive ? styles.statusPillActive : styles.statusPillInactive]}>
          <View style={[styles.statusDot,
            { backgroundColor: isActive ? G.green : G.red }]} />
          <Text style={[styles.statusPillText,
            { color: isActive ? G.green : G.red }]}>
            {isActive ? 'Active' : 'Inactive'}
          </Text>
        </View>
      </View>

      {/* ── Scroll ── */}
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >

        {/* Client Details */}
        <GlassCard accentColor={G.accent}>
          <SectionHeader label="Client Details" dot={G.accent} />
          {detailRows.map((row, i) => (
            <View key={i} style={[styles.detailRow,
              i < detailRows.length - 1 && styles.detailRowBorder]}>
              <Text style={styles.detailLabel}>{row.label}</Text>
              <Text style={styles.detailValue} numberOfLines={1}>{row.value}</Text>
            </View>
          ))}
        </GlassCard>

        {/* Email Reading Controls */}
        <GlassCard accentColor={G.amber}>
          <SectionHeader label="Email Reading Controls" dot={G.amber} />

          {/* Active toggle */}
          <View style={styles.controlRow}>
            <View style={styles.controlMeta}>
              <Text style={styles.controlLabel}>Account Active</Text>
              <Text style={styles.controlDesc}>Stops all email polling when inactive</Text>
            </View>
            <GlassToggle
              isOn={isActive}
              onPress={toggleActive}
              labelOn="ACTIVE"
              labelOff="INACTIVE"
              saving={saving}
            />
          </View>

          <View style={styles.glassDivider} />

          {/* Paused toggle */}
          <View style={styles.controlRow}>
            <View style={styles.controlMeta}>
              <Text style={styles.controlLabel}>Pause Email Reading</Text>
              <Text style={styles.controlDesc}>Inbox won't be polled for new orders</Text>
            </View>
            <GlassToggle
              isOn={!isPaused}
              onPress={togglePause}
              labelOn="RUNNING"
              labelOff="PAUSED"
              saving={saving}
            />
          </View>
        </GlassCard>

        {/* Blocked Senders */}
        <GlassCard accentColor={G.red}>
          <SectionHeader label="Blocked Senders" dot={G.red} count={blockedEmails.length} />

          {/* Input row */}
          <View style={styles.blockedInputRow}>
            <TextInput
              style={styles.blockedInput}
              placeholder="e.g. spam@example.com"
              placeholderTextColor={G.textMuted}
              value={newBlockedEmail}
              onChangeText={setNewBlockedEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              selectionColor={G.accent}
            />
            <TouchableOpacity
              style={[styles.blockAddBtn,
                !newBlockedEmail.trim() && { opacity: 0.4 }]}
              onPress={addBlockedEmail}
              disabled={!newBlockedEmail.trim() || saving}
              activeOpacity={0.8}
            >
              <Ionicons name="ban-outline" size={14} color={G.red} />
              <Text style={styles.blockAddText}>BLOCK</Text>
            </TouchableOpacity>
          </View>

          {blockedEmails.length === 0 ? (
            <View style={styles.emptyBlocked}>
              <View style={styles.emptyIcon}>
                <Ionicons name="shield-checkmark-outline" size={24} color={G.textMuted} />
              </View>
              <Text style={styles.emptyText}>No blocked senders</Text>
            </View>
          ) : (
            blockedEmails.map((email, idx) => (
              <View key={idx} style={styles.blockedChip}>
                <Ionicons name="ban" size={13} color={G.red} />
                <Text style={styles.blockedChipEmail}>{email}</Text>
                <TouchableOpacity
                  onPress={() => removeBlockedEmail(email)}
                  disabled={saving}
                  style={styles.chipRemove}
                  activeOpacity={0.7}
                >
                  <Ionicons name="close" size={12} color={G.textMuted} />
                </TouchableOpacity>
              </View>
            ))
          )}

          <View style={styles.infoStrip}>
            <Ionicons name="information-circle-outline" size={13} color={G.blue} />
            <Text style={styles.infoStripText}>
              Blocked emails are ignored for this client only — other clients remain unaffected.
            </Text>
          </View>
        </GlassCard>

        {/* Vendor Block/Unlock */}
        <GlassCard accentColor={G.amber}>
          <SectionHeader label="Vendors" dot={G.amber} count={vendors.length} />
          <View style={styles.infoStrip}>
            <Ionicons name="information-circle-outline" size={13} color={G.blue} />
            <Text style={styles.infoStripText}>
              Toggle to block or unblock a vendor for this client.
            </Text>
          </View>
          {vendors.length === 0 ? (
            <View style={styles.emptyBlocked}>
              <ActivityIndicator size="small" color={G.textMuted} />
            </View>
          ) : (
            vendors.map((v) => {
              const blocked = (liveClient.blockedVendors || []).includes(v.type);
              return (
                <View key={v.type} style={styles.blockedChip}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.blockedChipEmail}>{v.name}</Text>
                    <Text style={{ fontSize: 11, color: G.textMuted }}>{v.match}</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => toggleVendorBlock(v.type)}
                    disabled={vendorSaving === v.type}
                    style={[styles.blockAddBtn, blocked && { backgroundColor: G.redGlass, borderColor: G.redBorder }]}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name={blocked ? 'unlock-outline' : 'lock-closed-outline'}
                      size={14}
                      color={blocked ? G.red : G.green}
                    />
                    <Text style={[styles.blockAddText, { color: blocked ? G.red : G.green }]}>
                      {vendorSaving === v.type ? '...' : blocked ? 'UNLOCK' : 'BLOCK'}
                    </Text>
                  </TouchableOpacity>
                </View>
              );
            })
          )}
        </GlassCard>

        {/* Login Instructions */}
        <GlassCard>
          <SectionHeader label="Login Instructions" dot={G.accent} />
          <View style={styles.instructBox}>
            {[
              { icon: 'globe-outline',    label: 'URL',      val: 'This app (web / mobile)' },
              { icon: 'mail-outline',     label: 'Email',    val: liveClient.email },
              { icon: 'lock-closed-outline', label: 'Password', val: displayPassword },
            ].map((row, i) => (
              <View key={i} style={styles.instructRow}>
                <View style={styles.instructIcon}>
                  <Ionicons name={row.icon} size={13} color={G.accent} />
                </View>
                <Text style={styles.instructLabel}>{row.label}</Text>
                <Text style={styles.instructVal} numberOfLines={1}>{row.val}</Text>
              </View>
            ))}
          </View>
          <View style={styles.infoStrip}>
            <Ionicons name="share-outline" size={13} color={G.amber} />
            <Text style={[styles.infoStripText, { color: G.amber }]}>
              Share these credentials securely with the client.
            </Text>
          </View>
        </GlassCard>

        <View style={{ height: 32 }} />
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({

  // Root & ambient
  root: { flex: 1, backgroundColor: G.bg1 },
  orb1: {
    position: 'absolute', top: -80, left: -60,
    width: 260, height: 260, borderRadius: 130,
    backgroundColor: 'rgba(99,102,241,0.10)',
    // blur via shadow on iOS
    ...Platform.select({ ios: { shadowColor: '#6366f1', shadowRadius: 80, shadowOpacity: 0.4 } }),
  },
  orb2: {
    position: 'absolute', top: 180, right: -80,
    width: 200, height: 200, borderRadius: 100,
    backgroundColor: 'rgba(251,191,36,0.07)',
  },

  // Top bar
  topBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 14,
    backgroundColor: 'rgba(17,24,39,0.80)',
    borderBottomWidth: 1, borderBottomColor: G.glassBorder,
  },
  backBtn: {
    width: 34, height: 34, borderRadius: 10,
    backgroundColor: G.glassWhite,
    borderWidth: 1, borderColor: G.glassBorder,
    justifyContent: 'center', alignItems: 'center',
  },
  topBarCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  topBarAvatar: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: G.accentSoft,
    borderWidth: 1, borderColor: G.accentBorder,
    justifyContent: 'center', alignItems: 'center',
  },
  topBarAvatarText: { fontSize: 15, fontWeight: '700', color: G.accent },
  topBarName: { fontSize: 14, fontWeight: '700', color: G.textPrimary },
  topBarSub: { fontSize: 11, color: G.textMuted },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20,
    borderWidth: 1,
  },
  statusPillActive: { backgroundColor: G.greenGlass, borderColor: G.greenBorder },
  statusPillInactive: { backgroundColor: G.redGlass, borderColor: G.redBorder },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusPillText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },

  // Scroll
  scroll: { paddingHorizontal: 16, paddingTop: 16, gap: 12 },

  // Glass card
  glassCard: {
    backgroundColor: 'rgba(255,255,255,0.045)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: G.glassBorder,
    padding: 18,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.25,
        shadowRadius: 16,
      },
      android: { elevation: 4 },
    }),
  },

  // Section header
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  sectionDot: { width: 3, height: 18, borderRadius: 2 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: G.textPrimary, flex: 1, letterSpacing: 0.3 },
  countPill: {
    backgroundColor: G.glassWhite, borderRadius: 10,
    borderWidth: 1, borderColor: G.glassBorderStrong,
    paddingHorizontal: 8, paddingVertical: 2,
  },
  countText: { fontSize: 11, fontWeight: '700', color: G.textSecondary },

  // Detail rows
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 },
  detailRowBorder: { borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  detailLabel: { fontSize: 12, color: G.textMuted, fontWeight: '500', flex: 1 },
  detailValue: { fontSize: 13, color: G.textPrimary, fontWeight: '600', flex: 2, textAlign: 'right' },

  // Controls
  controlRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 12 },
  controlMeta: { flex: 1 },
  controlLabel: { fontSize: 13, fontWeight: '600', color: G.textPrimary },
  controlDesc: { fontSize: 11, color: G.textMuted, marginTop: 2 },
  glassDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.06)', marginVertical: 2 },

  // Toggle
  glassToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10,
    borderWidth: 1, minWidth: 108, justifyContent: 'center',
  },
  toggleDot: { width: 6, height: 6, borderRadius: 3 },
  toggleLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },

  // Blocked senders
  blockedInputRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  blockedInput: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1, borderColor: G.glassBorder,
    borderRadius: 10, paddingVertical: 10, paddingHorizontal: 13,
    fontSize: 13, color: G.textPrimary,
  },
  blockAddBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: G.redGlass,
    borderWidth: 1, borderColor: G.redBorder,
    paddingHorizontal: 14, borderRadius: 10,
  },
  blockAddText: { color: G.red, fontWeight: '700', fontSize: 12 },

  blockedChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(248,113,113,0.07)',
    borderWidth: 1, borderColor: 'rgba(248,113,113,0.20)',
    borderRadius: 10, paddingVertical: 9, paddingHorizontal: 12,
    marginBottom: 6,
  },
  blockedChipEmail: { flex: 1, fontSize: 12, color: '#fca5a5', fontWeight: '500' },
  chipRemove: {
    width: 22, height: 22, borderRadius: 6,
    backgroundColor: G.glassWhite, borderWidth: 1, borderColor: G.glassBorder,
    justifyContent: 'center', alignItems: 'center',
  },

  emptyBlocked: { alignItems: 'center', paddingVertical: 20, gap: 8 },
  emptyIcon: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: G.glassWhite, borderWidth: 1, borderColor: G.glassBorder,
    justifyContent: 'center', alignItems: 'center',
  },
  emptyText: { fontSize: 13, color: G.textMuted },

  // Info strip
  infoStrip: {
    flexDirection: 'row', gap: 7, alignItems: 'flex-start',
    marginTop: 12, padding: 10,
    backgroundColor: 'rgba(96,165,250,0.06)',
    borderRadius: 10, borderWidth: 1, borderColor: 'rgba(96,165,250,0.15)',
  },
  infoStripText: { fontSize: 11, color: G.blue, flex: 1, lineHeight: 16 },

  // Login instructions
  instructBox: { gap: 2, marginBottom: 4 },
  instructRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 9,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  instructIcon: {
    width: 26, height: 26, borderRadius: 8,
    backgroundColor: G.accentSoft, borderWidth: 1, borderColor: G.accentBorder,
    justifyContent: 'center', alignItems: 'center',
  },
  instructLabel: { fontSize: 12, color: G.textMuted, width: 64 },
  instructVal: { flex: 1, fontSize: 13, color: G.textPrimary, fontWeight: '600', textAlign: 'right' },
});