import { Link } from 'react-router-dom'
import { doc, limit, orderBy, where, writeBatch, updateDoc } from 'firebase/firestore'
import { Bell, CheckCheck } from 'lucide-react'
import { db } from '@/lib/firebase'
import { useAuth } from '@/lib/auth'
import { useQuery } from '@/hooks/useFirestore'
import { Button, EmptyState, ListSkeleton, PageHeader, cx } from '@/components/ui'

interface N { title: string; body: string; link: string; read: boolean; createdAt?: { toDate(): Date } }
const ago = (d?: Date) => { if (!d) return ''; const m = Math.round((Date.now() - d.getTime()) / 60000); return m < 1 ? 'now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d` }

export default function Notifications() {
  const { user } = useAuth()
  const n = useQuery<N>('notifications', () => [where('userId', '==', user!.uid), orderBy('createdAt', 'desc'), limit(50)], [user?.uid])
  const unread = n.data.filter(x => !x.read)
  const markAll = async () => { const b = writeBatch(db); unread.forEach(x => b.update(doc(db, 'notifications', x.id), { read: true, readAt: new Date() })); await b.commit() }
  return (
    <div><PageHeader title="Notifications" action={unread.length > 0 ? <Button size="sm" variant="soft" onClick={markAll}><CheckCheck className="size-4" />Mark all read</Button> : undefined} />
      {n.loading ? <ListSkeleton /> : n.data.length === 0 ? <EmptyState icon={Bell} title="You’re all caught up" body="Quotes, messages and appointment updates will show up here." /> :
        <ul className="space-y-2">{n.data.map(x => (
          <li key={x.id}><Link to={x.link} onClick={() => !x.read && updateDoc(doc(db, 'notifications', x.id), { read: true, readAt: new Date() })} className={cx('flex gap-3 rounded-2xl p-4 ring-1 transition', x.read ? 'bg-white/60 ring-ink/5' : 'bg-white shadow-sm ring-thor-sky')}>
            <span className={cx('mt-1.5 size-2.5 shrink-0 rounded-full', x.read ? 'bg-transparent' : 'bg-thor-orange')} /><div className="min-w-0 flex-1"><p className={cx(!x.read && 'font-bold')}>{x.title}</p><p className="text-sm text-thor-text">{x.body}</p></div><span className="text-xs text-thor-text">{ago(x.createdAt?.toDate())}</span></Link></li>))}</ul>}</div>)
}
