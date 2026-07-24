import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import {
  createInitialState, rollDice, getValidMoves, applyMove, checkWinner,
  getActivePlayers, getNextPlayer, PLAYER_COLORS, PLAYER_LABELS,
} from './ludoLogic'
import LudoBoard from './LudoBoard'
import { useLudoOnlineGame } from './useLudoOnlineGame'
import { useSounds } from './useSounds'
import { useStats } from './useStats'
import { useChat } from './useChat'
import { useTurnTimer } from './useTurnTimer'
import './ludo.css'

const PLAYER_AVATARS = [
  '\u{1F60E}', '\u{1F525}', '\u{1F680}', '\u{2B50}', '\u{1F3AF}', '\u{1F47E}',
  '\u{1F981}', '\u{1F985}', '\u{1F43A}', '\u{1F431}', '\u{1F42C}', '\u{1F984}',
]

const CHAT_REACTIONS = ['\u{1F44D}', '\u{1F602}', '\u{1F389}', '\u{1F62E}', '\u{1F480}']

// Dice face dot layout (3x3 grid, true = filled)
const DICE_FACES = {
  1: [0,0,0, 0,1,0, 0,0,0],
  2: [0,0,1, 0,0,0, 1,0,0],
  3: [0,0,1, 0,1,0, 1,0,0],
  4: [1,0,1, 0,0,0, 1,0,1],
  5: [1,0,1, 0,1,0, 1,0,1],
  6: [1,0,1, 1,0,1, 1,0,1],
}

// 3D cube: rotation to bring each face to the front
const FACE_ROTATIONS = {
  1: 'rotateX(0deg) rotateY(0deg)',
  2: 'rotateX(-90deg) rotateY(0deg)',
  3: 'rotateX(0deg) rotateY(-90deg)',
  4: 'rotateX(0deg) rotateY(90deg)',
  5: 'rotateX(90deg) rotateY(0deg)',
  6: 'rotateX(180deg) rotateY(0deg)',
}

