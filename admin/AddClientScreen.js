import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

function generatePassword(length = 12) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#';
  let pwd = '';
  for (let i = 0; i < length; i++) {
    pwd += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pwd;
}

function getPasswordStrength(pw) {
  if (!pw) return { score: 0, label: 'Enter or generate a password', color: '#6b7280' };
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const map = [
    { label: 'Too short', color: '#e24b4a' },
    { label: 'Weak',      color: '#e24b4a' },
    { label: 'Fair',      color: '#ef9f27' },
    { label: 'Good',      color: '#639922' },
    { label: 'Strong',    color: '#86efac' },
  ];
  return { score, ...map[score] };
}

// ── Sub-components ────────────────────────────────────────────────────────────

const CheckItem = ({ done, label }) => (
  <View style={s.checkItem}>
    <Ionicons
      name={done ? 'checkmark-circle' : 'ellipse-outline'}
      size={16}
      color={done ? '#86efac' : '#4b5563'}
    />
    <Text style={[s.checkLabel, done && s.checkLabelDone]}>{label}</Text>
  </View>
);

const PreviewRow = ({ label, value, badge }) => (
  <View style={s.previewRow}>
    <Text style={s.previewKey}>{label}</Text>
    {badge ? (
      <View style={s.pendingBadge}>
        <Text style={s.pendingBadgeText}>Pending</Text>
      </View>
    ) : (
      <Text style={s.previewVal} numberOfLines={1}>{value}</Text>
    )}
  </View>
);

// ── Main screen ───────────────────────────────────────────────────────────────

