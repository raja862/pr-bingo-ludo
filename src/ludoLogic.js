// Pure Ludo game logic — no React, no side effects

// Player colors and start offsets on the 52-cell track
export const PLAYER_COLORS = { 1: '#16c784', 2: '#ffd166', 3: '#4d8bff', 4: '#ff4d6d' }
export const PLAYER_LABELS = { 1: 'Green', 2: 'Yellow', 3: 'Blue', 4: 'Red' }
export const START_OFFSETS = { 1: 0, 2: 13, 3: 26, 4: 39 }

// Which players are active for a given player count
export function getActivePlayers(playerCount) {
  if (playerCount === 2) return [1, 3]
  if (playerCount === 3) return [1, 2, 3]
  return [1, 2, 3, 4]
}

export function getNextPlayer(current, playerCount) {
  const active = getActivePlayers(playerCount)
  const idx = active.indexOf(current)
  return active[(idx + 1) % active.length]
}

// 52-cell track coordinates on a 15x15 grid, starting from Green's start
// Built by concatenating 4 arms of 13 cells each, going clockwise
// Each arm: 5 cells going up the left column, 1 cell turning right at top,
// 5 cells going down the right column, 2 cells turning to next arm
function buildTrack() {
  const coords = []

  // Arm 1 (Green, bottom-left to top): cells 0-12
  // Go up left column (col 6), rows 13 down to 9
  coords.push([13, 6]) // 0 - Green start
  coords.push([12, 6])
  coords.push([11, 6])
  coords.push([10, 6])
  coords.push([9, 6])
  // Turn right at row 8
  coords.push([8, 5])
  coords.push([8, 4])
  coords.push([8, 3])
  coords.push([8, 2]) // 8 - safe (star)
  coords.push([8, 1])
  coords.push([8, 0])
  // Turn down to row 7, then up to row 6
  coords.push([7, 0])
  coords.push([6, 0])

  // Arm 2 (Yellow, top-left to right): cells 13-25
  coords.push([6, 1]) // 13 - Yellow start
  coords.push([6, 2])
  coords.push([6, 3])
  coords.push([6, 4])
  coords.push([6, 5])
  // Turn down at col 6
  coords.push([5, 6])
  coords.push([4, 6])
  coords.push([3, 6])
  coords.push([2, 6]) // 21 - safe (star)
  coords.push([1, 6])
  coords.push([0, 6])
  // Turn right to col 7, then to col 8
  coords.push([0, 7])
  coords.push([0, 8])

  // Arm 3 (Blue, top-right to bottom): cells 26-38
  coords.push([1, 8]) // 26 - Blue start
  coords.push([2, 8])
  coords.push([3, 8])
  coords.push([4, 8])
  coords.push([5, 8])
  // Turn right at row 6
  coords.push([6, 9])
  coords.push([6, 10])
  coords.push([6, 11])
  coords.push([6, 12]) // 34 - safe (star)
  coords.push([6, 13])
  coords.push([6, 14])
  // Turn down to row 7, then row 8
  coords.push([7, 14])
  coords.push([8, 14])

  // Arm 4 (Red, bottom-right to left): cells 39-51
  coords.push([8, 13]) // 39 - Red start
  coords.push([8, 12])
  coords.push([8, 11])
  coords.push([8, 10])
  coords.push([8, 9])
  // Turn up at col 8
  coords.push([9, 8])
  coords.push([10, 8])
  coords.push([11, 8])
  coords.push([12, 8]) // 47 - safe (star)
  coords.push([13, 8])
  coords.push([14, 8])
  // Turn left to col 7, then col 6
  coords.push([14, 7])
  coords.push([14, 6])

  return coords
}

export const TRACK = buildTrack()

// Safe positions (absolute track indices): start positions + star positions
export const SAFE_POSITIONS = new Set([0, 8, 13, 21, 26, 34, 39, 47])

// Home stretch cells (6 each, colored, leading to center)
// These are the cells between the track and the center home
export const HOME_STRETCHES = {
  1: [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7], [8, 7]], // Green: bottom to center
  2: [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5], [7, 6]],     // Yellow: left to center
  3: [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7]],     // Blue: top to center
  4: [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9], [7, 8]],  // Red: right to center
}

