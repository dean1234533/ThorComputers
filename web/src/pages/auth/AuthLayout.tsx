import { ReactNode } from 'react'
import { motion } from 'motion/react'
import { ShieldCheck, Scale, CalendarCheck } from 'lucide-react'
import { Logo } from '@/components/ui'

export default function AuthLayout({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <div className="grid min-h-dvh grid-cols-[minmax(0,1fr)] md:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-thor-blue p-12 text-white md:flex md:flex-col md:justify-between">
        <Logo className="h-20" onDark />
        <div>
          <h2 className="font-display text-4xl font-semibold leading-tight">Computer repairs,<br />quoted by experts you can trust.</h2>
          <ul className="mt-8 space-y-4 text-white/85">
            {[[Scale, 'Compare quotes from qualified engineers'], [ShieldCheck, 'Credentials checked by our team'], [CalendarCheck, 'Book a time that suits you']].map(([I, t], i) => {
              const Ic = I as typeof ShieldCheck; return <li key={i} className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-full bg-white/12"><Ic className="size-5 text-thor-cyan" /></span>{t as string}</li> })}
          </ul>
        </div>
        <p className="text-sm text-white/60">thorcomputer.com · London and Kent</p>
      </aside>
      <main className="flex items-center justify-center px-5 py-10">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
          <div className="mb-8 md:hidden"><Logo className="h-16" /></div>
          <h1 className="font-display text-3xl font-semibold text-thor-blue">{title}</h1>{sub && <p className="mb-6 mt-1.5 text-thor-text">{sub}</p>}
          <div className="mt-6">{children}</div>
        </motion.div>
      </main>
    </div>
  )
}
