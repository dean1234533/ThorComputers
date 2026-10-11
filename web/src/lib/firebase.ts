import { initializeApp } from 'firebase/app'
import { getAuth, connectAuthEmulator } from 'firebase/auth'
import { initializeFirestore, persistentLocalCache, persistentSingleTabManager, connectFirestoreEmulator } from 'firebase/firestore'
import { getStorage, connectStorageEmulator } from 'firebase/storage'
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions'

const env = import.meta.env
export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY, authDomain: env.VITE_FIREBASE_AUTH_DOMAIN, projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET, messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID, appId: env.VITE_FIREBASE_APP_ID,
}
export const isConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId)

export const app = initializeApp(isConfigured ? firebaseConfig : { apiKey: 'unconfigured', projectId: 'unconfigured', appId: 'unconfigured' })
export const auth = getAuth(app)
// Offline cache is memory-light and per-origin; it is cleared on sign-out (see auth.tsx) so private data never lingers on shared devices.
export const db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentSingleTabManager(undefined) }) })
export const storage = getStorage(app)
export const functions = getFunctions(app, 'europe-west2')

if (env.VITE_USE_EMULATORS === 'true') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
  connectStorageEmulator(storage, '127.0.0.1', 9199)
  connectFunctionsEmulator(functions, '127.0.0.1', 5001)
  console.info('[firebase] using LOCAL EMULATORS (auth 9099, firestore 8080, storage 9199, functions 5001); project', firebaseConfig.projectId)
}
