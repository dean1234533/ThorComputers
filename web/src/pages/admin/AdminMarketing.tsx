import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Copy, ExternalLink, Inbox, RefreshCw, ShieldCheck } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { api, errMsg, WebsiteMarketingStats } from '@/lib/api'
import { Button, EmptyState, Input, ListSkeleton, PageHeader, Select, Section, useToast } from '@/components/ui'

export default function AdminMarketing() {
  const { can } = useAuth(), toast = useToast(), enabled = can('marketing.manage')
  const [source, setSource] = useState('facebook'), [campaign, setCampaign] = useState(''), [content, setContent] = useState('')
  const [stats, setStats] = useState<WebsiteMarketingStats | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const load = async () => { setBusy(true); setError(''); try { setStats(await api.websiteMarketingStats({})) } catch (e) { setError(errMsg(e)) } finally { setBusy(false) } }
  useEffect(() => { if (enabled) load() }, [enabled]) // eslint-disable-line
  if (!enabled) return <EmptyState icon={ShieldCheck} title="No access" body="Marketing needs the marketing permission." />
  const link = new URL('/repair-enquiry', window.location.origin)
  link.searchParams.set('utm_source', source); link.searchParams.set('utm_medium', 'paid_social')
  if (campaign.trim()) link.searchParams.set('utm_campaign', campaign.trim())
  if (content.trim()) link.searchParams.set('utm_content', content.trim())
  return <div className="min-w-0"><PageHeader title="Marketing" sub="Link your advert to your enquiry page. We’ll save the leads here." />
    <div className="marketing-briefing"><div><p className="marketing-kicker">Your simple advertising flow</p><h2>Advert → enquiry → repair.</h2><p>Manage adverts in Meta. Manage customers and repair enquiries here.</p></div><Link to="/admin/leads" className="marketing-leads-link"><Inbox className="size-4" />Incoming leads<ArrowUpRight className="size-4" /></Link></div>
    <Section title="1. Get your advert link"><div className="surface space-y-5 p-5 sm:p-6"><p className="text-sm text-thor-text">Choose where you’ll advertise. Add a campaign name to group the enquiries it brings in. Paste the link below into your advert’s website destination.</p>
      <div className="grid gap-4 sm:grid-cols-3"><Select label="Advert platform" value={source} onChange={e => setSource(e.target.value)}><option value="facebook">Facebook</option><option value="instagram">Instagram</option></Select><Input label="Campaign name (optional)" placeholder="Laptop repairs — October" maxLength={100} value={campaign} onChange={e => setCampaign(e.target.value)} /><Input label="Advert name (optional)" placeholder="Broken laptop video" maxLength={100} value={content} onChange={e => setContent(e.target.value)} /></div>
      <Input label="Your advert destination link" readOnly value={link.href} onFocus={e => e.target.select()} />
      <div className="flex flex-wrap gap-3"><Button onClick={() => navigator.clipboard.writeText(link.href).then(() => toast('ok', 'Advert link copied.')).catch(() => toast('bad', 'Select the link above and copy it manually.'))}><Copy className="size-4" />Copy advert link</Button><a className="inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold text-thor-blue hover:bg-thor-blue/10" href={link.href} target="_blank" rel="noreferrer">Preview enquiry page<ExternalLink className="size-4" /></a></div>
    </div></Section>
    <Section title="2. Follow up your leads"><div className="surface p-5 text-sm"><p>Customers send a short enquiry without an account. It appears in Incoming Leads straight away. They can then sign in or register to review and confirm their repair request.</p><p className="mt-3 text-thor-text">Keep advertising spend, budgets and advert performance in Meta Ads Manager. This dashboard shows enquiries and repair outcomes recorded by this app. Campaign labels come from the link; they are not verified by Meta.</p><Link to="/admin/leads" className="mt-4 inline-flex items-center gap-2 font-semibold text-thor-blue">Open Incoming Leads<ArrowUpRight className="size-4" /></Link></div></Section>
    <Section title="Website enquiry results" action={<Button size="sm" variant="soft" onClick={load} loading={busy}><RefreshCw className="size-4" />Refresh</Button>}>
      {error ? <p role="alert" className="surface p-5 text-bad">Couldn’t load results: {error}. Use Refresh to try again.</p> : !stats ? <ListSkeleton rows={1} /> : <>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{[['Enquiries', stats.leads], ['Repair requests', stats.jobs], ['Paid repairs', stats.paid], ['Completed', stats.completed]].map(([label, value]) => <div key={label} className="marketing-metric surface p-4"><p className="text-xs text-thor-text">{label}</p><p className="font-display text-2xl">{value}</p></div>)}</div>
        {stats.limited && <p className="mt-3 text-sm text-warn">Showing up to 2,000 website enquiries.</p>}
        {stats.campaigns.length === 0 ? <p className="surface mt-4 p-5 text-sm text-thor-text">No website enquiries yet. Share your advert link to get started.</p> : <ul className="mt-4 space-y-3" aria-label="Campaign results">{stats.campaigns.map(c => <li key={c.name} className="surface p-5"><h3 className="font-semibold">{c.name}</h3><dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">{[['Enquiries', c.leads], ['Requests', c.jobs], ['Paid', c.paid], ['Completed', c.completed]].map(([label, value]) => <div key={label}><dt className="text-thor-text">{label}</dt><dd className="font-semibold">{value}</dd></div>)}</dl></li>)}</ul>}
      </>}
    </Section></div>
}
