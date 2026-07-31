// Pure Tic-Tac-Toe logic — no React, no side effects

// Slot 1 = X, Slot 2 = O
export const SYMBOLS = { 1: 'X', 2: 'O' }
export const PLAYER_LABELS = { 1: 'X', 2: 'O' }
export const PLAYER_COLORS = { 1: '#4d8bff', 2: '#ff4d6d' }

export const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // columns
  [0, 4, 8], [2, 4, 6],            // diagonals
]

export function createInitialState() {
  return {
    board: Array(9).fill(null),
    currentPlayer: 1,
    winner: null,  // 1 | 2 | 'draw' | null
    winLine: null, // array of 3 indices, or null
  }
}

export function getNextPlayer(player) {
  return player === 1 ? 2 : 1
}

// Returns { winner, line } when the game is decided, else null.
// winner is a player slot (1 | 2) or 'draw'.
export function getResult(board) {
  for (const line of WIN_LINES) {
    const [a, b, c] = line
    if (board[a] != null && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], line }
    }
  }
  if (board.every((cell) => cell != null)) {
    return { winner: 'draw', line: null }
  }
  return null
}

// Returns a new board with the mark placed, or null if the move is illegal.
export function applyMove(board, index, player) {
  if (index < 0 || index > 8) return null
  if (board[index] != null) return null
  const next = board.slice()
  next[index] = player
  return next
}

// Simple, unbeatable-ish AI helper (optional single-player use). Returns an index.
export function bestMove(board, player) {
  const opp = getNextPlayer(player)
  const empty = board.map((c, i) => (c == null ? i : -1)).filter((i) => i >= 0)
  // 1. Win if possible
  for (const i of empty) {
    const b = applyMove(board, i, player)
    if (b && getResult(b)?.winner === player) return i
  }
  // 2. Block opponent's win
  for (const i of empty) {
    const b = applyMove(board, i, opp)
    if (b && getResult(b)?.winner === opp) return i
  }
  // 3. Prefer center, then corners, then edges
  const order = [4, 0, 2, 6, 8, 1, 3, 5, 7]
  for (const i of order) if (board[i] == null) return i
  return empty[0]
}
