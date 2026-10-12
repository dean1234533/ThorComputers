import type { SpecialisationId, ServiceMethod } from '@/types/domain'

export interface AppProfile {
  displayName: string; businessName: string; bio: string; yearsExperience: number
  serviceArea: { postcode: string; radiusMiles: number }; areasCovered: string[]
  specialisations: SpecialisationId[]; certificationsText: string
  workingArrangements: ServiceMethod[]; typicalPricing: string; photoURL: string
}

/** Drafts may be incomplete, but every stored field must have a defined value. */
export function normaliseProfile(base: Partial<AppProfile> = {}, account: { fullName?: string; postcode?: string } = {}): AppProfile {
  return {
    displayName: base.displayName ?? account.fullName ?? '', businessName: base.businessName ?? '',
    bio: base.bio ?? '', yearsExperience: base.yearsExperience ?? 0,
    serviceArea: { postcode: base.serviceArea?.postcode ?? account.postcode ?? '', radiusMiles: base.serviceArea?.radiusMiles ?? 15 },
    areasCovered: base.areasCovered ?? [], specialisations: base.specialisations ?? [], certificationsText: base.certificationsText ?? '',
    workingArrangements: base.workingArrangements ?? [], typicalPricing: base.typicalPricing ?? '', photoURL: base.photoURL ?? '',
  }
}

export function profileErrors(profile: AppProfile, { submission, hasCertificate = false }: { submission: boolean; hasCertificate?: boolean }): Record<string, string> {
  const errors: Record<string, string> = {}
  if (profile.bio.trim().length < 60) errors.bio = 'Write at least 60 characters about your experience.'
  if (profile.bio.length > 1500) errors.bio = 'Keep your biography under 1,500 characters.'
  if (!profile.areasCovered.length) errors.areasCovered = 'Add at least one town or area where you work.'
  else if (profile.areasCovered.length > 30 || profile.areasCovered.some(a => a.length > 60)) errors.areasCovered = 'Add up to 30 areas, with each name under 60 characters.'
  if (!profile.workingArrangements.length) errors.workingArrangements = 'Choose at least one option, such as home visits or remote help.'
  try { const url = new URL(profile.photoURL); if (!['http:', 'https:'].includes(url.protocol)) errors.photoURL = 'Add a profile photo.' } catch { errors.photoURL = 'Add a profile photo.' }
  if (profile.typicalPricing.length > 400) errors.typicalPricing = 'Keep your pricing description under 400 characters.'
  if (submission) {
    if (profile.displayName.trim().length < 2 || profile.displayName.trim().length > 80) errors.displayName = 'Enter your name using 2 to 80 characters.'
    if (profile.businessName.length > 80) errors.businessName = 'Keep your business name under 80 characters.'
    if (!Number.isInteger(profile.yearsExperience) || profile.yearsExperience < 0 || profile.yearsExperience > 60) errors.yearsExperience = 'Enter a whole number of years between 0 and 60.'
    if (!/^[A-Za-z]{1,2}\d[A-Za-z\d]?\s?\d[A-Za-z]{2}$/.test(profile.serviceArea.postcode.trim())) errors.postcode = 'Enter a valid UK postcode.'
    if (!Number.isFinite(profile.serviceArea.radiusMiles) || profile.serviceArea.radiusMiles < 1 || profile.serviceArea.radiusMiles > 100) errors.radiusMiles = 'Choose a distance between 1 and 100 miles.'
    if (!profile.specialisations.length) errors.specialisations = 'Choose at least one type of repair you offer.'
    if (profile.certificationsText.length > 800) errors.certificationsText = 'Keep your certification details under 800 characters.'
    if (!hasCertificate) errors.qualifications = 'Upload at least one certificate before sending your application.'
  }
  return errors
}
