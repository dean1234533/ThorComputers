/** Only approved plain-language messages reach the UI; service details stay out of pop-ups. */
const messages: Record<string, string> = {
  'Sign in required.': 'Please sign in to continue.',
  'This account is suspended.': 'Your account is unavailable. Please contact Thor Computer for help.',
  'Your admin access has changed. Please sign out and in again.': 'Your account access has changed. Please sign out, then sign in again.',
  'Your engineer account is not approved yet.': 'Our team needs to approve your application before you can take jobs.',
  'Your engineer account is not approved.': 'Our team needs to approve your application before you can take jobs.',
  'Please verify your email address first.': 'Please open the link in your email to verify your account first.',
  'Account already set up.': 'Your account is already set up. Please sign in.',
  'User not found.': 'We couldn’t find that account.',
  'You cannot change your own admin level.': 'Another administrator needs to change your account access.',
  'Job not found.': 'We couldn’t find that repair request.',
  'Not your job.': 'This repair request isn’t linked to your account.',
  'You are not part of this job.': 'This repair request isn’t linked to your account.',
  'Select an engineer first.': 'Choose an engineer before booking an appointment.',
  'Appointments can be booked after you select an engineer.': 'Choose an engineer before booking an appointment.',
  'An appointment already exists. Use reschedule.': 'You already have an appointment. Open Appointments to change its time.',
  'That time was just taken. Please choose another slot.': 'That time has just been booked. Please choose another time.',
  'Add your address so the engineer can visit.': 'Please add the address where you want the engineer to visit.',
  'That time is outside the engineer’s availability.': 'The engineer isn’t available at that time. Please choose another time.',
  'Appointment not found.': 'We couldn’t find that appointment.',
  'Not your appointment.': 'This appointment isn’t linked to your account.',
  'This appointment has already started.': 'This appointment has already started, so its booking can’t be changed.',
  'Only confirmed appointments can be rescheduled.': 'You can only change the time of a confirmed appointment.',
  'No pending reschedule.': 'There is no request to change the appointment time.',
  'The other party must respond.': 'Please wait for the other person to respond to your proposed time.',
  'Complete your profile first.': 'Please complete your profile before sending your application.',
  'Upload at least one qualification or certificate.': 'Please add at least one certificate before sending your application.',
  'We could not find your service postcode.': 'Please check your service postcode and try again.',
  'We could not find that postcode.': 'Please check your postcode and try again.',
  'A note explaining the decision is required.': 'Please add a short reason for your decision.',
  'Application not found.': 'We couldn’t find that application.',
  'Qualification not found.': 'We couldn’t find that certificate.',
  'Only approved profiles can be edited this way.': 'Your application needs to be approved before you can make this change.',
  'Invalid photo reference.': 'We couldn’t attach that photo. Please add it again.',
  'Daily request limit reached.': 'You’ve reached today’s limit of 10 repair requests. Please try again tomorrow.',
  'Expiry must be between 1 hour and 30 days from now.': 'Choose a quote expiry between one hour and 30 days from now.',
  'Quote total must be above £0.': 'Please enter a quote price greater than £0.',
  'You cannot quote on your own job.': 'You can’t send a quote for your own repair request.',
  'This job is no longer open for quotes.': 'This repair request is no longer accepting quotes.',
  'This job is outside your approved specialisations.': 'This repair needs skills that aren’t included in your approved profile.',
  'The customer did not request that service method.': 'Please choose one of the service options the customer requested.',
  'This quote can no longer be changed.': 'This quote can no longer be changed.',
  'Not your quote.': 'This quote isn’t linked to your account.',
  'Only live quotes can be withdrawn.': 'You can only withdraw a quote that is still waiting for a decision.',
  'Quote not found.': 'We couldn’t find that quote.',
  'A quote has already been accepted for this job.': 'An engineer has already been chosen for this repair.',
  'This quote is no longer available.': 'This quote is no longer available. Please choose another quote.',
  'This quote has expired. Ask the engineer to refresh it.': 'This quote has expired. Please ask the engineer for a new quote.',
  'This engineer is no longer available.': 'This engineer is no longer available. Please choose another engineer.',
  'This job is finished.': 'This repair is finished, so its details can’t be changed.',
  'Please remove phone numbers and email addresses from your review.': 'Please remove phone numbers and email addresses from your review.',
  'Only people involved in this repair can review it.': 'You can only review a repair you were involved in.',
  'Reviews open once the repair is completed.': 'You can leave a review once the repair is complete.',
  'You have already reviewed this job.': 'You’ve already left a review for this repair.',
  'Not your review.': 'You can only edit your own reviews.',
  'This review was removed.': 'This review has been removed and can’t be edited.',
  'Reviews can be edited once, within 48 hours.': 'You can edit a review once, within 48 hours of posting it.',
  'All ratings are required.': 'Please give a star rating for every category.',
  'Review not found.': 'We couldn’t find that review.',
  'Conversation access requires an open report that references it.': 'Open the report about this chat before viewing its messages.',
  'This link is not valid.': 'This link doesn’t work. Please request a new link.',
  'This enquiry has already been used.': 'This enquiry has already been added to your repair requests.',
  'This link has expired.': 'This link has expired. Please request a new link.',
  'Sign in with the email address you used on thorcomputer.com.': 'Please sign in with the email address you used on thorcomputer.com.',
  'You have repairs in progress. Complete or cancel them before deleting your account.': 'Please finish or cancel your active repairs before deleting your account.',
  'This engineer has not finished payment setup yet. Please contact support or message the engineer.': 'Your engineer hasn’t finished setting up payments, so you can’t pay for this job yet. Please message them and ask them to complete payment setup, or contact Thor Computer support. Nothing has been charged.',
  'Choose an engineer’s quotation first.': 'Choose an engineer’s quotation before paying.',
  'The accepted quotation is no longer valid.': 'The accepted quotation has changed, so this payment can’t go ahead. Please check the repair or contact Thor Computer.',
  'Payments are not configured yet.': 'Payments aren’t available yet. Please contact Thor Computer for help. Nothing has been charged.',
  'The payment provider rejected the request.': 'Our payment provider couldn’t start this payment. Please try again in a moment, or contact Thor Computer. Nothing has been charged.',
  'Approve the extra charge first.': 'Please approve the extra work first, then pay for it.',
  'Already paid.': 'This has already been paid.',
  'Charge not found.': 'We couldn’t find that charge.',
  'Not your charge.': 'This charge isn’t linked to your account.',
  'Already answered.': 'You’ve already answered this request.',
  'Extra work can only be proposed while the repair is under way.': 'Extra work can only be requested while the repair is under way.',
  'This repair is already finished, so its appointment can’t be changed.': 'This repair is already finished, so its appointment can’t be changed.',
  'Please complete payment before booking your appointment.': 'Please pay for this repair first, then book your appointment.',
  'Only paid transactions can be refunded.': 'Only paid transactions can be refunded.',
  'No payment is recorded for this transaction.': 'No payment is recorded for this transaction yet.',
  'Could not process image': 'We couldn’t read that photo. Please choose another photo.',
}

