import { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import { ShieldCheck, ArrowUpRight, Check, Laptop, MapPin, LockKeyhole } from 'lucide-react'
import { Logo } from '@/components/ui'

export default function AuthLayout({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  const reduce = useReducedMotion()
  return (
    <div className="grid min-h-dvh grid-cols-[minmax(0,1fr)] lg:grid-cols-[1fr_1fr]">
      <aside className="auth-story relative hidden overflow-hidden p-10 text-white lg:flex lg:flex-col xl:p-14">
        <div className="flex items-center justify-between"><Logo className="h-20" onDark /><span className="rounded-full border border-white/15 px-3 py-1.5 text-[10px] uppercase tracking-[.16em] text-white/70">Care for your tech</span></div>
        <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center py-12">
          <p className="mb-5 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[.2em] text-thor-sky"><span className="size-1.5 rounded-full bg-thor-sky" />Your local repair network</p>
          <h2 className="font-display text-[clamp(36px,3.8vw,58px)] font-semibold leading-[1.12]">Great technology.<br />Even better <span className="text-thor-sky">care.</span></h2>
          <p className="mt-5 max-w-sm text-sm leading-7 text-white/55">From the first quote to the final fix. Connect with qualified engineers and give your devices a new lease of life.</p>
          <div className="auth-visual" aria-hidden="true">
            <div className="device-card p-6">
              <div className="flex items-center justify-between"><span className="text-[10px] uppercase tracking-[.17em] text-white/50">A simpler repair experience</span><span className="flex gap-1"><i className="size-1 rounded-full bg-white/40" /><i className="size-1 rounded-full bg-white/40" /><i className="size-1 rounded-full bg-white/40" /></span></div>
              <div className="flex items-center gap-5 py-6"><span className="grid size-16 shrink-0 place-items-center rounded-2xl bg-white/5"><Laptop className="size-9 text-thor-sky" strokeWidth={1.2} /></span><div><p className="font-display text-lg font-semibold">Your device. In good hands.</p><p className="mt-1 text-xs text-white/45">Expert help, every step of the way.</p></div></div>
              <div className="flex items-center justify-between border-t border-white/10 pt-5">{['Request', 'Compare', 'Repair'].map((step, i) => <div key={step} className="flex items-center gap-2 text-xs text-white/65"><span className="grid size-5 place-items-center rounded-full bg-thor-sky/15 text-[10px] text-thor-sky">{i + 1}</span>{step}</div>)}</div>
            </div>
            <div className="relative -mt-3 ml-auto mr-4 flex w-fit items-center gap-2 rounded-full border border-white/15 bg-thor-blue-700 px-4 py-2.5 text-xs text-thor-sky shadow-lg"><ShieldCheck className="size-4" />Credentials checked by our team</div>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-3 text-xs text-white/60">{['Clear quotes', 'Flexible appointments', 'Local expertise'].map(t => <span key={t} className="flex items-center gap-2"><Check className="size-3.5 text-thor-sky" />{t}</span>)}</div>
        </div>
        <div className="flex items-center justify-between border-t border-white/10 pt-5 text-xs text-white/40"><span className="flex items-center gap-1.5"><MapPin className="size-3.5" />London & Kent</span><a href="https://thorcomputer.com" target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-white">thorcomputer.com <ArrowUpRight className="size-3.5" /></a></div>
      </aside>
      <main className="auth-content flex min-w-0 flex-col px-5 py-7 sm:px-10 lg:px-12">
        <div className="flex items-center justify-between"><div className="lg:hidden"><Logo className="h-14" /></div><div className="hidden text-[11px] font-medium uppercase tracking-[.18em] text-thor-text lg:block">Thor workspace</div><Link to="/install" className="flex items-center gap-1 text-xs text-thor-text hover:text-thor-blue">Get the app <ArrowUpRight className="size-3.5" /></Link></div>
        <div className="flex flex-1 items-center justify-center py-10">
          <motion.div initial={reduce ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="auth-form-card w-full max-w-[440px]">
            <p className="mb-4 text-[10px] font-semibold uppercase tracking-[.18em] text-thor-blue">Your repairs, beautifully organised</p>
            <h1 className="font-display text-[32px] font-bold leading-tight text-ink">{title}<span className="text-thor-blue">.</span></h1>{sub && <p className="mt-2 text-sm leading-relaxed text-thor-text">{sub}</p>}
            <div className="mt-7">{children}</div>
          </motion.div>
        </div>
        <footer className="mx-auto flex w-full max-w-[440px] items-center justify-between gap-4 text-[11px] text-thor-text"><span className="flex items-center gap-1.5"><LockKeyhole className="size-3" />Secure account access</span><Link to="/privacy" className="hover:text-thor-blue">Privacy policy</Link></footer>
      </main>
    </div>
  )
}