// Yard positions (where tokens sit before entering the track)
export const YARD_POSITIONS = {
  1: [[11, 2], [11, 4], [13, 2], [13, 4]],  // Green: bottom-left
  2: [[1, 2], [1, 4], [3, 2], [3, 4]],      // Yellow: top-left
  3: [[1, 10], [1, 12], [3, 10], [3, 12]],  // Blue: top-right
  4: [[11, 10], [11, 12], [13, 10], [13, 12]], // Red: bottom-right
}

// Convert row,col to SVG x,y (each cell is 40x40 in a 600x600 viewBox)
export function toSvgXY(row, col) {
  return { x: col * 40 + 20, y: row * 40 + 20 }
}

// Convert a player's relative position to an absolute track index
export function toAbsoluteTrackIndex(player, relPos) {
  if (relPos < 0 || relPos >= 52) return -1
  return (relPos + START_OFFSETS[player]) % 52
}

// Get the grid coordinates for a token given player and relative position
export function getTokenCoords(player, relPos) {
  if (relPos === -1) {
    // In yard — return yard position (need token index, handled separately)
    return null
  }
  if (relPos >= 52 && relPos <= 57) {
    // Home stretch
    const stretchIdx = relPos - 52
    const stretch = HOME_STRETCHES[player]
    if (stretch && stretch[stretchIdx]) {
      return { row: stretch[stretchIdx][0], col: stretch[stretchIdx][1] }
    }
    return null
  }
  if (relPos === 58) {
    // HOME (center) — all players converge at center
    return { row: 7, col: 7 }
  }
  if (relPos >= 0 && relPos < 52) {
    const absIdx = toAbsoluteTrackIndex(player, relPos)
    const cell = TRACK[absIdx]
    return { row: cell[0], col: cell[1] }
  }
  return null
}

// Get yard coordinate for a specific token
export function getYardCoords(player, tokenIndex) {
  const yard = YARD_POSITIONS[player]
  if (yard && yard[tokenIndex]) {
    return { row: yard[tokenIndex][0], col: yard[tokenIndex][1] }
  }
  return { row: 7, col: 7 }
}

// Create initial game state
export function createInitialState(playerCount) {
  const active = getActivePlayers(playerCount)
  const pieces = {}
  for (const p of active) {
    pieces[p] = [-1, -1, -1, -1]
  }
  return {
    pieces,
    dice: null,
    sixCount: 0,
    movePhase: 'rolling',
    winner: null,
  }
}

// Roll a die
export function rollDice() {
  return Math.floor(Math.random() * 6) + 1
}

// Get valid moves for a player given the current state and dice value
export function getValidMoves(state, player, diceValue) {
  const moves = []
  const playerPieces = state.pieces[player]
  if (!playerPieces) return moves

  for (let tokenIdx = 0; tokenIdx < 4; tokenIdx++) {
    const pos = playerPieces[tokenIdx]

    if (pos === 58) continue // Already home

    if (pos === -1) {
      // In yard: can only come out on a 6
      if (diceValue === 6) {
        // Own tokens may stack on a cell, so entering is always allowed on a 6
        const startPos = 0 // relative start for this player
        const captureInfo = getCaptureInfo(state, player, startPos)
        moves.push({ tokenIdx, from: -1, to: startPos, capture: captureInfo })
      }
      continue
    }

    // On track or home stretch
    const newPos = pos + diceValue

    // Can't go past home
    if (newPos > 58) continue

    // Must land exactly on 58 to enter home
    if (newPos === 58) {
      moves.push({ tokenIdx, from: pos, to: 58, capture: null })
      continue
    }

    // Moving within home stretch (52-57) — own tokens may share a cell
    if (newPos >= 52) {
      moves.push({ tokenIdx, from: pos, to: newPos, capture: null })
      continue
    }

    // Moving on main track (0-51) — own tokens may stack on a cell
    const captureInfo = getCaptureInfo(state, player, newPos)
    moves.push({ tokenIdx, from: pos, to: newPos, capture: captureInfo })
  }

  return moves
}

