import { KeyRound, Home, Wrench, FileText, CalendarDays, MessageSquare, Bell, User, Settings, Briefcase, Search, Star, LayoutDashboard, Users, ShieldCheck, ClipboardList, Flag, SlidersHorizontal, HardHat, LucideIcon } from 'lucide-react'
import type { Role } from '@/types/domain'

export interface NavItem { to: string; label: string; icon: LucideIcon; primary?: boolean; badge?: 'messages' | 'notifications' }

export const NAV: Record<Role, NavItem[]> = {
  customer: [
    { to: '/customer', label: 'Home', icon: Home, primary: true },
    { to: '/customer/repairs', label: 'My Repairs', icon: Wrench, primary: true },
    { to: '/customer/appointments', label: 'Appointments', icon: CalendarDays, primary: true },
    { to: '/messages', label: 'Messages', icon: MessageSquare, primary: true, badge: 'messages' },
    { to: '/customer/quotations', label: 'Quotations', icon: FileText },
    { to: '/notifications', label: 'Notifications', icon: Bell, badge: 'notifications' },
    { to: '/profile', label: 'Profile', icon: User },
    { to: '/settings', label: 'Settings', icon: Settings },
  ],
  engineer: [
    { to: '/engineer/jobs', label: 'Available Jobs', icon: Search, primary: true },
    { to: '/engineer/quotations', label: 'My Quotations', icon: FileText, primary: true },
    { to: '/engineer/my-jobs', label: 'My Jobs', icon: Briefcase, primary: true },
    { to: '/messages', label: 'Messages', icon: MessageSquare, primary: true, badge: 'messages' },
    { to: '/engineer', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/engineer/appointments', label: 'Appointments', icon: CalendarDays },
    { to: '/engineer/reviews', label: 'Reviews', icon: Star },
    { to: '/notifications', label: 'Notifications', icon: Bell, badge: 'notifications' },
    { to: '/engineer/profile', label: 'Profile', icon: HardHat },
    { to: '/settings', label: 'Settings', icon: Settings },
  ],
  admin: [
    { to: '/admin', label: 'Overview', icon: LayoutDashboard, primary: true },
    { to: '/admin/approvals', label: 'Approvals', icon: ShieldCheck, primary: true },
    { to: '/admin/jobs', label: 'Repair Requests', icon: ClipboardList, primary: true },
    { to: '/admin/reports', label: 'Reports', icon: Flag, primary: true },
    { to: '/admin/customers', label: 'Customers', icon: Users },
    { to: '/admin/engineers', label: 'Engineers', icon: HardHat },
    { to: '/admin/quotations', label: 'Quotations', icon: FileText },
    { to: '/admin/appointments', label: 'Appointments', icon: CalendarDays },
    { to: '/admin/reviews', label: 'Reviews', icon: Star },
    { to: '/notifications', label: 'Notifications', icon: Bell, badge: 'notifications' },
    { to: '/admin/settings', label: 'Platform Settings', icon: SlidersHorizontal },
    { to: '/admin/security', label: 'Security', icon: KeyRound },
  ],
}
