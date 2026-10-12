// Verifies certificate storage + metadata against localhost only, with temporary records cleaned up afterwards.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
const adminRequire = createRequire(new URL('../functions/', import.meta.url))
const clientRequire = createRequire(import.meta.url)
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199'
const { initializeApp: adminApp, deleteApp: deleteAdmin } = adminRequire('firebase-admin/app')
const { getAuth: adminAuth } = adminRequire('firebase-admin/auth')
const { getFirestore: adminFirestore } = adminRequire('firebase-admin/firestore')
const { getStorage: adminStorage } = adminRequire('firebase-admin/storage')
const { initializeApp, deleteApp } = clientRequire('firebase/app')
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } = clientRequire('firebase/auth')
const { getFirestore, connectFirestoreEmulator, addDoc, collection, getDocsFromServer, query, where, serverTimestamp, terminate } = clientRequire('firebase/firestore')
const { getStorage, connectStorageEmulator, uploadBytes, ref, getDownloadURL } = clientRequire('firebase/storage')
const uid = `certificate-check-${randomUUID()}`
const bucket = 'demo-thor.appspot.com'
const backend = adminApp({ projectId: 'demo-thor', storageBucket: bucket }, uid)
const frontend = initializeApp({ apiKey: 'demo-key', projectId: 'demo-thor', storageBucket: bucket }, uid)
const auth = getAuth(frontend), db = getFirestore(frontend), storage = getStorage(frontend)
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
connectFirestoreEmulator(db, '127.0.0.1', 8080)
connectStorageEmulator(storage, '127.0.0.1', 9199)
let record
try {
  const email = `${uid}@demo.test`, password = randomUUID()
  await adminAuth(backend).createUser({ uid, email, password, emailVerified: true })
  await adminAuth(backend).setCustomUserClaims(uid, { role: 'engineer', suspended: false })
  await signInWithEmailAndPassword(auth, email, password)
  const path = `qualifications/${uid}/certificate.pdf`
  await uploadBytes(ref(storage, path), new TextEncoder().encode('%PDF-1.4\n% temporary upload check\n%%EOF'), { contentType: 'application/pdf' })
  console.log('PASS: an engineer can upload a certificate PDF')
  record = await addDoc(collection(db, 'engineerQualifications'), { engineerId: uid, name: 'Certificate upload check', issuer: '', storagePath: path, verification: 'pending', createdAt: serverTimestamp() })
  const saved = await getDocsFromServer(query(collection(db, 'engineerQualifications'), where('engineerId', '==', uid)))
  assert.equal(saved.size, 1)
  assert.equal(saved.docs[0].id, record.id)
  assert.equal(saved.docs[0].data().verification, 'pending')
  console.log('PASS: the saved certificate is returned by the profile query')
  const download = await getDownloadURL(ref(storage, path))
  assert.match(download, /^http:\/\/127\.0\.0\.1:9199\//)
  console.log('PASS: its uploaded file can be opened by its owner')
  await assert.rejects(uploadBytes(ref(storage, 'qualifications/someone-else/certificate.pdf'), new Uint8Array([1]), { contentType: 'application/pdf' }), e => e.code === 'storage/unauthorized')
  console.log('PASS: another person’s certificates remain protected')
} finally {
  if (record) await adminFirestore(backend).recursiveDelete(adminFirestore(backend).doc(record.path))
  await adminStorage(backend).bucket().deleteFiles({ prefix: `qualifications/${uid}/` })
  await adminAuth(backend).deleteUser(uid).catch(e => { if (e.code !== 'auth/user-not-found') throw e })
  await terminate(db)
  await deleteApp(frontend)
  await deleteAdmin(backend)
  console.log('Temporary verification records removed.')
}
