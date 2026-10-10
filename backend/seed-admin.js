// Run this script ONCE to create the initial admin account
// Usage: node backend/seed-admin.js
// Creates both a Firestore doc and a Firebase Auth user

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { initializeApp } = require('firebase/app');
const { getFirestore, collection, where, query, getDocs, addDoc } = require('firebase/firestore');
const admin = require('firebase-admin');

const firebaseConfig = {
  apiKey:            process.env.EXPO_PUBLIC_FIREBAS_API_KEY,
  authDomain:        process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId:         process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket:     process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId:             process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const SA_PATH = require('path').join(__dirname, 'serviceAccountKey.json');
if (admin.apps.length === 0) {
  if (require('fs').existsSync(SA_PATH)) {
    admin.initializeApp({ credential: admin.credential.cert(SA_PATH) });
  } else {
    admin.initializeApp({ projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID });
  }
}
const authAdmin = admin.auth();

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

async function seedAdmin() {
  try {
    const q = query(collection(db, 'admins'), where('email', '==', ADMIN_EMAIL));
    const existing = await getDocs(q);
    let uid;
    if (existing.empty) {
      const docRef = await addDoc(collection(db, 'admins'), {
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
        createdAt: new Date().toISOString(),
      });
      uid = docRef.id;
      console.log(`Admin Firestore doc created: ${ADMIN_EMAIL} (${uid})`);
    } else {
      uid = existing.docs[0].id;
      console.log('Admin Firestore doc already exists');
    }

    // Create Firebase Auth user (idempotent — skips if already exists)
    try {
      await authAdmin.createUser({ uid, email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
      console.log(`Firebase Auth user created: ${ADMIN_EMAIL}`);
    } catch (authErr) {
      if (authErr.code === 'auth/uid-already-exists' || authErr.code === 'auth/email-already-exists') {
        console.log('Firebase Auth user already exists');
      } else {
        console.error('Auth creation error:', authErr.message);
      }
    }
  } catch (err) {
    console.error('Error:', err);
  }
  process.exit(0);
}

seedAdmin();
