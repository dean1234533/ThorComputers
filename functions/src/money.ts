// Pure money rules (integer pence, GBP). No Firebase imports so they are unit-testable and shared by every payment path.

export const DEFAULT_COMMISSION_BPS = 1500   // 15.00%
export const MAX_COMMISSION_BPS = 3000       // hard ceiling so a typo can never take more than 30%

/** Thor's commission, in whole pence, rounded half up. Engineer share is the remainder, so the two always add up to the total exactly. */
export function commissionSplit(totalPence: number, bps: number): { commissionPence: number; engineerSharePence: number } {
  if (!Number.isInteger(totalPence) || totalPence < 0) throw new RangeError('totalPence must be a non-negative integer')
  if (!Number.isInteger(bps) || bps < 0 || bps > MAX_COMMISSION_BPS) throw new RangeError('commission basis points out of range')
  const commissionPence = Math.floor((totalPence * bps + 5000) / 10000)
  return { commissionPence, engineerSharePence: totalPence - commissionPence }
}

/** Share of the commission returned when part of the payment is refunded (proportional, rounded half up, never more than the commission). */
export function commissionRefund(totalPence: number, commissionPence: number, refundPence: number): number {
  if (totalPence <= 0) return 0
  const r = Math.min(Math.max(refundPence, 0), totalPence)
  return Math.min(commissionPence, Math.floor((r * commissionPence + Math.floor(totalPence / 2)) / totalPence))
}

export const penceToPounds = (p: number) => (p / 100).toFixed(2)
