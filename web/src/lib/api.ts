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
  jobId: string; repairPence: number; diagnosticPence: number; calloutPence: number; labourPence?: number; partsEstimatePence?: number; earliestAppointment?: string; includedServices?: string; excludedServices?: string; durationHours: number; availability: string
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
  reviewEngineerApplication: fn<{ engineerId: string; decision: 'start_review' | 'approve' | 'reject' | 'request_info' | 'suspend' | 'reinstate'; note?: string; provider?: 'independent' | 'thor' }, { status: string }>('reviewEngineerApplication'),
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
  adminStats: fn<{ days?: number; from?: string; to?: string }, any>('adminStats'),
  adminMfaStatus: fn<object, AdminMfaStatus>('adminMfaStatus'),
  savePlatformSettings: fn<Record<string, unknown>>('savePlatformSettings'),
  getEnquiry: fn<{ id: string; token: string }, { fields: Record<string, string> }>('getEnquiry'),
  // marketplace
  publishJob: fn<{ jobId: string; note?: string }, { ok: true; notified: number }>('publishJob'),
  proposeQuoteRevision: fn<{ jobId: string; additionalPence: number; reason: string }>('proposeQuoteRevision'),
  respondQuoteRevision: fn<{ jobId: string; accept: boolean }>('respondQuoteRevision'),
  adminUpdateEngineer: fn<{ engineerId: string; specialisations?: string[]; serviceRadiusMiles?: number; provider?: 'independent' | 'thor'; marketplaceRestricted?: boolean; note: string }>('adminUpdateEngineer'),
  respondToDispute: fn<{ jobId: string; response: string }>('respondToDispute'),
  resolveDispute: fn<{ jobId: string; outcome: 'completed' | 'closed' | 'cancelled'; resolution: string; refund?: { paymentId: string; amountPence: number }; requestKey: string }>('resolveDispute'),
  // payments
  stripeOnboardingLink: fn<object, { url: string }>('stripeOnboardingLink'),
  stripeRefreshAccount: fn<object, { connected: boolean; transfersActive?: boolean; payoutsEnabled?: boolean; requirementsDue?: string[] }>('stripeRefreshAccount'),
  stripeDashboardLink: fn<object, { url: string }>('stripeDashboardLink'),
  createCheckout: fn<{ jobId: string }, { url: string; paymentId: string }>('createCheckout'),
  refundPayment: fn<{ paymentId: string; amountPence?: number; reason: string; requestKey: string }, { refundId: string; status: string }>('refundPayment'),
  financeReport: fn<{ from: string; to: string }, any>('financeReport'),
  paymentsStatus: fn<object, { configured: boolean; mode: string; webhookSecret: boolean; connectWebhookSecret: boolean; enabled: boolean; lastEventAt: number | null; lastError: string | null }>('paymentsStatus'),
  // settings
  saveMarketplaceSettings: fn<Record<string, unknown>>('saveMarketplaceSettings'),
  savePaymentSettings: fn<Record<string, unknown>, { ok: true; commissionBps: number }>('savePaymentSettings'),
  saveMarketingSettings: fn<Record<string, unknown>>('saveMarketingSettings'),
  saveChatbotSettings: fn<Record<string, unknown>>('saveChatbotSettings'),
  // Meta & leads
  metaAuthStart: fn<object, { url: string }>('metaAuthStart'),
  metaSyncAssets: fn<object, { pages: number; adAccounts: number }>('metaSyncAssets'),
  metaDisconnect: fn<{ confirm: true }>('metaDisconnect'),
  metaSyncCampaigns: fn<{ days?: number }, { campaigns: number; insightRows: number }>('metaSyncCampaigns'),
  metaListChildren: fn<{ parentId: string; level: 'adsets' | 'ads' }, { rows: any[] }>('metaListChildren'),
  metaUpdateCampaign: fn<{ campaignId: string; action: 'pause' | 'resume' | 'set_daily_budget' | 'feed_marketplace' | 'stop_feeding_marketplace'; dailyBudgetPence?: number; confirm: true; reason: string }>('metaUpdateCampaign'),
  adminLeadAction: fn<{ leadId: string; action: 'approve' | 'reject' | 'request_info' | 'update_fields' | 'resend' | 'reprocess'; note?: string; fields?: Record<string, string> }>('adminLeadAction'),
  saveLeadMapping: fn<{ formId: string; connected: boolean; fieldMap: Record<string, string>; required: string[]; consentField?: string }>('saveLeadMapping'),
  retryMetaEvent: fn<{ eventId: string }, { status: string }>('retryMetaEvent'),
  // support, assistant, accounts
  createSupportTicket: fn<{ subject: string; message: string; jobId?: string; category?: string; transcript?: { role: 'user' | 'assistant'; text: string }[] }, { ticketId: string }>('createSupportTicket'),
  replySupportTicket: fn<{ ticketId: string; text: string }>('replySupportTicket'),
  updateSupportTicket: fn<{ ticketId: string; status?: 'open' | 'pending' | 'closed'; assignToMe?: boolean; escalate?: boolean; note?: string }>('updateSupportTicket'),
  assistantChat: fn<{ messages: { role: 'user' | 'assistant'; text: string }[] }, AssistantReply>('assistantChat'),
  adminSearchUsers: fn<{ q: string; role?: 'customer' | 'engineer' | 'admin' }, { users: { id: string; fullName: string; email: string; role: string; status: string; engineerStatus: string | null; createdAt: number | null }[] }>('adminSearchUsers'),
  adminDeleteAccount: fn<{ userId: string; confirm: 'DELETE'; reason: string }>('adminDeleteAccount'),
  requestAccountDeletion: fn<{ reason?: string }>('requestAccountDeletion'),
}

export interface AssistantDraft { deviceType?: string; manufacturer?: string; model?: string; problem?: string; postcode?: string; serviceMethod?: string; urgency?: string }
export interface AssistantReply { reply: string; intent: string; draft?: AssistantDraft | null; readyToSubmit: boolean; escalate: boolean }

export { userMessage as errMsg } from './errors'
