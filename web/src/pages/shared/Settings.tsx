import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { Download, Trash2, Bell, Smartphone, FileDown } from 'lucide-react'
import { db } from '@/lib/firebase'
import { useAuth } from '@/lib/auth'
import { api, errMsg } from '@/lib/api'
import { disablePush, enablePush, permission, pushSupport, PushSupport } from '@/lib/push'
import { useInstall } from '@/lib/pwa'
import { Button, PageHeader, Sheet, Input, useToast, Section } from '@/components/ui'
import InstallSteps from '@/components/InstallSteps'

const CATS: [string, string][] = [['quotes', 'Quotations'], ['messages', 'Messages'], ['bookings', 'Appointments'], ['status', 'Repair status'], ['reviews', 'Reviews']]
const Toggle = ({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) => (
  <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={`relative h-7 w-12 shrink-0 rounded-full transition ${on ? 'bg-thor-blue' : 'bg-ink/20'}`}><span className={`absolute top-0.5 size-6 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} /></button>)

import StripeConnectCard from '@/components/StripeConnectCard'

export default function Settings() {
  const { user, profile, signOut, role } = useAuth(); const toast = useToast(); const inst = useInstall()
  const [support, setSupport] = useState<PushSupport>('unsupported'); const [perm, setPerm] = useState(permission()); const [del, setDel] = useState(false); const [confirmTxt, setConfirmTxt] = useState(''); const [steps, setSteps] = useState(false)
  useEffect(() => { pushSupport().then(setSupport) }, [])
  const prefs = profile?.notificationPrefs ?? { push: {}, email: {} }
  const setPref = async (ch: 'push' | 'email', k: string, v: boolean) => { try { await updateDoc(doc(db, 'users', user!.uid), { [`notificationPrefs.${ch}.${k}`]: v, updatedAt: serverTimestamp() }) } catch { toast('bad', 'We couldn’t save your notification choices. Please try again.') } }
  const togglePush = async () => {
    try { if (perm === 'granted') { await disablePush(user!.uid); toast('info', 'Notifications are now off on this device.') } else { const r = await enablePush(user!.uid); toast(r === 'granted' ? 'ok' : 'info', r === 'granted' ? 'Notifications are now on.' : 'Notifications are still off. You can turn them on in your browser settings.') } } catch (e) { toast('bad', errMsg(e)) }
    setPerm(permission())
  }
  const exportData = async () => { try { const d = await api.exportMyData({}); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' })); a.download = 'thor-computer-my-data.json'; a.click(); toast('ok', 'Your data has been downloaded.') } catch (e) { toast('bad', errMsg(e)) } }
  const remove = async () => { try { await api.deleteMyAccount({ confirm: 'DELETE' }); await signOut() } catch (e) { toast('bad', errMsg(e)) } }

  return (
    <div className="max-w-2xl"><PageHeader title="Settings" />
      {role === 'engineer' && <Section title="Payments"><StripeConnectCard /></Section>}
      <Section title="Notifications">
        <div className="mb-4 flex items-center gap-3 surface p-5"><Bell className="size-6 text-thor-blue" />
          <div className="flex-1"><p className="font-medium">Push notifications on this device</p><p className="text-sm text-thor-text">{support === 'ios-needs-install' ? 'On iPhone and iPad, install the app to your Home Screen first.' : support === 'unsupported' ? 'Not supported by this browser.' : perm === 'denied' ? 'Blocked. Allow notifications for this site in your browser settings.' : perm === 'granted' ? 'On' : 'Off'}</p></div>
          {support === 'ok' && perm !== 'denied' && <Toggle on={perm === 'granted'} onChange={togglePush} label="Push notifications" />}</div>
        <table className="w-full text-sm"><thead><tr className="text-left text-thor-text"><th className="py-2 font-medium">Alert me about</th><th className="w-16 text-center font-medium">Push</th><th className="w-16 text-center font-medium">Email</th></tr></thead>
          <tbody className="divide-y divide-ink/8">{CATS.map(([k, l]) => <tr key={k}><td className="py-3">{l}</td>{(['push', 'email'] as const).map(ch => <td key={ch} className="text-center"><input type="checkbox" aria-label={`${l} ${ch}`} className="size-5 accent-thor-blue" checked={prefs[ch]?.[k] !== false} onChange={e => setPref(ch, k, e.target.checked)} /></td>)}</tr>)}</tbody></table>
        <p className="mt-2 text-xs text-thor-text">Push alerts never show names, addresses or message text on your lock screen.</p></Section>
      <Section title="Install the app"><div className="flex items-center gap-3 surface p-5"><Smartphone className="size-6 text-thor-blue" />
        <p className="flex-1 text-sm">{inst.standalone ? 'You’re using the installed app.' : 'Add Thor Computer to your device for faster access.'}</p>
        {!inst.standalone && (inst.canPrompt ? <Button size="sm" onClick={inst.install}><Download className="size-4" />Install</Button> : <Button size="sm" variant="soft" onClick={() => setSteps(true)}>How to install</Button>)}</div></Section>
      <Section title="Your data & privacy"><ul className="divide-y divide-ink/8 rounded-2xl bg-white shadow-sm ring-1 ring-ink/5">
        <li><button onClick={exportData} className="flex w-full items-center gap-3 p-4 text-left"><FileDown className="size-5 text-thor-blue" /><span className="flex-1"><b className="block font-medium">Download my data</b><span className="text-sm text-thor-text">A copy of everything we hold about you.</span></span></button></li>
        <li><Link to="/privacy" className="flex items-center gap-3 p-4"><span className="flex-1 font-medium">Privacy policy</span></Link></li>
        <li><button onClick={() => setDel(true)} className="flex w-full items-center gap-3 p-4 text-left text-bad"><Trash2 className="size-5" /><span className="flex-1"><b className="block font-medium">Delete my account</b><span className="text-sm opacity-80">Permanently removes your personal data.</span></span></button></li></ul></Section>
      <Sheet open={del} onClose={() => setDel(false)} title="Delete your account?"><p className="mb-4 text-sm text-thor-text">This erases your profile, contact details, photos and documents. Completed jobs are kept anonymously so the other party’s records remain accurate. It can’t be undone. Type <b>DELETE</b> to confirm.</p><Input label="Confirmation" value={confirmTxt} onChange={e => setConfirmTxt(e.target.value)} /><Button variant="danger" className="mt-4 w-full" disabled={confirmTxt !== 'DELETE'} onClick={remove}>Delete permanently</Button></Sheet>
      <Sheet open={steps} onClose={() => setSteps(false)} title="Install Thor Computer"><InstallSteps /><p className="mt-4 text-xs text-thor-text">On Android or desktop Chrome/Edge, use the browser menu and choose “Install app”.</p></Sheet>
    </div>)
}