export default function LudoGame({ onBack }) {
  const [mode, setMode] = useState(null) // null | 'offline' | 'online'
  const [phase, setPhase] = useState('setup') // setup | setup-offline | online-choice | create-room | join-room | lobby | playing

  // Offline game state
  const [playerCount, setPlayerCount] = useState(2)
  const [myPlayer, setMyPlayer] = useState(1)
  const [gameState, setGameState] = useState(null)
  const [currentTurn, setCurrentTurn] = useState(1)

  // Player info
  const [myName, setMyName] = useState('')
  const [myAvatar, setMyAvatar] = useState(() => {
    try { return localStorage.getItem('bingo_avatar') || PLAYER_AVATARS[0] } catch { return PLAYER_AVATARS[0] }
  })

  // UI state
  const [selectedToken, setSelectedToken] = useState(null)
  const [diceRolling, setDiceRolling] = useState(false)
  const [diceDisplay, setDiceDisplay] = useState(1) // value shown during animation
  const [diceLanded, setDiceLanded] = useState(false)
  const rollIntervalRef = useRef(null)
  const [autoPassMsg, setAutoPassMsg] = useState(null)
  const [extraTurnMsg, setExtraTurnMsg] = useState(null)

  // Timer for online
  const [timerEnabled, setTimerEnabled] = useState(false)
  const [timerSeconds, setTimerSeconds] = useState(30)

  // Online
  const online = useLudoOnlineGame()
  const [joinInput, setJoinInput] = useState('')
  const [copied, setCopied] = useState(false)

  // Sounds
  const { playTap, playBingo, playNotify, playDice, playCapture, muted, toggleMute } = useSounds()

  // Stats
  const { stats, recordGame, resetStats } = useStats()
  const hasRecorded = useRef(false)

  // Chat
  const chat = useChat(online.getChannel, online.mySlot, myName)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatInput, setChatInput] = useState('')
  const chatEndRef = useRef(null)

  // Notification tracking
  const prevIsMyTurn = useRef(false)

  const isOnline = mode === 'online'

  // Active game state (unified offline/online)
  const activeGameState = useMemo(() => {
    if (isOnline) {
      const gs = online.gameState
      if (gs && gs.__game === 'ludo') {
        return {
          pieces: gs.pieces || {},
          dice: gs.dice,
          sixCount: gs.sixCount || 0,
          movePhase: gs.movePhase || 'rolling',
          winner: gs.winner,
        }
      }
      return null
    }
    return gameState
  }, [isOnline, online.gameState, gameState])

  const activeCurrentTurn = isOnline
    ? (online.gameState?.currentPlayer || 1)
    : currentTurn

  const activePlayerCount = isOnline
    ? (online.gameState?.__playerCount || online.onlinePlayerCount)
    : playerCount

  const activeMyPlayer = isOnline ? online.mySlot : myPlayer
  const activePlayers = useMemo(() => getActivePlayers(activePlayerCount), [activePlayerCount])

  const playerNames = useMemo(() => {
    if (isOnline) return online.onlinePlayerNames
    const names = {}
    const active = getActivePlayers(playerCount)
    for (const p of active) {
      names[p] = p === myPlayer ? myName : `${PLAYER_LABELS[p]}`
    }
    return names
  }, [isOnline, online.onlinePlayerNames, playerCount, myPlayer, myName])

  const isMyTurn = activeCurrentTurn === activeMyPlayer
  const winner = activeGameState?.winner || null

  // Valid moves for current player
  const validMoves = useMemo(() => {
    if (!activeGameState || activeGameState.movePhase !== 'moving' || !activeGameState.dice) return []
    return getValidMoves(activeGameState, activeCurrentTurn, activeGameState.dice)
  }, [activeGameState, activeCurrentTurn])

  // Count tokens home per player
  const tokensHome = useMemo(() => {
    if (!activeGameState?.pieces) return {}
    const counts = {}
    for (const [p, tokens] of Object.entries(activeGameState.pieces)) {
      counts[p] = tokens.filter((pos) => pos === 58).length
    }
    return counts
  }, [activeGameState?.pieces])

  // Turn timer for online
  const secondsLeft = useTurnTimer(
    isOnline && online.timerEnabled ? online.turnDeadline : null,
    isMyTurn,
    online.passTurn,
  )

  // Sound + vibration: notify when it becomes your turn
  useEffect(() => {
    if (isOnline && isMyTurn && !prevIsMyTurn.current && !winner) {
      playNotify()
      if (navigator.vibrate) navigator.vibrate(200)
    }
    prevIsMyTurn.current = isMyTurn
  }, [isOnline, isMyTurn, winner, playNotify])

  // Sound + stats: win detection
  useEffect(() => {
    if (winner && !hasRecorded.current) {
      hasRecorded.current = true
      playBingo()
      if (winner === activeMyPlayer) {
        recordGame('win', { mode: isOnline ? 'online' : 'offline', game: 'ludo' })
      }
    }
  }, [winner, playBingo, recordGame, isOnline, activeMyPlayer])

  // Auto-transition lobby -> playing
  useEffect(() => {
    if (isOnline && phase === 'lobby' && online.onlineStatus === 'playing') {
      setPhase('playing')
    }
  }, [isOnline, phase, online.onlineStatus])

  // Auto-resume: when Ludo hook reconnects, transition UI to the correct phase
  useEffect(() => {
    if (mode === null && online.roomCode && online.mySlot && online.roomData) {
      setMode('online')
      if (online.onlineStatus === 'playing') {
        setPhase('playing')
      } else if (online.onlineStatus === 'waiting') {
        setPhase('lobby')
      }
    }
  }, [mode, online.roomCode, online.mySlot, online.roomData, online.onlineStatus])

  // Restore player name from reconnected room data
  useEffect(() => {
    if (online.roomCode && online.mySlot && online.onlinePlayers[online.mySlot]?.name && !myName) {
      setMyName(online.onlinePlayers[online.mySlot].name)
    }
  }, [online.roomCode, online.mySlot, online.onlinePlayers, myName])

  // Chat scroll
  useEffect(() => {
    if (chatOpen && chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [chat.messages, chatOpen])

  // Clear extra turn message after delay
  useEffect(() => {
    if (extraTurnMsg) {
      const t = setTimeout(() => setExtraTurnMsg(null), 2000)
      return () => clearTimeout(t)
    }
  }, [extraTurnMsg])

  // Online: surface "extra turn" messages from the shared move log (offline sets these directly)
  const lastLogLenRef = useRef(0)
  useEffect(() => {
    if (!isOnline) return
    const log = online.gameState?.moveLog
    if (!log) { lastLogLenRef.current = 0; return }
    if (log.length <= lastLogLenRef.current) { lastLogLenRef.current = log.length; return }
    lastLogLenRef.current = log.length
    const last = log[log.length - 1]
    if (last && last.extraTurn) {
      setExtraTurnMsg(last.capture ? 'Capture! Extra turn!' : 'Rolled 6! Extra turn!')
    }
  }, [isOnline, online.gameState?.moveLog])

  // Warn before leaving
  const isInGame = phase === 'playing' || phase === 'lobby'
  useEffect(() => {
    if (!isInGame) return
    const handleBeforeUnload = (e) => { e.preventDefault(); e.returnValue = '' }
    window.history.pushState({ ludo: true }, '')
    const handlePopState = () => {
      if (window.confirm('Leave the game? Your progress will be lost.')) {
        handleBackToMenu()
      } else {
        window.history.pushState({ ludo: true }, '')
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    window.addEventListener('popstate', handlePopState)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      window.removeEventListener('popstate', handlePopState)
    }
  }, [isInGame]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Actions ----

  const handleBackToMenu = () => {
    if (isOnline) {
      online.leaveRoom()
      chat.clearMessages()
    }
    setMode(null)
    setPhase('setup')
    setGameState(null)
    setChatOpen(false)
    setTimerEnabled(false)
    setTimerSeconds(30)
    setSelectedToken(null)
    setExtraTurnMsg(null)
    setAutoPassMsg(null)
  }

  const startOfflineGame = () => {
    const state = createInitialState(playerCount)
    const active = getActivePlayers(playerCount)
    setGameState(state)
    setCurrentTurn(active[0])
    hasRecorded.current = false
    setSelectedToken(null)
    setPhase('playing')
  }

  const handleRollDice = () => {
    if (winner) return
    if (diceRolling || autoPassMsg) return // block re-entry during roll / auto-pass window
    if (!isMyTurn && isOnline) return

    if (isOnline) {
      playDice?.() || playTap()
      setDiceRolling(true)
      setDiceLanded(false)
      // Cycle display values for visual effect
      let count = 0
      rollIntervalRef.current = setInterval(() => {
        setDiceDisplay(Math.floor(Math.random() * 6) + 1)
        count++
        if (count > 8) {
          clearInterval(rollIntervalRef.current)
          setDiceRolling(false)
          setDiceLanded(true)
          setTimeout(() => setDiceLanded(false), 400)
        }
      }, 80)
      online.rollDice()
      return
    }

    // Offline roll
    setDiceRolling(true)
    setDiceLanded(false)
    playDice?.() || playTap()

    // Cycle through random values during roll
    let count = 0
    rollIntervalRef.current = setInterval(() => {
      setDiceDisplay(Math.floor(Math.random() * 6) + 1)
      count++
      if (count > 10) {
        clearInterval(rollIntervalRef.current)
      }
    }, 70)

    setTimeout(() => {
      clearInterval(rollIntervalRef.current)
      const diceVal = rollDice()
      setDiceDisplay(diceVal)
      setDiceRolling(false)
      setDiceLanded(true)
      setTimeout(() => setDiceLanded(false), 400)

      // Third consecutive six forfeits the turn without moving
      const isThirdSix = diceVal === 6 && (gameState.sixCount || 0) >= 2
      const moves = isThirdSix ? [] : getValidMoves(
        { ...gameState, dice: diceVal },
        currentTurn,
        diceVal,
      )

      setGameState((prev) => ({
        ...prev,
        dice: diceVal,
        movePhase: moves.length > 0 ? 'moving' : 'rolling',
      }))
      setSelectedToken(null)

      if (moves.length === 0) {
        setAutoPassMsg(isThirdSix ? 'Three 6s — turn forfeited!' : `No valid moves with ${diceVal}`)

        setTimeout(() => {
          setAutoPassMsg(null)
          const next = getNextPlayer(currentTurn, playerCount)
          setCurrentTurn(next)
          setGameState((prev) => ({
            ...prev,
            dice: null,
            sixCount: 0,
            movePhase: 'rolling',
          }))
        }, 800)
      }
    }, 500)
  }

  const handleTokenClick = (tokenIdx, directMove) => {
    if (winner) return
    if (!activeGameState || activeGameState.movePhase !== 'moving') return

    if (isOnline && !isMyTurn) return

    // If a direct move is provided (clicked on destination)
    if (directMove) {
      executeMove(directMove)
      return
    }

    // If clicking the same token, deselect
    if (selectedToken === tokenIdx) {
      setSelectedToken(null)
      return
    }

    // Check if this token has valid moves
    const tokenMoves = validMoves.filter((m) => m.tokenIdx === tokenIdx)
    if (tokenMoves.length === 0) return

    // If only one valid move for this token, execute immediately
    if (tokenMoves.length === 1) {
      executeMove(tokenMoves[0])
      return
    }

    // Multiple destinations — select and show options
    setSelectedToken(tokenIdx)
  }

  const executeMove = (move) => {
    setSelectedToken(null)

    if (isOnline) {
      if (move.capture) playCapture?.() || playTap()
      else playTap()
      online.makeMove(move)
      return
    }

    // Offline move
    if (move.capture) {
      playCapture?.() || playTap()
    } else {
      playTap()
    }

    const result = applyMove(gameState, currentTurn, move, playerCount)

    setGameState({
      pieces: result.pieces,
      dice: null,
      sixCount: result.extraTurn ? (result.sixCount || 0) : 0,
      movePhase: 'rolling',
      winner: result.winner,
    })

    if (result.winner) {
      setCurrentTurn(currentTurn)
    } else {
      setCurrentTurn(result.nextPlayer)
      if (result.extraTurn) {
        if (result.captured) {
          setExtraTurnMsg('Capture! Extra turn!')
        } else {
          setExtraTurnMsg('Rolled 6! Extra turn!')
        }
      }
    }
  }

  // Auto-move when there is exactly one legal move (e.g. only one coin out).
  // Works for offline (any current player) and online (only on your own turn).
  const autoMoveRef = useRef(false)
  useEffect(() => {
    if (!activeGameState || activeGameState.movePhase !== 'moving') {
      autoMoveRef.current = false
      return
    }
    if (winner || online.isSpectator || diceRolling) return
    const iControlNow = isOnline ? isMyTurn : true
    if (!iControlNow) return
    if (validMoves.length === 1 && !autoMoveRef.current) {
      autoMoveRef.current = true
      const t = setTimeout(() => executeMove(validMoves[0]), 300)
      return () => clearTimeout(t)
    }
  }, [activeGameState, validMoves, winner, isOnline, isMyTurn, diceRolling, online.isSpectator]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleRematch = () => {
    hasRecorded.current = false
    if (isOnline) {
      online.rematch()
    } else {
      startOfflineGame()
    }
  }

  const handleCreateRoom = async () => {
    const code = await online.createRoom(playerCount, myName.trim(), timerEnabled, timerSeconds)
    if (code) {
      setPhase('lobby')
    }
  }

  const handleJoinRoom = async () => {
    const code = joinInput.trim().toUpperCase()
    if (code.length !== 6) return
    const ok = await online.joinRoom(code, myName.trim())
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
    }
  }

  const copyRoomCode = () => {
    if (online.roomCode) {
      const shareUrl = `${window.location.origin}${window.location.pathname}?join=${online.roomCode}&game=ludo`
      navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleShare = () => {
    if (online.roomCode && navigator.share) {
      navigator.share({
        title: 'Join my Ludo game!',
        text: `Join my Ludo game with code ${online.roomCode}`,
        url: `${window.location.origin}${window.location.pathname}?join=${online.roomCode}&game=ludo`,
      }).catch(() => {})
    }
  }

  const handleSendChat = () => {
    if (chatInput.trim()) {
      chat.sendMessage(chatInput)
      setChatInput('')
    }
  }

  const saveAvatar = (emoji) => {
    setMyAvatar(emoji)
    try { localStorage.setItem('bingo_avatar', emoji) } catch {}
  }

  // Confetti for win
  const confettiPieces = useMemo(() => {
    if (!winner) return []
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
  }, [winner])

  // Render 3D dice cube
  const renderDice = (value) => {
    if (!value) return null
    const showValue = value
    const isSix = !diceRolling && diceLanded && showValue === 6
    return (
      <div className={`ludo-dice-3d ${diceRolling ? 'rolling' : ''} ${diceLanded ? 'landed' : ''} ${isSix ? 'six' : ''}`}>
        <div
          className="ludo-dice-cube"
          style={!diceRolling ? { transform: FACE_ROTATIONS[showValue] } : undefined}
        >
          {[1, 2, 3, 4, 5, 6].map((face) => (
            <div key={face} className={`ludo-dice-face face-${face}`}>
              <div className="ludo-dice-face-dots">
                {DICE_FACES[face].map((filled, i) => (
                  <span key={i} className={`ludo-dice-dot ${filled ? '' : 'empty'}`} />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="ludo-dice-shadow-3d" />
      </div>
    )
  }

  // ---- RENDER ----

  // Setup: mode selection
  if (phase === 'setup') {
    return (
      <div className="ludo-container">
        <header className="header">
          <button className="back-to-games" onClick={onBack}>&larr; Back to Games</button>
          <h1 className="title" style={{ background: 'linear-gradient(90deg, #16c784, #4ff0b7)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>LUDO</h1>
          <p className="subtitle">Choose how you want to play</p>
        </header>
        <div className="setup">
          <button className="new-game big" onClick={() => { setMode('offline'); setPhase('setup-offline') }}>
            Play Offline
          </button>
          <button className="new-game big ludo-btn" onClick={() => { setMode('online'); setPhase('online-choice') }}>
            Play Online
          </button>
          <p className="setup-hint">
            <b>Offline:</b> Pass-and-play on one device.<br />
            <b>Online:</b> Play with friends on separate devices in real time.
          </p>
        </div>
      </div>
    )
  }

  // Offline setup
  if (phase === 'setup-offline') {
    return (
      <div className="ludo-container">
        <header className="header">
          <h1 className="title" style={{ background: 'linear-gradient(90deg, #16c784, #4ff0b7)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>LUDO</h1>
          <p className="subtitle">Offline — pass-and-play on one device</p>
        </header>
        <div className="setup">
          <label className="control-label wide">
            Your name
            <input className="name-input" type="text" maxLength={20} placeholder="Enter your name"
              value={myName} onChange={(e) => setMyName(e.target.value)} autoFocus />
          </label>
          <div className="control-label wide">
            Avatar
            <div className="avatar-picker">
              {PLAYER_AVATARS.map((emoji) => (
                <button key={emoji} className={`avatar-btn ${myAvatar === emoji ? 'active' : ''}`}
                  onClick={() => saveAvatar(emoji)}>{emoji}</button>
              ))}
            </div>
          </div>
          <label className="control-label wide">
            Number of players
            <select value={playerCount} onChange={(e) => setPlayerCount(Number(e.target.value))}>
              {[2, 3, 4].map((n) => (
                <option key={n} value={n}>{n} players</option>
              ))}
            </select>
          </label>
          <div className="control-label wide">
            You are
            <div className="choice">
              {getActivePlayers(playerCount).map((p) => (
                <button key={p}
                  className={`choice-btn ${myPlayer === p ? 'selected' : ''}`}
                  style={myPlayer === p ? { borderColor: PLAYER_COLORS[p], background: `${PLAYER_COLORS[p]}22`, color: PLAYER_COLORS[p] } : undefined}
                  onClick={() => setMyPlayer(p)}>
                  {PLAYER_LABELS[p]}
                </button>
              ))}
            </div>
          </div>
          <button className="new-game big" onClick={startOfflineGame}
            disabled={!myName.trim()}>
            Start Game
          </button>
          <button className="new-game ghost" onClick={handleBackToMenu}>Back</button>
          <p className="setup-hint">
            Roll a 6 to bring a token out of the yard. Move clockwise around the board.
            Land on an opponent to capture them. First player to get all 4 tokens home wins!
          </p>
        </div>
      </div>
    )
  }

  // Online choice
  if (phase === 'online-choice') {
    return (
      <div className="ludo-container">
        <header className="header">
          <h1 className="title" style={{ background: 'linear-gradient(90deg, #16c784, #4ff0b7)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>LUDO</h1>
          <p className="subtitle">Online multiplayer</p>
        </header>
        <div className="setup">
          <button className="new-game big" onClick={() => setPhase('create-room')}>Create Room</button>
          <button className="new-game big ludo-btn" onClick={() => setPhase('join-room')}>Join Room</button>
          <button className="new-game ghost" onClick={handleBackToMenu}>Back</button>
        </div>
      </div>
    )
  }

  // Create room
  if (phase === 'create-room') {
    return (
      <div className="ludo-container">
        <header className="header">
          <h1 className="title" style={{ background: 'linear-gradient(90deg, #16c784, #4ff0b7)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>LUDO</h1>
          <p className="subtitle">Create a new room</p>
        </header>
        <div className="setup">
          <label className="control-label wide">
            Your name
            <input className="name-input" type="text" maxLength={20} placeholder="Enter your name"
              value={myName} onChange={(e) => setMyName(e.target.value)} autoFocus />
          </label>
          <div className="control-label wide">
            Avatar
            <div className="avatar-picker">
              {PLAYER_AVATARS.map((emoji) => (
                <button key={emoji} className={`avatar-btn ${myAvatar === emoji ? 'active' : ''}`}
                  onClick={() => saveAvatar(emoji)}>{emoji}</button>
              ))}
            </div>
          </div>
          <label className="control-label wide">
            Number of players
            <select value={playerCount} onChange={(e) => setPlayerCount(Number(e.target.value))}>
              {[2, 3, 4].map((n) => (
                <option key={n} value={n}>{n} players</option>
              ))}
            </select>
          </label>
          <div className="control-label wide">
            <label className="toggle-row">
              <span className="toggle-label">Turn Timer</span>
              <button className={`toggle-switch ${timerEnabled ? 'on' : ''}`}
                onClick={() => setTimerEnabled((v) => !v)} type="button">
                <span className="toggle-knob" />
              </button>
            </label>
            {timerEnabled && (
              <div className="timer-options">
                {[15, 20, 30, 45, 60].map((s) => (
                  <button key={s} className={`timer-option ${timerSeconds === s ? 'active' : ''}`}
                    onClick={() => setTimerSeconds(s)} type="button">{s}s</button>
                ))}
              </div>
            )}
          </div>
          <button className="new-game big" onClick={handleCreateRoom} disabled={!myName.trim()}>
            Create Room
          </button>
          <button className="new-game ghost" onClick={() => setPhase('online-choice')}>Back</button>
          {online.error && <p className="online-error">{online.error}</p>}
        </div>
      </div>
    )
  }

  // Join room
  if (phase === 'join-room') {
    return (
      <div className="ludo-container">
        <header className="header">
          <h1 className="title" style={{ background: 'linear-gradient(90deg, #16c784, #4ff0b7)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>LUDO</h1>
          <p className="subtitle">Join a room</p>
        </header>
        <div className="setup">
          <label className="control-label wide">
            Your name
            <input className="name-input" type="text" maxLength={20} placeholder="Enter your name"
              value={myName} onChange={(e) => setMyName(e.target.value)} autoFocus />
          </label>
          <label className="control-label wide">
            Room code
            <input className="room-input" type="text" maxLength={6} placeholder="e.g. XK7M2P"
              value={joinInput} onChange={(e) => setJoinInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && handleJoinRoom()} />
          </label>
          <button className="new-game big" onClick={handleJoinRoom}
            disabled={joinInput.trim().length !== 6 || !myName.trim()}>Join Room</button>
          <button className="new-game ghost" onClick={handleSpectate}
            disabled={joinInput.trim().length !== 6}>Watch as Spectator</button>
          <button className="new-game ghost" onClick={() => setPhase('online-choice')}>Back</button>
          {online.error && <p className="online-error">{online.error}</p>}
        </div>
      </div>
    )
  }

  // Lobby
  if (phase === 'lobby') {
    const players = online.onlinePlayers
    const totalPlayers = getActivePlayers(online.gameState?.__playerCount || online.onlinePlayerCount)
    return (
      <div className="ludo-container">
        <header className="header">
          <h1 className="title" style={{ background: 'linear-gradient(90deg, #16c784, #4ff0b7)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>LUDO</h1>
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
                <button className="copy-btn" onClick={handleShare}>Share</button>
              )}
            </div>
          </div>

          <div className="lobby-info">
            {activePlayerCount} players · {online.gameState?.__timer ? `Timer: ${online.gameState.__timer}s` : 'No Timer'}
          </div>

          <div className="lobby-players">
            {totalPlayers.map((slot) => {
              const p = players[slot]
              const isMe = slot === online.mySlot
              return (
                <div key={slot} className={`lobby-slot ${p ? 'filled' : ''} ${isMe ? 'me' : ''}`}>
                  <span className="slot-dot" style={{ background: PLAYER_COLORS[slot] }} />
                  <span className="slot-label">
                    {p ? (p.name || PLAYER_LABELS[slot]) : PLAYER_LABELS[slot]}
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
            <button className="new-game big" onClick={() => online.startOnlineGame()}
              disabled={!online.allJoined}>
              {online.allJoined ? 'Start Game' : `Waiting for players (${online.connectedCount}/${totalPlayers.length})`}
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

  // ---- Playing screen ----
  if (!activeGameState) return null

  const diceValue = activeGameState.dice
  const movePhase = activeGameState.movePhase
  // Offline is pass-and-play: whoever holds the device controls the current turn.
  // Online: only control your own slot (and never as a spectator).
  const iControl = !online.isSpectator && (isOnline ? isMyTurn : true)
  const canRoll = movePhase === 'rolling' && !winner && iControl
  const canMove = movePhase === 'moving' && !winner && iControl

  return (
    <div className="ludo-container ludo-playing">
      <header className="header header-compact">
        <h1 className="title title-small" style={{ background: 'linear-gradient(90deg, #16c784, #4ff0b7)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>LUDO</h1>
        <p className="subtitle">
          {online.isSpectator ? (
            <span>Spectating</span>
          ) : (
            <>
              <span className="player-avatar-badge">{myAvatar}</span>
              {' '}
              <span style={{ color: PLAYER_COLORS[activeMyPlayer], fontWeight: 700 }}>
                {playerNames[activeMyPlayer] || PLAYER_LABELS[activeMyPlayer]}
              </span>
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
        <button className="mute-btn" onClick={toggleMute} title={muted ? 'Unmute' : 'Mute'}>
          {muted ? '\u{1F507}' : '\u{1F50A}'}
        </button>
      </div>

      {/* Player tabs */}
      <div className="ludo-player-tabs">
        {activePlayers.map((p) => (
          <div key={p}
            className={`ludo-player-tab p${p} ${activeCurrentTurn === p ? 'active' : ''} ${p === activeMyPlayer ? 'me' : ''}`}>
            <span className="ludo-tab-dot" style={{ background: PLAYER_COLORS[p] }} />
            <span className="player-tab-name">{playerNames[p] || PLAYER_LABELS[p]}</span>
            <span className="ludo-tab-home">{tokensHome[p] || 0}/4</span>
          </div>
        ))}
      </div>

      {/* Turn status */}
      <div className="ludo-turn-status">
        {winner ? (
          <span className="turn-win">
            {playerNames[winner] || PLAYER_LABELS[winner]} wins!
          </span>
        ) : (
          <>
            <span className={`ludo-whose-turn p${activeCurrentTurn}`}>
              {online.isSpectator
                ? `${playerNames[activeCurrentTurn] || PLAYER_LABELS[activeCurrentTurn]}'s turn`
                : isOnline
                  ? isMyTurn
                    ? `Your turn — ${movePhase === 'rolling' ? 'roll the dice' : 'select a token'}`
                    : `${playerNames[activeCurrentTurn] || PLAYER_LABELS[activeCurrentTurn]}'s turn`
                  : `${playerNames[activeCurrentTurn] || PLAYER_LABELS[activeCurrentTurn]}'s turn — ${movePhase === 'rolling' ? 'roll the dice' : 'select a token'}`}
            </span>
            {isOnline && online.timerEnabled && secondsLeft != null && (
              <span className={`timer ${secondsLeft <= 5 ? 'urgent' : ''}`}>
                {secondsLeft}s
              </span>
            )}
          </>
        )}
      </div>

      {extraTurnMsg && <div className="ludo-extra-turn">{extraTurnMsg}</div>}
      {autoPassMsg && <div className="ludo-auto-pass">{autoPassMsg}</div>}

      {/* Dice area */}
      <div className="ludo-dice-area">
        {diceValue ? renderDice(diceValue) : renderDice(1)}
        {canRoll && (
          <button className="ludo-roll-btn" onClick={handleRollDice} disabled={diceRolling || !!autoPassMsg}>
            {diceRolling ? 'Rolling...' : 'Roll Dice'}
          </button>
        )}
        {canMove && (
          <span className="ludo-dice-label">
            Rolled {diceValue} — {validMoves.length > 0 ? 'select a token to move' : 'no valid moves'}
          </span>
        )}
      </div>

      {/* Board */}
      <div className="ludo-board-wrap">
        <LudoBoard
          pieces={activeGameState.pieces}
          playerCount={activePlayerCount}
          validMoves={canMove ? validMoves : []}
          selectedToken={selectedToken}
          onTokenClick={canMove ? handleTokenClick : () => {}}
          currentTurn={activeCurrentTurn}
          dice={diceValue}
          animating={false}
        />
      </div>


      {/* Win overlay */}
      {winner && (
        <div className="ludo-win-overlay" role="dialog" aria-live="assertive">
          <div className="confetti-container">
            {confettiPieces.map((p) => (
              <span key={p.key} className="confetti-piece" style={p.style} />
            ))}
          </div>
          <div className="ludo-win-card">
            <div className="ludo-win-title">WINNER!</div>
            <div className="ludo-win-text" style={{ color: PLAYER_COLORS[winner] }}>
              {playerNames[winner] || PLAYER_LABELS[winner]} wins!
            </div>
            <p className="ludo-win-sub">All 4 tokens reached home.</p>
            <div className="ludo-win-actions">
              {(!isOnline || online.isHost) && (
                <button className="new-game" onClick={handleRematch}>Rematch</button>
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

      {/* Chat (online only) */}
      {isOnline && phase === 'playing' && !online.isSpectator && (
        <>
          <button className="chat-toggle" onClick={() => setChatOpen((o) => !o)}>
            {chatOpen ? '\u2715' : '\u{1F4AC}'}
            {!chatOpen && chat.messages.length > 0 && (
              <span className="chat-badge">{chat.messages.length}</span>
            )}
          </button>
          {chatOpen && (
            <div className="chat-panel">
              <div className="chat-messages">
                {chat.messages.map((msg, i) => (
                  <div key={i} className="chat-msg">
                    <span className="chat-name" style={{ color: PLAYER_COLORS[msg.slot] || 'var(--muted)' }}>
                      {msg.name}
                    </span>
                    <span className="chat-text">{msg.text}</span>
                  </div>
                ))}
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
                <input type="text" className="chat-input" placeholder="Type a message..."
                  value={chatInput} onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendChat()} maxLength={200} />
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
