import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Download, Smartphone, Bell, CalendarCheck, FileText } from 'lucide-react'
import { useInstall, dismissedRecently } from '@/lib/pwa'
import { Button, Logo, Sheet } from './ui'
import InstallSteps from './InstallSteps'

function PhonePreview() {
  return (
    <div aria-hidden className="relative mx-auto h-40 w-24 shrink-0 rounded-[1.4rem] border-[3px] border-white/90 bg-thor-blue-900 p-1.5 shadow-xl">
      <div className="flex h-full flex-col gap-1.5 rounded-[1rem] bg-paper p-1.5">
        <div className="h-3 rounded bg-thor-blue" />
        {[Bell, FileText, CalendarCheck].map((I, i) => <motion.div key={i} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: .3 + i * .18 }} className="flex items-center gap-1 rounded bg-white p-1 shadow-sm"><I className="size-3 text-thor-orange" /><div className="h-1.5 flex-1 rounded bg-ink/15" /></motion.div>)}
        <div className="mt-auto h-4 rounded bg-thor-orange" />
      </div>
    </div>
  )
}

/** Shown once after sign-in. Never in standalone mode; backs off after dismissal (7 → 21 → 60 days). */
export default function InstallBanner() {
  const { installable, ios, install, dismiss } = useInstall()
  const [show, setShow] = useState(false)
  const [steps, setSteps] = useState(false)

  useEffect(() => {
    if (!installable || dismissedRecently()) return
    const t = setTimeout(() => setShow(true), 2500)      // let the first screen settle before interrupting
    return () => clearTimeout(t)
  }, [installable])

  const close = () => { dismiss(); setShow(false) }
  const go = async () => { if (ios) { setSteps(true); return } const r = await install(); if (r !== 'unavailable') setShow(false) }

  return (
    <>
      <AnimatePresence>{show && !steps && (
        <motion.aside role="dialog" aria-labelledby="ib-t" initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }} transition={{ type: 'spring', damping: 26, stiffness: 260 }}
          className="fixed inset-x-3 bottom-24 z-50 mx-auto max-w-xl overflow-hidden rounded-3xl bg-thor-blue text-white shadow-2xl md:bottom-6 md:left-auto md:right-6">
          <div className="flex items-center gap-4 p-5">
            <div className="min-w-0 flex-1"><Logo className="mb-3 h-9" onDark />
              <h2 id="ib-t" className="font-display text-xl font-semibold">Install Thor Computer</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-white/80">Manage your repair jobs, receive instant quotations and never miss an appointment.</p>
            </div>
            <PhonePreview />
          </div>
          <div className="flex gap-3 bg-thor-blue-900/40 px-5 py-3.5">
            <Button variant="cta" onClick={go} className="flex-1">{ios ? <Smartphone className="size-4" /> : <Download className="size-4" />}{ios ? 'Show me how' : 'Install App'}</Button>
            <Button variant="ghost" onClick={close} className="text-white hover:bg-white/10">Maybe Later</Button>
          </div>
        </motion.aside>)}
      </AnimatePresence>
      <Sheet open={steps} onClose={() => { setSteps(false); close() }} title="Add Thor Computer to your Home Screen"><InstallSteps /></Sheet>
    </>
  )
}
