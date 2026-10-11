import { useRegisterSW } from 'virtual:pwa-register/react'
import { RefreshCw } from 'lucide-react'
import { Button } from './ui'

/** New versions wait until the user agrees, so a refresh never loses a half-written quote or message. */
export default function UpdatePrompt() {
  const { needRefresh: [need], updateServiceWorker } = useRegisterSW({ immediate: true, onRegisteredSW(_u, r) { r && setInterval(() => r.update(), 60 * 60 * 1000) } })
  if (!need) return null
  return (
    <div role="status" className="safe-t fixed inset-x-0 top-0 z-[70] flex items-center justify-center gap-3 bg-thor-orange px-4 py-2.5 text-sm font-medium text-ink">
      <RefreshCw className="size-4" />A new version of Thor Computer is ready.
      <Button size="sm" onClick={() => updateServiceWorker(true)}>Update now</Button>
    </div>
  )
}
