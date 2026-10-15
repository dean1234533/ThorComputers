import { useDoc } from '@/hooks/useFirestore'
import { useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Download, Smartphone, ArrowRight } from 'lucide-react'
import { Button, Logo } from '@/components/ui'
import { useInstall } from '@/lib/pwa'
import { useAuth } from '@/lib/auth'
import InstallSteps from '@/components/InstallSteps'

const Shell = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="min-h-dvh bg-paper"><header className="border-b border-ink/8 bg-white px-5 py-5"><div className="mx-auto flex max-w-3xl items-center justify-between"><Link to="/"><Logo className="h-12" /></Link><Link to="/login" className="rounded-xl bg-ink px-5 py-2.5 text-xs font-semibold text-white">Sign in</Link></div></header>
    <main className="mx-auto max-w-3xl px-5 py-14"><h1 className="mb-6 font-display text-4xl font-bold text-ink">{title}</h1>{children}</main></div>)

/** Landing target for the WordPress "Get the Thor Computer App" button. */
export function InstallPage() {
  const inst = useInstall(); const nav = useNavigate()
  return (
    <Shell title="Get the Thor Computer app">
      <p className="mb-6 text-lg text-thor-slate">Find qualified engineers, compare repair quotes and book appointments straight from your phone. There’s nothing to download from an app store. Thor Computer installs directly from your browser.</p>
      {inst.standalone ? <Button size="lg" variant="cta" onClick={() => nav('/')}>Open the app <ArrowRight className="size-5" /></Button> : <>
        {inst.canPrompt && <Button size="lg" variant="cta" onClick={inst.install}><Download className="size-5" />Install Thor Computer</Button>}
        {inst.ios && <div className="mt-2"><h2 className="mb-3 flex items-center gap-2 font-display text-xl"><Smartphone className="size-5 text-thor-blue" />Install on iPhone or iPad</h2><InstallSteps /></div>}
        {!inst.canPrompt && !inst.ios && <p className="rounded-2xl bg-white p-4 text-sm shadow-sm">Open this page in Chrome, Edge or Safari, then use the browser menu and choose <b>Install app</b> (or <b>Add to Dock</b> in Safari on Mac).</p>}
        <div className="mt-8"><Link to="/login" className="font-medium text-thor-blue hover:underline">Or continue in your browser →</Link></div></>}
    </Shell>)
}

/** Entry for a WordPress enquiry email link: send to login/register, then to the prefilled request form. */
export function Continue() {
  const [qs] = useSearchParams(); const nav = useNavigate(); const { user, loading, role } = useAuth()
  useEffect(() => {
    if (loading) return
    const to = `/customer/new-request?e=${qs.get('e')}&t=${qs.get('t')}`
    try { sessionStorage.setItem('thor.after', to) } catch { /* ignore */ }
    if (!user) nav('/register', { replace: true }); else if (role === 'customer') nav(to, { replace: true }); else nav('/', { replace: true })
  }, [loading, user, role, nav, qs])
  return null
}

interface Legal { approved?: boolean; businessName?: string; registeredAddress?: string; companyNumber?: string; contactEmail?: string; icoNumber?: string; icoExempt?: boolean; privacyText?: string }
/** The owner's approved policy: "## Heading", "- list item" and blank-line paragraphs. Plain text only (nothing is interpreted as HTML). */
function LegalText({ text }: { text: string }) {
  const blocks = text.replace(/\r/g, '').split(/\n{2,}/).map(b => b.trim()).filter(Boolean)
  return <>{blocks.map((b, i) => b.startsWith('## ') ? <h2 key={i} className="mt-8 mb-2 font-display text-xl text-thor-blue">{b.slice(3)}</h2> : b.split('\n').every(l => l.startsWith('- ')) ? <ul key={i} className="list-disc space-y-1 pl-5">{b.split('\n').map((l, j) => <li key={j}>{l.slice(2)}</li>)}</ul> : <p key={i} className="whitespace-pre-line">{b}</p>)}</>
}
export function Privacy() {
  const h = 'mt-8 mb-2 font-display text-xl text-thor-blue'
  const pub = useDoc<{ legal?: Legal }>('platformSettings/public'); const legal = pub.data?.legal
  if (legal?.approved && legal.privacyText) return (
    <Shell title="Privacy Policy"><div className="space-y-3 leading-relaxed text-thor-slate"><LegalText text={legal.privacyText} />
      <h2 className={h}>Who we are</h2><p>{legal.businessName}{legal.companyNumber ? `, company number ${legal.companyNumber}` : ''}<br />{legal.registeredAddress}<br />{legal.contactEmail}{legal.icoNumber ? <><br />ICO registration: {legal.icoNumber}</> : legal.icoExempt ? <><br />Exempt from ICO registration.</> : null}</p></div></Shell>)
  return (
    <Shell title="Privacy Policy">
      <div className="space-y-3 leading-relaxed text-thor-slate">
        <p className="rounded-xl bg-warn/15 p-3 text-sm text-ink"><b>Draft for legal review.</b> This text describes how the platform handles data. Thor Computer Ltd must confirm company details, ICO registration, retention periods and lawful bases with its legal adviser before launch.</p>
        <h2 className={h}>Who we are</h2><p>Thor Computer Ltd operates this app alongside thorcomputer.com and is the data controller for the personal data described here.</p>
        <h2 className={h}>What we collect and why</h2><ul className="list-disc space-y-1 pl-5"><li><b>Account data</b> (name, email, phone, postcode): to run your account and arrange repairs (contract).</li><li><b>Repair requests</b> (device, problem, photos, address): to obtain quotes. Engineers see only the device, problem and approximate area until you select them.</li><li><b>Engineer verification documents</b>: to check qualifications. Visible only to authorised Thor Computer staff and never published.</li><li><b>Messages and reviews</b>: to support jobs and keep the community safe. Staff open conversations only when a report requires it, and every access is logged.</li><li><b>Device tokens</b>: to send push notifications you have enabled.</li></ul>
        <h2 className={h}>Who sees your address</h2><p>Your exact address and access notes are shared only with the engineer you select, once your quote is accepted.</p>
        <h2 className={h}>Your rights</h2><p>You can download your data and delete your account from Settings at any time. Deleting your account erases your personal data; anonymised job records may be kept where needed for the other party and for legal or dispute purposes. You may also contact us to object to or restrict processing, or complain to the ICO.</p>
        <h2 className={h}>Retention</h2><p>Personal data is kept while your account is active. After deletion, anonymised job and audit records are retained for the period set by Thor Computer’s retention schedule.</p>
        <h2 className={h}>Independent engineers</h2><p>Repairs by independent engineers are carried out by them, not by Thor Computer. Their own warranty and terms apply.</p>
      </div>
    </Shell>)
}
