import { useState, useEffect, useRef } from 'react'

export function useTurnTimer(deadline, isMyTurn, onTimeout) {
  const [secondsLeft, setSecondsLeft] = useState(null)
  const firedRef = useRef(false)

  useEffect(() => {
    firedRef.current = false

    if (!deadline) {
      setSecondsLeft(null)
      return
    }

    const target = new Date(deadline).getTime()

    const tick = () => {
      const remaining = Math.max(0, Math.ceil((target - Date.now()) / 1000))
      setSecondsLeft(remaining)

      if (remaining <= 0 && !firedRef.current && isMyTurn) {
        firedRef.current = true
        onTimeout?.()
      }
    }

    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [deadline, isMyTurn, onTimeout])

  return secondsLeft
}
