import { getApp, getApps, initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const requiredKeys = Object.keys(firebaseConfig);

export function getFirebaseDb() {
  const missingKey = requiredKeys.find((key) => !firebaseConfig[key]);

  if (missingKey) {
    throw new Error("La tienda no está configurada para mostrar el catálogo.");
  }

  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

  return getFirestore(app);
}

export function getFirebaseAuth() {
  const missingKey = requiredKeys.find((key) => !firebaseConfig[key]);
  if (missingKey) throw new Error("La tienda no está configurada para iniciar sesión.");
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  return getAuth(app);
}
