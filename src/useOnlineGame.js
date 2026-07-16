import { useState, useEffect, useRef, useCallback } from 'react'
import { getSupabase } from './supabase'
import { shuffledNumbers, shuffledWords, getLines } from './gameLogic'

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function generateRoomCode() {
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
  }
  return code
}

function getPlayerId() {
  let id = localStorage.getItem('bingo_player_id')
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem('bingo_player_id', id)
  }
  return id
}

function computeFinishedPlayers(roomData, callersObj) {
  const finished = new Set()
  if (!roomData?.numbers || !roomData?.size) return finished
  const boardLines = getLines(roomData.size)
  for (let p = 1; p <= roomData.player_count; p++) {
    const board = roomData.numbers[p]
    if (!board || !Array.isArray(board)) continue
    const boardMarked = new Set()
    board.forEach((num, idx) => {
      if (callersObj[num] != null) boardMarked.add(idx)
    })
    const completedCount = boardLines.filter(cells => cells.every(i => boardMarked.has(i))).length
    if (completedCount >= roomData.size) finished.add(p)
  }
  return finished
}

function getNextUnfinishedTurn(currentPlayer, playerCount, finishedPlayers) {
  if (finishedPlayers.size >= playerCount) return currentPlayer
  let next = (currentPlayer % playerCount) + 1
  let tries = 0
  while (finishedPlayers.has(next) && tries < playerCount) {
    next = (next % playerCount) + 1
    tries++
  }
  return next
}

