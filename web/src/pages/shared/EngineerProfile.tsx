import { useParams, useNavigate } from 'react-router-dom'
import { limit, orderBy, where } from 'firebase/firestore'
import { ArrowLeft, BadgeCheck, Briefcase, MapPin, Wrench, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useDoc, useQuery } from '@/hooks/useFirestore'
import type { EngineerPublic } from '@/hooks/useEngineers'
import { Avatar, Badge, EmptyState, Skeleton, Stars, VerifiedBadge } from '@/components/ui'
import { ProviderBadge, ProviderTerms } from '@/components/ProviderNote'
import { SPECIALISATIONS, SERVICE_METHODS } from '@/types/domain'
import { Star } from 'lucide-react'

interface Review { rating: number; ratings: Record<string, number>; text: string; createdAt?: { toDate(): Date } }

export default function EngineerProfile() {
  const { id } = useParams(); const nav = useNavigate()
  const { data: e, loading } = useDoc<EngineerPublic>(id ? `engineerProfiles/${id}` : null)
  const reviews = useQuery<Review>(id ? 'reviews' : null, () => [where('subjectId', '==', id), where('direction', '==', 'customer_to_engineer'), where('status', '==', 'published'), orderBy('createdAt', 'desc'), limit(20)], [id])
  if (loading) return <div className="space-y-4"><Skeleton className="h-40" /><Skeleton className="h-64" /></div>
  if (!e || e.status !== 'approved') return <EmptyState icon={AlertTriangle} title="Profile not available" body="This engineer isn’t currently listed." />
  const verified = e.verifiedQualifications ?? []
  const avgCat = (k: string) => { const v = reviews.data.map(r => r.ratings?.[k]).filter(Boolean) as number[]; return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0 }
  return (
    <article>
      <button onClick={() => nav(-1)} className="mb-4 inline-flex items-center gap-1.5 text-sm text-thor-blue"><ArrowLeft className="size-4" />Back</button>
      <header className="overflow-hidden rounded-3xl bg-thor-blue p-6 text-white md:p-8">
        <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
          <Avatar src={e.photoURL} name={e.displayName} size={96} />
          <div className="flex-1"><div className="flex flex-wrap items-center gap-2"><h1 className="font-display text-3xl font-semibold">{e.businessName || e.displayName}</h1></div>
            {e.businessName && <p className="text-white/80">{e.displayName}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-2">{verified.length > 0 ? <VerifiedBadge label="Verified qualifications" /> : <Badge tone="neutral">Qualifications not yet verified</Badge>}<ProviderBadge provider={e.provider} /></div></div>
          <div className="flex gap-6 text-center sm:flex-col sm:gap-2"><div><p className="font-display text-3xl">{e.reviewCount ? e.ratingAvg.toFixed(1) : '—'}</p><p className="text-xs text-white/70">{e.reviewCount} review{e.reviewCount === 1 ? '' : 's'}</p></div></div>
        </div>
        <dl className="mt-6 grid grid-cols-3 gap-4 border-t border-white/15 pt-5 text-center"><div><dt className="text-xs text-white/70">Experience</dt><dd className="font-medium">{e.yearsExperience} yrs</dd></div><div><dt className="text-xs text-white/70">Jobs completed</dt><dd className="font-medium">{e.completedJobs}</dd></div><div><dt className="text-xs text-white/70">Area</dt><dd className="font-medium">{e.areasCovered?.[0] ?? '—'}</dd></div></dl>
      </header>

      <div className="mt-6 grid gap-8 md:grid-cols-[1fr_20rem]">
        <div className="space-y-8">
          <section><h2 className="mb-2 font-display text-xl">About</h2><p className="whitespace-pre-line leading-relaxed text-thor-slate">{e.bio}</p></section>
          <section><h2 className="mb-3 font-display text-xl">Specialisations</h2><div className="flex flex-wrap gap-2">{e.specialisations.map(s => <Badge key={s} tone="info"><Wrench className="size-3" />{SPECIALISATIONS.find(x => x.id === s)?.label ?? s}</Badge>)}</div></section>
          <section>
            <h2 className="mb-3 font-display text-xl">Reviews</h2>
            {reviews.loading ? <Skeleton className="h-24" /> : reviews.data.length === 0 ? <p className="text-thor-text">No reviews yet.</p> : <>
              <div className="mb-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">{['quality', 'professionalism', 'communication', 'punctuality', 'value'].map(k => <div key={k} className="flex items-center justify-between"><span className="capitalize text-thor-text">{k}</span><b>{avgCat(k).toFixed(1)}</b></div>)}</div>
              <ul className="divide-y divide-ink/8">{reviews.data.map((r, i) => <li key={i} className="py-4"><div className="flex items-center justify-between"><Stars value={r.rating} /><span className="text-xs text-thor-text">{r.createdAt?.toDate().toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}</span></div>{r.text && <p className="mt-1.5 text-sm">{r.text}</p>}</li>)}</ul></>}
          </section>
        </div>
        <aside className="space-y-6">
          <section><h2 className="mb-3 font-display text-lg">Qualifications</h2>
            {verified.length > 0 && <><p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ok"><BadgeCheck className="size-4" />Verified by Thor Computer</p><ul className="space-y-1.5">{verified.map(v => <li key={v.name} className="flex items-start gap-2 text-sm"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" /><span><b>{v.name}</b>{v.issuer && <span className="text-thor-text"> · {v.issuer}</span>}</span></li>)}</ul></>}
            {e.selfReportedCerts && <><p className="mb-1 mt-4 text-xs font-medium uppercase tracking-wide text-thor-text">Self-reported, not verified</p><p className="text-sm text-thor-slate">{e.selfReportedCerts}</p></>}
            {!verified.length && !e.selfReportedCerts && <p className="text-sm text-thor-text">None listed yet.</p>}</section>
          <section><h2 className="mb-2 font-display text-lg">Service</h2><ul className="space-y-1.5 text-sm text-thor-slate"><li className="flex gap-2"><MapPin className="size-4 shrink-0 text-thor-blue" />{e.areasCovered?.join(', ')}</li><li className="flex gap-2"><Briefcase className="size-4 shrink-0 text-thor-blue" />{e.workingArrangements?.map(m => SERVICE_METHODS.find(s => s.id === m)?.label).join(', ')}</li></ul>
            {e.typicalPricing && <p className="mt-3 rounded-xl bg-paper p-3 text-sm"><Star className="mr-1.5 inline size-4 text-thor-orange" />{e.typicalPricing}</p>}</section>
          <ProviderTerms provider={e.provider} />
        </aside>
      </div>
    </article>
  )
}
