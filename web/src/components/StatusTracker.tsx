import { motion } from 'motion/react'
import { Check } from 'lucide-react'
import { JobStatus, JOB_STATUS_LABEL } from '@/types/domain'
import { cx } from './ui'

const FLOW: { id: JobStatus; label: string }[] = [
  { id: 'open', label: 'Awaiting quotations' }, { id: 'engineer_selected', label: 'Engineer selected' }, { id: 'appointment_scheduled', label: 'Appointment scheduled' },
  { id: 'on_the_way', label: 'Engineer on the way' }, { id: 'in_progress', label: 'Repair in progress' }, { id: 'completed', label: 'Repair completed' }, { id: 'closed', label: 'Closed' },
]
const ORDER: Record<string, number> = { open: 0, engineer_selected: 1, appointment_scheduled: 2, on_the_way: 3, in_progress: 4, awaiting_parts: 4, completed: 5, closed: 6 }

/** Not every repair passes through every stage (e.g. remote fixes skip "on the way"); stages are shown as a guide with the current state highlighted. */
export default function StatusTracker({ status }: { status: JobStatus }) {
  if (status === 'cancelled' || status === 'disputed') return <p className={cx('rounded-xl px-4 py-3 text-sm font-medium', status === 'cancelled' ? 'bg-bad/10 text-bad' : 'bg-warn/15 text-warn')} role="status">{JOB_STATUS_LABEL[status]}</p>
  const cur = ORDER[status] ?? 0
  return (
    <ol className="relative space-y-0" aria-label="Repair progress">
      {FLOW.map((s, i) => {
        const done = i < cur, active = i === cur
        const label = active && status === 'awaiting_parts' ? 'Awaiting parts' : s.label
        return (
          <li key={s.id} className="relative flex items-center gap-3 pb-4 last:pb-0" aria-current={active ? 'step' : undefined}>
            {i < FLOW.length - 1 && <span className={cx('absolute left-[13px] top-7 h-[calc(100%-1.25rem)] w-0.5', done ? 'bg-thor-blue' : 'bg-ink/10')} />}
            <motion.span layout animate={active ? { scale: [1, 1.15, 1] } : {}} transition={{ duration: .5 }} className={cx('relative z-10 grid size-7 shrink-0 place-items-center rounded-full text-xs', done ? 'bg-thor-blue text-white' : active ? 'bg-thor-orange text-ink ring-4 ring-thor-orange/25' : 'bg-ink/10 text-thor-text')}>{done ? <Check className="size-4" /> : i + 1}</motion.span>
            <span className={cx('text-sm', active ? 'font-bold text-ink' : done ? 'text-ink' : 'text-thor-text')}>{label}</span>
          </li>)
      })}
    </ol>
  )
}