export function useOnlineGame() {
  const [roomCode, setRoomCode] = useState(null)
  const [roomData, setRoomData] = useState(null)
  const [mySlot, setMySlot] = useState(null)
  const [error, setError] = useState(null)
  const [isHost, setIsHost] = useState(false)
  const [connectedSlots, setConnectedSlots] = useState(new Set())
  const [isSpectator, setIsSpectator] = useState(false)

  const channelRef = useRef(null)
  const playerId = useRef(getPlayerId())

  // Attempt to reconnect from sessionStorage on mount
  useEffect(() => {
    const savedCode = localStorage.getItem('bingo_room_code')
    const savedSlot = localStorage.getItem('bingo_room_slot')
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

    // Fetch initial room data
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

    // Subscribe to realtime changes + presence
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

    // Persist for reconnection (only for players, not spectators)
    if (!spectator) {
      localStorage.setItem('bingo_room_code', code)
      localStorage.setItem('bingo_room_slot', String(slot))
    }
  }, [cleanup])

  const createRoom = useCallback(async (size, playerCount, name, gameType, wordList, timerEnabled = false, timerSeconds = 20, avatar = null) => {
    setError(null)
    try {
      const supabase = getSupabase()
      const code = generateRoomCode()
      const id = playerId.current

      // Generate a separate shuffled board for each player
      const boards = {}
      if (gameType === 'custom' && wordList?.length >= size * size) {
        for (let i = 1; i <= playerCount; i++) {
          boards[i] = shuffledWords(wordList, size * size)
        }
        boards.__type = 'custom'
      } else {
        for (let i = 1; i <= playerCount; i++) {
          boards[i] = shuffledNumbers(size * size)
        }
      }

      boards.__timer = timerEnabled ? timerSeconds : false

      const { error: err } = await supabase.from('rooms').insert({
        code,
        host: id,
        size,
        player_count: playerCount,
        status: 'waiting',
        numbers: boards,
        current_turn: 1,
        callers: {},
        calls: [],
        players: { 1: { id, name, avatar, connected: true } },
        turn_deadline: null,
      })

      if (err) {
        setError(err.message)
        return null
      }

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

  const joinRoom = useCallback(async (code, name, avatar = null) => {
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

      const players = data.players || {}

      // Check if already in room (by player ID) — allow rejoin regardless of game status
      for (const [slot, p] of Object.entries(players)) {
        if (p.id === id) {
          const updatedPlayers = { ...players, [slot]: { ...p, name: name || p.name, avatar: avatar || p.avatar, connected: true } }
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
      for (let s = 1; s <= data.player_count; s++) {
        if (!players[s]) {
          openSlot = s
          break
        }
      }

      if (openSlot === null) {
        setError('Room is full')
        return false
      }

      // Claim slot
      const updatedPlayers = { ...players, [openSlot]: { id, name, avatar, connected: true } }
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
        localStorage.removeItem('bingo_room_code')
        localStorage.removeItem('bingo_room_slot')
        return
      }

      if (data.status === 'finished') {
        localStorage.removeItem('bingo_room_code')
        localStorage.removeItem('bingo_room_slot')
        return
      }

      const player = data.players?.[slot]
      if (!player || player.id !== playerId.current) {
        localStorage.removeItem('bingo_room_code')
        localStorage.removeItem('bingo_room_slot')
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
      localStorage.removeItem('bingo_room_code')
      localStorage.removeItem('bingo_room_slot')
    }
  }, [subscribeToRoom])

  const callNumber = useCallback(async (index) => {
    if (!roomCode || !roomData || isSpectator) return
    setError(null)
    try {
      const callers = roomData.callers || {}
      const myBoard = roomData.numbers?.[mySlot]
      if (!myBoard) return
      const number = myBoard[index]
      if (number == null || callers[number] != null) return
      if (roomData.current_turn !== mySlot) return

      // Don't allow finished players to call
      const currentFinished = computeFinishedPlayers(roomData, callers)
      if (currentFinished.has(mySlot)) return

      const player = mySlot
      const updatedCallers = { ...callers, [number]: player }
      const currentCalls = roomData.calls || []
      const timerVal = roomData.numbers?.__timer

      // Compute finished players after this call for turn skipping
      const finishedAfter = computeFinishedPlayers(roomData, updatedCallers)
      const nextTurn = getNextUnfinishedTurn(player, roomData.player_count, finishedAfter)

      const updateData = {
        callers: updatedCallers,
        current_turn: nextTurn,
        calls: [...currentCalls, { player, number }],
      }
      if (timerVal && finishedAfter.size < roomData.player_count) {
        updateData.turn_deadline = new Date(Date.now() + timerVal * 1000).toISOString()
      }

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

  const passTurn = useCallback(async () => {
    if (!roomCode || !roomData || isSpectator) return
    if (roomData.current_turn !== mySlot) return
    setError(null)
    try {
      const callers = roomData.callers || {}
      const finished = computeFinishedPlayers(roomData, callers)
      const nextTurn = getNextUnfinishedTurn(mySlot, roomData.player_count, finished)
      const timerVal = roomData.numbers?.__timer

      const updateData = { current_turn: nextTurn }
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
  }, [roomCode, roomData, mySlot, isSpectator])

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
  }, [roomCode, isHost])

  const rematch = useCallback(async () => {
    if (!roomCode || !isHost || !roomData) return
    setError(null)
    try {
      const supabase = getSupabase()
      const size = roomData.size
      const pc = roomData.player_count
      const isCustom = roomData.numbers?.__type === 'custom'

      const boards = {}
      if (isCustom) {
        // Collect all words from existing boards to re-shuffle
        const allWords = new Set()
        for (const [key, val] of Object.entries(roomData.numbers)) {
          if (key !== '__type' && Array.isArray(val)) {
            val.forEach((w) => allWords.add(w))
          }
        }
        const wordArr = [...allWords]
        for (let i = 1; i <= pc; i++) {
          boards[i] = shuffledWords(wordArr, size * size)
        }
        boards.__type = 'custom'
      } else {
        for (let i = 1; i <= pc; i++) {
          boards[i] = shuffledNumbers(size * size)
        }
      }

      const timerVal = roomData.numbers?.__timer
      boards.__timer = timerVal || false

      const updateData = {
        numbers: boards,
        callers: {},
        calls: [],
        current_turn: 1,
        status: 'playing',
      }
      if (timerVal) updateData.turn_deadline = new Date(Date.now() + timerVal * 1000).toISOString()
      else updateData.turn_deadline = null

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
    localStorage.removeItem('bingo_room_code')
    localStorage.removeItem('bingo_room_slot')
  }, [cleanup])

  // Derived state — normalize snake_case DB columns to the hook's API
  const onlineBoards = roomData?.numbers || {}
  const myBoard = (mySlot && onlineBoards[mySlot]) || []
  const onlineCallers = roomData?.callers || {}
  const onlineCurrentTurn = roomData?.current_turn || 1
  const onlineCalls = roomData?.calls || []
  const onlineSize = roomData?.size || 5
  const onlineStatus = roomData?.status || 'waiting'
  const onlinePlayers = roomData?.players || {}
  const onlinePlayerCount = roomData?.player_count || 2
  const turnDeadline = roomData?.turn_deadline || null
  const timerEnabled = !!roomData?.numbers?.__timer

  const onlinePlayerNames = Object.fromEntries(
    Object.entries(onlinePlayers).map(([slot, p]) => [slot, p.name || `Player ${slot}`]),
  )

  const onlinePlayerAvatars = Object.fromEntries(
    Object.entries(onlinePlayers).map(([slot, p]) => [slot, p.avatar || null]),
  )

  const connectedCount = connectedSlots.size
  const allJoined = Object.keys(onlinePlayers).length >= onlinePlayerCount
  const hasDisconnected =
    Object.keys(onlinePlayers).length > 0 &&
    Array.from({ length: onlinePlayerCount }, (_, i) => i + 1).some(
      (slot) => onlinePlayers[slot] && !connectedSlots.has(slot),
    )

  return {
    // Actions
    createRoom,
    joinRoom,
    callNumber,
    startOnlineGame,
    kickPlayer,
    leaveRoom,
    rematch,
    passTurn,
    spectate,
    getChannel,

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
    myBoard,
    onlineCallers,
    onlineCurrentTurn,
    onlineCalls,
    onlineSize,
    onlineStatus,
    onlinePlayers,
    onlinePlayerCount,
    onlinePlayerNames,
    onlinePlayerAvatars,
    connectedCount,
    allJoined,
    hasDisconnected,
  }
}
