// Shared, pure catalogue of what the marketplace supports. Used by repair-request validation AND the chatbot so the two can never disagree.
export const DEVICES = ['laptop', 'desktop', 'gaming_pc', 'mac', 'phone', 'tablet', 'printer', 'other'] as const
export const METHODS = ['home', 'office', 'remote', 'collection', 'workshop'] as const
export type Device = typeof DEVICES[number]
export type Method = typeof METHODS[number]

export const METHODS_FOR: Record<string, readonly Method[]> = {
  laptop: METHODS, desktop: METHODS, gaming_pc: METHODS, mac: METHODS, other: METHODS,
  phone: ['collection', 'workshop', 'home'], tablet: ['collection', 'workshop', 'home'], printer: ['home', 'office', 'collection', 'workshop'],
}
export const DEVICE_LABEL: Record<Device, string> = { laptop: 'Laptop', desktop: 'Desktop PC', gaming_pc: 'Gaming PC', mac: 'Mac', phone: 'Mobile phone', tablet: 'Tablet', printer: 'Printer', other: 'Something else' }
export const METHOD_LABEL: Record<Method, string> = { home: 'Home visit', office: 'Business premises visit', remote: 'Remote assistance', collection: 'Collection and return', workshop: 'Workshop repair' }
export const JOB_STATUS_LABEL: Record<string, string> = {
  open: 'open for quotes', engineer_selected: 'engineer selected', appointment_scheduled: 'appointment booked', on_the_way: 'engineer on the way', in_progress: 'repair in progress',
  awaiting_parts: 'awaiting parts', completed: 'completed', closed: 'closed', cancelled: 'cancelled', disputed: 'under review',
}
