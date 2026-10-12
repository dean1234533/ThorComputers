import { ReactNode } from 'react'
import { Download, ShieldCheck } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import type { AdminPermission } from '@/types/domain'
import { Button, EmptyState, Select, Skeleton, cx } from './ui'

/** UI convenience only: every action is re-checked by Cloud Functions and every read by Firestore rules. */
export function Gate({ perm, children }: { perm: AdminPermission; children: ReactNode }) {
  const { perms } = useAuth(); return perms.includes(perm) ? <>{children}</> : <EmptyState icon={ShieldCheck} title="No access" body="Your admin role doesn’t include this area. Ask a super admin." />
}
export const useCan = () => { const { perms } = useAuth(); return (p: AdminPermission) => perms.includes(p) }

export interface Range { days: number }
export const rangeToIso = (r: Range) => ({ from: new Date(Date.now() - r.days * 86400_000).toISOString(), to: new Date().toISOString() })
export function RangePicker({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  return <div className="w-40"><Select label="" aria-label="Date range" value={value.days} onChange={e => onChange({ days: Number(e.target.value) })}>
    {[[7, 'Last 7 days'], [14, 'Last 14 days'], [30, 'Last 30 days'], [90, 'Last 90 days'], [365, 'Last 12 months']].map(([d, l]) => <option key={d} value={d}>{l}</option>)}</Select></div>
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: 'ok' | 'warn' | 'bad' }) {
  return <div className="surface p-4"><div className={cx('font-display text-2xl', tone === 'ok' && 'text-ok', tone === 'warn' && 'text-warn', tone === 'bad' && 'text-bad')}>{value ?? <Skeleton className="h-8 w-16" />}</div><p className="text-sm text-thor-text">{label}</p>{hint && <p className="mt-1 text-[11px] text-thor-text/80">{hint}</p>}</div>
}

/** Dependency-free bar chart; an equivalent table is rendered for screen readers. */
export function BarChart({ data, label, format = String, color = '#225AA5' }: { data: [string, number][]; label: string; format?: (n: number) => string; color?: string }) {
  if (!data.length) return <p className="py-8 text-center text-sm text-thor-text">No data in this period.</p>
  const max = Math.max(1, ...data.map(d => d[1])), w = Math.max(14, Math.min(28, 900 / data.length))
  return <>
    <svg viewBox={`0 0 ${data.length * w} 120`} className="h-40 w-full" role="img" aria-label={label} preserveAspectRatio="none">
      {data.map(([k, n], i) => <g key={k}><title>{`${k}: ${format(n)}`}</title><rect x={i * w + w * .15} y={100 - (n / max) * 90} width={w * .7} height={Math.max(0, (n / max) * 90)} rx="3" fill={color} />
        {data.length <= 31 && <text x={i * w + w / 2} y="114" textAnchor="middle" fontSize="8" fill="#7A7A7A">{k.slice(8)}</text>}</g>)}
    </svg>
    <table className="sr-only"><caption>{label}</caption><tbody>{data.map(([k, n]) => <tr key={k}><th>{k}</th><td>{format(n)}</td></tr>)}</tbody></table></>
}

/** Fills missing days so charts show gaps honestly. */
export function byDay(map: Record<string, number>, days: number): [string, number][] {
  const out: [string, number][] = []
  for (let i = days - 1; i >= 0; i--) { const k = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10); out.push([k, map[k] ?? 0]) }
  return out
}

export function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return
  const head = Object.keys(rows[0])
  const cell = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""')}"` : s }   // also blocks spreadsheet formula injection
  const csv = [head.join(','), ...rows.map(r => head.map(h => cell(r[h])).join(','))].join('\n')
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
export const ExportButton = ({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) => <Button size="sm" variant="soft" onClick={onClick} disabled={disabled}><Download className="size-4" />Export CSV</Button>
export const poundsStr = (p?: number | null) => p === null || p === undefined ? '—' : new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(p / 100)
