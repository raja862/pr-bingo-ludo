import { useState, useEffect, useRef, useCallback } from 'react'
import { getSupabase } from './supabase'
import { createInitialState, getActivePlayers, getNextPlayer, getValidMoves, applyMove, rollDice } from './ludoLogic'

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function generateRoomCode() {
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
  }
  return code
}

function getPlayerId() {
  let id = localStorage.getItem('ludo_player_id')
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem('ludo_player_id', id)
  }
  return id
}

export function useLudoOnlineGame() {
  const [roomCode, setRoomCode] = useState(null)
  const [roomData, setRoomData] = useState(null)
  const [mySlot, setMySlot] = useState(null)
  const [error, setError] = useState(null)
  const [isHost, setIsHost] = useState(false)
  const [connectedSlots, setConnectedSlots] = useState(new Set())
  const [isSpectator, setIsSpectator] = useState(false)

  const channelRef = useRef(null)
  const playerId = useRef(getPlayerId())

  // Reconnect from sessionStorage on mount
  useEffect(() => {
    const savedCode = localStorage.getItem('ludo_room_code')
    const savedSlot = localStorage.getItem('ludo_room_slot')
    if (savedCode && savedSlot) {
      reconnect(savedCode, Number(savedSlot))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cleanup = useCallback(() => {
    if (channelRef.current) {
      const supabase = getSupabase()
      supabase.removeChannel(channelRef.current)
      channelRef.current = null
    }
  }, [])

  const getChannel = useCallback(() => channelRef.current, [])

  const subscribeToRoom = useCallback((code, slot, spectator = false) => {
    cleanup()
    const supabase = getSupabase()

    supabase
      .from('rooms')
      .select('*')
      .eq('code', code)
      .single()
      .then(({ data, error: err }) => {
        if (err) {
          setError(err.message)
          return
        }
        if (data) {
          setRoomData(data)
          setError(null)
        }
      })

    const channel = supabase
      .channel(`room:${code}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'rooms', filter: `code=eq.${code}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            setError('Room no longer exists')
            setRoomData(null)
            return
          }
          setRoomData(payload.new)
          setError(null)
        },
      )
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState()
        const slots = new Set()
        for (const presences of Object.values(state)) {
          for (const p of presences) {
            if (p.slot) slots.add(p.slot)
          }
        }
        setConnectedSlots(slots)
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            playerId: playerId.current,
            slot: spectator ? null : slot,
            spectator,
          })
        }
      })

    channelRef.current = channel

    if (!spectator) {
      localStorage.setItem('ludo_room_code', code)
      localStorage.setItem('ludo_room_slot', String(slot))
    }
  }, [cleanup])

  const createRoom = useCallback(async (playerCount, name, timerEnabled = false, timerSeconds = 30) => {
    setError(null)
    try {
      const supabase = getSupabase()
      const code = generateRoomCode()
      const id = playerId.current

      const activePlayers = getActivePlayers(playerCount)
      const initialState = createInitialState(playerCount)

      // Store ludo state in the numbers JSONB column
      const gameState = {
        __game: 'ludo',
        __timer: timerEnabled ? timerSeconds : false,
        __playerCount: playerCount,
        pieces: initialState.pieces,
        dice: null,
        sixCount: 0,
        movePhase: 'rolling',
        winner: null,
        currentPlayer: activePlayers[0],
        moveLog: [],
      }

      const { error: err } = await supabase.from('rooms').insert({
        code,
        host: id,
        size: 15, // Board is 15x15
        player_count: playerCount,
        status: 'waiting',
        numbers: gameState,
        current_turn: activePlayers[0],
        callers: {},
        calls: [],
        players: { [activePlayers[0]]: { id, name, connected: true } },
        turn_deadline: null,
        game_type: 'ludo',
      })

      if (err) {
        setError(err.message)
        return null
      }

      setRoomCode(code)
      setMySlot(activePlayers[0])
      setIsHost(true)
      setIsSpectator(false)
      subscribeToRoom(code, activePlayers[0])
      return code
    } catch (err) {
      setError(err.message)
      return null
    }
  }, [subscribeToRoom])

  const joinRoom = useCallback(async (code, name) => {
    setError(null)
    try {
      const supabase = getSupabase()
      const id = playerId.current

      const { data, error: err } = await supabase
        .from('rooms')
        .select('*')
        .eq('code', code)
        .single()

      if (err || !data) {
        setError('Room not found')
        return false
      }
      if (data.game_type !== 'ludo') {
        setError('This is not a Ludo room')
        return false
      }

      const players = data.players || {}
      const playerCount = data.numbers?.__playerCount || data.player_count
      const activePlayers = getActivePlayers(playerCount)

      // Check if already in room (by player ID) — allow rejoin regardless of game status
      for (const [slot, p] of Object.entries(players)) {
        if (p.id === id) {
          const updatedPlayers = { ...players, [slot]: { ...p, name: name || p.name, connected: true } }
          await supabase.from('rooms').update({ players: updatedPlayers }).eq('code', code)
          setRoomCode(code)
          setMySlot(Number(slot))
          setIsHost(data.host === id)
          setIsSpectator(false)
          subscribeToRoom(code, Number(slot))
          return true
        }
      }

      // New player — block if game already started or ended
      if (data.status === 'playing') {
        setError('Game already in progress')
        return false
      }
      if (data.status === 'finished') {
        setError('Game has ended')
        return false
      }

      // Find open slot
      let openSlot = null
      for (const s of activePlayers) {
        if (!players[s]) {
          openSlot = s
          break
        }
      }

      if (openSlot === null) {
        setError('Room is full')
        return false
      }

      const updatedPlayers = { ...players, [openSlot]: { id, name, connected: true } }
      const { error: updateErr } = await supabase
        .from('rooms')
        .update({ players: updatedPlayers })
        .eq('code', code)

      if (updateErr) {
        setError(updateErr.message)
        return false
      }

      setRoomCode(code)
      setMySlot(openSlot)
      setIsHost(false)
      setIsSpectator(false)
      subscribeToRoom(code, openSlot)
      return true
    } catch (err) {
      setError(err.message)
      return false
    }
  }, [subscribeToRoom])

  const spectate = useCallback(async (code) => {
    setError(null)
    try {
      const supabase = getSupabase()

      const { data, error: err } = await supabase
        .from('rooms')
        .select('*')
        .eq('code', code)
        .single()

      if (err || !data) {
        setError('Room not found')
        return false
      }

      setRoomCode(code)
      setMySlot(null)
      setIsHost(false)
      setIsSpectator(true)
      subscribeToRoom(code, null, true)
      return true
    } catch (err) {
      setError(err.message)
      return false
    }
  }, [subscribeToRoom])

  const reconnect = useCallback(async (code, slot) => {
    setError(null)
    try {
      const supabase = getSupabase()
      const { data, error: err } = await supabase
        .from('rooms')
        .select('*')
        .eq('code', code)
        .single()

      if (err || !data) {
        localStorage.removeItem('ludo_room_code')
        localStorage.removeItem('ludo_room_slot')
        return
      }

      if (data.status === 'finished') {
        localStorage.removeItem('ludo_room_code')
        localStorage.removeItem('ludo_room_slot')
        return
      }

      const player = data.players?.[slot]
      if (!player || player.id !== playerId.current) {
        localStorage.removeItem('ludo_room_code')
        localStorage.removeItem('ludo_room_slot')
        return
      }

      // Mark as connected on rejoin
      const supabase2 = getSupabase()
      const updatedPlayers = { ...data.players, [slot]: { ...player, connected: true } }
      await supabase2.from('rooms').update({ players: updatedPlayers }).eq('code', code)

      setRoomCode(code)
      setMySlot(slot)
      setIsHost(data.host === playerId.current)
      setIsSpectator(false)
      subscribeToRoom(code, slot)
    } catch {
      localStorage.removeItem('ludo_room_code')
      localStorage.removeItem('ludo_room_slot')
    }
  }, [subscribeToRoom])

  const startOnlineGame = useCallback(async () => {
    if (!roomCode || !isHost) return
    setError(null)
    try {
      const timerVal = roomData?.numbers?.__timer
      const updateData = { status: 'playing' }
      if (timerVal) updateData.turn_deadline = new Date(Date.now() + timerVal * 1000).toISOString()

      const supabase = getSupabase()
      const { error: err } = await supabase
        .from('rooms')
        .update(updateData)
        .eq('code', roomCode)

      if (err) setError(err.message)
    } catch (err) {
      setError(err.message)
    }
  }, [roomCode, isHost, roomData])

  // Roll dice action
  const onlineRollDice = useCallback(async () => {
    if (!roomCode || !roomData || isSpectator) return
    const gameState = roomData.numbers
    if (!gameState || gameState.__game !== 'ludo') return
    if (gameState.currentPlayer !== mySlot) return
    if (gameState.movePhase !== 'rolling') return

    setError(null)
    try {
      const diceVal = rollDice()
      const playerCount = gameState.__playerCount
      const validMovesList = getValidMoves(
        { pieces: gameState.pieces, dice: diceVal },
        mySlot,
        diceVal,
      )

      const newGameState = {
        ...gameState,
        dice: diceVal,
        movePhase: validMovesList.length > 0 ? 'moving' : 'rolling',
      }

      const newMoveLog = [...(gameState.moveLog || []).slice(-29)]

      // If no valid moves, auto-pass
      if (validMovesList.length === 0) {
        // Handle 3 consecutive sixes
        let nextSixCount = gameState.sixCount
        if (diceVal === 6) {
          nextSixCount += 1
        } else {
          nextSixCount = 0
        }

        const nextPlayer = getNextPlayer(mySlot, playerCount)
        newGameState.currentPlayer = nextPlayer
        newGameState.sixCount = 0
        newGameState.movePhase = 'rolling'
        newGameState.dice = diceVal // keep dice value for display

        newMoveLog.push({
          player: mySlot,
          action: 'no-move',
          dice: diceVal,
        })
      }

      newGameState.moveLog = newMoveLog

      const timerVal = gameState.__timer
      const updateData = {
        numbers: newGameState,
        current_turn: newGameState.currentPlayer,
      }
      if (timerVal && validMovesList.length === 0) {
        updateData.turn_deadline = new Date(Date.now() + timerVal * 1000).toISOString()
      }

      // Optimistic local update so the UI reflects the roll instantly
      setRoomData((prev) => (prev ? { ...prev, ...updateData } : prev))

      const supabase = getSupabase()
      const { error: err } = await supabase
        .from('rooms')
        .update(updateData)
        .eq('code', roomCode)

      if (err) setError(err.message)
    } catch (err) {
      setError(err.message)
    }
  }, [roomCode, roomData, mySlot, isSpectator])

  // Make move action
  const onlineMakeMove = useCallback(async (move) => {
    if (!roomCode || !roomData || isSpectator) return
    const gameState = roomData.numbers
    if (!gameState || gameState.__game !== 'ludo') return
    if (gameState.currentPlayer !== mySlot) return
    if (gameState.movePhase !== 'moving') return

    setError(null)
    try {
      const playerCount = gameState.__playerCount
      const result = applyMove(
        { pieces: gameState.pieces, dice: gameState.dice, sixCount: gameState.sixCount },
        mySlot,
        move,
        playerCount,
      )

      const newMoveLog = [...(gameState.moveLog || []).slice(-29)]
      newMoveLog.push({
        player: mySlot,
        action: move.from === -1 ? 'enter' : move.to === 58 ? 'home' : 'move',
        dice: gameState.dice,
        capture: result.captured,
        extraTurn: result.extraTurn,
      })

      const newGameState = {
        ...gameState,
        pieces: result.pieces,
        dice: null,
        sixCount: result.extraTurn ? result.sixCount || 0 : 0,
        movePhase: 'rolling',
        winner: result.winner,
        currentPlayer: result.winner ? gameState.currentPlayer : result.nextPlayer,
        moveLog: newMoveLog,
      }

      const timerVal = gameState.__timer
      const updateData = {
        numbers: newGameState,
        current_turn: newGameState.currentPlayer,
      }

      if (result.winner) {
        updateData.status = 'finished'
      }

      if (timerVal && !result.winner) {
        updateData.turn_deadline = new Date(Date.now() + timerVal * 1000).toISOString()
      }

      // Optimistic local update so the move renders immediately
      setRoomData((prev) => (prev ? { ...prev, ...updateData } : prev))

      const supabase = getSupabase()
      const { error: err } = await supabase
        .from('rooms')
        .update(updateData)
        .eq('code', roomCode)

      if (err) setError(err.message)
    } catch (err) {
      setError(err.message)
    }
  }, [roomCode, roomData, mySlot, isSpectator])

  // Pass turn (timeout)
  const passTurn = useCallback(async () => {
    if (!roomCode || !roomData || isSpectator) return
    const gameState = roomData.numbers
    if (!gameState || gameState.__game !== 'ludo') return
    if (gameState.currentPlayer !== mySlot) return

    setError(null)
    try {
      const playerCount = gameState.__playerCount
      const nextPlayer = getNextPlayer(mySlot, playerCount)
      const timerVal = gameState.__timer

      const newGameState = {
        ...gameState,
        dice: null,
        sixCount: 0,
        movePhase: 'rolling',
        currentPlayer: nextPlayer,
      }

      const updateData = {
        numbers: newGameState,
        current_turn: nextPlayer,
      }
      if (timerVal) updateData.turn_deadline = new Date(Date.now() + timerVal * 1000).toISOString()

      // Optimistic local update so the turn passes immediately
      setRoomData((prev) => (prev ? { ...prev, ...updateData } : prev))

      const supabase = getSupabase()
      const { error: err } = await supabase
        .from('rooms')
        .update(updateData)
        .eq('code', roomCode)

      if (err) setError(err.message)
    } catch (err) {
      setError(err.message)
    }
  }, [roomCode, roomData, mySlot, isSpectator])

  const rematch = useCallback(async () => {
    if (!roomCode || !isHost || !roomData) return
    setError(null)
    try {
      const playerCount = roomData.numbers?.__playerCount || roomData.player_count
      const timerVal = roomData.numbers?.__timer
      const activePlayers = getActivePlayers(playerCount)
      const initialState = createInitialState(playerCount)

      const newGameState = {
        __game: 'ludo',
        __timer: timerVal || false,
        __playerCount: playerCount,
        pieces: initialState.pieces,
        dice: null,
        sixCount: 0,
        movePhase: 'rolling',
        winner: null,
        currentPlayer: activePlayers[0],
        moveLog: [],
      }

      const updateData = {
        numbers: newGameState,
        current_turn: activePlayers[0],
        status: 'playing',
      }
      if (timerVal) updateData.turn_deadline = new Date(Date.now() + timerVal * 1000).toISOString()
      else updateData.turn_deadline = null

      const supabase = getSupabase()
      const { error: err } = await supabase
        .from('rooms')
        .update(updateData)
        .eq('code', roomCode)

      if (err) setError(err.message)
    } catch (err) {
      setError(err.message)
    }
  }, [roomCode, isHost, roomData])

  const kickPlayer = useCallback(async (slot) => {
    if (!roomCode || !isHost || !roomData) return
    setError(null)
    try {
      const players = { ...roomData.players }
      delete players[slot]
      const supabase = getSupabase()
      const { error: err } = await supabase
        .from('rooms')
        .update({ players })
        .eq('code', roomCode)
      if (err) setError(err.message)
    } catch (err) {
      setError(err.message)
    }
  }, [roomCode, isHost, roomData])

  const leaveRoom = useCallback(() => {
    cleanup()
    setRoomCode(null)
    setRoomData(null)
    setMySlot(null)
    setIsHost(false)
    setError(null)
    setConnectedSlots(new Set())
    setIsSpectator(false)
    localStorage.removeItem('ludo_room_code')
    localStorage.removeItem('ludo_room_slot')
  }, [cleanup])

  // Derived state
  const gameState = roomData?.numbers || {}
  const onlineStatus = roomData?.status || 'waiting'
  const onlinePlayers = roomData?.players || {}
  const onlinePlayerCount = roomData?.player_count || 2
  const turnDeadline = roomData?.turn_deadline || null
  const timerEnabled = !!roomData?.numbers?.__timer

  const onlinePlayerNames = Object.fromEntries(
    Object.entries(onlinePlayers).map(([slot, p]) => [slot, p.name || `Player ${slot}`]),
  )

  const connectedCount = connectedSlots.size
  const allJoined = (() => {
    const pc = gameState.__playerCount || onlinePlayerCount
    const active = getActivePlayers(pc)
    return active.every((s) => onlinePlayers[s])
  })()
  const hasDisconnected =
    Object.keys(onlinePlayers).length > 0 &&
    getActivePlayers(gameState.__playerCount || onlinePlayerCount).some(
      (slot) => onlinePlayers[slot] && !connectedSlots.has(slot),
    )

  return {
    // Actions
    createRoom,
    joinRoom,
    startOnlineGame,
    kickPlayer,
    leaveRoom,
    rematch,
    passTurn,
    spectate,
    getChannel,
    rollDice: onlineRollDice,
    makeMove: onlineMakeMove,

    // State
    roomCode,
    roomData,
    mySlot,
    isHost,
    error,
    isSpectator,
    turnDeadline,
    timerEnabled,

    // Derived
    gameState,
    onlineStatus,
    onlinePlayers,
    onlinePlayerCount,
    onlinePlayerNames,
    connectedCount,
    allJoined,
    hasDisconnected,
  }
}
