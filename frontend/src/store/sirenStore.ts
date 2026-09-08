import { create } from 'zustand'

// Global siren: a single AudioContext shared app-wide so that resolving
// from ANY page (manager console, responder monitor, presence board)
// stops the sound everywhere. Previously each page owned its own
// oscillator, so Resolve clicked elsewhere left the tone running until refresh.
interface SirenState {
  mode: null | 'drill' | 'fire'
  startDrill: () => void
  startFire: () => void
  stop: () => void
}

let ctx: AudioContext | null = null
let osc: OscillatorNode | null = null
let gain: GainNode | null = null
let timer: number | null = null
let resumeRetry: number | null = null

// Phones block audio until the user interacts with the page, so a siren
// started by a socket push can be born suspended (silent). Sticky-gesture
// resume: any later tap/keypress wakes the live siren — no refresh needed.
if (typeof window !== 'undefined') {
  const wake = () => {
    try {
      ctx?.resume?.().catch(() => {})
    } catch {}
  }
  window.addEventListener('pointerdown', wake)
  window.addEventListener('touchend', wake)
  window.addEventListener('keydown', wake)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') wake()
  })
}

function vibrate(pattern: number | number[]) {
  try {
    ;(navigator as any)?.vibrate?.(pattern)
  } catch {}
}

function teardown() {
  if (timer) { window.clearInterval(timer); timer = null }
  if (resumeRetry) { window.clearInterval(resumeRetry); resumeRetry = null }
  if (osc) { try { osc.stop() } catch {} osc = null }
  if (ctx) { try { ctx.close() } catch {} ctx = null }
  gain = null
  vibrate(0)
}

function build(kind: 'drill' | 'fire') {
  teardown()
  try {
    ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    osc = ctx.createOscillator()
    gain = ctx.createGain()
    if (kind === 'fire') {
      // Continuous wail — real emergency
      osc.type = 'sawtooth'
      osc.frequency.value = 700
      gain.gain.value = 0.09
      let up = true
      timer = window.setInterval(() => {
        if (!osc || !ctx) { if (timer) window.clearInterval(timer); return }
        osc.frequency.setTargetAtTime(up ? 1200 : 650, ctx.currentTime, 0.06)
        up = !up
      }, 450)
    } else {
      // Soft intermittent beep — drill only
      osc.type = 'sine'
      osc.frequency.value = 660
      gain.gain.value = 0.06
      let on = true
      timer = window.setInterval(() => {
        if (!gain || !ctx) return
        gain.gain.setTargetAtTime(on ? 0.06 : 0.0, ctx.currentTime, 0.05)
        on = !on
      }, 600)
    }
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    // If the context is still suspended (no user gesture yet on this phone),
    // the oscillator runs silently until the wake hook above resumes it.
    // Retry resume for up to ~30s so a background-tab alert gets loud alone.
    try { ctx.resume?.().catch(() => {}) } catch {}
    if (resumeRetry) window.clearInterval(resumeRetry)
    let tries = 0
    resumeRetry = window.setInterval(() => {
      tries += 1
      try {
        if (ctx && ctx.state === 'suspended') ctx.resume?.().catch(() => {})
        else if (resumeRetry) { window.clearInterval(resumeRetry); resumeRetry = null }
      } catch {}
      if (tries > 15 && resumeRetry) { window.clearInterval(resumeRetry); resumeRetry = null }
    }, 2000)
    vibrate(kind === 'fire' ? [500, 200, 500, 200, 1000] : [300, 300, 300, 300])
  } catch {
    teardown()
  }
}

export const useSirenStore = create<SirenState>((set, get) => ({
  mode: null,
  startDrill: () => {
    if (get().mode === 'drill') return
    build('drill')
    set({ mode: 'drill' })
  },
  startFire: () => {
    if (get().mode === 'fire') return
    build('fire')
    set({ mode: 'fire' })
  },
  stop: () => {
    teardown()
    if (get().mode !== null) set({ mode: null })
  },
}))
