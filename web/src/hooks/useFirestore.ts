import { useEffect, useState } from 'react'
import { doc, onSnapshot, query, QueryConstraint, collection, DocumentData } from 'firebase/firestore'
import { db } from '@/lib/firebase'

export type WithId<T = DocumentData> = T & { id: string }

/** Realtime document listener; unsubscribes on unmount. Pass null path to skip. */
export function useDoc<T = DocumentData>(path: string | null) {
  const [state, set] = useState<{ data: WithId<T> | null; loading: boolean; error?: Error }>({ data: null, loading: !!path })
  useEffect(() => {
    if (!path) { set({ data: null, loading: false }); return }
    set(s => ({ ...s, loading: true }))
    return onSnapshot(doc(db, path), s => set({ data: s.exists() ? ({ id: s.id, ...s.data() } as WithId<T>) : null, loading: false }), error => set({ data: null, loading: false, error }))
  }, [path])
  return state
}

/** Realtime query listener. `deps` must capture everything the constraints depend on. */
export function useQuery<T = DocumentData>(path: string | null, constraints: () => QueryConstraint[], deps: unknown[]) {
  const [state, set] = useState<{ data: WithId<T>[]; loading: boolean; error?: Error }>({ data: [], loading: !!path })
  useEffect(() => {
    if (!path) { set({ data: [], loading: false }); return }
    set(s => ({ ...s, loading: true }))
    return onSnapshot(query(collection(db, path), ...constraints()), s => set({ data: s.docs.map(d => ({ id: d.id, ...d.data() }) as WithId<T>), loading: false }), error => set({ data: [], loading: false, error }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps])
  return state
}