export default function AddClientScreen({ onBack }) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= 768;

  const [businessName, setBusinessName]         = useState('');
  const [address, setAddress]                   = useState('');
  const [email, setEmail]                       = useState('');
  const [appPassword, setAppPassword]           = useState('');
  const [showAppPw, setShowAppPw]               = useState(false);
  const [generatedPassword, setGeneratedPassword] = useState('');
  const [loading, setLoading]                   = useState(false);

  const strength = getPasswordStrength(generatedPassword);

  const checks = {
    businessName: businessName.trim().length > 0,
    address:      address.trim().length > 0,
    email:        /^[^\s@]+@gmail\.com$/i.test(email),
    appPassword:  appPassword.length > 3,
    password:     generatedPassword.length >= 6,
  };
  const allValid = Object.values(checks).every(Boolean);

  const handleCreateClient = async () => {
    if (!allValid) {
      Alert.alert('Incomplete form', 'Please fill in all fields correctly and generate a password.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/clients`, {
           method: 'POST',
           headers: { 
                       'Content-Type': 'application/json',
                       'x-admin-key': process.env.EXPO_PUBLIC_ADMIN_API_KEY || '', // ✅ Add this
              },
                body: JSON.stringify({
                businessName: businessName.trim(),
                address: address.trim(),
                email: email.trim().toLowerCase(),
                appPassword: appPassword.trim(),
                password: generatedPassword,
           }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || 'Failed to create client');
      }
      const data = await res.json();
      Alert.alert(
        'Client created',
        `"${data.businessName}" is ready.\n\nEmail: ${email.trim().toLowerCase()}\nPassword: ${generatedPassword}`,
        [{ text: 'Done', onPress: onBack }]
      );
    } catch (error) {
      Alert.alert('Error', error.message);
    }
    setLoading(false);
  };

  // ── Sidebar (desktop only) ─────────────────────────────────────────────────
  const Sidebar = () => (
    <View style={s.sidebar}>

      {/* Checklist */}
      <View style={s.sideCard}>
        <View style={s.sideCardHeader}>
          <Ionicons name="checkbox-outline" size={15} color="#6b7280" />
          <Text style={s.sideCardTitle}>Form checklist</Text>
        </View>
        <CheckItem done={checks.businessName} label="Business name entered" />
        <CheckItem done={checks.address}      label="Business address entered" />
        <CheckItem done={checks.email}        label="Valid Gmail address" />
        <CheckItem done={checks.appPassword}  label="App password added" />
        <CheckItem done={checks.password}     label="Login password set" />
      </View>

      {/* Live preview */}
      <View style={s.sideCard}>
        <View style={s.sideCardHeader}>
          <Ionicons name="eye-outline" size={15} color="#6b7280" />
          <Text style={s.sideCardTitle}>Live preview</Text>
        </View>
        <PreviewRow label="Business" value={businessName || '—'} />
        <PreviewRow label="Address"  value={address || '—'} />
        <PreviewRow label="Email"    value={email || '—'} />
        <PreviewRow label="Status"   badge />
      </View>

      {/* App password help */}
      <View style={s.sideCard}>
        <View style={s.sideCardHeader}>
          <Ionicons name="key-outline" size={15} color="#6b7280" />
          <Text style={s.sideCardTitle}>App password help</Text>
        </View>
        <View style={s.tipBox}>
          <Text style={s.tipText}>
            Go to{' '}
            <Text style={s.tipBold}>
              Google Account → Security → 2-step verification → App passwords
            </Text>
            {'. '}Create one for "Mail" and paste it above.
          </Text>
        </View>
      </View>

    </View>
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <View style={s.container}>

      {/* Top bar */}
      <View style={s.topBar}>
        <TouchableOpacity onPress={onBack} style={s.backBtn}>
          <Ionicons name="arrow-back" size={17} color="#9ca3af" />
        </TouchableOpacity>
        <Text style={s.heading} numberOfLines={1}>Add new client</Text>
        {isDesktop && <Text style={s.breadcrumb}>Clients / New</Text>}
      </View>

      <ScrollView
        contentContainerStyle={[s.scrollContent, isDesktop && s.scrollContentDesktop]}
      >
        <View style={[s.mainGrid, isDesktop && s.mainGridDesktop]}>

          {/* ── Form card ── */}
          <View style={[s.card, isDesktop && s.cardDesktop]}>

            {/* Card header */}
            <View style={s.cardHeader}>
              <View style={s.cardDot} />
              <Text style={s.cardTitle}>Client information</Text>
              <View style={s.draftBadge}>
                <View style={s.draftDot} />
                <Text style={s.draftBadgeText}>Draft</Text>
              </View>
            </View>

            {/* Row 1: Business name + Email */}
            <View style={[s.formRow, isDesktop && s.formRowDesktop]}>
              <View style={[s.field, isDesktop && s.fieldHalf]}>
                <Text style={s.label}>Business name</Text>
                <View style={s.inputWrap}>
                  <TextInput
                    style={[s.input, s.inputIcon]}
                    placeholder="e.g. Samrat Hotel"
                    placeholderTextColor="#4b5563"
                    value={businessName}
                    onChangeText={setBusinessName}
                  />
                  <Ionicons name="storefront-outline" size={16} color="#6b7280" style={s.iconRight} />
                </View>
              </View>

              <View style={[s.field, isDesktop && s.fieldHalf]}>
                <Text style={s.label}>Gmail address</Text>
                <View style={s.inputWrap}>
                  <TextInput
                    style={[s.input, s.inputIcon]}
                    placeholder="hotel@gmail.com"
                    placeholderTextColor="#4b5563"
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    keyboardType="email-address"
                  />
                  <Ionicons name="mail-outline" size={16} color="#6b7280" style={s.iconRight} />
                </View>
              </View>
            </View>

            {/* Business address — used on printed bills */}
            <View style={s.field}>
              <Text style={s.label}>Business address</Text>
              <View style={s.inputWrap}>
                <TextInput
                  style={[s.input, s.textArea]}
                  placeholder="e.g. Shop No. 4, Station Road, Pune, Maharashtra 411001"
                  placeholderTextColor="#4b5563"
                  value={address}
                  onChangeText={setAddress}
                  multiline
                  numberOfLines={2}
                  textAlignVertical="top"
                />
              </View>
              <Text style={s.helperText}>This is printed on every delivery receipt for this client.</Text>
            </View>

            {/* Gmail app password */}
            <View style={s.field}>
              <Text style={s.label}>Gmail app password</Text>
              <View style={s.inputWrap}>
                <TextInput
                  style={[s.input, s.inputIcon]}
                  placeholder="App password from Google account"
                  placeholderTextColor="#4b5563"
                  value={appPassword}
                  onChangeText={setAppPassword}
                  secureTextEntry={!showAppPw}
                />
                <TouchableOpacity
                  onPress={() => setShowAppPw(v => !v)}
                  style={s.iconBtn}
                >
                  <Ionicons
                    name={showAppPw ? 'eye-off-outline' : 'eye-outline'}
                    size={16}
                    color="#6b7280"
                  />
                </TouchableOpacity>
              </View>
            </View>

            {/* Client login password */}
            {/*
              FIX: on narrow (mobile) widths this row used to stay
              flexDirection:'row' with the input taking flex:1 and the
              "Generate" button sized to its own content. When the
              screen (or the space left after any outer nav rail) got
              narrow, the button had no room left and its label got
              visually clipped ("Generat…").
              Now on mobile it stacks: input on top, full-width
              "Generate" button below — nothing can get cut off.
              Desktop keeps the original side-by-side layout.
            */}
            <View style={s.field}>
              <Text style={s.label}>Client login password</Text>
              <View style={[s.passwordRow, !isDesktop && s.passwordRowMobile]}>
                <TextInput
                  style={[s.passwordInput, !isDesktop && s.passwordInputMobile]}
                  placeholder="Generate or type a password"
                  placeholderTextColor="#4b5563"
                  value={generatedPassword}
                  onChangeText={setGeneratedPassword}
                />
                <TouchableOpacity
                  style={[s.genBtn, !isDesktop && s.genBtnMobile]}
                  onPress={() => setGeneratedPassword(generatePassword())}
                  activeOpacity={0.85}
                >
                  <Ionicons name="refresh" size={15} color="#fff" />
                  <Text style={s.genBtnText}>Generate</Text>
                </TouchableOpacity>
              </View>
              {/* Strength bar */}
              <View style={s.strengthRow}>
                {[0, 1, 2, 3].map(i => (
                  <View
                    key={i}
                    style={[
                      s.strengthSeg,
                      i < strength.score && { backgroundColor: strength.color },
                    ]}
                  />
                ))}
              </View>
              <Text style={[s.strengthLabel, { color: strength.color }]}>
                {strength.label}
              </Text>
            </View>

            {/* Info box */}
            <View style={s.infoBox}>
              <Ionicons name="information-circle-outline" size={17} color="#60a5fa" style={{ marginTop: 1 }} />
              <Text style={s.infoText}>
                The client uses their email and this password to log in. Their Gmail inbox is polled automatically for incoming catering order emails.
              </Text>
            </View>

            {/* Mobile checklist */}
            {!isDesktop && (
              <View style={s.mobileChecklist}>
                <View style={s.sideCardHeader}>
                  <Ionicons name="checkbox-outline" size={14} color="#6b7280" />
                  <Text style={s.sideCardTitle}>Checklist</Text>
                </View>
                <CheckItem done={checks.businessName} label="Business name entered" />
                <CheckItem done={checks.address}      label="Business address entered" />
                <CheckItem done={checks.email}        label="Valid Gmail address" />
                <CheckItem done={checks.appPassword}  label="App password added" />
                <CheckItem done={checks.password}     label="Login password set" />
              </View>
            )}

            {/* Actions */}
            <View style={[s.actions, !isDesktop && s.actionsMobile]}>
              <TouchableOpacity style={[s.cancelBtn, !isDesktop && s.actionBtnMobile]} onPress={onBack}>
                <Text style={s.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.saveBtn, !isDesktop && s.actionBtnMobile, (!allValid || loading) && s.saveBtnDisabled]}
                onPress={handleCreateClient}
                disabled={!allValid || loading}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name="checkmark" size={16} color="#fff" />
                    <Text style={s.saveBtnText}>Create client</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

          </View>

          {/* Sidebar — desktop only */}
          {isDesktop && <Sidebar />}

        </View>
      </ScrollView>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({

  // Root
  container:            { flex: 1, backgroundColor: '#111827' },

  // Top bar
  topBar:               { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 24, paddingVertical: 14, backgroundColor: '#1f2937', borderBottomWidth: 1, borderColor: '#374151' },
  backBtn:              { width: 36, height: 36, borderRadius: 8, borderWidth: 1, borderColor: '#374151', justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  heading:              { fontSize: 16, fontWeight: '600', color: '#f9fafb', flexShrink: 1 },
  breadcrumb:           { marginLeft: 'auto', fontSize: 13, color: '#6b7280' },

  // Scroll + layout
  scrollContent:        { padding: 16 },
  scrollContentDesktop: { padding: 24 },
  mainGrid:             { flexDirection: 'column', gap: 16 },
  mainGridDesktop:      { flexDirection: 'row', alignItems: 'flex-start', gap: 20 },

  // Form card
  card:                 { backgroundColor: '#1f2937', borderRadius: 12, padding: 20, borderWidth: 1, borderColor: '#374151', flex: 1 },
  cardDesktop:          { maxWidth: 720 },
  cardHeader:           { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 22, paddingBottom: 16, borderBottomWidth: 1, borderColor: '#374151' },
  cardDot:              { width: 3, height: 20, backgroundColor: '#3b82f6', borderRadius: 2 },
  cardTitle:            { fontSize: 15, fontWeight: '600', color: '#f9fafb', flex: 1 },

  // Draft badge
  draftBadge:           { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#1e3a5f', borderWidth: 1, borderColor: '#1d4ed8', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99 },
  draftDot:             { width: 7, height: 7, borderRadius: 99, backgroundColor: '#3b82f6' },
  draftBadgeText:       { fontSize: 12, fontWeight: '500', color: '#60a5fa' },

  // Form layout
  formRow:              { flexDirection: 'column' },
  formRowDesktop:       { flexDirection: 'row', gap: 16 },
  field:                { marginBottom: 16 },
  fieldHalf:            { flex: 1 },

  // Labels
  label:                { fontSize: 12, fontWeight: '600', color: '#9ca3af', marginBottom: 6, letterSpacing: 0.5, textTransform: 'uppercase' },

  // Inputs
  inputWrap:            { justifyContent: 'center' },
  input:                { borderWidth: 1, borderColor: '#374151', borderRadius: 8, paddingVertical: 11, paddingHorizontal: 14, fontSize: 14, color: '#f9fafb', backgroundColor: '#111827' },
  inputIcon:            { paddingRight: 40 },
  textArea:             { minHeight: 56, paddingTop: 11 },
  helperText:           { fontSize: 11, color: '#6b7280', marginTop: 6 },
  iconRight:            { position: 'absolute', right: 12 },
  iconBtn:              { position: 'absolute', right: 12, padding: 2 },

  // Password row
  // Desktop: input + button side-by-side (original layout)
  passwordRow:          { flexDirection: 'row', gap: 8, marginBottom: 7 },
  passwordInput:        { flex: 1, borderWidth: 1, borderColor: '#374151', borderRadius: 8, paddingVertical: 11, paddingHorizontal: 14, fontSize: 14, color: '#f9fafb', backgroundColor: '#111827' },
  genBtn:               { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#3b82f6', paddingHorizontal: 16, paddingVertical: 11, borderRadius: 8 },
  genBtnText:           { color: '#fff', fontWeight: '600', fontSize: 13 },
  // Mobile: stack input above a full-width button so "Generate" never
  // gets squeezed/clipped by limited horizontal space.
  passwordRowMobile:    { flexDirection: 'column', gap: 8 },
  passwordInputMobile:  { flex: 0, width: '100%' },
  genBtnMobile:         { width: '100%', paddingVertical: 12 },

  // Strength bar
  strengthRow:          { flexDirection: 'row', gap: 4, marginBottom: 5 },
  strengthSeg:          { flex: 1, height: 3, borderRadius: 99, backgroundColor: '#374151' },
  strengthLabel:        { fontSize: 12, fontWeight: '500' },

  // Info box
  infoBox:              { flexDirection: 'row', gap: 10, padding: 14, backgroundColor: '#1e3a5f', borderRadius: 8, borderWidth: 1, borderColor: '#1d4ed8', marginTop: 4, alignItems: 'flex-start' },
  infoText:             { fontSize: 13, color: '#93c5fd', flex: 1, lineHeight: 19 },

  // Mobile checklist
  mobileChecklist:      { marginTop: 16, padding: 14, backgroundColor: '#111827', borderRadius: 8, borderWidth: 1, borderColor: '#374151', gap: 8 },

  // Actions
  actions:              { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 24, paddingTop: 18, borderTopWidth: 1, borderColor: '#374151' },
  actionsMobile:        { flexDirection: 'column-reverse' },
  actionBtnMobile:      { width: '100%', justifyContent: 'center' },
  cancelBtn:            { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8, borderWidth: 1, borderColor: '#374151', backgroundColor: 'transparent', alignItems: 'center' },
  cancelBtnText:        { color: '#9ca3af', fontWeight: '600', fontSize: 13 },
  saveBtn:              { flexDirection: 'row', gap: 7, alignItems: 'center', backgroundColor: '#3b82f6', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8 },
  saveBtnDisabled:      { opacity: 0.4 },
  saveBtnText:          { color: '#fff', fontWeight: '600', fontSize: 13 },

  // Sidebar
  sidebar:              { width: 280, gap: 14, flexShrink: 0 },
  sideCard:             { backgroundColor: '#1f2937', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#374151', gap: 8 },
  sideCardHeader:       { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 4 },
  sideCardTitle:        { fontSize: 13, fontWeight: '600', color: '#d1d5db' },

  // Checklist
  checkItem:            { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkLabel:           { fontSize: 13, color: '#6b7280' },
  checkLabelDone:       { color: '#86efac' },

  // Preview rows
  previewRow:           { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderColor: '#374151' },
  previewKey:           { fontSize: 13, color: '#6b7280' },
  previewVal:           { fontSize: 13, fontWeight: '500', color: '#e5e7eb', maxWidth: 150 },
  pendingBadge:         { backgroundColor: '#1e3a5f', borderWidth: 1, borderColor: '#1d4ed8', paddingHorizontal: 9, paddingVertical: 2, borderRadius: 99 },
  pendingBadgeText:     { fontSize: 11, fontWeight: '500', color: '#60a5fa' },

  // Tip box
  tipBox:               { backgroundColor: '#111827', borderRadius: 8, padding: 12, borderWidth: 1, borderColor: '#374151' },
  tipText:              { fontSize: 12, color: '#6b7280', lineHeight: 18 },
  tipBold:              { fontWeight: '600', color: '#9ca3af' },
});
