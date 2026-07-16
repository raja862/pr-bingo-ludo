import { useRef, useCallback, useState } from 'react'

const STORAGE_KEY = 'bingo_muted'

export function useSounds() {
  const ctxRef = useRef(null)
  const [muted, setMuted] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) === 'true' } catch { return false }
  })
  const mutedRef = useRef(muted)

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev
      mutedRef.current = next
      try { localStorage.setItem(STORAGE_KEY, String(next)) } catch {}
      return next
    })
  }, [])

  const getCtx = useCallback(() => {
    if (!ctxRef.current) {
      ctxRef.current = new (window.AudioContext || window.webkitAudioContext)()
    }
    if (ctxRef.current.state === 'suspended') {
      ctxRef.current.resume()
    }
    return ctxRef.current
  }, [])

  const playTap = useCallback(() => {
    if (mutedRef.current) return
    try {
      const ctx = getCtx()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'square'
      osc.frequency.value = 800
      gain.gain.setValueAtTime(0.08, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.05)
    } catch {
      // Audio not available
    }
  }, [getCtx])

  const playBingo = useCallback(() => {
    if (mutedRef.current) return
    try {
      const ctx = getCtx()
      const notes = [523.25, 659.25, 783.99, 1046.5] // C5, E5, G5, C6
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.value = freq
        const start = ctx.currentTime + i * 0.12
        gain.gain.setValueAtTime(0.15, start)
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.3)
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start(start)
        osc.stop(start + 0.3)
      })
    } catch {
      // Audio not available
    }
  }, [getCtx])

  const playNotify = useCallback(() => {
    if (mutedRef.current) return
    try {
      const ctx = getCtx()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(440, ctx.currentTime)
      osc.frequency.setValueAtTime(554, ctx.currentTime + 0.1)
      gain.gain.setValueAtTime(0.1, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.2)
    } catch {
      // Audio not available
    }
  }, [getCtx])

  const playDice = useCallback(() => {
    if (mutedRef.current) return
    try {
      const ctx = getCtx()
      const now = ctx.currentTime

      // Rattle: series of short surface impacts (dice tumbling)
      const clickCount = 6 + Math.floor(Math.random() * 3)
      for (let i = 0; i < clickCount; i++) {
        const t = now + i * 0.065 + Math.random() * 0.02
        const vol = 0.07 * (1 - i * 0.07) + 0.015

        const len = Math.floor(ctx.sampleRate * (0.012 + Math.random() * 0.008))
        const buf = ctx.createBuffer(1, len, ctx.sampleRate)
        const d = buf.getChannelData(0)
        for (let j = 0; j < len; j++) {
          d[j] = (Math.random() * 2 - 1) * (1 - j / len)
        }
        const src = ctx.createBufferSource()
        src.buffer = buf

        const filter = ctx.createBiquadFilter()
        filter.type = 'highpass'
        filter.frequency.value = 1500 + Math.random() * 2500
        filter.Q.value = 0.8

        const gain = ctx.createGain()
        gain.gain.setValueAtTime(vol, t)
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.02)

        src.connect(filter)
        filter.connect(gain)
        gain.connect(ctx.destination)
        src.start(t)
      }

      // Landing thud: low-frequency impact
      const landTime = now + clickCount * 0.065 + 0.06
      const thud = ctx.createOscillator()
      const thudGain = ctx.createGain()
      thud.type = 'sine'
      thud.frequency.setValueAtTime(120, landTime)
      thud.frequency.exponentialRampToValueAtTime(45, landTime + 0.12)
      thudGain.gain.setValueAtTime(0.1, landTime)
      thudGain.gain.exponentialRampToValueAtTime(0.001, landTime + 0.15)
      thud.connect(thudGain)
      thudGain.connect(ctx.destination)
      thud.start(landTime)
      thud.stop(landTime + 0.15)

      // Landing noise burst
      const landLen = Math.floor(ctx.sampleRate * 0.035)
      const landBuf = ctx.createBuffer(1, landLen, ctx.sampleRate)
      const landData = landBuf.getChannelData(0)
      for (let j = 0; j < landLen; j++) {
        landData[j] = (Math.random() * 2 - 1) * (1 - j / landLen) * 0.5
      }
      const landSrc = ctx.createBufferSource()
      landSrc.buffer = landBuf
      const landGain = ctx.createGain()
      landGain.gain.setValueAtTime(0.09, landTime)
      landGain.gain.exponentialRampToValueAtTime(0.001, landTime + 0.06)
      landSrc.connect(landGain)
      landGain.connect(ctx.destination)
      landSrc.start(landTime)
    } catch {
      // Audio not available
    }
  }, [getCtx])

  const playCapture = useCallback(() => {
    if (mutedRef.current) return
    try {
      const ctx = getCtx()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sawtooth'
      osc.frequency.setValueAtTime(600, ctx.currentTime)
      osc.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.2)
      gain.gain.setValueAtTime(0.1, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.25)
    } catch {
      // Audio not available
    }
  }, [getCtx])

  return { playTap, playBingo, playNotify, playDice, playCapture, muted, toggleMute }
}
