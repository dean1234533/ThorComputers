import { motion } from 'motion/react'
import { Check } from 'lucide-react'
import { JobStatus, JOB_STATUS_LABEL } from '@/types/domain'
import { cx } from './ui'

interface Step { id: string; label: string }

/** Not every repair passes through every stage (remote fixes skip "on the way"); stages are a guide with the current state highlighted.
 *  The payment step appears only when the marketplace collects payment for this job. */
export default function StatusTracker({ status, quoteCount = 0, paymentRequired = false, paid = false, reviewed = false }: { status: JobStatus; quoteCount?: number; paymentRequired?: boolean; paid?: boolean; reviewed?: boolean }) {
  if (status === 'cancelled' || status === 'disputed') return <p className={cx('rounded-xl px-4 py-3 text-sm font-medium', status === 'cancelled' ? 'bg-bad/10 text-bad' : 'bg-warn/15 text-warn')} role="status">{JOB_STATUS_LABEL[status]}</p>
  const steps: Step[] = [
    { id: 'submitted', label: status === 'awaiting_verification' ? 'Request submitted (being checked)' : 'Repair request submitted' },
    { id: 'quotes', label: 'Quotations received' }, { id: 'selected', label: 'Engineer selected' },
    ...(paymentRequired ? [{ id: 'paid', label: status === 'awaiting_payment' ? 'Awaiting payment' : 'Payment confirmed' }] : []),
    { id: 'scheduled', label: 'Appointment scheduled' }, { id: 'progress', label: status === 'awaiting_parts' ? 'Awaiting parts' : status === 'on_the_way' ? 'Engineer on the way' : 'Repair in progress' },
    { id: 'completed', label: 'Repair completed' }, { id: 'review', label: 'Customer review' },
  ]
  const current: Record<JobStatus, string> = {
    awaiting_verification: 'submitted', open: quoteCount > 0 ? 'quotes' : 'submitted', awaiting_payment: 'paid', engineer_selected: paymentRequired && paid ? 'paid' : 'selected',
    appointment_scheduled: 'scheduled', on_the_way: 'progress', in_progress: 'progress', awaiting_parts: 'progress', completed: 'completed', closed: 'review', cancelled: 'submitted', disputed: 'submitted',
  }
  const idx = Math.max(0, steps.findIndex(s => s.id === current[status]))
  const allDone = status === 'closed' && reviewed
  return (
    <ol className="relative space-y-0" aria-label="Repair progress">
      {steps.map((s, i) => {
        const done = i < idx || allDone, active = i === idx && !allDone
        return (
          <li key={s.id} className="relative flex items-center gap-3 pb-4 last:pb-0" aria-current={active ? 'step' : undefined}>
            {i < steps.length - 1 && <span className={cx('absolute left-[13px] top-7 h-[calc(100%-1.25rem)] w-0.5', done ? 'bg-thor-blue' : 'bg-ink/10')} />}
            <motion.span layout animate={active ? { scale: [1, 1.15, 1] } : {}} transition={{ duration: .5 }} className={cx('relative z-10 grid size-7 shrink-0 place-items-center rounded-full text-xs', done ? 'bg-thor-blue text-white' : active ? 'bg-thor-orange text-ink ring-4 ring-thor-orange/25' : 'bg-ink/10 text-thor-text')}>{done ? <Check className="size-4" /> : i + 1}</motion.span>
            <span className={cx('text-sm', active ? 'font-bold text-ink' : done ? 'text-ink' : 'text-thor-text')}>{s.label}</span>
          </li>)
      })}
    </ol>
  )
}
