import { useMemo, useState } from 'react'
import { where, Timestamp, type QueryConstraint } from 'firebase/firestore'

type Preset = 'all' | 'today' | '7' | '30' | 'custom'
export interface DateRange { preset: Preset; from: string; to: string }
export const ALL_TIME: DateRange = { preset: 'all', from: '', to: '' }

const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** [start, end) as Dates, or nulls for "all time". End is exclusive so a single chosen day covers the whole day. */
export function rangeBounds(r: DateRange): { start: Date | null; end: Date | null } {
  const today = startOfDay(new Date())
  if (r.preset === 'today') return { start: today, end: null }
  if (r.preset === '7' || r.preset === '30') { const s = new Date(today); s.setDate(s.getDate() - (r.preset === '7' ? 6 : 29)); return { start: s, end: null } }
  if (r.preset === 'custom') {
    const start = r.from ? startOfDay(new Date(r.from + 'T00:00')) : null
    const end = r.to ? (() => { const e = startOfDay(new Date(r.to + 'T00:00')); e.setDate(e.getDate() + 1); return e })() : null
    return { start, end }
  }
  return { start: null, end: null }
}

/**
 * Query constraints for a date range on `field`. The field must be the same one the query orders by,
 * so the existing composite indexes still apply (a range on the ordered field needs no new index).
 */
export function dateConstraints(field: string, r: DateRange): QueryConstraint[] {
  const { start, end } = rangeBounds(r), c: QueryConstraint[] = []
  if (start) c.push(where(field, '>=', Timestamp.fromDate(start)))
  if (end) c.push(where(field, '<', Timestamp.fromDate(end)))
  return c
}

/** Stable string for useQuery deps. */
export const rangeKey = (r: DateRange) => `${r.preset}|${r.from}|${r.to}`

const OPTIONS: { id: Preset; label: string }[] = [{ id: 'all', label: 'All time' }, { id: 'today', label: 'Today' }, { id: '7', label: 'Last 7 days' }, { id: '30', label: 'Last 30 days' }, { id: 'custom', label: 'Pick dates' }]

export function useDateRange(initial: DateRange = ALL_TIME) { return useState<DateRange>(initial) }

export function DateFilter({ value, onChange, label = 'Date' }: { value: DateRange; onChange: (r: DateRange) => void; label?: string }) {
  const max = useMemo(() => iso(new Date()), [])
  const field = 'h-10 rounded-xl border border-ink/15 bg-white px-3 text-sm'
  return (
    <div className="mb-4 flex flex-wrap items-end gap-2" role="group" aria-label={`${label} filter`}>
      <label className="block text-sm"><span className="mb-1 block font-medium">{label}</span>
        <select aria-label={`${label} range`} className={field} value={value.preset} onChange={e => onChange({ ...value, preset: e.target.value as Preset })}>{OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
      {value.preset === 'custom' && <>
        <label className="block text-sm"><span className="mb-1 block text-thor-text">From</span><input type="date" aria-label="From date" className={field} value={value.from} max={value.to || max} onChange={e => onChange({ ...value, from: e.target.value })} /></label>
        <label className="block text-sm"><span className="mb-1 block text-thor-text">To</span><input type="date" aria-label="To date" className={field} value={value.to} min={value.from} max={max} onChange={e => onChange({ ...value, to: e.target.value })} /></label></>}
      {value.preset !== 'all' && <button type="button" className="h-10 px-2 text-sm text-thor-blue underline" onClick={() => onChange(ALL_TIME)}>Clear</button>}
    </div>
  )
}
