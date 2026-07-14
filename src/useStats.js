import { useState, useCallback } from 'react'

const STORAGE_KEY = 'bingo_stats'

function loadStats() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    // corrupted data
  }
  return { gamesPlayed: 0, wins: 0, currentStreak: 0, bestStreak: 0, history: [] }
}

function saveStats(stats) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stats))
  } catch {
    // storage full
  }
}

export function useStats() {
  const [stats, setStats] = useState(loadStats)

  const recordGame = useCallback((result, meta = {}) => {
    setStats((prev) => {
      const isWin = result === 'win'
      const currentStreak = isWin ? prev.currentStreak + 1 : 0
      const next = {
        gamesPlayed: prev.gamesPlayed + 1,
        wins: prev.wins + (isWin ? 1 : 0),
        currentStreak,
        bestStreak: Math.max(prev.bestStreak, currentStreak),
        history: [
          ...prev.history.slice(-49),
          { result, date: new Date().toISOString(), ...meta },
        ],
      }
      saveStats(next)
      return next
    })
  }, [])

  const resetStats = useCallback(() => {
    const empty = { gamesPlayed: 0, wins: 0, currentStreak: 0, bestStreak: 0, history: [] }
    saveStats(empty)
    setStats(empty)
  }, [])

  return { stats, recordGame, resetStats }
}