// Check if landing on a position would capture an opponent
function getCaptureInfo(state, player, relPos) {
  if (relPos >= 52) return null // Can't capture in home stretch

  const absPos = toAbsoluteTrackIndex(player, relPos)

  // Can't capture on safe positions
  if (SAFE_POSITIONS.has(absPos)) return null

  // Check all other players
  for (const [otherPlayerStr, otherPieces] of Object.entries(state.pieces)) {
    const otherPlayer = Number(otherPlayerStr)
    if (otherPlayer === player) continue

    for (let ti = 0; ti < otherPieces.length; ti++) {
      const otherRelPos = otherPieces[ti]
      if (otherRelPos < 0 || otherRelPos >= 52) continue // Skip yard/home stretch/home

      const otherAbsPos = toAbsoluteTrackIndex(otherPlayer, otherRelPos)
      if (otherAbsPos === absPos) {
        return { player: otherPlayer, tokenIdx: ti }
      }
    }
  }

  return null
}

// Apply a move and return new state
export function applyMove(state, player, move, playerCount) {
  const newPieces = {}
  for (const [p, tokens] of Object.entries(state.pieces)) {
    newPieces[p] = [...tokens]
  }

  // Move the token
  newPieces[player][move.tokenIdx] = move.to

  // Handle capture
  let captured = false
  if (move.capture) {
    newPieces[move.capture.player][move.capture.tokenIdx] = -1
    captured = true
  }

  // Check for winner
  const winner = checkWinner({ ...state, pieces: newPieces })

  // Determine if player gets another turn
  const rolledSix = state.dice === 6
  let nextMovePhase = 'rolling'
  let nextSixCount = state.sixCount

  // Determine next player
  let nextPlayer = getNextPlayer(player, playerCount)
  let extraTurn = false

  if (rolledSix) {
    nextSixCount = state.sixCount + 1
    if (nextSixCount >= 3) {
      // 3 consecutive sixes — lose turn
      nextSixCount = 0
      nextPlayer = getNextPlayer(player, playerCount)
    } else {
      // Extra turn for rolling 6
      extraTurn = true
      nextPlayer = player
    }
  } else if (captured) {
    // Extra turn for capture
    extraTurn = true
    nextPlayer = player
    nextSixCount = 0
  } else {
    nextSixCount = 0
  }

  return {
    pieces: newPieces,
    dice: null,
    sixCount: extraTurn ? nextSixCount : 0,
    movePhase: nextMovePhase,
    winner,
    nextPlayer,
    extraTurn,
    captured,
  }
}

// Check if any player has all 4 tokens home
export function checkWinner(state) {
  for (const [playerStr, tokens] of Object.entries(state.pieces)) {
    if (tokens.every((pos) => pos === 58)) {
      return Number(playerStr)
    }
  }
  return null
}

// Get all tokens on a specific absolute track position (for stacking display)
export function getTokensAtAbsolutePos(state, absPos) {
  const tokens = []
  for (const [playerStr, pieces] of Object.entries(state.pieces)) {
    const player = Number(playerStr)
    for (let ti = 0; ti < pieces.length; ti++) {
      const relPos = pieces[ti]
      if (relPos >= 0 && relPos < 52) {
        if (toAbsoluteTrackIndex(player, relPos) === absPos) {
          tokens.push({ player, tokenIdx: ti })
        }
      }
    }
  }
  return tokens
}

// Get stacking offset for tokens sharing a cell
export function getStackOffset(index, total) {
  if (total <= 1) return { dx: 0, dy: 0 }
  const offsets2 = [{ dx: -6, dy: 0 }, { dx: 6, dy: 0 }]
  const offsets3 = [{ dx: -7, dy: -4 }, { dx: 7, dy: -4 }, { dx: 0, dy: 6 }]
  const offsets4 = [{ dx: -6, dy: -6 }, { dx: 6, dy: -6 }, { dx: -6, dy: 6 }, { dx: 6, dy: 6 }]
  if (total === 2) return offsets2[index] || { dx: 0, dy: 0 }
  if (total === 3) return offsets3[index] || { dx: 0, dy: 0 }
  return offsets4[index] || { dx: 0, dy: 0 }
}
