import { ShieldCheck, Info } from 'lucide-react'
import { useDoc } from '@/hooks/useFirestore'
import { Badge } from './ui'
import type { Provider } from '@/types/domain'

export const ProviderBadge = ({ provider }: { provider?: Provider }) => provider === 'thor' ? <Badge tone="brand"><ShieldCheck className="size-3.5" />Thor Computer Engineer</Badge> : <Badge tone="info">Independent engineer</Badge>

/** Makes clear who the customer contracts with and whose warranty applies (policies are configured by admins, never hardcoded). */
export function ProviderTerms({ provider }: { provider?: Provider }) {
  const { data } = useDoc<{ directServicePolicy?: { warranty: string }; marketplaceDisclaimer?: string }>('platformSettings/public')
  const text = provider === 'thor'
    ? data?.directServicePolicy?.warranty || 'This repair is carried out directly by Thor Computer. Thor Computer’s own terms and warranty apply.'
    : data?.marketplaceDisclaimer || 'This repair is carried out by an independent engineer, who is responsible for the work. The warranty and terms stated in their quotation apply, not Thor Computer’s own service warranty.'
  return <p className="flex gap-2 rounded-xl bg-thor-sky/15 p-3 text-xs leading-relaxed text-thor-blue-700"><Info className="mt-0.5 size-4 shrink-0" />{text}</p>
}
