import { FormEvent, useState } from 'react'
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { Camera } from 'lucide-react'
import { getDownloadURL, ref } from 'firebase/storage'
import { db, storage } from '@/lib/firebase'
import { useAuth } from '@/lib/auth'
import { uploadImage } from '@/lib/images'
import { Avatar, Button, Input, PageHeader, useToast } from '@/components/ui'

export default function Profile() {
  const { user, profile } = useAuth(); const toast = useToast()
  const [f, setF] = useState({ fullName: profile?.fullName ?? '', phone: profile?.phone ?? '', postcode: profile?.postcode ?? '' }); const [busy, setBusy] = useState(false)
  const save = async (e: FormEvent) => { e.preventDefault(); setBusy(true); try { await updateDoc(doc(db, 'users', user!.uid), { ...f, postcode: f.postcode.toUpperCase().trim(), updatedAt: serverTimestamp() }); toast('ok', 'Profile saved.') } catch { toast('bad', 'Could not save your profile.') } finally { setBusy(false) } }
  const photo = async (file?: File) => { if (!file) return; try { const p = `avatars/${user!.uid}/profile.jpg`; await uploadImage(p, file); await updateDoc(doc(db, 'users', user!.uid), { photoURL: await getDownloadURL(ref(storage, p)), updatedAt: serverTimestamp() }) } catch { toast('bad', 'Could not upload photo.') } }
  return (
    <div className="max-w-xl"><PageHeader title="Profile" />
      <div className="mb-6 flex items-center gap-4"><div className="relative"><Avatar src={profile?.photoURL} name={profile?.fullName ?? '?'} size={80} /><label className="absolute -bottom-1 -right-1 grid size-8 cursor-pointer place-items-center rounded-full bg-thor-orange"><Camera className="size-4" /><span className="sr-only">Change photo</span><input type="file" accept="image/*" className="sr-only" onChange={e => photo(e.target.files?.[0])} /></label></div>
        <div><p className="font-medium">{profile?.email}</p><p className="text-sm text-thor-text">Member since {profile?.createdAt?.toDate().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</p></div></div>
      <form onSubmit={save} className="space-y-4"><Input label="Full name" value={f.fullName} onChange={e => setF({ ...f, fullName: e.target.value })} /><Input label="Phone" type="tel" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} hint="Only shared with an engineer you select." /><Input label="Postcode" value={f.postcode} onChange={e => setF({ ...f, postcode: e.target.value })} className="uppercase" /><Button type="submit" loading={busy}>Save changes</Button></form></div>)
}
