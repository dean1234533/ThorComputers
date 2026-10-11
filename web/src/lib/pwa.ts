import { useEffect, useState, useSyncExternalStore } from 'react'

interface BIPEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
let deferred: BIPEvent | null = null
const subs = new Set<() => void>()
const emit = () => subs.forEach(f => f())
const KEY = { dismissed: 'thor.install.dismissedAt', count: 'thor.install.dismissCount', installed: 'thor.install.installed' }
const get = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const set = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* storage unavailable */ } }

// Capture at module load: the browser can fire this before React mounts.
if (typeof window !== 'undefined') {
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e as BIPEvent; try { localStorage.removeItem(KEY.installed) } catch { /* ignore */ } emit() })   // event only fires when NOT installed
  addEventListener('appinstalled', () => { set(KEY.installed, '1'); deferred = null; emit() })
}

export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || (navigator as any).standalone === true
export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

/** Re-prompt delay grows each time the user dismisses: 7, 21, then 60 days. */
const delayDays = () => [7, 21, 60][Math.min(Number(get(KEY.count) ?? 0), 2)]
export const dismissedRecently = () => { const t = Number(get(KEY.dismissed) ?? 0); return t > 0 && Date.now() - t < delayDays() * 86400_000 }

export function useInstall() {
  const canPrompt = useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f) }, () => deferred !== null)
  const [standalone, setStandalone] = useState(isStandalone)
  useEffect(() => { const m = matchMedia('(display-mode: standalone)'), h = () => setStandalone(isStandalone()); m.addEventListener('change', h); return () => m.removeEventListener('change', h) }, [])
  const ios = isIOS()
  const installed = standalone || get(KEY.installed) === '1'
  return {
    standalone, ios, canPrompt, installed,
    /** Only offer the banner where we can genuinely help: native prompt available, or iOS manual steps. */
    installable: !installed && (canPrompt || ios),
    async install() {
      if (!deferred) return 'unavailable' as const
      await deferred.prompt(); const { outcome } = await deferred.userChoice; deferred = null; emit(); return outcome
    },
    dismiss() { set(KEY.dismissed, String(Date.now())); set(KEY.count, String(Number(get(KEY.count) ?? 0) + 1)) },
  }
}
