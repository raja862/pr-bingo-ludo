// Odd grid sizes only — 6x6 (even) is not allowed.
export const SIZES = [3, 5, 7, 9, 11]
export const DEFAULT_SIZE = 5

// Fisher-Yates shuffle of unique numbers 1..count
export function shuffledNumbers(count) {
  const arr = Array.from({ length: count }, (_, i) => i + 1)
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

// All winnable lines (rows, columns, both diagonals).
export function getLines(size) {
  const lines = []
  for (let r = 0; r < size; r++) {
    const cells = []
    for (let c = 0; c < size; c++) cells.push(r * size + c)
    lines.push(cells)
  }
  for (let c = 0; c < size; c++) {
    const cells = []
    for (let r = 0; r < size; r++) cells.push(r * size + c)
    lines.push(cells)
  }
  const d1 = []
  for (let i = 0; i < size; i++) d1.push(i * size + i)
  lines.push(d1)
  const d2 = []
  for (let i = 0; i < size; i++) d2.push(i * size + (size - 1 - i))
  lines.push(d2)
  return lines
}

// Fisher-Yates shuffle of a word array, returns first `count` items
export function shuffledWords(words, count) {
  const arr = [...words]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr.slice(0, count)
}

// Letters revealed as lines complete. For 5x5 this spells BINGO.
export function progressLetters(size) {
  const word = 'BINGO'
  if (size <= word.length) return word.slice(0, size).split('')
  return Array.from({ length: size }, (_, i) => word[i % word.length])
}
