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

export interface MetaCheck { id: string; label: string; ok: boolean; detail: string; fix?: string; required?: boolean }
export interface MetaSelfTest { overall: 'not_configured' | 'not_connected' | 'needs_attention' | 'ready'; ingestionVerified: boolean; lastWebhookAt: number | null; lastLeadAt: number | null; checks: MetaCheck[]; notes: string[] }
export interface LegalInput { businessName: string; registeredAddress: string; companyNumber?: string; contactEmail: string; icoNumber?: string; icoExempt?: boolean; privacyText: string; approved: boolean }
export interface QuickReply { label: string; value: string }
export interface ChatReply { reply: string; quickReplies: QuickReply[]; draft: Record<string, any> | null; ready: boolean; openForm: boolean; escalate: boolean; source: 'rules' | 'ai' | 'fallback'; state: unknown; remainingToday: number }
export interface AiSettingsInput {
  enabled: boolean; aiFallbackEnabled: boolean; welcome: string; escalation: string; knowledge?: string; model?: string; dailyLimit: number; aiDailyLimit: number; globalAiDailyLimit: number
  aiTimeoutMs?: number; costInMicrosPer1k?: number; costOutMicrosPer1k?: number; faqOverrides?: Record<string, { answer?: string; enabled?: boolean }>; customFaqs?: { id: string; questions: string[]; answer: string }[]
}

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
  saveMarketplaceSettings: fn<{ newRequestsEnabled: boolean; biddingEnabled: boolean; maxQuotesPerJob: number; maxQuoteValidityDays: number }>('saveMarketplaceSettings'),
  getEnquiry: fn<{ id: string; token: string }, { fields: Record<string, string>; source?: string }>('getEnquiry'),
  // payments (Stripe Connect)
  stripeConnectOnboard: fn<object, { url: string }>('stripeConnectOnboard'),
  stripeConnectRefresh: fn<object, { connected: boolean; chargesEnabled: boolean; payoutsEnabled: boolean }>('stripeConnectRefresh'),
  createCheckout: fn<{ jobId: string; additionalChargeId?: string }, { alreadyPaid: boolean; url: string | null }>('createCheckout'),
  proposeAdditionalCharge: fn<{ jobId: string; amountPence: number; description: string }, { id: string }>('proposeAdditionalCharge'),
  respondAdditionalCharge: fn<{ id: string; accept: boolean }>('respondAdditionalCharge'),
  refundTransaction: fn<{ transactionId: string; amountPence: number; reason: string }, { refundId: string }>('refundTransaction'),
  resolvePaymentDispute: fn<{ disputeId: string; resolution: 'won' | 'lost' | 'refunded' | 'withdrawn'; note: string; customerComplaint?: string; engineerResponse?: string }>('resolvePaymentDispute'),
  saveFinanceSettings: fn<{ commissionBps: number; requirePaymentBeforeBooking: boolean; refundPolicy?: string; cancellationPolicy?: string }>('saveFinanceSettings'),
  adminFinanceStats: fn<{ from?: string; to?: string }, any>('adminFinanceStats'),
  // marketing & lead generation (Meta)
  metaConnectUrl: fn<object, { url: string }>('metaConnectUrl'),
  metaConnectWithToken: fn<{ token: string }, { pages: number; adAccounts: number; subscribedPages: number }>('metaConnectWithToken'),
  metaDisconnect: fn<object>('metaDisconnect'),
  syncMetaCampaigns: fn<object, { campaigns: number }>('syncMetaCampaigns'),
  reconcileMetaLeads: fn<object, { checked: number; imported: number }>('reconcileMetaLeads'),
  setMetaCampaignStatus: fn<{ campaignId: string; status: 'ACTIVE' | 'PAUSED'; confirm: true }>('setMetaCampaignStatus'),
  setMetaCampaignBudget: fn<{ campaignId: string; dailyBudgetPence: number; confirm: true }>('setMetaCampaignBudget'),
  rejectMetaLead: fn<{ leadId: string; reason: string }>('rejectMetaLead'),
  updateMetaLead: fn<{ leadId: string; fields: Record<string, string> }, { status: string }>('updateMetaLead'),
  issueLeadConfirmationLink: fn<{ leadId: string; sendEmail?: boolean }, { url: string }>('issueLeadConfirmationLink'),
  saveLeadMapping: fn<{ formId: string; fields: Record<string, string[]>; required: string[] }>('saveLeadMapping'),
  saveCampaignRouting: fn<{ campaignId: string; enabled: boolean; deviceType?: string; serviceMethod?: string }>('saveCampaignRouting'),
  saveMarketingSettings: fn<{ requiredFields: string[]; defaultFeedsMarketplace: boolean; attributionWindowDays: number; maxDailyBudgetPence: number; maxBudgetChangePct: number; autoImport: boolean }>('saveMarketingSettings'),
  metaSelfTest: fn<object, MetaSelfTest>('metaSelfTest'),
  saveLegalSettings: fn<LegalInput>('saveLegalSettings'),
  adminMarketingStats: fn<{ from?: string; to?: string }, any>('adminMarketingStats'),
  // AI assistant
  /** 20 s ceiling: the assistant must never leave a customer on "Thinking…" indefinitely. */
  chatbotMessage: async (input: { text: string; state?: unknown }): Promise<ChatReply> => (await httpsCallable<typeof input, ChatReply>(functions, 'chatbotMessage', { timeout: 20000 })(input)).data,
  chatFaqCatalog: fn<object, { intents: { id: string; label: string; topic: string; answer: string; account: boolean }[] }>('chatFaqCatalog'),
  saveAiSettings: fn<AiSettingsInput>('saveAiSettings'),
  aiUsage: fn<object, { perDay: Record<string, { messages: number; users: number }>; metrics: Record<string, Record<string, number>> }>('aiUsage'),
}

export { userMessage as errMsg } from './errors'