export function userMessage(error: unknown): string {
  const record = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown } : {}
  const code = typeof record.code === 'string' ? record.code.replace(/^[^/]+\//, '') : ''
  const raw = typeof record.message === 'string' ? record.message : typeof error === 'string' ? error : ''
  const message = raw.replace(/^Firebase:\s*/i, '').replace(/\s*\((?:auth|functions|storage|firestore)\/[\w-]+\)\.?$/, '').trim()
  if (Object.hasOwn(messages, message)) return messages[message]
  if (/^At most £[\d.]+ can still be refunded\.$/.test(message)) return message
  const ref = message.match(/\(ref (E[0-9A-F]{6})\)/)?.[1]
  if (ref) return `We hit a problem on our side and couldn’t finish that. Please try again in a minute. If it keeps happening, contact Thor Computer and quote reference ${ref}.`
  if (/paused for a short while/.test(message)) return message
  if (/maximum number of quotations/.test(message)) return 'This repair has received the maximum number of quotes, so no more can be added.'
  if (/mfa-required|multi-factor authentication is required/i.test(message)) return 'Open Security and set up two-step verification, then sign in again.'
  if (/^Missing permission:|^Requires \w+ account\./.test(message)) return 'Your account can’t make this change. Please contact an administrator.'
  if (/^Ratings required:/.test(message)) return 'Please give a star rating for every category.'
  if (/^Application is already|^Cannot \w+ an application/.test(message)) return 'This application has already changed. Refresh the page to see its latest status.'
  if (/^(?:customer|engineer|admin) cannot move a job from/.test(message)) return 'This repair has already changed. Refresh the page to see what you can do next.'
  if (/^Appointment is already/.test(message)) return 'This appointment has already changed. Open Appointments to see its latest status.'
  if (/is not available for this device type\.$/.test(message)) return 'Please choose a repair option that matches your device.'

  if (['network-request-failed', 'unavailable', 'retry-limit-exceeded', 'disconnected'].includes(code)) return 'We couldn’t connect. Check your internet connection and try again.'
  if (code === 'deadline-exceeded') return 'This is taking longer than expected. Please try again.'
  if (['unauthenticated', 'requires-recent-login', 'user-token-expired', 'invalid-user-token'].includes(code)) return 'Please sign in again to continue.'
  if (['invalid-credential', 'invalid-login-credentials', 'wrong-password', 'user-not-found'].includes(code)) return 'Incorrect email or password.'
  if (code === 'email-already-in-use') return 'An account with this email already exists. Please sign in instead.'
  if (code === 'invalid-email') return 'Please enter a valid email address.'
  if (['weak-password', 'password-does-not-meet-requirements'].includes(code)) return 'Please choose a stronger password with at least eight characters.'
  if (['too-many-requests', 'resource-exhausted', 'quota-exceeded'].includes(code)) return 'There have been too many attempts. Please wait a few minutes and try again.'
  if (['user-disabled', 'operation-not-allowed', 'app-not-authorized', 'invalid-api-key'].includes(code)) return 'Sign-in is unavailable. Please contact Thor Computer for help.'
  if (code === 'unverified-email') return 'Please verify your email address before continuing.'
  if (code === 'invalid-verification-code') return 'That code isn’t correct. Please enter the latest code from your authenticator app.'
  if (['session-expired', 'invalid-verification-id', 'invalid-multi-factor-session'].includes(code)) return 'Your verification has expired. Please sign in again.'
  if (code === 'maximum-second-factor-count-exceeded') return 'You’ve already added the maximum number of verification methods.'
  if (code === 'second-factor-already-in-use') return 'This verification method is already added to your account.'
  if (['permission-denied', 'unauthorized'].includes(code)) return 'Your account can’t make this change. Please contact Thor Computer for help.'
  if (['invalid-argument', 'out-of-range'].includes(code)) return 'Please check the details you entered and try again.'
  if (code === 'not-found' || code === 'object-not-found') return 'This item is no longer available. Please refresh the page.'
  if (code === 'already-exists') return 'This has already been added. Please refresh the page.'
  if (code === 'aborted' || code === 'failed-precondition') return 'Something has changed. Please refresh the page and try again.'
  if (code === 'cancelled' || code === 'canceled') return 'This was cancelled. Please try again when you’re ready.'
  return 'We couldn’t complete that. Please try again. If it keeps happening, contact Thor Computer for help.'
}
