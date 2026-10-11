import { useEffect, useState } from 'react'
import { getDownloadURL, ref } from 'firebase/storage'
import { storage } from '@/lib/firebase'

/** Resolves a Storage path to a download URL at render time. Storage rules gate who can obtain it; the URL itself is an unguessable token link. */
export function StorageImg({ path, className, alt = '' }: { path: string; className?: string; alt?: string }) {
  const [url, setUrl] = useState<string>()
  useEffect(() => { let live = true; getDownloadURL(ref(storage, path)).then(u => live && setUrl(u)).catch(() => {}); return () => { live = false } }, [path])
  return url ? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={alt || 'Attached photo'} loading="lazy" className={className} /></a> : <div className={`skeleton ${className ?? ''}`} />
}
