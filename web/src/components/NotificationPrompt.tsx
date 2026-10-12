import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { BellRing } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { dismissedRecently, useInstall } from '@/lib/pwa'
import { dismissPush, enablePush, permission, pushDismissedRecently, pushSupport } from '@/lib/push'
import { Button, useToast } from './ui'

/** Explains the value first; the browser permission dialog only appears after the user taps Enable. */
export default function NotificationPrompt() {
  const { user } = useAuth()
  const { installable, standalone } = useInstall()
  const toast = useToast()
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!user || permission() !== 'default' || pushDismissedRecently()) return
    // Don't stack two prompts: wait until the install banner has been handled (installed, dismissed, or not offered).
    if (installable && !dismissedRecently()) return
    let live = true
    pushSupport().then(s => { if (live && s === 'ok') setTimeout(() => live && setShow(true), 4000) })
    return () => { live = false }
  }, [user, installable, standalone])

  const enable = async () => {
    setBusy(true)
    try { const r = await enablePush(user!.uid); toast(r === 'granted' ? 'ok' : 'info', r === 'granted' ? 'Notifications are now on.' : 'Notifications are off. You can change this in Settings.') }
    catch { toast('bad', 'Could not enable notifications. Try again from Settings.') }
    finally { setBusy(false); setShow(false) }
  }
  return (
    <AnimatePresence>{show && (
      <motion.aside role="dialog" aria-labelledby="np-t" initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-x-3 bottom-24 z-50 mx-auto max-w-md rounded-3xl bg-white p-5 shadow-2xl md:bottom-6 md:left-auto md:right-6">
        <div className="flex gap-3.5"><span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-thor-orange/20"><BellRing className="size-6 text-thor-orange-600" /></span>
          <div><h2 id="np-t" className="font-display text-lg font-semibold">Never Miss a Repair Update</h2>
            <p className="mt-1 text-sm text-thor-text">Turn on notifications for new quotes, messages and appointment reminders. Alerts never show your personal details on the lock screen.</p></div></div>
        <div className="mt-4 flex gap-3"><Button onClick={enable} loading={busy} className="flex-1">Turn on notifications</Button><Button variant="ghost" onClick={() => { dismissPush(); setShow(false) }}>Maybe later</Button></div>
      </motion.aside>)}</AnimatePresence>
  )
}
