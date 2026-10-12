import { useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { where, orderBy } from 'firebase/firestore'
import { MessageSquare, MapPin, CalendarClock, Star, XCircle, AlertTriangle, CheckCircle2, ImageIcon } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { useDoc, useQuery } from '@/hooks/useFirestore'
import { useEngineers } from '@/hooks/useEngineers'
import { api, errMsg } from '@/lib/api'
import QuoteCompare, { Quote, engName } from '@/components/QuoteCompare'
import StatusTracker from '@/components/StatusTracker'
import BookingPanel from '@/components/BookingPanel'
import ReviewSheet from '@/components/ReviewSheet'
import { ProviderTerms } from '@/components/ProviderNote'
import { Avatar, Button, EmptyState, ListSkeleton, Section, Sheet, StatusPill, useToast } from '@/components/ui'
import { DEVICE_TYPES, JobStatus, gbp, SERVICE_METHODS, JobPayment } from '@/types/domain'
import PaymentPanel from '@/components/PaymentPanel'
import JobTimeline from '@/components/JobTimeline'
import { Textarea } from '@/components/ui'
import { StorageImg } from '@/components/StorageImg'

export interface Job { reference: string; status: JobStatus; device: { type: string; manufacturer: string; model: string }; description: string; issues: string[]; urgency: string; location: { area: string }; selectedEngineerId: string | null; acceptedQuoteId: string | null; agreedTotalPence?: number; agreedMethod?: string; photoPaths: string[]; statusHistory?: { status: string; at: { toDate(): Date } }[]; quoteCount: number; provider?: 'independent' | 'thor'; customerId: string
  payment?: JobPayment; commissionBps?: number; originalQuotePence?: number; pendingRevision?: { n: number; additionalPence: number; reason: string; status: string } | null; revisions?: { n: number; additionalPence: number; reason: string; status: string }[]; source?: string; messageCount?: number; lastMessageAt?: { toDate(): Date } }

export default function RepairDetail() {
  const { id } = useParams(); const nav = useNavigate(); const { user } = useAuth(); const toast = useToast()
  const { data: job, loading } = useDoc<Job>(`repairRequests/${id}`)
  const priv = useDoc<{ addressLine?: string; postcode: string; serialNumber?: string }>(job ? `repairRequests/${id}/private/details` : null)
  const quotes = useQuery<Quote>(job ? 'repairQuotes' : null, () => [where('jobId', '==', id), where('customerId', '==', user!.uid), orderBy('createdAt', 'desc')], [id, user?.uid, !!job])
  const appt = useDoc<{ startAt: { toDate(): Date }; status: string; id: string; durationMinutes: number }>(job?.status && ['appointment_scheduled', 'on_the_way', 'in_progress', 'awaiting_parts', 'completed', 'closed'].includes(job.status) ? `appointments/apt_${id}` : null)
  const eng = useEngineers(job?.selectedEngineerId ? [job.selectedEngineerId] : [])
  const [busy, setBusy] = useState(''); const [review, setReview] = useState(false); const [confirm, setConfirm] = useState<null | 'cancel' | 'dispute'>(null); const [complaint, setComplaint] = useState('')
  const dispute = useDoc<{ status: string; complaint: string; engineerResponse?: string | null; resolution?: { outcome: string; text: string } | null }>(job && (job.status === 'disputed' || (job.statusHistory ?? []).some(h => h.status === 'disputed')) ? `disputes/${id}` : null)
  const myReview = useDoc(job && ['completed', 'closed'].includes(job.status) ? `reviews/${id}_customer_to_engineer` : null)

  if (loading) return <ListSkeleton />
  if (!job) return <EmptyState icon={AlertTriangle} title="Repair not found" body="It may have been removed, or you don’t have access." action={<Button onClick={() => nav('/customer/repairs')}>My repairs</Button>} />
  const live = quotes.data.filter(q => q.status === 'submitted')
  const accepted = quotes.data.find(q => q.status === 'accepted')
  const e = job.selectedEngineerId ? eng[job.selectedEngineerId] : null
  const select = async (qid: string) => { setBusy(qid); try { await api.acceptQuote({ quoteId: qid }); toast('ok', 'Engineer selected. Now choose a time.') } catch (x) { toast('bad', errMsg(x)) } finally { setBusy('') } }
  const act = async (to: string, note?: string) => { setBusy(to); try { await api.changeJobStatus({ jobId: job.id, to, note }); setConfirm(null); setComplaint('') } catch (x) { toast('bad', errMsg(x)) } finally { setBusy('') } }
  const revise = async (accept: boolean) => { setBusy(accept ? 'rev-yes' : 'rev-no'); try { await api.respondQuoteRevision({ jobId: job.id, accept }); toast('ok', accept ? 'Additional work approved.' : 'Revision declined.') } catch (x) { toast('bad', errMsg(x)) } finally { setBusy('') } }
  const needsAddress = ['home', 'office'].includes(job.agreedMethod ?? '') && !priv.data?.addressLine

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-3"><p className="text-sm font-medium text-thor-text">{job.reference}</p><StatusPill status={job.status} quoteCount={job.quoteCount} /></div>
      <h1 className="font-display text-3xl">{job.device.manufacturer} {job.device.model}</h1>
      <p className="mt-1 flex items-center gap-1.5 text-sm text-thor-text"><MapPin className="size-4" />{job.location.area} · {DEVICE_TYPES.find(d => d.id === job.device.type)?.label}</p>

      <div className="mt-6 grid gap-8 md:grid-cols-[1fr_16rem]">
        <div>
          {job.status === 'awaiting_verification' && <p className="mb-2 rounded-2xl bg-warn/10 p-4 text-sm">Thanks. Our team is checking your request before it goes live to engineers. You’ll be notified as soon as it’s published.</p>}
          {job.status === 'open' && <Section title={live.length ? 'Compare quotations' : 'Awaiting quotations'}>
            {quotes.loading ? <ListSkeleton rows={2} /> : live.length === 0 ? <EmptyState icon={CalendarClock} title="Engineers are reviewing your request" body="You’ll get a notification as soon as the first quote arrives." /> : <QuoteCompare quotes={live} onSelect={select} busyId={busy} canSelect />}</Section>}

          {job.selectedEngineerId && <Section title="Your engineer">
            <div className="flex items-center gap-4 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-ink/5">
              <Avatar src={e?.photoURL} name={engName(e)} size={56} /><div className="min-w-0 flex-1"><p className="font-display text-lg">{engName(e)}</p><Link to={`/engineers/${job.selectedEngineerId}`} className="text-sm text-thor-blue hover:underline">View profile</Link></div>
              <div className="text-right"><p className="font-display text-xl text-thor-blue">{gbp(job.agreedTotalPence ?? 0)}</p><p className="text-xs text-thor-text">{SERVICE_METHODS.find(m => m.id === job.agreedMethod)?.label}</p></div></div>
            {accepted && <div className="mt-3"><ProviderTerms provider={accepted.provider} /></div>}
            <Link to={`/messages/${job.acceptedQuoteId}`} className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-thor-blue"><MessageSquare className="size-4" />Message your engineer</Link></Section>}

          {job.payment?.required && <Section title={job.status === 'awaiting_payment' ? 'Pay to confirm your engineer' : 'Payment'}><PaymentPanel jobId={job.id} status={job.status} agreedPence={job.agreedTotalPence ?? 0} payment={job.payment} /></Section>}

          {job.pendingRevision?.status === 'pending' && <Section title="Revised quotation"><div className="space-y-3 rounded-3xl bg-warn/10 p-5"><p className="text-sm">Your engineer found additional work and proposes an extra <b>{gbp(job.pendingRevision.additionalPence)}</b>, bringing the total to <b>{gbp((job.agreedTotalPence ?? 0) + job.pendingRevision.additionalPence)}</b>.</p>
            <p className="whitespace-pre-line rounded-xl bg-white p-3 text-sm italic">“{job.pendingRevision.reason}”</p><p className="text-xs text-thor-text">Nothing extra is charged unless you approve. Ask your engineer in Messages if anything is unclear.</p>
            <div className="flex flex-wrap gap-2"><Button onClick={() => revise(true)} loading={busy === 'rev-yes'}>Approve additional work</Button><Button variant="ghost" onClick={() => revise(false)} loading={busy === 'rev-no'}>Decline</Button></div></div></Section>}

          {dispute.data && <Section title="Problem raised"><div className="space-y-2 rounded-3xl bg-white p-5 text-sm shadow-sm ring-1 ring-ink/5"><p><b>Your complaint:</b> {dispute.data.complaint}</p>{dispute.data.engineerResponse && <p><b>Engineer’s response:</b> {dispute.data.engineerResponse}</p>}
            {dispute.data.resolution ? <p className="rounded-xl bg-ok/10 p-3"><b>Decision:</b> {dispute.data.resolution.text}</p> : <p className="text-thor-text">Our team is reviewing this. We’ll notify you of the decision.</p>}</div></Section>}

          {job.status === 'engineer_selected' && <Section title="Book your appointment"><BookingPanel jobId={job.id} needsAddress={needsAddress} onBooked={() => {}} /></Section>}

          {appt.data && ['confirmed', 'reschedule_requested'].includes(appt.data.status) && job.status !== 'completed' && <Section title="Appointment" action={<Link to="/customer/appointments" className="text-sm text-thor-blue">Manage</Link>}>
            <p className="rounded-2xl bg-thor-sky/20 p-4 font-medium text-thor-blue-700"><CalendarClock className="mr-2 inline size-5" />{appt.data.startAt.toDate().toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Europe/London' })}</p></Section>}

          {job.status === 'completed' && <Section title="Your repair is complete"><div className="space-y-3 rounded-3xl bg-ok/10 p-5"><p className="flex items-center gap-2 font-medium text-ok"><CheckCircle2 className="size-5" />Check the work, then close the job or raise a problem.</p>
            <div className="flex flex-wrap gap-2"><Button onClick={() => act('closed')} loading={busy === 'closed'} disabled={!!job.payment?.required && (job.payment.paidPence ?? 0) < (job.agreedTotalPence ?? 0)}>Everything’s fine, close job</Button><Button variant="ghost" onClick={() => setConfirm('dispute')}>Raise a problem</Button></div></div></Section>}
          {['completed', 'closed'].includes(job.status) && !myReview.data && <Section title="Leave a review"><Button variant="cta" onClick={() => setReview(true)}><Star className="size-4" />Review your engineer</Button></Section>}

          {!['awaiting_verification', 'open'].includes(job.status) && <Section title="Repair timeline"><JobTimeline jobId={job.id} job={job} audience="customer" /></Section>}

          <Section title="Details"><dl className="space-y-3 text-sm"><div><dt className="text-thor-text">Problem</dt><dd className="whitespace-pre-line">{job.description}</dd></div>
            {priv.data?.addressLine && <div><dt className="text-thor-text">Your address (private)</dt><dd>{priv.data.addressLine}</dd></div>}
            {job.photoPaths?.length > 0 && <div><dt className="mb-2 flex items-center gap-1.5 text-thor-text"><ImageIcon className="size-4" />Photos</dt><dd className="flex flex-wrap gap-2">{job.photoPaths.map(p => <StorageImg key={p} path={p} className="size-20 rounded-xl object-cover" />)}</dd></div>}</dl></Section>
        </div>

        <aside><h2 className="mb-3 font-display text-lg">Progress</h2><StatusTracker status={job.status} quoteCount={job.quoteCount} paymentRequired={!!job.payment?.required} paid={(job.payment?.paidPence ?? 0) > 0} reviewed={!!myReview.data} />
          {['awaiting_verification', 'open', 'engineer_selected', 'awaiting_payment', 'appointment_scheduled'].includes(job.status) && <Button variant="ghost" className="mt-6 text-bad hover:bg-bad/10" onClick={() => setConfirm('cancel')}><XCircle className="size-4" />Cancel request</Button>}</aside>
      </div>

      <Sheet open={confirm !== null} onClose={() => setConfirm(null)} title={confirm === 'cancel' ? 'Cancel this request?' : 'Raise a problem'}>
        <p className="mb-4 text-thor-text">{confirm === 'cancel' ? `Any appointment will be cancelled and engineers will be told.${(job.payment?.paidPence ?? 0) > 0 ? ' Payments are refunded automatically, less any cancellation charge in our refund policy.' : ''}` : 'Tell us what went wrong. Your engineer can respond, and our team will review the job and payment before deciding.'}</p>
        {confirm === 'dispute' && <div className="mb-4"><Textarea label="What’s the problem?" value={complaint} onChange={e => setComplaint(e.target.value)} maxLength={2000} hint="At least 10 characters. Please don’t include card details." /></div>}
        <Button variant="danger" className="w-full" loading={!!busy} disabled={confirm === 'dispute' && complaint.trim().length < 10} onClick={() => act(confirm === 'cancel' ? 'cancelled' : 'disputed', confirm === 'dispute' ? complaint.trim() : undefined)}>{confirm === 'cancel' ? 'Yes, cancel' : 'Raise a problem'}</Button></Sheet>
      <ReviewSheet open={review} onClose={() => setReview(false)} jobId={job.id} direction="customer_to_engineer" />
    </div>
  )
}
