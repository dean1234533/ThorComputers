import { useEffect, useState } from 'react'
import { getDownloadURL, ref } from 'firebase/storage'
import { ImageOff } from 'lucide-react'
import { storage } from '@/lib/firebase'
import { cx } from './ui'

/** Storage rules gate access; unavailable attachments show an explicit state instead of an endless loader. */
export function StorageImg({ path, className, alt = '' }: { path: string; className?: string; alt?: string }) {
  const [result, setResult] = useState<{ path: string; url?: string; failed?: boolean }>({ path })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let live = true
    setResult({ path })
    getDownloadURL(ref(storage, path)).then(url => { if (live) setResult({ path, url }) }).catch(() => { if (live) setResult({ path, failed: true }) })
    return () => { live = false }
  }, [path, attempt])
  const current = result.path === path ? result : { path }
  if (current.failed) return <div className={cx('flex flex-col items-center justify-center gap-1 rounded-xl bg-paper p-2 text-center text-[11px] text-thor-text', className)} role="status"><ImageOff className="size-4 shrink-0" /><span>Photo unavailable</span><button type="button" onClick={() => setAttempt(a => a + 1)} className="font-medium text-thor-blue hover:underline">Retry</button></div>
  return current.url ? <a href={current.url} target="_blank" rel="noreferrer"><img src={current.url} alt={alt || 'Attached photo'} loading="lazy" onError={() => setResult({ path, failed: true })} className={className} /></a> : <div className={cx('skeleton', className)} role="status" aria-label="Loading photo" />
}
