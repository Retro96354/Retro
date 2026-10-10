import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { auth, db } from '../src/firebaseConfig';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

export default function AdminLoginScreen({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) return Alert.alert("Error", "Please fill in all fields");
    setLoading(true);
    try {
      // Try Firebase Auth first
      await signInWithEmailAndPassword(auth, email.toLowerCase().trim(), password);
      const q = query(collection(db, 'admins'), where('email', '==', email.toLowerCase().trim()));
      const snap = await getDocs(q);
      if (snap.empty) { Alert.alert("Login Failed", "Admin not found"); setLoading(false); return; }
      onLogin({ id: snap.docs[0].id, ...snap.docs[0].data() }, 'admin');
    } catch (authErr) {
      // Fallback: old Firestore check for existing admins without Auth account
      if (authErr.code === 'auth/user-not-found' || authErr.code === 'auth/invalid-credential') {
        try {
          const q = query(collection(db, 'admins'), where('email', '==', email.toLowerCase().trim()));
          const snap = await getDocs(q);
          if (snap.empty) { Alert.alert("Login Failed", "Admin not found"); setLoading(false); return; }
          const adminData = snap.docs[0].data();
          if (adminData.password !== password) { Alert.alert("Login Failed", "Incorrect password"); setLoading(false); return; }
          // Migrate: create Firebase Auth user via backend (non-fatal if unreachable)
          try {
            const res = await fetch(`${BACKEND_URL}/api/auth/create-user`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-admin-key': process.env.EXPO_PUBLIC_ADMIN_API_KEY || '' },
              body: JSON.stringify({ uid: snap.docs[0].id, email: email.toLowerCase().trim(), password }),
            });
            if (res.ok) { try { await signInWithEmailAndPassword(auth, email.toLowerCase().trim(), password); } catch (_) {} }
          } catch (_) { /* Backend unreachable — proceed with fallback auth */ }
          onLogin({ id: snap.docs[0].id, ...adminData }, 'admin');
        } catch (fallbackErr) {
          Alert.alert("Login Failed", fallbackErr.message);
        }
      } else {
        Alert.alert("Login Failed", authErr.message);
      }
    }
    setLoading(false);
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <View style={styles.logoContainer}>
          <View style={styles.logoIconBox}>
            <Ionicons name="shield-checkmark" size={24} color="#fff" />
          </View>
          <Text style={styles.title}>MIGME Admin</Text>
          <Text style={styles.subtitle}>SaaS Platform Administration</Text>
        </View>
        <View style={styles.form}>
          <View style={styles.inputContainer}>
            <Text style={styles.label}>ADMIN EMAIL</Text>
            <TextInput
              style={styles.input}
              placeholder="admin@migme.app"
              placeholderTextColor="#94a3b8"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />
          </View>
          <View style={styles.inputContainer}>
            <Text style={styles.label}>PASSWORD</Text>
            <TextInput
              style={styles.input}
              placeholder="••••••••"
              placeholderTextColor="#94a3b8"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
          </View>
          <TouchableOpacity style={styles.btn} onPress={handleLogin} disabled={loading} activeOpacity={0.8}>
            {loading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Text style={styles.btnText}>ADMIN LOGIN</Text>
                <Ionicons name="arrow-forward" size={16} color="#fff" />
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a', justifyContent: 'center', alignItems: 'center', padding: 20 },
  card: { backgroundColor: '#1e293b', padding: 40, borderRadius: 12, width: '100%', maxWidth: 420, borderWidth: 1, borderColor: '#334155' },
  logoContainer: { alignItems: 'center', marginBottom: 32 },
  logoIconBox: { backgroundColor: '#3b82f6', width: 52, height: 52, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 24, fontWeight: '800', color: '#fff', letterSpacing: -0.5, marginBottom: 6 },
  subtitle: { fontSize: 14, color: '#94a3b8', fontWeight: '500' },
  form: { width: '100%' },
  inputContainer: { marginBottom: 20 },
  label: { fontSize: 10, fontWeight: '700', color: '#64748b', marginBottom: 8, letterSpacing: 0.8 },
  input: { borderWidth: 1, borderColor: '#334155', backgroundColor: '#0f172a', borderRadius: 8, paddingVertical: 12, paddingHorizontal: 16, fontSize: 15, color: '#fff' },
  btn: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, backgroundColor: '#3b82f6', paddingVertical: 14, borderRadius: 8, marginTop: 12 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 13, letterSpacing: 0.5 },
});
