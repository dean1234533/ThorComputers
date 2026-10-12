import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { limit, orderBy, where } from 'firebase/firestore'
import { Banknote, CheckCircle2, ExternalLink, ShieldCheck, Wallet } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { useDoc, useQuery } from '@/hooks/useFirestore'
import { api, errMsg } from '@/lib/api'
import { Badge, Button, EmptyState, ListSkeleton, PageHeader, Section, useToast } from '@/components/ui'
import { gbp } from '@/types/domain'

interface Acct { accountId: string; transfersActive: boolean; payoutsEnabled: boolean; detailsSubmitted: boolean; requirementsDue: string[]; disabledReason: string | null }
interface Txn { reference: string; kind: string; grossPence: number; commissionPence: number; engineerSharePence: number; refundedPence: number; status: string; createdAt: { toDate(): Date } }
interface Payout { amountPence: number; status: string; arrivalDate: { toDate(): Date } }

/** Bank details and identity checks are handled entirely by Stripe; Thor Computer never sees or stores them. */
export default function Payouts() {
  const { user } = useAuth(); const toast = useToast(); const [qs] = useSearchParams(); const [busy, setBusy] = useState('')
  const acct = useDoc<Acct>(`stripeConnectedAccounts/${user!.uid}`)
  const settings = useDoc<{ payments?: { enabled: boolean; commissionBps: number } }>('platformSettings/public')
  const txns = useQuery<Txn>('transactions', () => [where('engineerId', '==', user!.uid), orderBy('createdAt', 'desc'), limit(50)], [user?.uid])
  const payouts = useQuery<Payout>('payouts', () => [where('engineerId', '==', user!.uid), orderBy('createdAt', 'desc'), limit(20)], [user?.uid])
  useEffect(() => { if (qs.get('stripe') === 'return') api.stripeRefreshAccount({}).catch(() => undefined) }, [qs])
  const go = async (k: 'onboard' | 'dash') => { setBusy(k); try { const r = k === 'onboard' ? await api.stripeOnboardingLink({}) : await api.stripeDashboardLink({}); window.location.assign(r.url) } catch (e) { toast('bad', errMsg(e)); setBusy('') } }
  const a = acct.data, ready = a?.transfersActive
  const earned = txns.data.reduce((n, t) => n + t.engineerSharePence, 0), bps = settings.data?.payments?.commissionBps ?? 1500
  return (
    <div className="max-w-3xl"><PageHeader title="Payouts" sub="Get paid for marketplace repairs through Stripe." />
      <Section title="Payout account">
        <div className="surface flex flex-wrap items-center gap-4 p-5">
          <span className="grid size-12 place-items-center rounded-xl bg-paper">{ready ? <CheckCircle2 className="size-6 text-ok" /> : <Wallet className="size-6 text-thor-blue" />}</span>
          <div className="min-w-0 flex-1"><p className="font-medium">{ready ? 'Ready to receive payments' : a ? 'Finish setting up with Stripe' : 'Connect a Stripe account'}</p>
            <p className="text-sm text-thor-text">{ready ? (a?.payoutsEnabled ? 'Payouts to your bank are enabled.' : 'Stripe still needs details before paying out to your bank.') : 'Stripe verifies your identity and holds your bank details securely. It takes about five minutes.'}</p>
            {a && a.requirementsDue?.length > 0 && <p className="mt-1 text-xs text-warn">Stripe needs: {a.requirementsDue.slice(0, 4).join(', ').replace(/_/g, ' ')}</p>}</div>
          {acct.loading ? null : !ready ? <Button variant="cta" loading={busy === 'onboard'} onClick={() => go('onboard')}>{a ? 'Continue setup' : 'Set up payouts'}</Button>
            : <Button variant="soft" loading={busy === 'dash'} onClick={() => go('dash')}><ExternalLink className="size-4" />Stripe dashboard</Button>}
        </div>
        {settings.data?.payments?.enabled && !ready && <p className="mt-3 rounded-xl bg-warn/10 p-3 text-sm">You need a ready payout account before you can send quotations.</p>}
        <p className="mt-3 flex items-start gap-2 text-xs text-thor-text"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-ok" />Customers pay Thor Computer Ltd through Stripe. Thor keeps a {(bps / 100).toFixed(bps % 100 ? 2 : 0)}% marketplace commission (fixed on each quote when you send it) and Stripe transfers the rest to your account, then pays out on your Stripe schedule.</p>
      </Section>
      <Section title={`Earnings · ${gbp(earned)}`}>
        {txns.loading ? <ListSkeleton rows={2} /> : txns.data.length === 0 ? <EmptyState icon={Banknote} title="No payments yet" body="Customer payments for your jobs will appear here." /> :
          <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-ink/5"><table className="w-full min-w-[34rem] text-sm"><thead className="text-left text-thor-text"><tr>{['Date', 'Job', 'Customer paid', 'Commission', 'Your share', 'Status'].map(h => <th key={h} className="p-3 font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-ink/8">{txns.data.map(t => <tr key={t.id}><td className="p-3">{t.createdAt.toDate().toLocaleDateString('en-GB')}</td><td className="p-3">{t.reference} <span className="text-xs capitalize text-thor-text">({t.kind})</span></td><td className="p-3">{gbp(t.grossPence)}</td><td className="p-3">{gbp(t.commissionPence)}</td><td className="p-3 font-semibold">{gbp(t.engineerSharePence)}</td><td className="p-3"><Badge tone={t.status === 'succeeded' ? 'ok' : 'warn'}>{t.status.replace('_', ' ')}</Badge></td></tr>)}</tbody></table></div>}
      </Section>
      <Section title="Payouts to your bank">
        {payouts.loading ? <ListSkeleton rows={1} /> : payouts.data.length === 0 ? <p className="text-sm text-thor-text">No payouts yet.</p> :
          <ul className="divide-y divide-ink/8 surface px-5">{payouts.data.map(x => <li key={x.id} className="flex items-center justify-between py-3 text-sm"><span>{x.arrivalDate.toDate().toLocaleDateString('en-GB')}</span><span className="font-medium">{gbp(x.amountPence)}</span><Badge tone={x.status === 'paid' ? 'ok' : x.status === 'failed' ? 'bad' : 'info'}>{x.status.replace('_', ' ')}</Badge></li>)}</ul>}
      </Section>
    </div>)
}
