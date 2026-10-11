import { useState, Suspense } from 'react'
import { NavLink, Outlet, useLocation, Link } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Bell, MoreHorizontal, LogOut } from 'lucide-react'
import { limit, orderBy, where } from 'firebase/firestore'
import { useAuth } from '@/lib/auth'
import { useQuery } from '@/hooks/useFirestore'
import { NAV, NavItem } from './nav'
import { Logo, Sheet, cx, Avatar, Spinner } from '@/components/ui'
import InstallBanner from '@/components/InstallBanner'
import NotificationPrompt from '@/components/NotificationPrompt'

function useBadges() {
  const { user } = useAuth()
  const notifs = useQuery<{ read: boolean }>(user ? 'notifications' : null, () => [where('userId', '==', user!.uid), where('read', '==', false), limit(99)], [user?.uid])
  const convs = useQuery<{ unread?: Record<string, number> }>(user ? 'conversations' : null, () => [where('participants', 'array-contains', user!.uid), orderBy('lastMessageAt', 'desc'), limit(50)], [user?.uid])
  return { notifications: notifs.data.length, messages: convs.data.reduce((n, c) => n + (c.unread?.[user!.uid] ?? 0), 0) }
}

const Badge = ({ n }: { n: number }) => n > 0 ? (
  <motion.span key={n} initial={{ scale: .4 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 18 }}
    className="absolute -right-2 -top-1.5 grid min-w-5 place-items-center rounded-full bg-thor-orange px-1 text-[11px] font-bold leading-5 text-ink" aria-label={`${n} unread`}>{n > 99 ? '99+' : n}</motion.span>) : null

export default function AppShell() {
  const { role, profile, signOut } = useAuth()
  const badges = useBadges()
  const loc = useLocation()
  const reduce = useReducedMotion()
  const [more, setMore] = useState(false)
  const items = NAV[role ?? 'customer']
  const primary = items.filter(i => i.primary), secondary = items.filter(i => !i.primary)
  const count = (i: NavItem) => (i.badge ? badges[i.badge] : 0)
  const end = (to: string) => ['/customer', '/engineer', '/admin'].includes(to)

  return (
    <div className="min-h-dvh md:pl-64">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col bg-thor-blue-900 p-5 text-white md:flex">
        <Link to={`/${role}`} aria-label="Thor Computer home"><Logo className="h-14" onDark /></Link>
        <nav className="mt-8 flex-1 space-y-1" aria-label="Main">
          {items.map(i => (
            <NavLink key={i.to} to={i.to} end={end(i.to)} className={({ isActive }) => cx('group relative flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[15px] transition', isActive ? 'bg-white/12 font-medium text-white' : 'text-white/70 hover:bg-white/8 hover:text-white')}>
              <span className="relative"><i.icon className="size-5" /><Badge n={count(i)} /></span>{i.label}
            </NavLink>))}
        </nav>
        <div className="flex items-center gap-3 border-t border-white/10 pt-4">
          <Avatar src={profile?.photoURL} name={profile?.fullName ?? '?'} size={38} />
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{profile?.fullName}</p><p className="truncate text-xs capitalize text-white/60">{role}</p></div>
          <button onClick={signOut} aria-label="Sign out" className="rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white"><LogOut className="size-5" /></button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="safe-t sticky top-0 z-30 flex items-center justify-between bg-thor-blue px-4 py-2 md:hidden">
        <Logo className="h-10" onDark />
        <Link to="/notifications" aria-label="Notifications" className="relative rounded-full p-2 text-white"><Bell className="size-6" /><Badge n={badges.notifications} /></Link>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-28 pt-6 md:px-10 md:pb-16 md:pt-10">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={loc.pathname} initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={reduce ? undefined : { opacity: 0 }} transition={{ duration: .18 }}>
            <Suspense fallback={<div className="grid place-items-center py-24"><Spinner /></div>}><Outlet /></Suspense>
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Mobile bottom navigation: four primary destinations + More */}
      <nav className="safe-b fixed inset-x-0 bottom-0 z-40 border-t border-ink/10 bg-white/95 backdrop-blur md:hidden" aria-label="Main">
        <ul className="mx-auto grid max-w-lg grid-cols-5">
          {primary.slice(0, 4).map(i => (
            <li key={i.to}><NavLink to={i.to} end={end(i.to)} className={({ isActive }) => cx('flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition', isActive ? 'text-thor-blue' : 'text-thor-text')}>
              <span className="relative"><i.icon className="size-6" /><Badge n={count(i)} /></span>{i.label.replace('Available ', '').replace('My ', '')}</NavLink></li>))}
          <li><button onClick={() => setMore(true)} className="flex w-full flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium text-thor-text"><MoreHorizontal className="size-6" />More</button></li>
        </ul>
      </nav>
      <Sheet open={more} onClose={() => setMore(false)} title="More">
        <ul className="divide-y divide-ink/8">
          {secondary.map(i => <li key={i.to}><Link to={i.to} onClick={() => setMore(false)} className="flex items-center gap-3 py-3.5"><span className="relative"><i.icon className="size-5 text-thor-blue" /><Badge n={count(i)} /></span>{i.label}</Link></li>)}
          <li><button onClick={signOut} className="flex w-full items-center gap-3 py-3.5 text-bad"><LogOut className="size-5" />Sign out</button></li>
        </ul>
      </Sheet>

      <InstallBanner />
      <NotificationPrompt />
    </div>
  )
}
