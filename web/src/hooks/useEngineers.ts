import { useEffect, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { Provider } from '@/types/domain'

export interface EngineerPublic {
  uid: string; displayName: string; businessName?: string; bio: string; yearsExperience: number; specialisations: string[]; areasCovered: string[]
  workingArrangements: string[]; typicalPricing?: string; photoURL: string; verifiedQualifications: { name: string; issuer: string }[]; selfReportedCerts?: string
  ratingAvg: number; reviewCount: number; completedJobs: number; provider: Provider; status: string
}
const cache = new Map<string, Promise<EngineerPublic | null>>()
const load = (id: string) => { if (!cache.has(id)) cache.set(id, getDoc(doc(db, 'engineerProfiles', id)).then(s => (s.exists() ? ({ uid: id, ...s.data() } as EngineerPublic) : null), () => null)); return cache.get(id)! }

/** Loads public profiles once per id (module cache) to keep Firestore reads down. */
export function useEngineers(ids: string[]) {
  const key = [...new Set(ids)].sort().join(',')
  const [map, setMap] = useState<Record<string, EngineerPublic | null>>({})
  useEffect(() => { let live = true; Promise.all(key ? key.split(',').map(async i => [i, await load(i)] as const) : []).then(r => live && setMap(Object.fromEntries(r))); return () => { live = false } }, [key])
  return map
}
