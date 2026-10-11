export interface LatLng { lat: number; lng: number }
export const miles = (a: LatLng, b: LatLng) => {
  const R = 3958.8, r = (d: number) => d * Math.PI / 180, dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng)
  return 2 * R * Math.asin(Math.sqrt(Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2))
}
/** postcodes.io is a public, CORS-enabled UK postcode API. Result is cached per postcode. */
export async function geocode(postcode: string): Promise<LatLng | null> {
  if (import.meta.env.VITE_USE_EMULATORS === 'true') return { lat: 51.41, lng: 0.02 }   // local runs never call the public postcode API
  const key = 'thor.geo.' + postcode.replace(/\s/g, '').toUpperCase()
  try { const c = localStorage.getItem(key); if (c) return JSON.parse(c) } catch { /* ignore */ }
  try {
    const r = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode.replace(/\s/g, ''))}`); if (!r.ok) return null
    const x = (await r.json()).result; const v = { lat: x.latitude, lng: x.longitude }
    try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* ignore */ }
    return v
  } catch { return null }
}
