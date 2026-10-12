import { useState, Suspense } from 'react'
import { NavLink, Outlet, useLocation, Link } from 'react-router-dom'
import { motion } from 'motion/react'
import { Bell, MoreHorizontal, LogOut, ChevronRight, ArrowUpRight, Laptop } from 'lucide-react'
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
  const [more, setMore] = useState(false)
  const items = NAV[role ?? 'customer']
  const primary = items.filter(i => i.primary), secondary = items.filter(i => !i.primary)
  const count = (i: NavItem) => (i.badge ? badges[i.badge] : 0)
  const current = items.find(i => i.to === loc.pathname) ?? items.find(i => loc.pathname.startsWith(i.to + '/'))
  const workspaceName = role === 'admin' ? 'Platform management' : role === 'engineer' ? 'Engineer workspace' : 'Your repair workspace'
  const end = (to: string) => ['/customer', '/engineer', '/admin'].includes(to)

  return (
    <div className="workspace min-h-dvh md:pl-[252px]">
      <a href="#main-content" className="sr-only z-50 rounded-lg bg-white p-3 focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Skip to content</a>
      {/* Desktop sidebar */}
      <aside className="app-sidebar fixed inset-y-0 left-0 z-40 hidden w-[252px] flex-col px-5 py-7 text-white md:flex">
        <Link to={`/${role}`} aria-label="Thor Computer home"><Logo className="h-20" onDark /></Link>
        <div className="mb-7 mt-8 flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/5 px-3 py-3"><span className="grid size-8 place-items-center rounded-lg bg-white/5"><Laptop className="size-4 text-thor-orange" /></span><div><p className="text-xs font-medium">{workspaceName}</p><p className="mt-1 text-[10px] capitalize text-white/40">{role} account</p></div></div>
        <nav className="min-h-0 flex-1 overflow-y-auto" aria-label="Main">
          {[{ label: 'Workspace', links: items.filter(i => i.primary) }, { label: 'Manage', links: items.filter(i => !i.primary) }].map(group => <div key={group.label} className="mb-6"><p className="mb-2.5 px-3 text-[9px] font-medium uppercase tracking-[.2em] text-white/35">{group.label}</p><div className="space-y-1">
            {group.links.map(i => <NavLink key={i.to} to={i.to} end={end(i.to)} className={({ isActive }) => cx('sidebar-link group relative flex items-center gap-3 rounded-xl px-3.5 py-2.5 transition', isActive ? 'active font-semibold' : 'text-white/55 hover:bg-white/5 hover:text-white')}>
              <span className="relative"><i.icon className="size-[18px]" strokeWidth={1.65} /><Badge n={count(i)} /></span>{i.label}
            </NavLink>)}
          </div></div>)}
        </nav>
        <Link to="/install" className="mb-5 flex items-center gap-3 rounded-xl border border-white/10 p-3 text-xs text-white/65 hover:bg-white/5"><span className="flex-1"><span className="block font-medium text-white/85">Take Thor with you</span><span className="mt-1 block text-[10px] text-white/40">Install the app on your device</span></span><ArrowUpRight className="size-4 text-thor-orange" /></Link>
        <div className="flex items-center gap-3 border-t border-white/10 pt-4">
          <Avatar src={profile?.photoURL} name={profile?.fullName ?? '?'} size={38} />
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{profile?.fullName}</p><p className="truncate text-xs capitalize text-white/60">{role}</p></div>
          <button onClick={signOut} aria-label="Sign out" className="rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white"><LogOut className="size-5" /></button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="safe-t sticky top-0 z-30 flex items-center justify-between bg-thor-blue-900 px-5 py-3 md:hidden">
        <Logo className="h-10" onDark />
        <Link to="/notifications" aria-label="Notifications" className="relative rounded-full p-2 text-white"><Bell className="size-5" /><Badge n={badges.notifications} /></Link>
      </header>

      <header className="workspace-bar sticky top-0 z-30 hidden h-[76px] items-center justify-between gap-4 px-8 md:flex xl:px-12">
        <div className="flex items-center gap-3 text-xs"><span className="text-thor-text">Workspace</span><ChevronRight className="size-3 text-thor-text/50" /><span className="font-medium">{current?.label ?? 'Details'}</span></div>
        <div className="flex items-center gap-5"><span className="hidden text-xs text-thor-text lg:block">{new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'Europe/London' })}</span><div className="h-5 w-px bg-ink/10" /><Link to="/notifications" aria-label="Notifications" className="relative rounded-full p-2 text-thor-text transition hover:bg-ink/5"><Bell className="size-[18px]" /><Badge n={badges.notifications} /></Link><Link to="/profile" aria-label="Your profile"><Avatar src={profile?.photoURL} name={profile?.fullName ?? '?'} size={32} /></Link></div>
      </header>
      <main id="main-content" className="mx-auto max-w-[1240px] px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-5 md:px-8 md:pb-16 md:pt-9 xl:px-12">
        <Suspense fallback={<div className="surface p-6" role="status"><div className="flex items-center gap-3 text-sm text-thor-slate"><Spinner />Loading page…</div></div>}><Outlet /></Suspense>
      </main>

      {/* Mobile bottom navigation: four primary destinations + More */}
      <nav className="mobile-nav safe-b fixed inset-x-0 bottom-0 z-40 md:hidden" aria-label="Main">
        <ul className="mx-auto grid max-w-lg grid-cols-5">
          {primary.slice(0, 4).map(i => (
            <li key={i.to}><NavLink to={i.to} end={end(i.to)} className={({ isActive }) => cx('mobile-tab', isActive ? 'active' : '')}>
              <span className="tab-icon relative"><i.icon className="size-5" /><Badge n={count(i)} /></span><span className="tab-label">{i.mobileLabel ?? i.label.replace('Available ', '').replace('My ', '')}</span></NavLink></li>))}
          <li><button onClick={() => setMore(true)} aria-expanded={more} className={cx('mobile-tab', (more || secondary.some(i => i.to === current?.to)) && 'active')}><span className="tab-icon"><MoreHorizontal className="size-5" /></span><span className="tab-label">More</span></button></li>
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
