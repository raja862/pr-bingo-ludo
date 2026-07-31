import { useState, useMemo, useRef, useEffect } from 'react'
import {
  createInitialState, applyMove, getResult, getNextPlayer,
  SYMBOLS, PLAYER_LABELS, PLAYER_COLORS,
} from './ticTacToeLogic'
import { useTicTacToeOnlineGame } from './useTicTacToeOnlineGame'
import { useSounds } from './useSounds'
import { useStats } from './useStats'
import { useChat } from './useChat'
import { useTurnTimer } from './useTurnTimer'
import './tictactoe.css'

const CHAT_REACTIONS = ['\u{1F44D}', '\u{1F602}', '\u{1F389}', '\u{1F62E}', '\u{1F480}']
const TITLE_STYLE = {
  background: 'linear-gradient(90deg, #4d8bff, #ff4d6d)',
  WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
}

export default function TicTacToeGame({ onBack }) {
  const [mode, setMode] = useState(null) // null | 'offline' | 'online'
  const [phase, setPhase] = useState('setup') // setup | setup-offline | online-choice | create-room | join-room | lobby | playing

  // Offline game state
  const [gameState, setGameState] = useState(null)
  const [myPlayer, setMyPlayer] = useState(1) // offline: which mark "you" are (cosmetic)

  // Player info
  const [myName, setMyName] = useState('')

  // Timer (online)
  const [timerEnabled, setTimerEnabled] = useState(false)
  const [timerSeconds, setTimerSeconds] = useState(20)

  // Online
  const online = useTicTacToeOnlineGame()
  const [joinInput, setJoinInput] = useState('')
  const [copied, setCopied] = useState(false)

  // Sounds / stats / chat
  const { playTap, playBingo, playNotify, playCapture, muted, toggleMute } = useSounds()
  const { recordGame } = useStats()
  const hasRecorded = useRef(false)
  const chat = useChat(online.getChannel, online.mySlot, myName)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatInput, setChatInput] = useState('')
  const chatEndRef = useRef(null)
  const prevIsMyTurn = useRef(false)

  const isOnline = mode === 'online'

  // Unified active state
  const activeGameState = useMemo(() => {
    if (isOnline) {
      const gs = online.gameState
      if (gs && gs.__game === 'tictactoe') {
        return {
          board: gs.board || Array(9).fill(null),
          currentPlayer: gs.currentPlayer || 1,
          winner: gs.winner ?? null,
          winLine: gs.winLine ?? null,
        }
      }
      return null
    }
    return gameState
  }, [isOnline, online.gameState, gameState])

  const activeCurrentTurn = activeGameState?.currentPlayer || 1
  const activeMyPlayer = isOnline ? online.mySlot : myPlayer
  const winner = activeGameState?.winner ?? null
  const winLine = activeGameState?.winLine ?? null
  const isMyTurn = activeCurrentTurn === activeMyPlayer
  const iControl = !online.isSpectator && (isOnline ? isMyTurn : true)

  const playerNames = useMemo(() => {
    if (isOnline) return online.onlinePlayerNames
    return {
      1: myPlayer === 1 && myName ? myName : PLAYER_LABELS[1],
      2: myPlayer === 2 && myName ? myName : PLAYER_LABELS[2],
    }
  }, [isOnline, online.onlinePlayerNames, myPlayer, myName])

  // Turn timer (online)
  const secondsLeft = useTurnTimer(
    isOnline && online.timerEnabled ? online.turnDeadline : null,
    isMyTurn,
    online.passTurn,
  )

  // Notify when it becomes your turn (online)
  useEffect(() => {
    if (isOnline && isMyTurn && !prevIsMyTurn.current && !winner) {
      playNotify()
      if (navigator.vibrate) navigator.vibrate(150)
    }
    prevIsMyTurn.current = isMyTurn
  }, [isOnline, isMyTurn, winner, playNotify])

  // Win sound + stats
  useEffect(() => {
    if (winner && !hasRecorded.current) {
      hasRecorded.current = true
      if (winner === 'draw') {
        playNotify()
        recordGame('loss', { mode: isOnline ? 'online' : 'offline', game: 'tictactoe', draw: true })
      } else {
        playBingo()
        if (winner === activeMyPlayer) {
          recordGame('win', { mode: isOnline ? 'online' : 'offline', game: 'tictactoe' })
        } else if (isOnline) {
          recordGame('loss', { mode: 'online', game: 'tictactoe' })
        }
      }
    }
  }, [winner, playBingo, playNotify, recordGame, isOnline, activeMyPlayer])

  // Auto-transition lobby -> playing
  useEffect(() => {
    if (isOnline && phase === 'lobby' && online.onlineStatus === 'playing') {
      setPhase('playing')
    }
  }, [isOnline, phase, online.onlineStatus])

  // Reset the win guard when a fresh game starts
  useEffect(() => {
    if (!winner) hasRecorded.current = false
  }, [winner])

  // Auto-resume: hook reconnected from localStorage
  useEffect(() => {
    if (mode === null && online.roomCode && online.mySlot && online.roomData) {
      setMode('online')
      setPhase(online.onlineStatus === 'playing' ? 'playing' : 'lobby')
    }
  }, [mode, online.roomCode, online.mySlot, online.roomData, online.onlineStatus])

  // Restore name from reconnected room
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
    setTimerSeconds(20)
  }

  const startOfflineGame = () => {
    setGameState(createInitialState())
    hasRecorded.current = false
    setPhase('playing')
  }

  const handleCellClick = (index) => {
    if (winner) return
    if (!activeGameState || activeGameState.board[index] != null) return
    if (!iControl) return

    if (isOnline) {
      playTap()
      online.makeMove(index)
      return
    }

    // Offline
    const newBoard = applyMove(gameState.board, index, gameState.currentPlayer)
    if (!newBoard) return
    const result = getResult(newBoard)
    if (result && result.winner !== 'draw') playCapture?.() || playTap()
    else playTap()
    setGameState({
      board: newBoard,
      currentPlayer: result ? gameState.currentPlayer : getNextPlayer(gameState.currentPlayer),
      winner: result ? result.winner : null,
      winLine: result ? result.line : null,
    })
  }

  const handleRematch = () => {
    hasRecorded.current = false
    if (isOnline) {
      online.rematch()
    } else {
      const starter = gameState?.winner === 1 ? 2 : 1
      setGameState({ ...createInitialState(), currentPlayer: starter })
    }
  }

  const handleCreateRoom = async () => {
    const code = await online.createRoom(myName.trim(), timerEnabled, timerSeconds)
    if (code) setPhase('lobby')
  }

  const handleJoinRoom = async () => {
    const code = joinInput.trim().toUpperCase()
    if (code.length !== 6) return
    const ok = await online.joinRoom(code, myName.trim())
    if (ok) setPhase('lobby')
  }

  const handleSpectate = async () => {
    const code = joinInput.trim().toUpperCase()
    if (code.length !== 6) return
    const ok = await online.spectate(code)
    if (ok) setPhase('playing')
  }

  const copyRoomCode = () => {
    if (online.roomCode) {
      const shareUrl = `${window.location.origin}${window.location.pathname}?join=${online.roomCode}&game=tictactoe`
      navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleShare = () => {
    if (online.roomCode && navigator.share) {
      navigator.share({
        title: 'Join my Tic-Tac-Toe game!',
        text: `Join my Tic-Tac-Toe game with code ${online.roomCode}`,
        url: `${window.location.origin}${window.location.pathname}?join=${online.roomCode}&game=tictactoe`,
      }).catch(() => {})
    }
  }

  const handleSendChat = () => {
    if (chatInput.trim()) {
      chat.sendMessage(chatInput)
      setChatInput('')
    }
  }

  // Confetti (real win only, not draw)
  const confettiPieces = useMemo(() => {
    if (!winner || winner === 'draw') return []
    return Array.from({ length: 32 }, (_, i) => ({
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

  // ---- RENDER: setup screens ----
  if (phase === 'setup') {
    return (
      <div className="ttt-container">
        <header className="header">
          <button className="back-to-games" onClick={onBack}>&larr; Back to Games</button>
          <h1 className="title" style={TITLE_STYLE}>TIC-TAC-TOE</h1>
          <p className="subtitle">Choose how you want to play</p>
        </header>
        <div className="setup">
          <button className="new-game big" onClick={() => { setMode('offline'); setPhase('setup-offline') }}>
            Play Offline
          </button>
          <button className="new-game big ttt-btn" onClick={() => { setMode('online'); setPhase('online-choice') }}>
            Play Online
          </button>
          <p className="setup-hint">
            <b>Offline:</b> Pass-and-play on one device.<br />
            <b>Online:</b> Play a friend on separate devices in real time.
          </p>
        </div>
      </div>
    )
  }

  if (phase === 'setup-offline') {
    return (
      <div className="ttt-container">
        <header className="header">
          <h1 className="title" style={TITLE_STYLE}>TIC-TAC-TOE</h1>
          <p className="subtitle">Offline — pass-and-play</p>
        </header>
        <div className="setup">
          <label className="control-label wide">
            Your name
            <input className="name-input" type="text" maxLength={20} placeholder="Enter your name"
              value={myName} onChange={(e) => setMyName(e.target.value)} autoFocus />
          </label>
          <div className="control-label wide">
            You play as
            <div className="choice">
              {[1, 2].map((p) => (
                <button key={p}
                  className={`choice-btn ${myPlayer === p ? 'selected' : ''}`}
                  style={myPlayer === p ? { borderColor: PLAYER_COLORS[p], background: `${PLAYER_COLORS[p]}22`, color: PLAYER_COLORS[p] } : undefined}
                  onClick={() => setMyPlayer(p)}>
                  {SYMBOLS[p]}
                </button>
              ))}
            </div>
          </div>
          <button className="new-game big" onClick={startOfflineGame}>Start Game</button>
          <button className="new-game ghost" onClick={handleBackToMenu}>Back</button>
          <p className="setup-hint">X goes first. Get three in a row — across, down, or diagonally — to win!</p>
        </div>
      </div>
    )
  }

  if (phase === 'online-choice') {
    return (
      <div className="ttt-container">
        <header className="header">
          <h1 className="title" style={TITLE_STYLE}>TIC-TAC-TOE</h1>
          <p className="subtitle">Online multiplayer</p>
        </header>
        <div className="setup">
          <button className="new-game big" onClick={() => setPhase('create-room')}>Create Room</button>
          <button className="new-game big ttt-btn" onClick={() => setPhase('join-room')}>Join Room</button>
          <button className="new-game ghost" onClick={handleBackToMenu}>Back</button>
        </div>
      </div>
    )
  }

  if (phase === 'create-room') {
    return (
      <div className="ttt-container">
        <header className="header">
          <h1 className="title" style={TITLE_STYLE}>TIC-TAC-TOE</h1>
          <p className="subtitle">Create a new room</p>
        </header>
        <div className="setup">
          <label className="control-label wide">
            Your name
            <input className="name-input" type="text" maxLength={20} placeholder="Enter your name"
              value={myName} onChange={(e) => setMyName(e.target.value)} autoFocus />
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
                {[10, 15, 20, 30].map((s) => (
                  <button key={s} className={`timer-option ${timerSeconds === s ? 'active' : ''}`}
                    onClick={() => setTimerSeconds(s)} type="button">{s}s</button>
                ))}
              </div>
            )}
          </div>
          <button className="new-game big" onClick={handleCreateRoom} disabled={!myName.trim()}>Create Room</button>
          <button className="new-game ghost" onClick={() => setPhase('online-choice')}>Back</button>
          {online.error && <p className="online-error">{online.error}</p>}
        </div>
      </div>
    )
  }

  if (phase === 'join-room') {
    return (
      <div className="ttt-container">
        <header className="header">
          <h1 className="title" style={TITLE_STYLE}>TIC-TAC-TOE</h1>
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

  if (phase === 'lobby') {
    const players = online.onlinePlayers
    return (
      <div className="ttt-container">
        <header className="header">
          <h1 className="title" style={TITLE_STYLE}>TIC-TAC-TOE</h1>
          <p className="subtitle">Waiting for players</p>
        </header>
        <div className="setup">
          <div className="room-code-display">
            <span className="room-code-label">Room Code</span>
            <span className="room-code-value">{online.roomCode}</span>
            <div className="room-code-actions">
              <button className="copy-btn" onClick={copyRoomCode}>{copied ? 'Copied!' : 'Copy Link'}</button>
              {navigator.share && <button className="copy-btn" onClick={handleShare}>Share</button>}
            </div>
          </div>
          <div className="lobby-info">
            {online.timerEnabled ? `Timer: ${online.gameState?.__timer}s` : 'No Timer'}
          </div>
          <div className="lobby-players">
            {[1, 2].map((slot) => {
              const p = players[slot]
              const isMe = slot === online.mySlot
              return (
                <div key={slot} className={`lobby-slot ${p ? 'filled' : ''} ${isMe ? 'me' : ''}`}>
                  <span className="slot-dot" style={{ background: PLAYER_COLORS[slot] }} />
                  <span className="slot-label">
                    {p ? (p.name || PLAYER_LABELS[slot]) : PLAYER_LABELS[slot]}
                    {` (${SYMBOLS[slot]})`}
                    {isMe && ' — You'}
                  </span>
                  {!p && <span className="slot-waiting">Waiting...</span>}
                  {p && p.connected && <span className="slot-connected">Connected</span>}
                  {p && !p.connected && <span className="slot-disconnected">Disconnected</span>}
                  {online.isHost && p && !isMe && (
                    <button className="kick-btn" onClick={() => online.kickPlayer(slot)} title="Kick player">&times;</button>
                  )}
                </div>
              )
            })}
          </div>
          {online.isHost && (
            <button className="new-game big" onClick={() => online.startOnlineGame()} disabled={!online.allJoined}>
              {online.allJoined ? 'Start Game' : `Waiting for opponent (${online.connectedCount}/2)`}
            </button>
          )}
          {!online.isHost && <p className="lobby-hint">Waiting for the host to start the game...</p>}
          <button className="new-game ghost" onClick={handleBackToMenu}>Leave Room</button>
          {online.error && <p className="online-error">{online.error}</p>}
        </div>
      </div>
    )
  }

  // ---- RENDER: playing ----
  if (!activeGameState) return null
  const board = activeGameState.board
  const isDraw = winner === 'draw'

  return (
    <div className="ttt-container ttt-playing">
      <header className="header header-compact">
        <h1 className="title title-small" style={TITLE_STYLE}>TIC-TAC-TOE</h1>
        <p className="subtitle">
          {online.isSpectator ? (
            <span>Spectating</span>
          ) : (
            <span style={{ color: PLAYER_COLORS[activeMyPlayer], fontWeight: 700 }}>
              You are {SYMBOLS[activeMyPlayer]}
            </span>
          )}
          {isOnline && online.roomCode && <span className="room-badge">Room: {online.roomCode}</span>}
        </p>
      </header>

      {online.isSpectator && <div className="spectator-bar">Spectator mode — watching the game</div>}
      {isOnline && online.hasDisconnected && !online.isSpectator && (
        <div className="disconnect-bar">A player has disconnected. They can rejoin with the room code.</div>
      )}

      <div className="controls">
        <button className="new-game ghost" onClick={handleBackToMenu}>{isOnline ? 'Leave' : 'New Game'}</button>
        <button className="mute-btn" onClick={toggleMute} title={muted ? 'Unmute' : 'Mute'}>
          {muted ? '\u{1F507}' : '\u{1F50A}'}
        </button>
      </div>

      {/* Player tabs */}
      <div className="ttt-player-tabs">
        {[1, 2].map((p) => (
          <div key={p} className={`ttt-player-tab p${p} ${activeCurrentTurn === p && !winner ? 'active' : ''} ${p === activeMyPlayer ? 'me' : ''}`}>
            <span className="ttt-tab-mark" style={{ color: PLAYER_COLORS[p] }}>{SYMBOLS[p]}</span>
            <span className="ttt-tab-name">{playerNames[p] || PLAYER_LABELS[p]}</span>
          </div>
        ))}
      </div>

      {/* Turn status */}
      <div className="ttt-turn-status">
        {winner ? (
          isDraw ? (
            <span className="ttt-turn-draw">It's a draw!</span>
          ) : (
            <span className="ttt-turn-win" style={{ color: PLAYER_COLORS[winner] }}>
              {playerNames[winner] || PLAYER_LABELS[winner]} ({SYMBOLS[winner]}) wins!
            </span>
          )
        ) : (
          <>
            <span className={`ttt-whose-turn p${activeCurrentTurn}`}>
              {online.isSpectator
                ? `${playerNames[activeCurrentTurn] || PLAYER_LABELS[activeCurrentTurn]}'s turn (${SYMBOLS[activeCurrentTurn]})`
                : iControl
                  ? `Your turn — place ${SYMBOLS[activeCurrentTurn]}`
                  : `${playerNames[activeCurrentTurn] || PLAYER_LABELS[activeCurrentTurn]}'s turn`}
            </span>
            {isOnline && online.timerEnabled && secondsLeft != null && (
              <span className={`timer ${secondsLeft <= 5 ? 'urgent' : ''}`}>{secondsLeft}s</span>
            )}
          </>
        )}
      </div>

      {/* Board */}
      <div className="ttt-board-wrap">
        <div className={`ttt-board ${iControl && !winner ? 'my-turn' : ''}`}>
          {board.map((cell, i) => (
            <button key={i}
              className={`ttt-cell ${cell ? `filled p${cell}` : ''} ${winLine?.includes(i) ? 'win' : ''}`}
              onClick={() => handleCellClick(i)}
              disabled={cell != null || !!winner || !iControl}
              aria-label={`Cell ${i + 1}${cell ? `, ${SYMBOLS[cell]}` : ''}`}>
              {cell && <span className={`ttt-mark m${cell}`}>{SYMBOLS[cell]}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Win overlay */}
      {winner && (
        <div className="ttt-win-overlay" role="dialog" aria-live="assertive">
          {!isDraw && (
            <div className="confetti-container">
              {confettiPieces.map((p) => (
                <span key={p.key} className="confetti-piece" style={p.style} />
              ))}
            </div>
          )}
          <div className="ttt-win-card">
            <div className="ttt-win-title">{isDraw ? 'DRAW' : 'WINNER!'}</div>
            {!isDraw && (
              <div className="ttt-win-text" style={{ color: PLAYER_COLORS[winner] }}>
                {playerNames[winner] || PLAYER_LABELS[winner]} ({SYMBOLS[winner]}) wins!
              </div>
            )}
            <p className="ttt-win-sub">{isDraw ? 'No more moves — nobody wins.' : 'Three in a row!'}</p>
            <div className="ttt-win-actions">
              {(!isOnline || online.isHost) && (
                <button className="new-game" onClick={handleRematch}>Rematch</button>
              )}
              {isOnline && !online.isHost && <p className="lobby-hint">Waiting for host to start rematch...</p>}
              <button className="new-game ghost" onClick={handleBackToMenu}>{isOnline ? 'Leave Game' : 'Back to Menu'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Chat (online only) */}
      {isOnline && phase === 'playing' && !online.isSpectator && (
        <>
          <button className="chat-toggle" onClick={() => setChatOpen((o) => !o)}>
            {chatOpen ? '✕' : '\u{1F4AC}'}
            {!chatOpen && chat.messages.length > 0 && <span className="chat-badge">{chat.messages.length}</span>}
          </button>
          {chatOpen && (
            <div className="chat-panel">
              <div className="chat-messages">
                {chat.messages.map((msg, i) => (
                  <div key={i} className="chat-msg">
                    <span className="chat-name" style={{ color: PLAYER_COLORS[msg.slot] || 'var(--muted)' }}>{msg.name}</span>
                    <span className="chat-text">{msg.text}</span>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
              <div className="chat-reactions">
                {CHAT_REACTIONS.map((emoji) => (
                  <button key={emoji} className="chat-reaction-btn" onClick={() => chat.sendMessage(emoji)}>{emoji}</button>
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
