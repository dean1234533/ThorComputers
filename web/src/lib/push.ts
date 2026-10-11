import { getMessaging, getToken, deleteToken, isSupported, onMessage } from 'firebase/messaging'
import { collection, deleteDoc, doc, getDocs, query, serverTimestamp, setDoc, where } from 'firebase/firestore'
import { app, db } from './firebase'
import { isIOS, isStandalone } from './pwa'

const KEY = 'thor.push.dismissedAt'
const lsGet = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
export const pushDismissedRecently = () => Date.now() - Number(lsGet(KEY) ?? 0) < 7 * 86400_000
export const dismissPush = () => { try { localStorage.setItem(KEY, String(Date.now())) } catch { /* ignore */ } }

export type PushSupport = 'ok' | 'ios-needs-install' | 'unsupported'
export async function pushSupport(): Promise<PushSupport> {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return isIOS() && !isStandalone() ? 'ios-needs-install' : 'unsupported'
  if (isIOS() && !isStandalone()) return 'ios-needs-install'      // iOS only allows web push for installed web apps
  return (await isSupported()) ? 'ok' : 'unsupported'
}
export const permission = () => ('Notification' in window ? Notification.permission : 'denied')

const tokenId = async (token: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 40)

/** Must be called from a user gesture. Never auto-requests; never re-asks after a denial. */
export async function enablePush(userId: string): Promise<'granted' | 'denied' | 'unsupported'> {
  if ((await pushSupport()) !== 'ok') return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  const result = await Notification.requestPermission()
  if (result !== 'granted') { dismissPush(); return 'denied' }
  const reg = await navigator.serviceWorker.ready
  const token = await getToken(getMessaging(app), { vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY, serviceWorkerRegistration: reg })
  if (!token) return 'unsupported'
  await setDoc(doc(db, 'deviceTokens', await tokenId(token)), { userId, token, platform: isIOS() ? 'ios' : /Android/.test(navigator.userAgent) ? 'android' : 'desktop', userAgent: navigator.userAgent.slice(0, 160), createdAt: serverTimestamp(), lastSeenAt: serverTimestamp() })
  return 'granted'
}

export async function disablePush(userId: string) {
  try { await deleteToken(getMessaging(app)) } catch { /* no token */ }
  const snap = await getDocs(query(collection(db, 'deviceTokens'), where('userId', '==', userId)))
  await Promise.all(snap.docs.map(d => deleteDoc(d.ref)))
}
/** Foreground messages are shown in-app (toast) instead of a system notification. */
export const onForeground = async (cb: (d: Record<string, string>) => void) => { if ((await pushSupport()) !== 'ok') return () => {}; return onMessage(getMessaging(app), p => cb((p.data ?? {}) as Record<string, string>)) }
