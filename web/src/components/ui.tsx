import { createContext, forwardRef, useCallback, useContext, useEffect, useId, useState, ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { BadgeCheck, CheckCircle2, AlertCircle, Info, Loader2, Star, X, UserRound } from 'lucide-react'
import { JOB_STATUS_LABEL, JobStatus } from '@/types/domain'

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ')

// ---------- brand ----------
export function Logo({ className = 'h-9', onDark = false }: { className?: string; onDark?: boolean }) {
  return <span className={cx('brand-logo-3d', onDark && 'brand-logo-3d-dark', className)}>
    <img src="/brand/logo.jpg" alt="Thor Computer Ltd" className="block h-full w-full rounded-[inherit] object-contain" width={500} height={275} />
  </span>
}

// ---------- buttons ----------
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'cta' | 'ghost' | 'danger' | 'soft'; loading?: boolean; size?: 'md' | 'lg' | 'sm' }
export const Button = forwardRef<HTMLButtonElement, BtnProps>(({ variant = 'primary', loading, size = 'md', className, children, disabled, ...p }, ref) => {
  const v = {
    primary: 'bg-thor-blue text-white hover:bg-thor-blue-700', cta: 'bg-thor-orange text-ink hover:bg-thor-orange-600 font-bold',
    ghost: 'text-thor-blue hover:bg-thor-blue/10', soft: 'bg-thor-blue/10 text-thor-blue hover:bg-thor-blue/15', danger: 'bg-bad text-white hover:bg-bad/90',
  }[variant]
  const s = { sm: 'h-9 px-3 text-sm', md: 'h-11 px-5', lg: 'h-13 px-7 text-lg' }[size]
  return (
    <button ref={ref} disabled={disabled || loading} {...p}
      className={cx('ui-button inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition active:scale-[.98] disabled:opacity-50 disabled:pointer-events-none select-none', v, s, className)}>
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}{children}
    </button>
  )
})

// ---------- form fields (label + hint + error wired for screen readers) ----------
interface FieldShell { label: string; hint?: string; error?: string }
function Shell({ label, hint, error, id, children }: FieldShell & { id: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-ink">{label}</label>
      {children}
      {hint && !error && <p id={`${id}-h`} className="text-xs text-thor-text">{hint}</p>}
      {error && <p id={`${id}-e`} role="alert" className="text-xs text-bad">{error}</p>}
    </div>
  )
}
const inputCls = 'ui-input w-full rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-base text-ink transition focus:border-thor-blue focus:outline-none focus:ring-4 focus:ring-thor-sky/30 aria-[invalid=true]:border-bad'
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & FieldShell>(({ label, hint, error, className, ...p }, ref) => {
  const id = useId(); return <Shell {...{ label, hint, error, id }}><input ref={ref} id={id} aria-invalid={!!error} aria-describedby={error ? `${id}-e` : hint ? `${id}-h` : undefined} className={cx(inputCls, 'h-11', className)} {...p} /></Shell>
})
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & FieldShell>(({ label, hint, error, className, ...p }, ref) => {
  const id = useId(); return <Shell {...{ label, hint, error, id }}><textarea ref={ref} id={id} aria-invalid={!!error} className={cx(inputCls, 'min-h-28', className)} {...p} /></Shell>
})
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & FieldShell>(({ label, hint, error, className, children, ...p }, ref) => {
  const id = useId(); return <Shell {...{ label, hint, error, id }}><select ref={ref} id={id} aria-invalid={!!error} className={cx(inputCls, 'h-11', className)} {...p}>{children}</select></Shell>
})

/** Tap-friendly chip group; single or multi select. */
export function Chips<T extends string>({ options, value, onChange, multi, label }: { options: readonly { id: T; label: string }[]; value: T[]; onChange: (v: T[]) => void; multi?: boolean; label: string }) {
  const toggle = (id: T) => onChange(multi ? (value.includes(id) ? value.filter(x => x !== id) : [...value, id]) : [id])
  return (
    <fieldset><legend className="mb-2 text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-2" role={multi ? 'group' : 'radiogroup'}>
        {options.map(o => {
          const on = value.includes(o.id)
          return <button type="button" key={o.id} role={multi ? 'checkbox' : 'radio'} aria-checked={on} onClick={() => toggle(o.id)}
            className={cx('rounded-full border px-4 py-2 text-sm transition active:scale-95', on ? 'border-thor-blue bg-thor-blue text-white' : 'border-ink/15 bg-white hover:border-thor-blue/50')}>{o.label}</button>
        })}
      </div>
    </fieldset>
  )
}

// ---------- display ----------
export const Spinner = () => <Loader2 className="size-5 animate-spin text-thor-blue" aria-label="Loading" />
export const Skeleton = ({ className }: { className?: string }) => <div className={cx('skeleton', className)} aria-hidden />
export const ListSkeleton = ({ rows = 3 }: { rows?: number }) => <div className="space-y-4" role="status" aria-label="Loading">{Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'ok' | 'warn' | 'bad' | 'info' | 'brand'; children: ReactNode }) {
  const t = { neutral: 'bg-ink/8 text-ink/70', ok: 'bg-ok/12 text-ok', warn: 'bg-warn/15 text-warn', bad: 'bg-bad/12 text-bad', info: 'bg-thor-sky/25 text-thor-blue-700', brand: 'bg-thor-blue text-white' }[tone]
  return <span className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium', t)}>{children}</span>
}
const STATUS_TONE: Partial<Record<JobStatus, 'ok' | 'warn' | 'bad' | 'info' | 'neutral'>> = { open: 'info', completed: 'ok', closed: 'neutral', cancelled: 'bad', disputed: 'bad', awaiting_parts: 'warn' }
export const StatusPill = ({ status }: { status: JobStatus }) => <Badge tone={STATUS_TONE[status] ?? 'info'}>{JOB_STATUS_LABEL[status]}</Badge>
export const VerifiedBadge = ({ label = 'Verified engineer' }: { label?: string }) => <Badge tone="ok"><BadgeCheck className="size-3.5" aria-hidden />{label}</Badge>

