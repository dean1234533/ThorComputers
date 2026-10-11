import { useState } from 'react'
import { api, errMsg } from '@/lib/api'
import { Button, Sheet, StarInput, Textarea, useToast } from './ui'

const FORMS = {
  customer_to_engineer: { title: 'Review your engineer', cats: [['quality', 'Quality of repair'], ['professionalism', 'Professionalism'], ['communication', 'Communication'], ['punctuality', 'Punctuality'], ['value', 'Value for money']] },
  engineer_to_customer: { title: 'Feedback about this customer', cats: [['communication', 'Communication'], ['reliability', 'Appointment reliability'], ['accuracy', 'Accuracy of job description'], ['overall', 'Overall experience']] },
} as const

export default function ReviewSheet({ open, onClose, jobId, direction, onDone }: { open: boolean; onClose: () => void; jobId: string; direction: keyof typeof FORMS; onDone?: () => void }) {
  const f = FORMS[direction]; const toast = useToast()
  const [r, setR] = useState<Record<string, number>>({}); const [text, setText] = useState(''); const [busy, setBusy] = useState(false)
  const ready = f.cats.every(([k]) => r[k])
  const send = async () => { setBusy(true); try { await api.submitReview({ jobId, ratings: r, text }); toast('ok', direction === 'engineer_to_customer' ? 'Thanks. Your feedback will be reviewed by our team.' : 'Thanks for your review.'); onDone?.(); onClose() } catch (e) { toast('bad', errMsg(e)) } finally { setBusy(false) } }
  return (
    <Sheet open={open} onClose={onClose} title={f.title}>
      <div className="divide-y divide-ink/8">{f.cats.map(([k, label]) => <StarInput key={k} label={label} value={r[k] ?? 0} onChange={n => setR(s => ({ ...s, [k]: n }))} />)}</div>
      <div className="mt-4"><Textarea label="Comments (optional)" value={text} onChange={e => setText(e.target.value)} maxLength={1000} hint="Keep it factual and respectful. Don’t include phone numbers, emails or addresses. Abusive or discriminatory content is removed." /></div>
      <Button className="mt-4 w-full" onClick={send} loading={busy} disabled={!ready} size="lg">Submit</Button>
    </Sheet>
  )
}
