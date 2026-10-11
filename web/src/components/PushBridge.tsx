import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { onForeground } from '@/lib/push'
import { useToast } from './ui'

/** Handles notification deep links from the service worker, and shows foreground pushes as in-app toasts. */
export default function PushBridge() {
  const nav = useNavigate(); const toast = useToast(); const { user } = useAuth()
  useEffect(() => {
    const h = (e: MessageEvent) => { if (e.data?.type === 'NAVIGATE') { const u = new URL(e.data.link); nav(u.pathname + u.search) } }
    navigator.serviceWorker?.addEventListener('message', h); return () => navigator.serviceWorker?.removeEventListener('message', h)
  }, [nav])
  useEffect(() => { if (!user) return; let off = () => {}; onForeground(d => d.title && toast('info', `${d.title}: ${d.body}`)).then(f => { off = f }); return () => off() }, [user, toast])
  return null
}
