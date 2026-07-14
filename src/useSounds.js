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
      const bufferSize = ctx.sampleRate * 0.08
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
      const data = buffer.getChannelData(0)
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize)
      }
      const source = ctx.createBufferSource()
      source.buffer = buffer
      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0.12, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08)
      source.connect(gain)
      gain.connect(ctx.destination)
      source.start(ctx.currentTime)
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
