import { useEffect, useState } from 'react'
import { WifiOff } from 'lucide-react'

/** navigator.onLine is unreliable (VPNs, virtual adapters and some Wi-Fi setups make Chrome report "offline" while the network works),
 *  so the browser's claim is only a hint: confirm with a real, uncached request to our own origin before telling the user they are offline. */
const reallyOnline = async () => { try { await fetch(`/favicon.png?ping=${Date.now()}`, { method: 'HEAD', cache: 'no-store' }); return true } catch { return false } }

export default function OfflineBanner() {
  const [online, setOnline] = useState(true)
  useEffect(() => {
    let live = true
    const check = async () => { const ok = navigator.onLine ? true : await reallyOnline(); if (live) setOnline(ok) }
    const on = () => setOnline(true), off = () => { void check() }
    if (!navigator.onLine) void check()
    addEventListener('online', on); addEventListener('offline', off)
    const poll = setInterval(() => { if (!navigator.onLine) void check() }, 15000)   // recover even if the browser never fires "online"
    return () => { live = false; clearInterval(poll); removeEventListener('online', on); removeEventListener('offline', off) }
  }, [])
  if (online) return null
  return <div role="status" className="safe-t fixed inset-x-0 top-0 z-[65] flex items-center justify-center gap-2 bg-ink px-4 py-2 text-sm text-white"><WifiOff className="size-4" />You’re offline. Changes will sync when you reconnect.</div>
}