export function Stars({ value, count }: { value: number; count?: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-sm" aria-label={count === 0 ? 'No reviews yet' : `Rated ${value.toFixed(1)} out of 5`}>
      <Star className={cx('size-4', value > 0 ? 'fill-thor-orange text-thor-orange' : 'text-ink/25')} aria-hidden />
      <b>{count === 0 ? 'New' : value.toFixed(1)}</b>{count !== undefined && count > 0 && <span className="text-thor-text">({count})</span>}
    </span>
  )
}
export function StarInput({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5"><span className="text-sm">{label}</span>
      <div className="flex" role="radiogroup" aria-label={label}>{[1, 2, 3, 4, 5].map(n => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} onClick={() => onChange(n)} className="p-1 active:scale-90 transition">
          <Star className={cx('size-6', n <= value ? 'fill-thor-orange text-thor-orange' : 'text-ink/25')} /></button>))}</div>
    </div>
  )
}
export function Avatar({ src, name, size = 44 }: { src?: string | null; name: string; size?: number }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const initials = name === '?' ? '' : name.trim().split(/\s+/).filter(Boolean).map(s => s[0]).slice(0, 2).join('').toUpperCase()
  return src && src !== failedSrc ? <img src={src} alt="" width={size} height={size} loading="lazy" onError={() => setFailedSrc(src)} className="rounded-full object-cover bg-ink/10" style={{ width: size, height: size }} />
    : <span aria-hidden className="grid shrink-0 place-items-center rounded-full bg-thor-blue text-white font-medium" style={{ width: size, height: size, fontSize: size / 2.6 }}>{initials || <UserRound style={{ width: size / 2, height: size / 2 }} />}</span>
}

export function EmptyState({ icon: Icon, title, body, action }: { icon: React.ComponentType<{ className?: string }>; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="empty-state mx-auto flex max-w-sm flex-col items-center py-14 text-center">
      <div className="mb-4 grid size-16 place-items-center rounded-full bg-thor-sky/20"><Icon className="size-7 text-thor-blue" /></div>
      <h3 className="font-display text-xl text-ink">{title}</h3><p className="mt-1.5 text-thor-text">{body}</p>{action && <div className="mt-5">{action}</div>}
    </div>
  )
}
export const PageHeader = ({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) => (
  <header className="page-header flex flex-wrap items-end justify-between gap-4"><div><h1 className="font-display text-3xl font-bold text-ink md:text-[34px]">{title}</h1>{sub && <p className="mt-2 text-sm leading-relaxed text-thor-text">{sub}</p>}</div>{action}</header>
)
export const Section = ({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) => (
  <section className="py-5"><div className="mb-3 flex items-center justify-between"><h2 className="font-display text-xl">{title}</h2>{action}</div>{children}</section>
)

// ---------- overlays ----------
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const reduce = useReducedMotion()
  useEffect(() => { if (!open) return; const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); addEventListener('keydown', k); return () => removeEventListener('keydown', k) }, [open, onClose])
  return (
    <AnimatePresence>{open && (
      <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center" role="dialog" aria-modal="true" aria-label={title}>
        <motion.div className="absolute inset-0 bg-ink/50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
        <motion.div className="safe-b relative max-h-[88dvh] w-full overflow-y-auto rounded-t-3xl bg-white p-6 shadow-2xl md:max-w-lg md:rounded-3xl"
          initial={reduce ? { opacity: 0 } : { y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={reduce ? { opacity: 0 } : { y: 60, opacity: 0 }} transition={{ type: 'spring', damping: 28, stiffness: 320 }}>
          <div className="mb-4 flex items-center justify-between"><h2 className="font-display text-xl">{title}</h2><button onClick={onClose} aria-label="Close" className="rounded-full p-2 hover:bg-ink/5"><X className="size-5" /></button></div>
          {children}
        </motion.div>
      </div>)}
    </AnimatePresence>
  )
}

type Toast = { id: number; kind: 'ok' | 'bad' | 'info'; text: string }
const ToastCtx = createContext<(kind: Toast['kind'], text: string) => void>(() => {})
export const useToast = () => useContext(ToastCtx)
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])
  const push = useCallback((kind: Toast['kind'], text: string) => { const id = Date.now() + Math.random(); setItems(i => [...i, { id, kind, text }]); setTimeout(() => setItems(i => i.filter(t => t.id !== id)), 4500) }, [])
  const I = { ok: CheckCircle2, bad: AlertCircle, info: Info }
  return (
    <ToastCtx.Provider value={push}>{children}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 p-3 safe-t" aria-live="polite">
        <AnimatePresence>{items.map(t => { const Ic = I[t.kind]; return (
          <motion.div key={t.id} layout initial={{ y: -24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ opacity: 0, scale: .95 }}
            className="pointer-events-auto flex max-w-md items-center gap-2.5 rounded-xl bg-ink px-4 py-3 text-sm text-white shadow-xl"><Ic className={cx('size-5 shrink-0', t.kind === 'ok' ? 'text-ok' : t.kind === 'bad' ? 'text-thor-orange' : 'text-thor-sky')} />{t.text}</motion.div>) })}</AnimatePresence>
      </div>
    </ToastCtx.Provider>
  )
}
