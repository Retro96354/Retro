import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { signInWithEmailAndPassword, signInAnonymously } from 'firebase/auth';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || 'http://localhost:3000';

export default function ClientLoginScreen({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) return Alert.alert("Error", "Please fill in all fields");
    setLoading(true);
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email.toLowerCase().trim(), password);
      const uid = userCredential.user.uid;
      console.log('✅ Firebase auth success, uid:', uid);

      const q = query(collection(db, 'clients'), where('email', '==', email.toLowerCase().trim()));
      const snap = await getDocs(q);
      console.log('✅ Firestore snap empty?', snap.empty, 'size:', snap.size);

      if (snap.empty) { Alert.alert("Login Failed", "Client not found"); setLoading(false); return; }
      const clientData = snap.docs[0].data();
      console.log('✅ clientData:', JSON.stringify(clientData));

      if (clientData.active === false) { Alert.alert("Account Disabled", "Please contact your administrator"); setLoading(false); return; }

      const loginPayload = { id: snap.docs[0].id, uid: uid, ...clientData };
      console.log('✅ Calling onLogin with payload:', JSON.stringify(loginPayload), 'role: client');
      onLogin(loginPayload, 'client');

    } catch (authErr) {
      console.log('❌ Auth error code:', authErr.code, authErr.message);
      if (
        authErr.code === 'auth/user-not-found' ||
        authErr.code === 'auth/invalid-credential' ||
        authErr.code === 'auth/invalid-login-credentials' ||
        authErr.code === 'auth/wrong-password' ||
        authErr.code === 'auth/network-request-failed'
      ) {
        try {
          const q = query(collection(db, 'clients'), where('email', '==', email.toLowerCase().trim()));
          const snap = await getDocs(q);
          if (snap.empty) { Alert.alert("Login Failed", "Client not found"); setLoading(false); return; }
          const clientDoc = snap.docs[0];
          const clientData = clientDoc.data();

          const match = clientData.password
            ? password === clientData.password
            : await verifyPasswordViaBackend(clientDoc.id, password);
          if (!match) { Alert.alert("Login Failed", "Incorrect password"); setLoading(false); return; }
          if (clientData.active === false) { Alert.alert("Account Disabled", "Please contact your administrator"); setLoading(false); return; }

          let uid = clientDoc.id;
          try {
            const createRes = await fetch(`${BACKEND_URL}/api/auth/create-user`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-admin-key': process.env.EXPO_PUBLIC_ADMIN_API_KEY || '' },
              body: JSON.stringify({ uid: clientDoc.id, email: email.toLowerCase().trim(), password }),
            });
            if (createRes.ok) {
              try {
                const uc = await signInWithEmailAndPassword(auth, email.toLowerCase().trim(), password);
                uid = uc.user.uid;
              } catch (_) {}
            } else {
              try {
                const anonCred = await signInAnonymously(auth);
                uid = anonCred.user.uid;
              } catch (_) {}
            }
          } catch (_) {
            try {
              const anonCred = await signInAnonymously(auth);
              uid = anonCred.user.uid;
            } catch (_) {}
          }

          const loginPayload = { id: clientDoc.id, uid: uid, ...clientData };
          console.log('✅ Fallback: Calling onLogin with:', JSON.stringify(loginPayload), 'role: client');
          onLogin(loginPayload, 'client');

        } catch (fallbackErr) {
          console.log('❌ Fallback error:', fallbackErr.message);
          Alert.alert("Login Failed", fallbackErr.message);
        }
      } else {
        Alert.alert("Login Failed", authErr.message);
      }
    }
    setLoading(false);
  };

  async function verifyPasswordViaBackend(uid, pwd) {
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/verify-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-key': process.env.EXPO_PUBLIC_ADMIN_API_KEY || '' },
        body: JSON.stringify({ uid, password: pwd }),
      });
      const data = await res.json();
      return data.valid === true;
    } catch { return false; }
  }

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <View style={styles.logoContainer}>
          <View style={styles.logoIconBox}>
            <Ionicons name="restaurant" size={24} color="#fff" />
          </View>
          <Text style={styles.title}>MIGME</Text>
          <Text style={styles.subtitle}>Sign in to manage your catering operations</Text>
        </View>
        <View style={styles.form}>
          <View style={styles.inputContainer}>
            <Text style={styles.label}>EMAIL ADDRESS</Text>
            <TextInput
              style={styles.input}
              placeholder="client@email.com"
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
                <Text style={styles.btnText}>AUTHENTICATE</Text>
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
  container: { flex: 1, backgroundColor: '#f8fafc', justifyContent: 'center', alignItems: 'center', padding: 20 },
  card: { backgroundColor: '#fff', padding: 40, borderRadius: 12, width: '100%', maxWidth: 420, borderWidth: 1, borderColor: '#e2e8f0' },
  logoContainer: { alignItems: 'center', marginBottom: 32 },
  logoIconBox: { backgroundColor: '#0f172a', width: 52, height: 52, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 24, fontWeight: '800', color: '#0f172a', letterSpacing: -0.5, marginBottom: 6 },
  subtitle: { fontSize: 14, color: '#64748b', fontWeight: '500' },
  form: { width: '100%' },
  inputContainer: { marginBottom: 20 },
  label: { fontSize: 10, fontWeight: '700', color: '#64748b', marginBottom: 8, letterSpacing: 0.8 },
  input: { borderWidth: 1, borderColor: '#e2e8f0', backgroundColor: '#f8fafc', borderRadius: 8, paddingVertical: 12, paddingHorizontal: 16, fontSize: 15, color: '#0f172a' },
  btn: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, backgroundColor: '#0f172a', paddingVertical: 14, borderRadius: 8, marginTop: 12 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 13, letterSpacing: 0.5 },
});
