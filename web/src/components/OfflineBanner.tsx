import { useEffect, useState } from 'react'
import { WifiOff } from 'lucide-react'

export default function OfflineBanner() {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => { const on = () => setOnline(true), off = () => setOnline(false); addEventListener('online', on); addEventListener('offline', off); return () => { removeEventListener('online', on); removeEventListener('offline', off) } }, [])
  if (online) return null
  return <div role="status" className="safe-t fixed inset-x-0 top-0 z-[65] flex items-center justify-center gap-2 bg-ink px-4 py-2 text-sm text-white"><WifiOff className="size-4" />You’re offline. Changes will sync when you reconnect.</div>
}
