import { httpsCallable } from 'firebase/functions'
import { functions } from './firebase'

/** Every privileged write goes through a Cloud Function; the browser never writes these collections directly. */
const fn = <I, O = { ok: true }>(name: string) => async (input: I): Promise<O> => (await httpsCallable<I, O>(functions, name)(input)).data

export interface RequestInput {
  requestKey: string; device: { type: string; manufacturer: string; model: string; os?: string }; serialNumber?: string
  issues: string[]; description: string; startedAt?: string; urgency: 'flexible' | 'soon' | 'urgent'; serviceMethods: string[]
  postcode: string; addressLine?: string; accessNotes?: string; preferredDates: string[]; photoPaths: string[]; enquiry?: { id: string; token: string }
}
export interface QuoteInput {
  jobId: string; repairPence: number; diagnosticPence: number; calloutPence: number; durationHours: number; availability: string
  partsIncluded: boolean; partsNote?: string; warranty?: string; notes?: string; expiresAt: string; serviceMethod: string
}
export interface ReviewInput { jobId: string; ratings: Record<string, number>; text?: string }

export interface AdminMfaStatus { mode: 'off' | 'warn' | 'enforce'; sessionHasSecondFactor: boolean; enrolledFactors: number; admins?: { uid: string; email: string; enrolledFactors: number }[] }

export const api = {
  completeRegistration: fn<{ role: 'customer' | 'engineer'; fullName: string; phone: string; postcode: string; consent: true }>('completeRegistration'),
  exportMyData: fn<object, Record<string, unknown>>('exportMyData'),
  deleteMyAccount: fn<{ confirm: 'DELETE' }>('deleteMyAccount'),
  submitEngineerApplication: fn<object, { status: string }>('submitEngineerApplication'),
  updatePublicProfile: fn<{ bio: string; typicalPricing?: string; areasCovered: string[]; workingArrangements: string[]; photoURL: string }>('updatePublicProfile'),
  reviewEngineerApplication: fn<{ engineerId: string; decision: 'approve' | 'reject' | 'request_info' | 'suspend' | 'reinstate'; note?: string; provider?: 'independent' | 'thor' }, { status: string }>('reviewEngineerApplication'),
  verifyQualification: fn<{ qualificationId: string; decision: 'verified' | 'rejected'; note?: string }>('verifyQualification'),
  createRepairRequest: fn<RequestInput, { jobId: string; reference: string; duplicate: boolean }>('createRepairRequest'),
  submitQuote: fn<QuoteInput, { quoteId: string }>('submitQuote'),
  withdrawQuote: fn<{ quoteId: string }>('withdrawQuote'),
  acceptQuote: fn<{ quoteId: string }, { jobId: string }>('acceptQuote'),
  updateJobPrivate: fn<{ jobId: string; addressLine: string; accessNotes?: string }>('updateJobPrivate'),
  changeJobStatus: fn<{ jobId: string; to: string; note?: string }>('changeJobStatus'),
  getSlots: fn<{ jobId: string; date: string }, { slots: string[]; durationMinutes: number }>('getSlots'),
  bookAppointment: fn<{ jobId: string; startAt: string }, { appointmentId: string }>('bookAppointment'),
  cancelAppointment: fn<{ appointmentId: string; reason?: string }>('cancelAppointment'),
  requestReschedule: fn<{ appointmentId: string; newStartAt: string }>('requestReschedule'),
  respondReschedule: fn<{ appointmentId: string; accept: boolean }>('respondReschedule'),
  submitReview: fn<ReviewInput>('submitReview'),
  editReview: fn<{ reviewId: string; ratings: Record<string, number>; text?: string }>('editReview'),
  moderateReview: fn<{ reviewId: string; decision: 'approve' | 'remove' | 'restore'; note: string }>('moderateReview'),
  resolveReport: fn<{ reportId: string; outcome: 'dismissed' | 'actioned'; note: string }>('resolveReport'),
  auditConversation: fn<{ conversationId: string; reportId: string; reason: string }, { messages: any[] }>('auditConversation'),
  setAccountSuspended: fn<{ userId: string; suspended: boolean; reason: string }>('setAccountSuspended'),
  setAdminRole: fn<{ userId: string; level: 'super_admin' | 'admin' | 'support' | 'none'; perms?: string[] }>('setAdminRole'),
  adminStats: fn<object, any>('adminStats'),
  adminMfaStatus: fn<object, AdminMfaStatus>('adminMfaStatus'),
  savePlatformSettings: fn<Record<string, unknown>>('savePlatformSettings'),
  getEnquiry: fn<{ id: string; token: string }, { fields: Record<string, string> }>('getEnquiry'),
}

export const errMsg = (e: unknown) => {
  const m = (e as { message?: string })?.message ?? 'Something went wrong.'
  return m.replace(/^.*?:\s*/, '').replace(/\(functions\/[\w-]+\)\.?$/, '').trim() || 'Something went wrong.'
}
