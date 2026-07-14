import { useState, useMemo, useCallback, useRef, useLayoutEffect, useEffect } from 'react'
import { SIZES, DEFAULT_SIZE, shuffledNumbers, shuffledWords, getLines, progressLetters } from './gameLogic'
import { useOnlineGame } from './useOnlineGame'
import { useSounds } from './useSounds'
import { useStats } from './useStats'
import { useChat } from './useChat'
import { useTurnTimer } from './useTurnTimer'
import LudoGame from './LudoGame'

const THEMES = [
  { name: 'Default', bg: '#0f1226', bg2: '#1a1f3d', cell: '#232a52', mode: 'dark' },
  { name: 'Midnight', bg: '#0a0a1a', bg2: '#12122e', cell: '#1a1a3a', mode: 'dark' },
  { name: 'Forest', bg: '#0b1a10', bg2: '#132e1a', cell: '#1a3d24', mode: 'dark' },
  { name: 'Ocean', bg: '#0a1520', bg2: '#122a3d', cell: '#1a3552', mode: 'dark' },
  { name: 'Wine', bg: '#1a0a14', bg2: '#2e1220', cell: '#3d1a2a', mode: 'dark' },
  { name: 'Charcoal', bg: '#1a1a1a', bg2: '#2a2a2a', cell: '#3a3a3a', mode: 'dark' },
  { name: 'Light', bg: '#e8ecf4', bg2: '#f4f6fa', cell: '#ffffff', mode: 'light' },
  { name: 'Cream', bg: '#f5f0e1', bg2: '#faf7f0', cell: '#ffffff', mode: 'light' },
]

function loadTheme() {
  try {
    const raw = localStorage.getItem('bingo_theme')
    if (raw) return JSON.parse(raw)
  } catch {}
  return THEMES[0]
}

function applyTheme(theme) {
  const root = document.documentElement
  root.style.setProperty('--bg', theme.bg)
  root.style.setProperty('--bg-2', theme.bg2)
  root.style.setProperty('--cell', theme.cell)
  if (theme.mode === 'light') {
    root.style.setProperty('--text', '#1a1a2e')
    root.style.setProperty('--muted', '#5a6080')
    root.style.setProperty('--cell-hover', '#e2e6f0')
  } else {
    root.style.setProperty('--text', '#eef1ff')
    root.style.setProperty('--muted', '#9aa3d0')
    root.style.setProperty('--cell-hover', '#2e3872')
  }
  try { localStorage.setItem('bingo_theme', JSON.stringify(theme)) } catch {}
}

const PLAYER_AVATARS = [
  '\u{1F60E}', '\u{1F525}', '\u{1F680}', '\u{2B50}', '\u{1F3AF}', '\u{1F47E}',
  '\u{1F981}', '\u{1F985}', '\u{1F43A}', '\u{1F431}', '\u{1F42C}', '\u{1F984}',
]

function Board({ size, numbers, callers, completedLines, onCellClick, disabled, flashIndex, shakeIndex, boardAnimating }) {
  const boardRef = useRef(null)
  const cellRefs = useRef([])
  const [segments, setSegments] = useState([])

  const inLineCells = useMemo(() => {
    const s = new Set()
    for (const cells of completedLines) for (const idx of cells) s.add(idx)
    return s
  }, [completedLines])

  const recompute = useCallback(() => {
    const board = boardRef.current
    if (!board) return
    const b = board.getBoundingClientRect()
    const segs = completedLines
      .map((cells) => {
        const first = cellRefs.current[cells[0]]
        const last = cellRefs.current[cells[cells.length - 1]]
        if (!first || !last) return null
        const fr = first.getBoundingClientRect()
        const lr = last.getBoundingClientRect()
        return {
          x1: fr.left + fr.width / 2 - b.left,
          y1: fr.top + fr.height / 2 - b.top,
          x2: lr.left + lr.width / 2 - b.left,
          y2: lr.top + lr.height / 2 - b.top,
        }
      })
      .filter(Boolean)
    setSegments(segs)
  }, [completedLines])

  useLayoutEffect(() => { recompute() }, [recompute, size, numbers])
  useEffect(() => {
    window.addEventListener('resize', recompute)
    return () => window.removeEventListener('resize', recompute)
  }, [recompute])

  const isWordCell = typeof numbers[0] === 'string'

  return (
    <div className="board-wrap">
      <div className={`board ${boardAnimating ? 'board-animate' : ''}`} ref={boardRef} style={{ '--size': size }}>
        {numbers.map((num, index) => {
          const caller = callers[index]
          return (
            <button
              key={index}
              ref={(el) => { cellRefs.current[index] = el }}
              className={`cell ${caller ? `p${caller}` : ''} ${inLineCells.has(index) ? 'in-line' : ''} ${flashIndex === index ? 'flash' : ''} ${shakeIndex === index ? 'shake' : ''} ${isWordCell ? 'word-cell' : ''}`}
              style={boardAnimating ? { '--cell-i': index } : undefined}
              onClick={() => onCellClick(index)}
              disabled={disabled || caller != null}
            >
              {num}
            </button>
          )
        })}
      </div>
      <svg className="lines-overlay" aria-hidden="true">
        {segments.map((s, i) => (
          <line key={i} className="bingo-line" x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} />
        ))}
      </svg>
    </div>
  )
}

const CHAT_REACTIONS = ['\u{1F44D}', '\u{1F602}', '\u{1F389}', '\u{1F62E}', '\u{1F480}']

