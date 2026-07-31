import { useState, useEffect, useRef, useCallback } from 'react'
import { getSupabase } from './supabase'
import { createInitialState, getResult, applyMove, getNextPlayer } from './ticTacToeLogic'

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const ACTIVE_PLAYERS = [1, 2]

function generateRoomCode() {
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
  }
  return code
}

function getPlayerId() {
  let id = localStorage.getItem('ttt_player_id')
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem('ttt_player_id', id)
  }
  return id
}

export function useTicTacToeOnlineGame() {
  const [roomCode, setRoomCode] = useState(null)
  const [roomData, setRoomData] = useState(null)
  const [mySlot, setMySlot] = useState(null)
  const [error, setError] = useState(null)
  const [isHost, setIsHost] = useState(false)
  const [connectedSlots, setConnectedSlots] = useState(new Set())
  const [isSpectator, setIsSpectator] = useState(false)

  const channelRef = useRef(null)
  const playerId = useRef(getPlayerId())

  // Reconnect from localStorage on mount
  useEffect(() => {
    const savedCode = localStorage.getItem('ttt_room_code')
    const savedSlot = localStorage.getItem('ttt_room_slot')
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
        if (err) { setError(err.message); return }
        if (data) { setRoomData(data); setError(null) }
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
      localStorage.setItem('ttt_room_code', code)
      localStorage.setItem('ttt_room_slot', String(slot))
    }
  }, [cleanup])

  const createRoom = useCallback(async (name, timerEnabled = false, timerSeconds = 30) => {
    setError(null)
    try {
      const supabase = getSupabase()
      const code = generateRoomCode()
      const id = playerId.current
      const initial = createInitialState()

      const gameState = {
        __game: 'tictactoe',
        __timer: timerEnabled ? timerSeconds : false,
        board: initial.board,
        currentPlayer: 1,
        winner: null,
        winLine: null,
      }

      const { error: err } = await supabase.from('rooms').insert({
        code,
        host: id,
        size: 3,
        player_count: 2,
        status: 'waiting',
        numbers: gameState,
        current_turn: 1,
        callers: {},
        calls: [],
        players: { 1: { id, name, connected: true } },
        turn_deadline: null,
        game_type: 'tictactoe',
      })

      if (err) { setError(err.message); return null }

      setRoomCode(code)
      setMySlot(1)
      setIsHost(true)
      setIsSpectator(false)
      subscribeToRoom(code, 1)
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
        .from('rooms').select('*').eq('code', code).single()

      if (err || !data) { setError('Room not found'); return false }
      if (data.game_type !== 'tictactoe') { setError('This is not a Tic-Tac-Toe room'); return false }

      const players = data.players || {}

      // Already in room (by player ID) — allow rejoin regardless of status
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

      if (data.status === 'playing') { setError('Game already in progress'); return false }
      if (data.status === 'finished') { setError('Game has ended'); return false }

      // Find open slot (1 or 2)
      let openSlot = null
      for (const s of ACTIVE_PLAYERS) {
        if (!players[s]) { openSlot = s; break }
      }
      if (openSlot === null) { setError('Room is full'); return false }

      const updatedPlayers = { ...players, [openSlot]: { id, name, connected: true } }
      const { error: updateErr } = await supabase
        .from('rooms').update({ players: updatedPlayers }).eq('code', code)

      if (updateErr) { setError(updateErr.message); return false }

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
        .from('rooms').select('*').eq('code', code).single()
      if (err || !data) { setError('Room not found'); return false }

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
        .from('rooms').select('*').eq('code', code).single()

      if (err || !data || data.status === 'finished') {
        localStorage.removeItem('ttt_room_code')
        localStorage.removeItem('ttt_room_slot')
        return
      }

      const player = data.players?.[slot]
      if (!player || player.id !== playerId.current) {
        localStorage.removeItem('ttt_room_code')
        localStorage.removeItem('ttt_room_slot')
        return
      }

      const updatedPlayers = { ...data.players, [slot]: { ...player, connected: true } }
      await supabase.from('rooms').update({ players: updatedPlayers }).eq('code', code)

      setRoomCode(code)
      setMySlot(slot)
      setIsHost(data.host === playerId.current)
      setIsSpectator(false)
      subscribeToRoom(code, slot)
    } catch {
      localStorage.removeItem('ttt_room_code')
      localStorage.removeItem('ttt_room_slot')
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
      const { error: err } = await supabase.from('rooms').update(updateData).eq('code', roomCode)
      if (err) setError(err.message)
    } catch (err) {
      setError(err.message)
    }
  }, [roomCode, isHost, roomData])

  const makeMove = useCallback(async (index) => {
    if (!roomCode || !roomData || isSpectator) return
    const gs = roomData.numbers
    if (!gs || gs.__game !== 'tictactoe') return
    if (gs.currentPlayer !== mySlot) return
    if (gs.winner) return

    const newBoard = applyMove(gs.board, index, mySlot)
    if (!newBoard) return

    setError(null)
    try {
      const result = getResult(newBoard)
      const newGameState = {
        ...gs,
        board: newBoard,
        currentPlayer: result ? gs.currentPlayer : getNextPlayer(mySlot),
        winner: result ? result.winner : null,
        winLine: result ? result.line : null,
      }

      const updateData = { numbers: newGameState, current_turn: newGameState.currentPlayer }
      if (result) updateData.status = 'finished'
      const timerVal = gs.__timer
      if (timerVal && !result) {
        updateData.turn_deadline = new Date(Date.now() + timerVal * 1000).toISOString()
      }

      // Optimistic local update so the mark shows instantly
      setRoomData((prev) => (prev ? { ...prev, ...updateData } : prev))

      const supabase = getSupabase()
      const { error: err } = await supabase.from('rooms').update(updateData).eq('code', roomCode)
      if (err) setError(err.message)
    } catch (err) {
      setError(err.message)
    }
  }, [roomCode, roomData, mySlot, isSpectator])

  // Pass turn (timeout)
  const passTurn = useCallback(async () => {
    if (!roomCode || !roomData || isSpectator) return
    const gs = roomData.numbers
    if (!gs || gs.__game !== 'tictactoe' || gs.winner) return
    if (gs.currentPlayer !== mySlot) return

    setError(null)
    try {
      const nextPlayer = getNextPlayer(mySlot)
      const newGameState = { ...gs, currentPlayer: nextPlayer }
      const updateData = { numbers: newGameState, current_turn: nextPlayer }
      const timerVal = gs.__timer
      if (timerVal) updateData.turn_deadline = new Date(Date.now() + timerVal * 1000).toISOString()

      setRoomData((prev) => (prev ? { ...prev, ...updateData } : prev))

      const supabase = getSupabase()
      const { error: err } = await supabase.from('rooms').update(updateData).eq('code', roomCode)
      if (err) setError(err.message)
    } catch (err) {
      setError(err.message)
    }
  }, [roomCode, roomData, mySlot, isSpectator])

  const rematch = useCallback(async () => {
    if (!roomCode || !isHost || !roomData) return
    setError(null)
    try {
      const timerVal = roomData.numbers?.__timer
      const initial = createInitialState()
      // Loser (or O on a draw) starts the next game for fairness
      const prevWinner = roomData.numbers?.winner
      const starter = prevWinner === 1 ? 2 : 1

      const newGameState = {
        __game: 'tictactoe',
        __timer: timerVal || false,
        board: initial.board,
        currentPlayer: starter,
        winner: null,
        winLine: null,
      }

      const updateData = {
        numbers: newGameState,
        current_turn: starter,
        status: 'playing',
      }
      if (timerVal) updateData.turn_deadline = new Date(Date.now() + timerVal * 1000).toISOString()
      else updateData.turn_deadline = null

      const supabase = getSupabase()
      const { error: err } = await supabase.from('rooms').update(updateData).eq('code', roomCode)
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
      const { error: err } = await supabase.from('rooms').update({ players }).eq('code', roomCode)
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
    localStorage.removeItem('ttt_room_code')
    localStorage.removeItem('ttt_room_slot')
  }, [cleanup])

  // Derived state
  const gameState = roomData?.numbers || {}
  const onlineStatus = roomData?.status || 'waiting'
  const onlinePlayers = roomData?.players || {}
  const turnDeadline = roomData?.turn_deadline || null
  const timerEnabled = !!roomData?.numbers?.__timer

  const onlinePlayerNames = Object.fromEntries(
    Object.entries(onlinePlayers).map(([slot, p]) => [slot, p.name || `Player ${slot}`]),
  )

  const connectedCount = connectedSlots.size
  const allJoined = ACTIVE_PLAYERS.every((s) => onlinePlayers[s])
  const hasDisconnected =
    Object.keys(onlinePlayers).length > 0 &&
    ACTIVE_PLAYERS.some((slot) => onlinePlayers[slot] && !connectedSlots.has(slot))

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
    makeMove,

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
    onlinePlayerNames,
    connectedCount,
    allJoined,
    hasDisconnected,
  }
}
