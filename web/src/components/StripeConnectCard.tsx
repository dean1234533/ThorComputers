import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Landmark } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { useDoc } from '@/hooks/useFirestore'
import { api, errMsg } from '@/lib/api'
import { Badge, Button, useToast } from '@/components/ui'

/** Engineer payout setup. Identity and bank details are collected by Stripe's hosted onboarding; Thor Computer stores only the connected-account status. */
export default function StripeConnectCard() {
  const { user, approved } = useAuth(); const toast = useToast(); const [qs, setQs] = useSearchParams(); const [busy, setBusy] = useState('')
  const acct = useDoc<{ accountId: string; chargesEnabled: boolean; payoutsEnabled: boolean; detailsSubmitted: boolean }>(user ? `stripeAccounts/${user.uid}` : null)
  const refresh = async () => { setBusy('r'); try { await api.stripeConnectRefresh({}) } catch (e) { toast('bad', errMsg(e)) } finally { setBusy('') } }
  useEffect(() => { if (qs.get('stripe') === 'return' || qs.get('stripe') === 'refresh') { qs.delete('stripe'); setQs(qs, { replace: true }); void refresh() } }, [])   // eslint-disable-line
  if (!approved) return null
  const a = acct.data, ready = a?.chargesEnabled && a?.payoutsEnabled
  const start = async () => { setBusy('s'); try { window.location.assign((await api.stripeConnectOnboard({})).url) } catch (e) { toast('bad', errMsg(e)); setBusy('') } }
  return (
    <div className="surface space-y-3 p-5 text-sm"><div className="flex flex-wrap items-center gap-3"><Landmark className="size-5 text-thor-blue" /><p className="font-medium">Get paid through Thor Computer</p>
      <Badge tone={ready ? 'ok' : a ? 'warn' : 'neutral'}>{ready ? 'Ready to be paid' : a ? (a.detailsSubmitted ? 'Stripe is reviewing' : 'Setup incomplete') : 'Not set up'}</Badge></div>
      <p className="text-thor-text">Customers pay through Thor Computer and your share is sent to your own Stripe account, then to your bank. Thor Computer keeps a platform commission on each job. You can’t be paid for a job until this is set up.</p>
      <div className="flex flex-wrap gap-2"><Button onClick={start} loading={busy === 's'} variant={ready ? 'soft' : 'primary'}>{a ? (ready ? 'Update payout details' : 'Continue setup') : 'Set up payments with Stripe'}</Button>
        {a && <Button variant="ghost" loading={busy === 'r'} onClick={refresh}>Refresh status</Button>}</div></div>)
}
