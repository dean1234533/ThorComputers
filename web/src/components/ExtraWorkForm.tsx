import { useState } from 'react'
import { where } from 'firebase/firestore'
import { useAuth } from '@/lib/auth'
import { useQuery } from '@/hooks/useFirestore'
import { api, errMsg } from '@/lib/api'
import { gbp } from '@/types/domain'
import { Badge, Button, Input, Textarea, useToast } from '@/components/ui'

/** Engineer proposes extra work found during the repair. Nothing is charged until the customer approves and pays. */
export default function ExtraWorkForm({ jobId, status }: { jobId: string; status: string }) {
  const toast = useToast(); const { user } = useAuth(); const [pounds, setPounds] = useState(''), [desc, setDesc] = useState(''), [busy, setBusy] = useState(false)
  const list = useQuery<{ amountPence: number; description: string; status: string }>('additionalCharges', () => [where('jobId', '==', jobId), where('engineerId', '==', user!.uid)], [jobId, user?.uid])
  const live = ['appointment_scheduled', 'on_the_way', 'in_progress', 'awaiting_parts'].includes(status), pence = Math.round(Number(pounds) * 100)
  return (
    <div className="space-y-3 text-sm">
      {list.data.map(x => <div key={x.id} className="flex items-center justify-between gap-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-ink/5"><span>{gbp(x.amountPence)} · {x.description}</span><Badge tone={x.status === 'paid' ? 'ok' : x.status === 'declined' ? 'bad' : 'warn'}>{x.status}</Badge></div>)}
      {live ? <div className="space-y-3 rounded-2xl border border-dashed border-ink/20 p-4"><p className="text-thor-text">Found more work? Ask the customer to approve the extra charge before you do it.</p>
        <Input label="Extra amount (£)" type="number" min="1" step="0.5" value={pounds} onChange={e => setPounds(e.target.value)} /><Textarea label="What is it for?" value={desc} onChange={e => setDesc(e.target.value)} />
        <Button loading={busy} disabled={!(pence >= 100) || desc.trim().length < 5} onClick={async () => { setBusy(true); try { await api.proposeAdditionalCharge({ jobId, amountPence: pence, description: desc.trim() }); toast('ok', 'Sent to the customer for approval.'); setPounds(''); setDesc('') } catch (e) { toast('bad', errMsg(e)) } finally { setBusy(false) } }}>Request approval</Button></div>
        : list.data.length === 0 && <p className="text-thor-text">Extra work can be proposed once the appointment is booked and until the repair is complete.</p>}
    </div>)
}
