import { Platform } from "react-native";
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getAnalytics, isSupported } from "firebase/analytics";

const firebaseConfig = {
  apiKey:            process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain:        process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId:         process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket:     process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId:             process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
  measurementId:     process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// ─────────────────────────────────────────────────────────────────────────
// ✅ Firebase Analytics — WEB ONLY.
//
// `firebase/analytics` relies on browser-only APIs (the gtag.js / GA4
// measurement library), which don't exist in a native Expo/React Native
// runtime. Importing the module is harmless on native, but calling
// getAnalytics() there would throw. Two guards are used together:
//
//   1. Platform.OS === 'web' — cheap, synchronous, rules out native
//      builds immediately.
//   2. isSupported() — Firebase's own async check, which additionally
//      rules out browser environments that lack IndexedDB / are in a
//      privacy mode that blocks measurement (e.g. some in-app browsers,
//      Safari private mode). This is the same check Firebase's own docs
//      recommend before calling getAnalytics().
//
// `analytics` is exported as a Promise that resolves to either the
// Analytics instance or null — callers should await it (or `.then()`)
// rather than assuming it's ready synchronously, since isSupported() is
// itself async.
// ─────────────────────────────────────────────────────────────────────────
export const analytics =
  Platform.OS === "web"
    ? isSupported()
        .then((supported) => (supported ? getAnalytics(app) : null))
        .catch(() => null)
    : Promise.resolve(null);
