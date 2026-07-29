import { initializeApp, getApps, getApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'
import { getAuth } from 'firebase/auth'
import { getStorage } from 'firebase/storage'
import { getAnalytics, isSupported as analyticsSupported } from 'firebase/analytics'

// Config is read from VITE_ env vars, with harmless placeholders as a fallback
// so the app boots in dev even before you wire up a real Firebase project.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'demo-api-key',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'physicsboard-demo.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'physicsboard-demo',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'physicsboard-demo.appspot.com',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '000000000000',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:000000000000:web:demo',
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || undefined,
}

// Reuse the existing app if one is already initialized (avoids a
// "duplicate-app" error during Vite HMR / repeated imports).
const app = getApps().length ? getApp() : initializeApp(firebaseConfig)

export const db = getFirestore(app)
export const auth = getAuth(app)
export const storage = getStorage(app)

// Analytics only works in a supported browser environment and needs a
// measurementId — initialise it lazily and never let it break the app.
export let analytics = null
if (firebaseConfig.measurementId) {
  analyticsSupported()
    .then((ok) => {
      if (ok) analytics = getAnalytics(app)
    })
    .catch(() => {})
}

// The single hard-coded admin UID that is allowed to WRITE (mirrors firestore.rules).
export const ADMIN_UID = import.meta.env.VITE_ADMIN_UID || 'REPLACE_WITH_ADMIN_UID'

// The active batch students see on the dashboard.
export const ACTIVE_BATCH_ID = 'batch_jee_2026_a'

export default app
