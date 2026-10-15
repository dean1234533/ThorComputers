/** A short two-note chime for new notifications and messages while the app is open (no audio file needed). Background alerts use the device's own notification sound via the service worker.
 *  Browsers only allow audio after the person has interacted with the page, so the context is unlocked on the first tap/keypress. The choice is stored per device. */
let ctx: AudioContext | null = null
const Ctor = (): typeof AudioContext | undefined => typeof window === 'undefined' ? undefined : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)

export const soundEnabled = () => { try { return localStorage.getItem('thor.sound') !== 'off' } catch { return true } }
export const setSoundEnabled = (on: boolean) => { try { localStorage.setItem('thor.sound', on ? 'on' : 'off') } catch { /* private mode: the default (on) applies */ } }

export function unlockAudio() {
  const C = Ctor(); if (!C) return
  const go = () => { try { ctx ??= new C(); if (ctx.state === 'suspended') void ctx.resume() } catch { /* unsupported */ } }
  addEventListener('pointerdown', go, { once: true, capture: true }); addEventListener('keydown', go, { once: true, capture: true })
}

export function playChime(force = false) {
  if (!force && !soundEnabled()) return
  const C = Ctor(); if (!C) return
  try {
    ctx ??= new C(); if (ctx.state === 'suspended') void ctx.resume()
    const c = ctx, t0 = c.currentTime
    ;([[880, 0], [1318.5, 0.16]] as const).forEach(([freq, delay]) => {
      const o = c.createOscillator(), g = c.createGain(); o.type = 'sine'; o.frequency.value = freq
      g.gain.setValueAtTime(0.0001, t0 + delay); g.gain.exponentialRampToValueAtTime(0.2, t0 + delay + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + delay + 0.45)
      o.connect(g).connect(c.destination); o.start(t0 + delay); o.stop(t0 + delay + 0.5)
    })
  } catch { /* blocked by autoplay policy: silently skip, the badge still updates */ }
}
