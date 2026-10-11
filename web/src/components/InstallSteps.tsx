import { Share, SquarePlus, Check } from 'lucide-react'

/** Visual walkthrough for iPhone/iPad, where no programmatic install prompt exists. */
export default function InstallSteps() {
  const steps = [
    { icon: Share, title: 'Tap the Share button', body: 'In Safari, it’s the square with an arrow at the bottom (or top on iPad) of the screen.' },
    { icon: SquarePlus, title: 'Choose “Add to Home Screen”', body: 'Scroll down the share sheet if you can’t see it straight away.' },
    { icon: Check, title: 'Tap “Add”', body: 'Thor Computer now appears on your Home Screen and opens like a normal app.' },
  ]
  return (
    <ol className="space-y-3">
      {steps.map((s, i) => (
        <li key={i} className="flex items-start gap-3.5 rounded-2xl bg-paper p-3.5">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-thor-blue text-white"><s.icon className="size-5" /></span>
          <div><p className="font-medium">{i + 1}. {s.title}</p><p className="text-sm text-thor-text">{s.body}</p></div>
        </li>))}
    </ol>
  )
}
