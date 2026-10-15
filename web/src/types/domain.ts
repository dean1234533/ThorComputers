export type Role = 'customer' | 'engineer' | 'admin'
export type AdminLevel = 'super_admin' | 'admin' | 'support'
export type AdminPermission =
  | 'engineers.review' | 'customers.manage' | 'jobs.manage' | 'reviews.moderate'
  | 'messages.audit' | 'settings.edit' | 'admins.manage' | 'reports.view'
  | 'marketing.manage' | 'finance.view' | 'payments.manage' | 'integrations.manage' | 'ai.manage'

export const ADMIN_DEFAULT_PERMISSIONS: Record<AdminLevel, AdminPermission[]> = {
  super_admin: ['engineers.review', 'customers.manage', 'jobs.manage', 'reviews.moderate', 'messages.audit', 'settings.edit', 'admins.manage', 'reports.view', 'marketing.manage', 'finance.view', 'payments.manage', 'integrations.manage', 'ai.manage'],
  admin: ['engineers.review', 'customers.manage', 'jobs.manage', 'reviews.moderate', 'reports.view', 'marketing.manage', 'ai.manage'],
  support: ['customers.manage', 'reports.view'],
}

export const DEVICE_TYPES = [
  { id: 'laptop', label: 'Laptop' }, { id: 'desktop', label: 'Desktop PC' }, { id: 'gaming_pc', label: 'Gaming PC' },
  { id: 'mac', label: 'Mac' }, { id: 'phone', label: 'Mobile phone' }, { id: 'tablet', label: 'Tablet' },
  { id: 'printer', label: 'Printer' }, { id: 'other', label: 'Other technology' },
] as const
export type DeviceType = (typeof DEVICE_TYPES)[number]['id']

export const SPECIALISATIONS = [
  { id: 'laptop', label: 'Laptop repairs' }, { id: 'desktop', label: 'Desktop computer repairs' },
  { id: 'gaming_pc', label: 'Gaming PC repairs' }, { id: 'phone', label: 'Mobile phone repairs' },
  { id: 'tablet', label: 'Tablet repairs' }, { id: 'mac', label: 'Apple Mac repairs' },
  { id: 'virus', label: 'Virus removal' }, { id: 'data_recovery', label: 'Data recovery' },
  { id: 'upgrades', label: 'Hardware upgrades' }, { id: 'software', label: 'Software troubleshooting' },
  { id: 'networking', label: 'Networking' }, { id: 'printer', label: 'Printer repairs' },
  { id: 'it_support', label: 'IT support' }, { id: 'other', label: 'Other approved categories' },
] as const
export type SpecialisationId = (typeof SPECIALISATIONS)[number]['id']

/** Which specialisations qualify an engineer to see a job for a device type. */
export const DEVICE_TO_SPECIALISATIONS: Record<DeviceType, SpecialisationId[]> = {
  laptop: ['laptop'], desktop: ['desktop'], gaming_pc: ['gaming_pc', 'desktop'], mac: ['mac'],
  phone: ['phone'], tablet: ['tablet'], printer: ['printer'], other: ['other', 'it_support'],
}

export const COMMON_ISSUES = [
  'Device will not turn on', 'Screen broken', 'Running slowly', 'Virus or malware', 'Water damage',
  'Data recovery required', 'Battery problem', 'Charging issue', 'Overheating', 'Hardware replacement', 'Software issue',
] as const

export const SERVICE_METHODS = [
  { id: 'home', label: 'Home visit' }, { id: 'office', label: 'Office visit' }, { id: 'remote', label: 'Remote assistance' },
  { id: 'collection', label: 'Collection and return' }, { id: 'workshop', label: 'Engineer workshop' },
] as const
export type ServiceMethod = (typeof SERVICE_METHODS)[number]['id']

/** Service methods that make sense per device type (remote is meaningless for broken hardware). */
export const METHODS_FOR_DEVICE: Record<DeviceType, ServiceMethod[]> = {
  laptop: ['home', 'office', 'remote', 'collection', 'workshop'],
  desktop: ['home', 'office', 'remote', 'collection', 'workshop'],
  gaming_pc: ['home', 'office', 'remote', 'collection', 'workshop'],
  mac: ['home', 'office', 'remote', 'collection', 'workshop'],
  phone: ['collection', 'workshop', 'home'],
  tablet: ['collection', 'workshop', 'home'],
  printer: ['home', 'office', 'collection', 'workshop'],
  other: ['home', 'office', 'remote', 'collection', 'workshop'],
}

export type JobStatus =
  | 'open' | 'engineer_selected' | 'appointment_scheduled' | 'on_the_way' | 'in_progress'
  | 'awaiting_parts' | 'completed' | 'closed' | 'cancelled' | 'disputed'

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  open: 'Awaiting quotations', engineer_selected: 'Engineer selected', appointment_scheduled: 'Appointment scheduled',
  on_the_way: 'Engineer on the way', in_progress: 'Repair in progress', awaiting_parts: 'Awaiting parts',
  completed: 'Repair completed', closed: 'Closed', cancelled: 'Cancelled', disputed: 'Disputed',
}

/** Server-enforced transition map (mirrored in functions/src/domain.ts). Used here only to render UI choices. */
export const ENGINEER_NEXT: Partial<Record<JobStatus, JobStatus[]>> = {
  appointment_scheduled: ['on_the_way', 'in_progress'],
  on_the_way: ['in_progress'],
  in_progress: ['awaiting_parts', 'completed'],
  awaiting_parts: ['in_progress', 'completed'],
}

export type QuoteStatus = 'submitted' | 'accepted' | 'declined' | 'withdrawn' | 'expired'
export type EngineerStatus = 'draft' | 'pending' | 'info_requested' | 'approved' | 'rejected' | 'suspended'
export type VerificationState = 'unverified' | 'pending' | 'verified' | 'rejected'
export type Provider = 'independent' | 'thor'

export const gbp = (pence: number) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(pence / 100)
