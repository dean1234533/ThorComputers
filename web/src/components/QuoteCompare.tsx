import { useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'motion/react'
import { Clock, CalendarDays, ShieldCheck, Check, GitCompare, Wallet } from 'lucide-react'
import { WithId } from '@/hooks/useFirestore'
import { EngineerPublic, useEngineers } from '@/hooks/useEngineers'
import { Avatar, Button, Stars, VerifiedBadge, cx, Badge } from './ui'
import { ProviderBadge, ProviderTerms } from './ProviderNote'
import { gbp, SERVICE_METHODS } from '@/types/domain'

export interface Quote {
  jobId: string; engineerId: string; totalPence: number; repairPence: number; diagnosticPence: number; calloutPence: number; durationHours: number; availability: string
  partsIncluded: boolean; partsNote?: string; warranty?: string; notes?: string; serviceMethod: string; status: string; provider?: 'independent' | 'thor'; expiresAt: { toDate(): Date }; version: number
}
const method = (id: string) => SERVICE_METHODS.find(m => m.id === id)?.label ?? id
export const engName = (e?: EngineerPublic | null) => e?.businessName || e?.displayName || 'Engineer'

function PriceBreakdown({ q }: { q: Quote }) {
  const rows: [string, number][] = [['Repair', q.repairPence], ...(q.diagnosticPence ? [['Diagnostic', q.diagnosticPence] as [string, number]] : []), ...(q.calloutPence ? [['Call-out', q.calloutPence] as [string, number]] : [])]
  return <dl className="space-y-1 text-sm">{rows.map(([k, v]) => <div key={k} className="flex justify-between text-thor-text"><dt>{k}</dt><dd>{gbp(v)}</dd></div>)}
    <div className="flex justify-between border-t border-ink/10 pt-1.5 font-bold text-ink"><dt>You pay</dt><dd>{gbp(q.totalPence)}</dd></div></dl>
}

export default function QuoteCompare({ quotes, onSelect, busyId, canSelect }: { quotes: WithId<Quote>[]; onSelect: (id: string) => void; busyId?: string; canSelect: boolean }) {
  const engineers = useEngineers(quotes.map(q => q.engineerId))
  const [picked, setPicked] = useState<string[]>([])
  const [view, setView] = useState<'cards' | 'compare'>('cards')
  const cheapest = Math.min(...quotes.map(q => q.totalPence))
  const toggle = (id: string) => setPicked(p => p.includes(id) ? p.filter(x => x !== id) : p.length >= 3 ? p : [...p, id])
  const sel = quotes.filter(q => picked.includes(q.id))

  return (
    <div>
      <div className="mb-3 flex items-center justify-between"><p className="text-sm text-thor-text">{quotes.length} quote{quotes.length === 1 ? '' : 's'}. Price isn’t everything. Check qualifications, reviews and availability.</p>
        {sel.length >= 2 && <Button size="sm" variant="soft" onClick={() => setView(view === 'cards' ? 'compare' : 'cards')}><GitCompare className="size-4" />{view === 'cards' ? `Compare ${sel.length}` : 'Back to list'}</Button>}</div>

      {view === 'cards' ? (
        <ul className="space-y-4">
          <AnimatePresence initial={false}>{quotes.map((q, i) => { const e = engineers[q.engineerId]; return (
            <motion.li key={q.id} layout initial={{ opacity: 0, y: 16, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: i * .04 }} className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-ink/5">
              <div className="flex items-start gap-3.5">
                <Avatar src={e?.photoURL} name={engName(e)} size={56} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><h3 className="font-display text-lg leading-tight">{engName(e)}</h3>{(e?.verifiedQualifications.length ?? 0) > 0 && <VerifiedBadge />}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-thor-text"><Stars value={e?.ratingAvg ?? 0} count={e?.reviewCount ?? 0} />{e && <><span>{e.yearsExperience} yrs experience</span><span>{e.completedJobs} jobs</span></>}</div>
                  <div className="mt-2 flex flex-wrap gap-1.5"><ProviderBadge provider={q.provider} />{e?.verifiedQualifications.slice(0, 3).map(v => <Badge key={v.name} tone="ok"><Check className="size-3" />{v.name}</Badge>)}{q.totalPence === cheapest && quotes.length > 1 && <Badge tone="warn">Lowest price</Badge>}</div>
                </div>
                <div className="text-right"><p className="font-display text-2xl font-semibold text-thor-blue">{gbp(q.totalPence)}</p><p className="text-xs text-thor-text">total</p></div>
              </div>
              <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <ul className="space-y-1.5 text-thor-text"><li className="flex gap-2"><Clock className="size-4 shrink-0 text-thor-blue" />About {q.durationHours} hour{q.durationHours === 1 ? '' : 's'} · {method(q.serviceMethod)}</li>
                  <li className="flex gap-2"><CalendarDays className="size-4 shrink-0 text-thor-blue" />{q.availability}</li>
                  <li className="flex gap-2"><Wallet className="size-4 shrink-0 text-thor-blue" />Parts {q.partsIncluded ? 'included' : 'not included'}{q.partsNote ? `: ${q.partsNote}` : ''}</li>
                  {q.warranty && <li className="flex gap-2"><ShieldCheck className="size-4 shrink-0 text-thor-blue" />{q.warranty}</li>}</ul>
                <PriceBreakdown q={q} />
              </div>
              {q.notes && <p className="mt-3 rounded-xl bg-paper p-3 text-sm italic text-thor-slate">“{q.notes}”</p>}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {canSelect && <Button variant="cta" loading={busyId === q.id} onClick={() => onSelect(q.id)}>Select engineer</Button>}
                <Link to={`/engineers/${q.engineerId}`} className="rounded-xl px-4 py-2.5 text-sm font-medium text-thor-blue hover:bg-thor-blue/10">View profile</Link>
                <Link to={`/messages/${q.jobId}_${q.engineerId}`} className="rounded-xl px-4 py-2.5 text-sm font-medium text-thor-blue hover:bg-thor-blue/10">Ask a question</Link>
                <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-thor-blue" checked={picked.includes(q.id)} onChange={() => toggle(q.id)} disabled={!picked.includes(q.id) && picked.length >= 3} />Compare</label>
              </div>
              <p className="mt-3 text-xs text-thor-text">Valid until {q.expiresAt.toDate().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</p>
            </motion.li>) })}</AnimatePresence>
        </ul>
      ) : <CompareTable quotes={sel} engineers={engineers} onSelect={onSelect} busyId={busyId} canSelect={canSelect} />}
      <div className="mt-5"><ProviderTerms provider={quotes[0]?.provider} /></div>
    </div>
  )
}

function CompareTable({ quotes, engineers, onSelect, busyId, canSelect }: { quotes: WithId<Quote>[]; engineers: Record<string, EngineerPublic | null>; onSelect: (id: string) => void; busyId?: string; canSelect: boolean }) {
  const rows: [string, (q: WithId<Quote>, e?: EngineerPublic | null) => React.ReactNode][] = [
    ['Total price', q => <b className="text-lg text-thor-blue">{gbp(q.totalPence)}</b>], ['Repair', q => gbp(q.repairPence)], ['Diagnostic', q => (q.diagnosticPence ? gbp(q.diagnosticPence) : 'None')], ['Call-out', q => (q.calloutPence ? gbp(q.calloutPence) : 'None')],
    ['Rating', (_, e) => <Stars value={e?.ratingAvg ?? 0} count={e?.reviewCount ?? 0} />], ['Experience', (_, e) => `${e?.yearsExperience ?? 0} years`], ['Jobs completed', (_, e) => e?.completedJobs ?? 0],
    ['Verified qualifications', (_, e) => e?.verifiedQualifications.length ? e.verifiedQualifications.map(v => v.name).join(', ') : 'None verified'], ['Duration', q => `${q.durationHours} h`], ['Method', q => method(q.serviceMethod)],
    ['Availability', q => q.availability], ['Parts', q => (q.partsIncluded ? 'Included' : 'Not included')], ['Warranty', q => q.warranty || 'Not stated'], ['Provider', q => (q.provider === 'thor' ? 'Thor Computer' : 'Independent')],
  ]
  // Horizontal scroll with snap on phones; the label column stays pinned so the table remains readable.
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2 [scroll-snap-type:x_mandatory]">
      <table className="w-full min-w-[34rem] border-separate border-spacing-0 text-sm">
        <thead><tr><th className="sticky left-0 z-10 w-28 bg-paper" />{quotes.map(q => { const e = engineers[q.engineerId]; return <th key={q.id} className="min-w-40 p-3 text-left align-bottom [scroll-snap-align:start]"><Avatar src={e?.photoURL} name={engName(e)} size={44} /><p className="mt-2 font-display text-base">{engName(e)}</p></th> })}</tr></thead>
        <tbody>{rows.map(([label, cell], r) => <tr key={label} className={cx(r % 2 === 0 && 'bg-white')}><th scope="row" className="sticky left-0 z-10 bg-inherit p-3 text-left font-medium text-thor-text">{label}</th>{quotes.map(q => <td key={q.id} className="p-3 align-top">{cell(q, engineers[q.engineerId])}</td>)}</tr>)}</tbody>
        {canSelect && <tfoot><tr><td className="sticky left-0 bg-paper" />{quotes.map(q => <td key={q.id} className="p-3"><Button variant="cta" size="sm" loading={busyId === q.id} onClick={() => onSelect(q.id)}>Select</Button></td>)}</tr></tfoot>}
      </table>
    </div>
  )
}
