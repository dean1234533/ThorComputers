import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { CalendarCheck, Home } from 'lucide-react'
import { api, errMsg } from '@/lib/api'
import { Button, Input, Skeleton, useToast, cx } from './ui'

const days = Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return d.toLocaleDateString('en-CA') })
const fmtDay = (s: string) => new Date(s + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

/** Free slots are computed on the server from the engineer's availability minus locked slots; booking is a transaction. */
export default function BookingPanel({ jobId, needsAddress, onBooked }: { jobId: string; needsAddress: boolean; onBooked: () => void }) {
  const toast = useToast()
  const [day, setDay] = useState(days[1]); const [slots, setSlots] = useState<string[] | null>(null); const [dur, setDur] = useState(60); const [busy, setBusy] = useState('')
  const [address, setAddress] = useState(''); const [saved, setSaved] = useState(!needsAddress)
  useEffect(() => { let live = true; setSlots(null); api.getSlots({ jobId, date: day }).then(r => { if (live) { setSlots(r.slots); setDur(r.durationMinutes) } }).catch(e => { toast('bad', errMsg(e)); live && setSlots([]) }); return () => { live = false } /* eslint-disable-next-line */ }, [jobId, day])
  const saveAddress = async () => { setBusy('addr'); try { await api.updateJobPrivate({ jobId, addressLine: address }); setSaved(true) } catch (e) { toast('bad', errMsg(e)) } finally { setBusy('') } }
  const book = async (iso: string) => { setBusy(iso); try { await api.bookAppointment({ jobId, startAt: iso }); toast('ok', 'Appointment confirmed.'); onBooked() } catch (e) { toast('bad', errMsg(e)); api.getSlots({ jobId, date: day }).then(r => setSlots(r.slots)) } finally { setBusy('') } }
  if (!saved) return (
    <div className="space-y-3"><p className="flex items-center gap-2 text-sm text-thor-text"><Home className="size-4 text-thor-blue" />The engineer will visit you, so we need your address. It’s only shared with them once booked.</p>
      <Input label="Full address" value={address} onChange={e => setAddress(e.target.value)} autoComplete="street-address" /><Button onClick={saveAddress} loading={busy === 'addr'} disabled={address.trim().length < 5}>Save address</Button></div>)
  return (
    <div>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2" role="listbox" aria-label="Choose a day">{days.map(d => <button key={d} role="option" aria-selected={d === day} onClick={() => setDay(d)} className={cx('shrink-0 rounded-xl px-3.5 py-2 text-sm transition', d === day ? 'bg-thor-blue text-white' : 'bg-white ring-1 ring-ink/10 hover:ring-thor-blue/50')}>{fmtDay(d)}</button>)}</div>
      <p className="mb-2 mt-4 text-xs text-thor-text">Expected duration: {dur >= 60 ? `${Math.floor(dur / 60)}h${dur % 60 ? ` ${dur % 60}m` : ''}` : `${dur}m`} · times shown in UK time</p>
      {slots === null ? <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-11" />)}</div> :
        slots.length === 0 ? <p className="rounded-xl bg-paper p-4 text-sm text-thor-text">No free times on this day. Try another date.</p> :
          <motion.div initial="h" animate="s" variants={{ s: { transition: { staggerChildren: .02 } } }} className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {slots.map(s => <motion.button key={s} variants={{ h: { opacity: 0, y: 6 }, s: { opacity: 1, y: 0 } }} disabled={!!busy} onClick={() => book(s)} className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-white text-sm font-medium ring-1 ring-ink/10 transition hover:bg-thor-blue hover:text-white disabled:opacity-50">
              {busy === s ? <CalendarCheck className="size-4 animate-pulse" /> : new Date(s).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })}</motion.button>)}</motion.div>}
    </div>
  )
}
