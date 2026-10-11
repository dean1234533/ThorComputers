export interface Geo { lat: number; lng: number; outcode: string; area: string }
/** Resolves a UK postcode via postcodes.io. Returns null on failure so callers can degrade gracefully. */
export async function geocode(postcode: string): Promise<Geo | null> {
  // Local development: deterministic offline lookup so emulator runs never depend on (or call) a live service.
  if (process.env.FUNCTIONS_EMULATOR === 'true' || process.env.MOCK_EXTERNAL === 'true') {
    const pc = postcode.replace(/\s/g, '').toUpperCase()
    if (!/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(pc)) return null
    const outcode = pc.slice(0, -3)
    return { lat: 51.4 + (outcode.charCodeAt(outcode.length - 1) % 10) / 100, lng: 0.02, outcode, area: `Bromley · ${outcode}` }
  }
  try {
    const r = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode.replace(/\s/g, ''))}`, { signal: AbortSignal.timeout(5000) })
    if (!r.ok) return null
    const j: any = await r.json()
    const x = j.result
    return { lat: x.latitude, lng: x.longitude, outcode: x.outcode, area: [x.admin_district ?? x.region, x.outcode].filter(Boolean).join(' · ') }
  } catch { return null }
}
export const miles = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 3958.8, rad = (d: number) => d * Math.PI / 180
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
/** Coarsen coordinates (~11 km) before they go anywhere public. */
export const coarse = (n: number) => Math.round(n * 10) / 10
