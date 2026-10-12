import { KeyRound, Contact, KanbanSquare, Megaphone, Inbox, Wallet, Gavel, LifeBuoy, PoundSterling, Home, Wrench, FileText, CalendarDays, MessageSquare, Bell, User, Settings, Briefcase, Search, Star, LayoutDashboard, Users, ShieldCheck, ClipboardList, Flag, SlidersHorizontal, HardHat, LucideIcon } from 'lucide-react'
import type { AdminPermission, Role } from '@/types/domain'

export interface NavItem { to: string; label: string; mobileLabel?: string; icon: LucideIcon; primary?: boolean; badge?: 'messages' | 'notifications'; perm?: AdminPermission | AdminPermission[] }

export const NAV: Record<Role, NavItem[]> = {
  customer: [
    { to: '/customer', label: 'Home', icon: Home, primary: true },
    { to: '/customer/repairs', label: 'My Repairs', icon: Wrench, primary: true },
    { to: '/customer/appointments', label: 'Appointments', mobileLabel: 'Bookings', icon: CalendarDays, primary: true },
    { to: '/messages', label: 'Messages', icon: MessageSquare, primary: true, badge: 'messages' },
    { to: '/customer/quotations', label: 'Quotations', icon: FileText },
    { to: '/notifications', label: 'Notifications', icon: Bell, badge: 'notifications' },
    { to: '/support', label: 'Support', icon: LifeBuoy },
    { to: '/profile', label: 'Profile', icon: User },
    { to: '/settings', label: 'Settings', icon: Settings },
  ],
  engineer: [
    { to: '/engineer/jobs', label: 'Available Jobs', icon: Search, primary: true },
    { to: '/engineer/quotations', label: 'My Quotations', mobileLabel: 'Quotes', icon: FileText, primary: true },
    { to: '/engineer/my-jobs', label: 'My Jobs', icon: Briefcase, primary: true },
    { to: '/messages', label: 'Messages', icon: MessageSquare, primary: true, badge: 'messages' },
    { to: '/engineer', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/engineer/appointments', label: 'Appointments', icon: CalendarDays },
    { to: '/engineer/reviews', label: 'Reviews', icon: Star },
    { to: '/notifications', label: 'Notifications', icon: Bell, badge: 'notifications' },
    { to: '/engineer/payouts', label: 'Payouts', icon: Wallet },
    { to: '/engineer/profile', label: 'Profile', icon: HardHat },
    { to: '/support', label: 'Support', icon: LifeBuoy },
    { to: '/settings', label: 'Settings', icon: Settings },
  ],
  admin: [
    { to: '/admin', label: 'Overview', icon: LayoutDashboard, primary: true },
    { to: '/admin/jobs', label: 'Repair Requests', mobileLabel: 'Requests', icon: ClipboardList, primary: true, perm: ['jobs.view', 'jobs.manage'] },
    { to: '/admin/leads', label: 'Incoming Leads', mobileLabel: 'Leads', icon: Inbox, primary: true, perm: 'leads.manage' },
    { to: '/admin/support', label: 'Support', icon: LifeBuoy, primary: true, perm: 'support.handle' },
    { to: '/admin/progress', label: 'Work in progress', mobileLabel: 'Progress', icon: KanbanSquare, perm: ['jobs.view', 'jobs.manage'] },
    { to: '/admin/contacts', label: 'Contacts', icon: Contact, perm: 'customers.manage' },
    { to: '/admin/approvals', label: 'Approvals', icon: ShieldCheck, perm: 'engineers.review' },
    { to: '/admin/marketing', label: 'Marketing & Lead Generation', mobileLabel: 'Marketing', icon: Megaphone, perm: 'marketing.view' },
    { to: '/admin/finance', label: 'Finance', icon: PoundSterling, perm: 'finance.view' },
    { to: '/admin/disputes', label: 'Disputes', icon: Gavel, perm: 'disputes.manage' },
    { to: '/admin/reports', label: 'Reports', icon: Flag, perm: 'reviews.moderate' },
    { to: '/admin/customers', label: 'Customers', icon: Users, perm: 'customers.manage' },
    { to: '/admin/engineers', label: 'Engineers', icon: HardHat, perm: 'customers.manage' },
    { to: '/admin/quotations', label: 'Quotations', icon: FileText, perm: ['jobs.view', 'jobs.manage'] },
    { to: '/admin/appointments', label: 'Appointments', icon: CalendarDays, perm: ['jobs.view', 'jobs.manage'] },
    { to: '/admin/reviews', label: 'Reviews', icon: Star, perm: 'reviews.moderate' },
    { to: '/notifications', label: 'Notifications', icon: Bell, badge: 'notifications' },
    { to: '/admin/settings', label: 'Platform Settings', icon: SlidersHorizontal, perm: 'settings.edit' },
    { to: '/admin/security', label: 'Security', icon: KeyRound },
  ],
}