export default function App() {
  const [game, setGame] = useState(null) // null | 'bingo' | 'ludo'
  const [mode, setMode] = useState(null)
  const [phase, setPhase] = useState('setup')
  const [size, setSize] = useState(DEFAULT_SIZE)
  const [playerCount, setPlayerCount] = useState(2)
  const [myPlayer, setMyPlayer] = useState(1)

  const [myName, setMyName] = useState('')
  const [myAvatar, setMyAvatar] = useState(() => {
    try { return localStorage.getItem('bingo_avatar') || PLAYER_AVATARS[0] } catch { return PLAYER_AVATARS[0] }
  })

  // Theme state
  const [theme, setTheme] = useState(loadTheme)
  const [showThemePicker, setShowThemePicker] = useState(false)
  const [customBgColor, setCustomBgColor] = useState(theme.bg)

  useEffect(() => { applyTheme(theme) }, [theme])

  const selectTheme = (t) => {
    setTheme(t)
    setCustomBgColor(t.bg)
  }

  const applyCustomColor = (color) => {
    setCustomBgColor(color)
    const r = parseInt(color.slice(1, 3), 16)
    const g = parseInt(color.slice(3, 5), 16)
    const b = parseInt(color.slice(5, 7), 16)
    const lum = (r * 299 + g * 587 + b * 114) / 1000
    const isLight = lum > 128
    const bg2 = `#${Math.min(255, r + (isLight ? -12 : 16)).toString(16).padStart(2, '0')}${Math.min(255, g + (isLight ? -12 : 16)).toString(16).padStart(2, '0')}${Math.min(255, b + (isLight ? -12 : 16)).toString(16).padStart(2, '0')}`
    const cell = `#${Math.min(255, r + (isLight ? -20 : 30)).toString(16).padStart(2, '0')}${Math.min(255, g + (isLight ? -20 : 30)).toString(16).padStart(2, '0')}${Math.min(255, b + (isLight ? -20 : 30)).toString(16).padStart(2, '0')}`
    setTheme({ name: 'Custom', bg: color, bg2, cell, mode: isLight ? 'light' : 'dark' })
  }

  // Custom bingo state
  const [gameType, setGameType] = useState('numbers')
  const [customWords, setCustomWords] = useState('')
  const [timerEnabled, setTimerEnabled] = useState(false)
  const [timerSeconds, setTimerSeconds] = useState(20)

  // Offline state
  const [numbers, setNumbers] = useState([])
  const [callers, setCallers] = useState({})
  const [currentTurn, setCurrentTurn] = useState(1)
  const [calls, setCalls] = useState([])

  // Rankings state
  const [rankings, setRankings] = useState([])
  const [rankBanner, setRankBanner] = useState(null)
  const prevRankingsLen = useRef(0)

  // Online state
  const online = useOnlineGame()
  const [joinInput, setJoinInput] = useState('')
  const [copied, setCopied] = useState(false)

  // Sound effects
  const { playTap, playBingo, playNotify, muted, toggleMute } = useSounds()

  // Game stats
  const { stats, recordGame, resetStats } = useStats()
  const hasRecorded = useRef(false)

  // Auto-call highlight (flash) + shake
  const [flashIndex, setFlashIndex] = useState(null)
  const [shakeIndex, setShakeIndex] = useState(null)
  const prevCallsLen = useRef(0)

  // Board load animation
  const [boardAnimating, setBoardAnimating] = useState(false)

  // Call log panel
  const [showCallLog, setShowCallLog] = useState(false)

  // Chat
  const chat = useChat(online.getChannel, online.mySlot, myName, online.roomCode)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatInput, setChatInput] = useState('')
  const chatEndRef = useRef(null)

  // iOS keyboard offset for chat panel
  const [keyboardOffset, setKeyboardOffset] = useState(0)

  useEffect(() => {
    if (!chatOpen || !window.visualViewport) return
    const vv = window.visualViewport
    const onResize = () => {
      setKeyboardOffset(Math.max(0, window.innerHeight - vv.height))
    }
    vv.addEventListener('resize', onResize)
    vv.addEventListener('scroll', onResize)
    return () => {
      vv.removeEventListener('resize', onResize)
      vv.removeEventListener('scroll', onResize)
    }
  }, [chatOpen])

  // Track previous isMyTurn for notification sound + vibration
  const prevIsMyTurn = useRef(false)

  // Fullscreen
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  // Detect standalone PWA mode (added to home screen)
  useEffect(() => {
    const isStandalone = window.navigator.standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches
    if (isStandalone) document.body.classList.add('standalone')
  }, [])

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {})
    } else {
      document.documentElement.requestFullscreen().catch(() => {})
    }
  }

  // Warn before page refresh or back navigation during active game
  const isInGame = phase === 'playing' || phase === 'lobby'
  useEffect(() => {
    if (!isInGame) return
    const handleBeforeUnload = (e) => { e.preventDefault(); e.returnValue = '' }
    window.history.pushState({ bingo: true }, '')
    const handlePopState = () => {
      if (window.confirm('Leave the game? Your progress will be lost.')) {
        handleBackToMenu()
      } else {
        window.history.pushState({ bingo: true }, '')
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    window.addEventListener('popstate', handlePopState)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      window.removeEventListener('popstate', handlePopState)
    }
  }, [isInGame]) // eslint-disable-line react-hooks/exhaustive-deps

  // Transition lobby -> playing when host starts the game
  useEffect(() => {
    if (mode === 'online' && phase === 'lobby' && online.onlineStatus === 'playing') {
      setPhase('playing')
      setBoardAnimating(true)
      setTimeout(() => setBoardAnimating(false), 800)
    }
  }, [mode, phase, online.onlineStatus])

  // Share link: parse ?join=XXXXXX from URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const joinCode = params.get('join')
    if (joinCode && joinCode.length === 6) {
      setJoinInput(joinCode.toUpperCase())
      setMode('online')
      setPhase('join-room')
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  // Active state
  const isOnline = mode === 'online'
  const activeSize = isOnline ? online.onlineSize : size
  const activeNumbers = useMemo(() => {
    if (!isOnline) return numbers
    if (online.isSpectator) {
      const boards = online.roomData?.numbers || {}
      return boards[online.onlineCurrentTurn] || []
    }
    return online.myBoard
  }, [isOnline, numbers, online.isSpectator, online.roomData, online.onlineCurrentTurn, online.myBoard])

  const activeCallers = useMemo(() => {
    if (!isOnline) return callers
    const board = activeNumbers
    const indexCallers = {}
    for (const [num, player] of Object.entries(online.onlineCallers)) {
      const numVal = Number(num)
      let idx = isNaN(numVal) ? board.indexOf(num) : board.indexOf(numVal)
      if (idx === -1) idx = board.indexOf(num)
      if (idx !== -1) indexCallers[idx] = player
    }
    return indexCallers
  }, [isOnline, callers, online.onlineCallers, activeNumbers])

  const activeCurrentTurn = isOnline ? online.onlineCurrentTurn : currentTurn
  const activeCalls = isOnline ? (online.onlineCalls || []) : calls
  const activePlayerCount = isOnline ? online.onlinePlayerCount : playerCount
  const activeMyPlayer = isOnline ? online.mySlot : myPlayer

  const lines = useMemo(() => getLines(activeSize), [activeSize])

  const markedSet = useMemo(
    () => new Set(Object.keys(activeCallers).map(Number)),
    [activeCallers],
  )

  const completedLines = useMemo(
    () => lines.filter((cells) => cells.every((i) => markedSet.has(i))),
    [lines, markedSet],
  )

  const playerNames = useMemo(() => {
    if (isOnline) return online.onlinePlayerNames
    const names = {}
    for (let i = 1; i <= playerCount; i++) {
      names[i] = i === myPlayer ? myName : `Player ${i}`
    }
    return names
  }, [isOnline, online.onlinePlayerNames, playerCount, myPlayer, myName])

  // Per-player completed line counts
  const playerLineCounts = useMemo(() => {
    const counts = {}
    if (isOnline && online.roomData?.numbers) {
      // Online: compute completed lines from each player's own board
      const calledNumbers = online.onlineCallers
      const boards = online.roomData.numbers
      for (let p = 1; p <= activePlayerCount; p++) {
        const board = boards[p]
        if (!board || !Array.isArray(board)) {
          counts[p] = 0
          continue
        }
        const boardMarked = new Set()
        board.forEach((num, idx) => {
          if (calledNumbers[num] != null) boardMarked.add(idx)
        })
        counts[p] = lines.filter((cells) => cells.every((i) => boardMarked.has(i))).length
      }
    } else {
      // Offline: a completed line goes to the player who marked its last cell
      for (let p = 1; p <= activePlayerCount; p++) counts[p] = 0
      for (const cells of lines) {
        if (!cells.every((i) => activeCallers[i] != null)) continue
        // Find which player marked each cell last (by call order)
        let lastPlayer = null
        let lastCallIdx = -1
        for (const ci of cells) {
          const callIdx = calls.findIndex((c) => c.index === ci)
          if (callIdx > lastCallIdx) {
            lastCallIdx = callIdx
            lastPlayer = activeCallers[ci]
          }
        }
        if (lastPlayer) counts[lastPlayer] = (counts[lastPlayer] || 0) + 1
      }
    }
    return counts
  }, [isOnline, activePlayerCount, lines, online.onlineCallers, online.roomData, activeCallers, calls])

  // Ranked-play derived values
  const finishedPlayers = useMemo(() => new Set(rankings.map(r => r.player)), [rankings])
  const gameOver = rankings.length >= activePlayerCount
  const myBingo = finishedPlayers.has(activeMyPlayer)
  const isMyTurn = activeCurrentTurn === activeMyPlayer
  const lastCall = activeCalls.length ? activeCalls[activeCalls.length - 1] : null
  const letters = useMemo(() => progressLetters(activeSize), [activeSize])

  // Turn timer
  const secondsLeft = useTurnTimer(
    isOnline && online.timerEnabled ? online.turnDeadline : null,
    isMyTurn,
    online.passTurn,
  )

  // Sound + vibration: notify when it becomes your turn in online mode
  useEffect(() => {
    if (isOnline && isMyTurn && !prevIsMyTurn.current && !gameOver) {
      playNotify()
      if (navigator.vibrate) navigator.vibrate(200)
    }
    prevIsMyTurn.current = isMyTurn
  }, [isOnline, isMyTurn, gameOver, playNotify])

  // Rankings detection: add/remove players from rankings as playerLineCounts change
  useEffect(() => {
    if (phase !== 'playing') return
    setRankings(prev => {
      // Remove players who no longer qualify (undo support)
      let updated = prev.filter(r => (playerLineCounts[r.player] || 0) >= activeSize)

      // Add new qualifiers
      for (let p = 1; p <= activePlayerCount; p++) {
        if ((playerLineCounts[p] || 0) >= activeSize && !updated.find(r => r.player === p)) {
          updated = [...updated, { player: p, rank: updated.length + 1, lines: playerLineCounts[p] }]
        }
      }

      // Auto-rank last remaining player
      if (updated.length === activePlayerCount - 1 && activePlayerCount > 1) {
        for (let p = 1; p <= activePlayerCount; p++) {
          if (!updated.find(r => r.player === p)) {
            updated = [...updated, { player: p, rank: updated.length + 1, lines: playerLineCounts[p] || 0 }]
            break
          }
        }
      }

      // Re-number ranks and update line counts
      updated = updated.map((r, i) => ({ ...r, rank: i + 1, lines: playerLineCounts[r.player] ?? r.lines }))

      // Only update if actually changed
      if (updated.length === prev.length && updated.every((r, i) => r.player === prev[i]?.player && r.lines === prev[i]?.lines)) {
        return prev
      }
      return updated
    })
  }, [playerLineCounts, activeSize, activePlayerCount, phase])

  // Rank banner + bingo sound when new players are ranked
  useEffect(() => {
    if (rankings.length > prevRankingsLen.current && rankings.length > 0) {
      const newlyRanked = rankings.slice(prevRankingsLen.current)
      const latest = rankings[rankings.length - 1]
      setRankBanner(latest)

      // Play bingo sound if my player was just ranked
      if (newlyRanked.some(r => r.player === activeMyPlayer)) {
        playBingo()
      }

      const timer = setTimeout(() => setRankBanner(null), 3000)
      prevRankingsLen.current = rankings.length
      return () => clearTimeout(timer)
    }
    // Handle rank removal (undo)
    if (rankings.length < prevRankingsLen.current) {
      prevRankingsLen.current = rankings.length
      setRankBanner(null)
    }
  }, [rankings, playBingo, activeMyPlayer])

  // Stats recording: record when game is fully over
  useEffect(() => {
    if (gameOver && !hasRecorded.current) {
      hasRecorded.current = true
      const myRanking = rankings.find(r => r.player === activeMyPlayer)
      if (myRanking) {
        recordGame(myRanking.rank === 1 ? 'win' : 'loss', {
          mode: isOnline ? 'online' : 'offline',
          size: activeSize,
          rank: myRanking.rank,
        })
      }
    }
  }, [gameOver, rankings, activeMyPlayer, recordGame, isOnline, activeSize])

  // Offline: skip turns for finished players
  useEffect(() => {
    if (!isOnline && phase === 'playing' && !gameOver && finishedPlayers.size > 0) {
      if (finishedPlayers.has(currentTurn)) {
        let next = (currentTurn % playerCount) + 1
        let tries = 0
        while (finishedPlayers.has(next) && tries < playerCount) {
          next = (next % playerCount) + 1
          tries++
        }
        setCurrentTurn(next)
      }
    }
  }, [rankings, currentTurn, playerCount, isOnline, phase, gameOver, finishedPlayers])

  // Auto-call highlight
  useEffect(() => {
    const callsArr = online.onlineCalls || []
    if (callsArr.length > prevCallsLen.current && callsArr.length > 0) {
      const latest = callsArr[callsArr.length - 1]
      if (latest.player !== online.mySlot) {
        const board = online.myBoard
        if (board.length) {
          const numVal = Number(latest.number)
          let idx = isNaN(numVal) ? board.indexOf(latest.number) : board.indexOf(numVal)
          if (idx === -1) idx = board.indexOf(latest.number)
          if (idx !== -1) {
            setFlashIndex(idx)
            setTimeout(() => setFlashIndex(null), 1200)
          }
        }
      }
    }
    prevCallsLen.current = callsArr.length
  }, [online.onlineCalls, online.mySlot, online.myBoard])

  // Scroll chat to bottom
  useEffect(() => {
    if (chatOpen && chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [chat.messages, chatOpen])

  const handlePlayerCountChange = (count) => {
    setPlayerCount(count)
    if (myPlayer > count) setMyPlayer(1)
  }

  const saveAvatar = (emoji) => {
    setMyAvatar(emoji)
    try { localStorage.setItem('bingo_avatar', emoji) } catch {}
  }

  const startOfflineGame = () => {
    if (gameType === 'custom') {
      const words = customWords.split('\n').map((w) => w.trim()).filter(Boolean)
      if (words.length < size * size) return
      setNumbers(shuffledWords(words, size * size))
    } else {
      setNumbers(shuffledNumbers(size * size))
    }
    setCallers({})
    setCurrentTurn(1)
    setCalls([])
    setRankings([])
    setRankBanner(null)
    prevRankingsLen.current = 0
    hasRecorded.current = false
    setPhase('playing')
    setBoardAnimating(true)
    setTimeout(() => setBoardAnimating(false), 800)
  }

  const offlineCallNumber = (index) => {
    if (gameOver || callers[index] != null) return
    const player = currentTurn
    if (finishedPlayers.has(player)) return
    const number = numbers[index]
    setCallers((prev) => ({ ...prev, [index]: player }))
    setCalls((prev) => [...prev, { player, number, index }])
    // Skip to next unfinished player
    let next = (player % playerCount) + 1
    let tries = 0
    while (finishedPlayers.has(next) && tries < playerCount) {
      next = (next % playerCount) + 1
      tries++
    }
    setCurrentTurn(next)
  }

  const undo = () => {
    if (calls.length === 0) return
    const last = calls[calls.length - 1]
    setCallers((prev) => {
      const next = { ...prev }
      delete next[last.index]
      return next
    })
    setCalls((prev) => prev.slice(0, -1))
    setCurrentTurn(last.player)
  }

  const handleCellClick = (index) => {
    // Shake if not your turn (online) or already called
    if (isOnline && !isMyTurn && !gameOver) {
      setShakeIndex(index)
      setTimeout(() => setShakeIndex(null), 500)
      return
    }
    if (!isOnline && currentTurn !== myPlayer && !gameOver) {
      // Offline: allow tapping opponent's called number, but shake if already marked
      if (callers[index] != null) {
        setShakeIndex(index)
        setTimeout(() => setShakeIndex(null), 500)
        return
      }
    }
    playTap()
    if (isOnline) {
      online.callNumber(index)
    } else {
      offlineCallNumber(index)
    }
  }

  const handleBackToMenu = () => {
    if (isOnline) {
      online.leaveRoom()
      chat.clearMessages()
    }
    setMode(null)
    setPhase('setup')
    setChatOpen(false)
    setGameType('numbers')
    setCustomWords('')
    setTimerEnabled(false)
    setTimerSeconds(20)
    setShowCallLog(false)
    setRankings([])
    setRankBanner(null)
    prevRankingsLen.current = 0
  }

  const handleCreateRoom = async () => {
    let wordList = null
    if (gameType === 'custom') {
      wordList = customWords.split('\n').map((w) => w.trim()).filter(Boolean)
      if (wordList.length < size * size) return
    }
    const code = await online.createRoom(size, playerCount, myName.trim(), gameType, wordList, timerEnabled, timerSeconds, myAvatar)
    if (code) {
      setPhase('lobby')
    }
  }

  const handleJoinRoom = async () => {
    const code = joinInput.trim().toUpperCase()
    if (code.length !== 6) return
    const ok = await online.joinRoom(code, myName.trim(), myAvatar)
    if (ok) {
      setPhase('lobby')
    }
  }

  const handleSpectate = async () => {
    const code = joinInput.trim().toUpperCase()
    if (code.length !== 6) return
    const ok = await online.spectate(code)
    if (ok) {
      setPhase('playing')
      setBoardAnimating(true)
      setTimeout(() => setBoardAnimating(false), 800)
    }
  }

  const handleStartOnline = () => {
    online.startOnlineGame()
  }

  const handleRematch = () => {
    hasRecorded.current = false
    setRankings([])
    setRankBanner(null)
    prevRankingsLen.current = 0
    if (isOnline) {
      online.rematch()
    } else {
      startOfflineGame()
    }
  }

  const copyRoomCode = () => {
    if (online.roomCode) {
      const shareUrl = `${window.location.origin}${window.location.pathname}?join=${online.roomCode}`
      navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleShare = () => {
    if (online.roomCode && navigator.share) {
      navigator.share({
        title: 'Join my Bingo game!',
        text: `Join my Bingo game with code ${online.roomCode}`,
        url: `${window.location.origin}${window.location.pathname}?join=${online.roomCode}`,
      }).catch(() => {})
    }
  }

  const handleSendChat = () => {
    if (chatInput.trim()) {
      chat.sendMessage(chatInput)
      setChatInput('')
    }
  }

  const parsedWordCount = customWords.split('\n').map((w) => w.trim()).filter(Boolean).length

  // Confetti particles for standings overlay
  const confettiPieces = useMemo(() => {
    if (!gameOver) return []
    return Array.from({ length: 35 }, (_, i) => ({
      key: i,
      style: {
        '--delay': `${Math.random() * 1.5}s`,
        '--x': `${Math.random() * 100}vw`,
        '--hue': `${Math.random() * 360}`,
        '--drift': `${(Math.random() - 0.5) * 200}px`,
        '--size': `${6 + Math.random() * 8}px`,
      },
    }))
  }, [gameOver])

  // Room settings info string for lobby
  const roomSettingsInfo = useMemo(() => {
    if (!online.roomData) return ''
    const parts = [`${online.onlineSize}x${online.onlineSize}`]
    const isCustom = online.roomData.numbers?.__type === 'custom'
    if (isCustom) parts.push('Custom Words')
    const timerVal = online.roomData.numbers?.__timer
    if (timerVal) parts.push(`Timer: ${timerVal}s`)
    else parts.push('No Timer')
    return parts.join(' · ')
  }, [online.roomData, online.onlineSize])

  // ---------- Game selection ----------
  if (game === null) {
    return (
      <div className="app">
        <header className="header">
          <h1 className="title">G<span>A</span>M<span>E</span>S</h1>
          <p className="subtitle">Pick a game to play</p>
        </header>
        <div className="setup">
          <div className="game-select-grid">
            <button className="game-select-card bingo" onClick={() => setGame('bingo')}>
              <span className="game-select-icon">{'\u{1F3B2}'}</span>
              <span className="game-select-name">Bingo</span>
              <span className="game-select-desc">Classic number calling board game</span>
            </button>
            <button className="game-select-card ludo" onClick={() => setGame('ludo')}>
              <span className="game-select-icon">{'\u{1F3B2}'}</span>
              <span className="game-select-name">Ludo</span>
              <span className="game-select-desc">Race your tokens around the board</span>
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ---------- Ludo game ----------
  if (game === 'ludo') {
    return <LudoGame onBack={() => setGame(null)} />
  }

  // ---------- Mode selection ----------
  if (phase === 'setup' && mode === null) {
    return (
      <div className="app">
        <header className="header">
          <button className="back-to-games" onClick={() => setGame(null)}>&larr; Back to Games</button>
          <h1 className="title">B<span>I</span>N<span>G</span>O</h1>
          <p className="subtitle">Choose how you want to play</p>
        </header>
        <div className="setup">
          {stats.gamesPlayed > 0 && (
            <div className="stats-card">
              <div className="stats-row">
                <span className="stats-label">Games</span>
                <span className="stats-value">{stats.gamesPlayed}</span>
              </div>
              <div className="stats-row">
                <span className="stats-label">Wins</span>
                <span className="stats-value">{stats.wins}</span>
              </div>
              <div className="stats-row">
                <span className="stats-label">Win rate</span>
                <span className="stats-value">{stats.gamesPlayed ? Math.round((stats.wins / stats.gamesPlayed) * 100) : 0}%</span>
              </div>
              <div className="stats-row">
                <span className="stats-label">Streak</span>
                <span className="stats-value">
                  {stats.currentStreak > 2 && '\u{1F525} '}{stats.currentStreak} (best: {stats.bestStreak})
                </span>
              </div>
              <button className="stats-reset" onClick={resetStats}>Reset stats</button>
            </div>
          )}
          <button className="new-game big" onClick={() => { setMode('offline'); setPhase('setup-offline') }}>
            Play Offline
          </button>
          <button className="new-game big online-btn" onClick={() => { setMode('online'); setPhase('online-choice') }}>
            Play Online
          </button>
          <button className="new-game ghost" onClick={() => setShowThemePicker((v) => !v)}>
            {showThemePicker ? 'Hide Themes' : 'Change Theme'}
          </button>
          {showThemePicker && (
            <div className="theme-picker">
              <div className="theme-swatches">
                {THEMES.map((t) => (
                  <button
                    key={t.name}
                    className={`theme-swatch ${theme.name === t.name ? 'active' : ''}`}
                    style={{ background: t.bg, border: t.mode === 'light' ? '2px solid #ccc' : undefined }}
                    onClick={() => selectTheme(t)}
                    title={t.name}
                  >
                    <span className="theme-swatch-inner" style={{ background: t.cell }} />
                  </button>
                ))}
              </div>
              <div className="theme-custom-row">
                <label className="theme-custom-label">Custom</label>
                <input
                  type="color"
                  className="theme-color-input"
                  value={customBgColor}
                  onChange={(e) => applyCustomColor(e.target.value)}
                />
              </div>
            </div>
          )}
          <p className="setup-hint">
            <b>Offline:</b> Pass-and-play on one device.<br />
            <b>Online:</b> Play with friends on separate devices in real time.
          </p>
        </div>
      </div>
    )
  }

  // ---------- Offline setup ----------
  if (phase === 'setup-offline') {
    return (
      <div className="app">
        <header className="header">
          <h1 className="title">B<span>I</span>N<span>G</span>O</h1>
          <p className="subtitle">Offline — pass-and-play on one device</p>
        </header>
        <div className="setup">
          <label className="control-label wide">
            Your name
            <input
              className="name-input"
              type="text"
              maxLength={20}
              placeholder="Enter your name"
              value={myName}
              onChange={(e) => setMyName(e.target.value)}
              autoFocus
            />
          </label>
          <div className="control-label wide">
            Avatar
            <div className="avatar-picker">
              {PLAYER_AVATARS.map((emoji) => (
                <button
                  key={emoji}
                  className={`avatar-btn ${myAvatar === emoji ? 'active' : ''}`}
                  onClick={() => saveAvatar(emoji)}
                >{emoji}</button>
              ))}
            </div>
          </div>
          <label className="control-label wide">
            Grid size
            <select value={size} onChange={(e) => setSize(Number(e.target.value))}>
              {SIZES.map((s) => (
                <option key={s} value={s}>{s} x {s}</option>
              ))}
            </select>
          </label>
          <label className="control-label wide">
            Number of players
            <select value={playerCount} onChange={(e) => handlePlayerCountChange(Number(e.target.value))}>
              {[2, 3, 4].map((n) => (
                <option key={n} value={n}>{n} players</option>
              ))}
            </select>
          </label>
          <div className="control-label wide">
            You are
            <div className="choice">
              {Array.from({ length: playerCount }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  className={`choice-btn p${p} ${myPlayer === p ? 'selected' : ''}`}
                  onClick={() => setMyPlayer(p)}
                >
                  Player {p}
                </button>
              ))}
            </div>
          </div>
          <div className="control-label wide">
            Game type
            <div className="choice">
              <button className={`choice-btn ${gameType === 'numbers' ? 'selected' : ''}`} onClick={() => setGameType('numbers')}>
                Numbers
              </button>
              <button className={`choice-btn ${gameType === 'custom' ? 'selected' : ''}`} onClick={() => setGameType('custom')}>
                Custom Words
              </button>
            </div>
          </div>
          {gameType === 'custom' && (
            <label className="control-label wide">
              Words (one per line)
              <textarea
                className="words-input"
                rows={6}
                placeholder={`Enter at least ${size * size} words, one per line`}
                value={customWords}
                onChange={(e) => setCustomWords(e.target.value)}
              />
              <span className={`word-count ${parsedWordCount >= size * size ? 'ok' : 'low'}`}>
                {parsedWordCount} / {size * size} words
              </span>
            </label>
          )}
          <button
            className="new-game big"
            onClick={startOfflineGame}
            disabled={!myName.trim() || (gameType === 'custom' && parsedWordCount < size * size)}
          >
            Start Game
          </button>
          <button className="new-game ghost" onClick={handleBackToMenu}>Back</button>
          <p className="setup-hint">
            Player 1 calls first. On <b>your</b> turn, tap a number on your board to call it.
            On your opponent&apos;s turn, tap the number they call out. Complete {size} lines to shout <b>BINGO!</b>
          </p>
        </div>
      </div>
    )
  }

  // ---------- Online choice ----------
  if (phase === 'online-choice') {
    return (
      <div className="app">
        <header className="header">
          <h1 className="title">B<span>I</span>N<span>G</span>O</h1>
          <p className="subtitle">Online multiplayer</p>
        </header>
        <div className="setup">
          <button className="new-game big" onClick={() => setPhase('create-room')}>
            Create Room
          </button>
          <button className="new-game big online-btn" onClick={() => setPhase('join-room')}>
            Join Room
          </button>
          <button className="new-game ghost" onClick={handleBackToMenu}>Back</button>
        </div>
      </div>
    )
  }

  // ---------- Create room ----------
  if (phase === 'create-room') {
    return (
      <div className="app">
        <header className="header">
          <h1 className="title">B<span>I</span>N<span>G</span>O</h1>
          <p className="subtitle">Create a new room</p>
        </header>
        <div className="setup">
          <label className="control-label wide">
            Your name
            <input
              className="name-input"
              type="text"
              maxLength={20}
              placeholder="Enter your name"
              value={myName}
              onChange={(e) => setMyName(e.target.value)}
              autoFocus
            />
          </label>
          <div className="control-label wide">
            Avatar
            <div className="avatar-picker">
              {PLAYER_AVATARS.map((emoji) => (
                <button
                  key={emoji}
                  className={`avatar-btn ${myAvatar === emoji ? 'active' : ''}`}
                  onClick={() => saveAvatar(emoji)}
                >{emoji}</button>
              ))}
            </div>
          </div>
          <label className="control-label wide">
            Grid size
            <select value={size} onChange={(e) => setSize(Number(e.target.value))}>
              {SIZES.map((s) => (
                <option key={s} value={s}>{s} x {s}</option>
              ))}
            </select>
          </label>
          <label className="control-label wide">
            Number of players
            <select value={playerCount} onChange={(e) => setPlayerCount(Number(e.target.value))}>
              {[2, 3, 4].map((n) => (
                <option key={n} value={n}>{n} players</option>
              ))}
            </select>
          </label>
          <div className="control-label wide">
            Game type
            <div className="choice">
              <button className={`choice-btn ${gameType === 'numbers' ? 'selected' : ''}`} onClick={() => setGameType('numbers')}>
                Numbers
              </button>
              <button className={`choice-btn ${gameType === 'custom' ? 'selected' : ''}`} onClick={() => setGameType('custom')}>
                Custom Words
              </button>
            </div>
          </div>
          {gameType === 'custom' && (
            <label className="control-label wide">
              Words (one per line)
              <textarea
                className="words-input"
                rows={6}
                placeholder={`Enter at least ${size * size} words, one per line`}
                value={customWords}
                onChange={(e) => setCustomWords(e.target.value)}
              />
              <span className={`word-count ${parsedWordCount >= size * size ? 'ok' : 'low'}`}>
                {parsedWordCount} / {size * size} words
              </span>
            </label>
          )}
          <div className="control-label wide">
            <label className="toggle-row">
              <span className="toggle-label">Turn Timer</span>
              <button
                className={`toggle-switch ${timerEnabled ? 'on' : ''}`}
                onClick={() => setTimerEnabled((v) => !v)}
                type="button"
              >
                <span className="toggle-knob" />
              </button>
            </label>
            {timerEnabled && (
              <div className="timer-options">
                {[10, 15, 20, 30, 45, 60].map((s) => (
                  <button
                    key={s}
                    className={`timer-option ${timerSeconds === s ? 'active' : ''}`}
                    onClick={() => setTimerSeconds(s)}
                    type="button"
                  >
                    {s}s
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            className="new-game big"
            onClick={handleCreateRoom}
            disabled={!myName.trim() || (gameType === 'custom' && parsedWordCount < size * size)}
          >
            Create Room
          </button>
          <button className="new-game ghost" onClick={() => setPhase('online-choice')}>Back</button>
          {online.error && <p className="online-error">{online.error}</p>}
        </div>
      </div>
    )
  }

  // ---------- Join room ----------
  if (phase === 'join-room') {
    return (
      <div className="app">
        <header className="header">
          <h1 className="title">B<span>I</span>N<span>G</span>O</h1>
          <p className="subtitle">Join a room</p>
        </header>
        <div className="setup">
          <label className="control-label wide">
            Your name
            <input
              className="name-input"
              type="text"
              maxLength={20}
              placeholder="Enter your name"
              value={myName}
              onChange={(e) => setMyName(e.target.value)}
              autoFocus
            />
          </label>
          <label className="control-label wide">
            Room code
            <input
              className="room-input"
              type="text"
              maxLength={6}
              placeholder="e.g. XK7M2P"
              value={joinInput}
              onChange={(e) => setJoinInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && handleJoinRoom()}
            />
          </label>
          <button
            className="new-game big"
            onClick={handleJoinRoom}
            disabled={joinInput.trim().length !== 6 || !myName.trim()}
          >
            Join Room
          </button>
          <button
            className="new-game ghost"
            onClick={handleSpectate}
            disabled={joinInput.trim().length !== 6}
          >
            Watch as Spectator
          </button>
          <button className="new-game ghost" onClick={() => setPhase('online-choice')}>Back</button>
          {online.error && <p className="online-error">{online.error}</p>}
        </div>
      </div>
    )
  }

  // ---------- Lobby ----------
  if (phase === 'lobby') {
    const players = online.onlinePlayers
    const totalSlots = online.onlinePlayerCount
    return (
      <div className="app">
        <header className="header">
          <h1 className="title">B<span>I</span>N<span>G</span>O</h1>
          <p className="subtitle">Waiting for players</p>
        </header>
        <div className="setup">
          <div className="room-code-display">
            <span className="room-code-label">Room Code</span>
            <span className="room-code-value">{online.roomCode}</span>
            <div className="room-code-actions">
              <button className="copy-btn" onClick={copyRoomCode}>
                {copied ? 'Copied!' : 'Copy Link'}
              </button>
              {navigator.share && (
                <button className="copy-btn" onClick={handleShare}>
                  Share
                </button>
              )}
            </div>
          </div>

          {roomSettingsInfo && (
            <div className="lobby-info">{roomSettingsInfo}</div>
          )}

          <div className="lobby-players">
            {Array.from({ length: totalSlots }, (_, i) => i + 1).map((slot) => {
              const p = players[slot]
              const isMe = slot === online.mySlot
              return (
                <div key={slot} className={`lobby-slot ${p ? 'filled' : ''} ${isMe ? 'me' : ''}`}>
                  <span className={`slot-dot p${slot}`} />
                  <span className="slot-label">
                    {p?.avatar && <span className="player-avatar-badge">{p.avatar}</span>}
                    {p?.avatar && ' '}
                    {p ? (p.name || `Player ${slot}`) : `Player ${slot}`}
                    {isMe && ' (You)'}
                    {p && !isMe && ' — Joined'}
                  </span>
                  {!p && <span className="slot-waiting">Waiting...</span>}
                  {p && p.connected && <span className="slot-connected">Connected</span>}
                  {p && !p.connected && <span className="slot-disconnected">Disconnected</span>}
                  {online.isHost && p && !isMe && (
                    <button className="kick-btn" onClick={() => online.kickPlayer(slot)} title="Kick player">
                      &times;
                    </button>
                  )}
                </div>
              )
            })}
          </div>

          {online.isHost && (
            <button
              className="new-game big"
              onClick={handleStartOnline}
              disabled={!online.allJoined}
            >
              {online.allJoined ? 'Start Game' : `Waiting for players (${online.connectedCount}/${totalSlots})`}
            </button>
          )}
          {!online.isHost && (
            <p className="lobby-hint">Waiting for the host to start the game...</p>
          )}
          <button className="new-game ghost" onClick={handleBackToMenu}>Leave Room</button>
          {online.error && <p className="online-error">{online.error}</p>}
        </div>
      </div>
    )
  }

  // ---------- Playing screen ----------
  const cellDisabled = gameOver || online.isSpectator || (isOnline && !isMyTurn) || (isOnline && myBingo)

  return (
    <div className="app playing-screen">
      <header className="header header-compact">
        <h1 className="title title-small">B<span>I</span>N<span>G</span>O</h1>
        <p className="subtitle">
          {online.isSpectator ? (
            <span>Spectating</span>
          ) : (
            <>
              <span className="player-avatar-badge">{myAvatar}</span>
              {' '}
              <span className={`you-tag p${activeMyPlayer}`}>{playerNames[activeMyPlayer] || `Player ${activeMyPlayer}`}</span>
              {stats.currentStreak > 2 && <span className="streak-badge" title={`${stats.currentStreak} win streak`}>{'\u{1F525}'}{stats.currentStreak}</span>}
            </>
          )}
          {isOnline && online.roomCode && (
            <span className="room-badge">Room: {online.roomCode}</span>
          )}
        </p>
      </header>

      {online.isSpectator && (
        <div className="spectator-bar">Spectator mode — watching the game</div>
      )}

      {isOnline && online.hasDisconnected && !online.isSpectator && (
        <div className="disconnect-bar">A player has disconnected. They can rejoin with the room code.</div>
      )}

      <div className="controls">
        <button className="new-game ghost" onClick={handleBackToMenu}>
          {isOnline ? 'Leave' : 'New Game'}
        </button>
        {!isOnline && (
          <button className="new-game ghost" onClick={undo} disabled={calls.length === 0}>
            Undo
          </button>
        )}
        <button className="mute-btn" onClick={toggleMute} title={muted ? 'Unmute' : 'Mute'}>
          {muted ? '\u{1F507}' : '\u{1F50A}'}
        </button>
        <button className="mute-btn" onClick={() => setShowCallLog((v) => !v)} title="Call log">
          {'\u{1F4CB}'}
        </button>
        {document.fullscreenEnabled && (
          <button className="mute-btn" onClick={toggleFullscreen} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
            {isFullscreen ? '\u{2716}' : '\u{26F6}'}
          </button>
        )}
      </div>

      <div className="player-tabs">
        {Array.from({ length: activePlayerCount }, (_, i) => i + 1).map((p) => {
          const ranking = rankings.find(r => r.player === p)
          const isFinished = !!ranking
          return (
            <div
              key={p}
              className={`player-tab p${p} ${activeCurrentTurn === p ? 'active' : ''} ${p === activeMyPlayer ? 'me' : ''} ${isFinished ? 'finished' : ''}`}
            >
              {isFinished && <span className="rank-badge">{ranking.rank === 1 ? '\u{1F947}' : ranking.rank === 2 ? '\u{1F948}' : ranking.rank === 3 ? '\u{1F949}' : `#${ranking.rank}`}</span>}
              {isOnline && online.onlinePlayerAvatars[p] && <span className="player-avatar-badge">{online.onlinePlayerAvatars[p]}</span>}
              <span className="player-tab-name">{playerNames[p] || `Player ${p}`}</span>
              <span className="player-tab-count">{playerLineCounts[p] || 0} / {activeSize}</span>
            </div>
          )
        })}
      </div>

      <div className="turn-status">
        {gameOver ? (
          <span className="turn-win">
            Game Over! {rankings.length > 0 && playerNames[rankings[0].player] ? `${playerNames[rankings[0].player]} wins!` : 'Final standings are in.'}
          </span>
        ) : (
          <>
            {lastCall && (
              <span className="last-move">
                {lastCall.player === activeMyPlayer ? 'You' : (playerNames[lastCall.player] || `Player ${lastCall.player}`)} called <b>{lastCall.number}</b>
              </span>
            )}
            <span className={`whose-turn p${activeCurrentTurn}`}>
              {online.isSpectator
                ? `${playerNames[activeCurrentTurn] || `Player ${activeCurrentTurn}`}'s turn`
                : myBingo
                  ? 'You finished! Waiting for others...'
                  : isMyTurn
                    ? 'Your turn \u2014 call a number'
                    : `${playerNames[activeCurrentTurn] || `Player ${activeCurrentTurn}`}'s turn${isOnline ? ' \u2014 wait for them' : ' \u2014 tap their called number'}`}
            </span>
            {rankings.length > 0 && !gameOver && (
              <span className="rankings-hint">
                {rankings.length} of {activePlayerCount} players finished \u2014 keep going!
              </span>
            )}
            {isOnline && online.timerEnabled && secondsLeft != null && (
              <span className={`timer ${secondsLeft <= 5 ? 'urgent' : ''}`}>
                {secondsLeft}s
              </span>
            )}
          </>
        )}
      </div>

      <div className="progress">
        {letters.map((ch, i) => (
          <span key={i} className={`progress-letter ${i < completedLines.length ? 'lit' : ''}`}>
            {ch}
          </span>
        ))}
        <span className="progress-count">{completedLines.length} / {activeSize} lines</span>
      </div>

      <div className="boards">
        <div className="board-col">
          <Board
            size={activeSize}
            numbers={activeNumbers}
            callers={activeCallers}
            completedLines={completedLines}
            onCellClick={handleCellClick}
            disabled={cellDisabled}
            flashIndex={flashIndex}
            shakeIndex={shakeIndex}
            boardAnimating={boardAnimating}
          />
        </div>
      </div>

      {/* Call log panel */}
      {showCallLog && (
        <div className="call-log-panel">
          <div className="call-log-header">
            <span>Call Log</span>
            <button className="call-log-close" onClick={() => setShowCallLog(false)}>&times;</button>
          </div>
          <div className="call-log-list">
            {activeCalls.length === 0 && <p className="call-log-empty">No calls yet</p>}
            {activeCalls.map((c, i) => (
              <div key={i} className="call-log-item">
                <span className={`call-log-dot p${c.player}`} />
                <span className="call-log-name">{playerNames[c.player] || `Player ${c.player}`}</span>
                <span className="call-log-number">{c.number}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Rank banner notification */}
      {rankBanner && !gameOver && (
        <div className={`rank-banner rank-${rankBanner.rank}`}>
          <span className="rank-banner-text">
            {rankBanner.rank === 1 ? '\u{1F947}' : rankBanner.rank === 2 ? '\u{1F948}' : rankBanner.rank === 3 ? '\u{1F949}' : '\u{1F3C5}'}
            {' '}{playerNames[rankBanner.player] || `Player ${rankBanner.player}`} got BINGO! \u2014 {rankBanner.rank === 1 ? '1st' : rankBanner.rank === 2 ? '2nd' : rankBanner.rank === 3 ? '3rd' : `${rankBanner.rank}th`} Place
          </span>
        </div>
      )}

      {/* Final standings overlay */}
      {gameOver && (
        <div className="win-overlay" role="dialog" aria-live="assertive">
          <div className="confetti-container">
            {confettiPieces.map((p) => (
              <span key={p.key} className="confetti-piece" style={p.style} />
            ))}
          </div>
          <div className="win-card standings-card">
            <div className="win-bingo">GAME OVER</div>
            <div className="win-text">
              {rankings.length > 0 && playerNames[rankings[0].player]
                ? `${playerNames[rankings[0].player]} wins!`
                : 'Final Standings'}
            </div>
            <div className="standings-list">
              {rankings.map((r) => (
                <div key={r.player} className={`standings-row rank-${r.rank}`}>
                  <span className="standings-rank">
                    {r.rank === 1 ? '\u{1F947}' : r.rank === 2 ? '\u{1F948}' : r.rank === 3 ? '\u{1F949}' : `#${r.rank}`}
                  </span>
                  <span className={`standings-name p${r.player}`}>
                    {playerNames[r.player] || `Player ${r.player}`}
                  </span>
                  <span className="standings-lines">{r.lines} lines</span>
                </div>
              ))}
            </div>
            <p className="win-sub">
              {stats.currentStreak > 1 && `${'\u{1F525}'} ${stats.currentStreak} win streak!`}
            </p>
            <div className="win-actions">
              {(!isOnline || online.isHost) && (
                <button className="new-game" onClick={handleRematch}>
                  Rematch
                </button>
              )}
              {isOnline && !online.isHost && (
                <p className="lobby-hint">Waiting for host to start rematch...</p>
              )}
              <button className="new-game ghost" onClick={handleBackToMenu}>
                {isOnline ? 'Leave Game' : 'Back to Menu'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Chat toggle + panel (online playing only) */}
      {isOnline && phase === 'playing' && !online.isSpectator && (
        <>
          <button className="chat-toggle" onClick={() => setChatOpen((o) => !o)} style={keyboardOffset > 0 ? { bottom: `${keyboardOffset + 10}px` } : undefined}>
            {chatOpen ? '\u2715' : '\u{1F4AC}'}
            {!chatOpen && chat.messages.length > 0 && (
              <span className="chat-badge">{chat.messages.length}</span>
            )}
          </button>
          {chatOpen && (
            <div className="chat-panel" style={keyboardOffset > 0 ? { bottom: `${keyboardOffset + 10}px` } : undefined}>
              <div className="chat-messages">
                {chat.messages.map((msg, i) => {
                  const isEmoji = CHAT_REACTIONS.includes(msg.text)
                  return (
                    <div key={i} className="chat-msg">
                      <span className={`chat-name p${msg.slot}`}>{msg.name}</span>
                      <span className={`chat-text ${isEmoji ? 'chat-emoji-msg' : ''}`}>{msg.text}</span>
                    </div>
                  )
                })}
                <div ref={chatEndRef} />
              </div>
              <div className="chat-reactions">
                {CHAT_REACTIONS.map((emoji) => (
                  <button key={emoji} className="chat-reaction-btn" onClick={() => chat.sendMessage(emoji)}>
                    {emoji}
                  </button>
                ))}
              </div>
              <div className="chat-input-row">
                <input
                  type="text"
                  className="chat-input"
                  placeholder="Type a message..."
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendChat()}
                  maxLength={200}
                />
                <button className="chat-send" onClick={handleSendChat}>Send</button>
              </div>
            </div>
          )}
        </>
      )}

      {online.error && <p className="online-error">{online.error}</p>}
    </div>
  )
}
