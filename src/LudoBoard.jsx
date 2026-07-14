import { useMemo } from 'react'
import {
  TRACK, HOME_STRETCHES, YARD_POSITIONS, SAFE_POSITIONS,
  PLAYER_COLORS, START_OFFSETS, toSvgXY, toAbsoluteTrackIndex,
  getTokenCoords, getYardCoords, getStackOffset, getActivePlayers,
} from './ludoLogic'

const CELL_SIZE = 40

// Yard background rectangles (6x6 area in each corner)
const YARD_RECTS = {
  1: { x: 0, y: 360, w: 240, h: 240 },   // Green: bottom-left
  2: { x: 0, y: 0, w: 240, h: 240 },     // Yellow: top-left
  3: { x: 360, y: 0, w: 240, h: 240 },   // Blue: top-right
  4: { x: 360, y: 360, w: 240, h: 240 }, // Red: bottom-right
}

// Inner yard circle positions (where tokens rest)
const YARD_INNER = {
  1: { cx: 120, cy: 480, r: 70 },
  2: { cx: 120, cy: 120, r: 70 },
  3: { cx: 480, cy: 120, r: 70 },
  4: { cx: 480, cy: 480, r: 70 },
}

export default function LudoBoard({
  pieces, playerCount, validMoves = [], selectedToken, onTokenClick,
  currentTurn, dice, animating,
}) {
  const activePlayers = useMemo(() => getActivePlayers(playerCount), [playerCount])

  // Build set of valid destination positions for highlighting
  const validDestinations = useMemo(() => {
    if (selectedToken == null) return new Set()
    const dests = new Set()
    for (const m of validMoves) {
      if (m.tokenIdx === selectedToken) {
        dests.add(`${currentTurn}:${m.to}`)
      }
    }
    return dests
  }, [validMoves, selectedToken, currentTurn])

  // Build map of movable token indices
  const movableTokens = useMemo(() => {
    const s = new Set()
    for (const m of validMoves) s.add(m.tokenIdx)
    return s
  }, [validMoves])

  // Collect all tokens with their screen positions for rendering
  const tokenElements = useMemo(() => {
    const elements = []
    if (!pieces) return elements

    // Group tokens by their screen position for stacking
    const positionMap = {}

    for (const player of activePlayers) {
      const playerPieces = pieces[player]
      if (!playerPieces) continue

      for (let ti = 0; ti < 4; ti++) {
        const pos = playerPieces[ti]
        let coords
        let key

        if (pos === -1) {
          const yc = getYardCoords(player, ti)
          coords = toSvgXY(yc.row, yc.col)
          key = `yard-${player}-${ti}`
        } else if (pos === 58) {
          coords = toSvgXY(7, 7)
          key = `home-${player}-${ti}`
        } else {
          const tc = getTokenCoords(player, pos)
          if (!tc) continue
          coords = toSvgXY(tc.row, tc.col)
          key = `track-${player}-${pos}`
        }

        const posKey = `${Math.round(coords.x)},${Math.round(coords.y)}`
        if (!positionMap[posKey]) positionMap[posKey] = []
        positionMap[posKey].push({ player, tokenIdx: ti, pos, coords, key })
      }
    }

    // Render with stacking offsets
    for (const group of Object.values(positionMap)) {
      for (let i = 0; i < group.length; i++) {
        const { player, tokenIdx, pos, coords, key } = group[i]
        const offset = getStackOffset(i, group.length)
        const isMovable = player === currentTurn && movableTokens.has(tokenIdx)
        const isSelected = player === currentTurn && selectedToken === tokenIdx

        elements.push({
          key,
          player,
          tokenIdx,
          pos,
          x: coords.x + offset.dx,
          y: coords.y + offset.dy,
          isMovable,
          isSelected,
        })
      }
    }

    return elements
  }, [pieces, activePlayers, currentTurn, movableTokens, selectedToken])

  return (
    <svg viewBox="0 0 600 600" className="ludo-board-svg">
      {/* Background */}
      <rect x="0" y="0" width="600" height="600" rx="16" fill="var(--bg-2)" />

      {/* Yard backgrounds */}
      {activePlayers.map((p) => {
        const r = YARD_RECTS[p]
        return (
          <rect key={`yard-bg-${p}`} x={r.x} y={r.y} width={r.w} height={r.h}
            rx="12" fill={PLAYER_COLORS[p]} opacity="0.12" />
        )
      })}

      {/* Yard inner circles */}
      {activePlayers.map((p) => {
        const c = YARD_INNER[p]
        return (
          <circle key={`yard-inner-${p}`} cx={c.cx} cy={c.cy} r={c.r}
            fill="var(--bg-2)" stroke={PLAYER_COLORS[p]} strokeWidth="2" opacity="0.5" />
        )
      })}

      {/* Track cells (52) */}
      {TRACK.map((cell, i) => {
        const { x, y } = toSvgXY(cell[0], cell[1])
        const isStart = [0, 13, 26, 39].includes(i)
        const isSafe = SAFE_POSITIONS.has(i)
        let fill = 'var(--cell)'
        let strokeColor = '#3a4380'

        if (isStart) {
          const startPlayer = { 0: 1, 13: 2, 26: 3, 39: 4 }[i]
          fill = PLAYER_COLORS[startPlayer]
          strokeColor = PLAYER_COLORS[startPlayer]
        }

        return (
          <g key={`track-${i}`}>
            <rect
              x={x - 17} y={y - 17} width={34} height={34}
              rx="5" fill={fill} stroke={strokeColor} strokeWidth="1"
              opacity={isStart ? 0.35 : 1}
            />
            {isSafe && !isStart && (
              <text x={x} y={y + 1} textAnchor="middle" dominantBaseline="central"
                fontSize="14" fill="var(--muted)" opacity="0.5">
                &#9733;
              </text>
            )}
            {isStart && (
              <text x={x} y={y + 1} textAnchor="middle" dominantBaseline="central"
                fontSize="10" fill={PLAYER_COLORS[{ 0: 1, 13: 2, 26: 3, 39: 4 }[i]]}
                fontWeight="700" opacity="0.8">
                S
              </text>
            )}
          </g>
        )
      })}

      {/* Home stretch cells */}
      {activePlayers.map((p) => {
        const stretch = HOME_STRETCHES[p]
        return stretch.map((cell, i) => {
          const { x, y } = toSvgXY(cell[0], cell[1])
          return (
            <rect key={`hs-${p}-${i}`}
              x={x - 17} y={y - 17} width={34} height={34}
              rx="5" fill={PLAYER_COLORS[p]} opacity="0.25"
              stroke={PLAYER_COLORS[p]} strokeWidth="1"
            />
          )
        })
      })}

      {/* Center home (circle with colored quarters) */}
      <circle cx="300" cy="300" r="24" fill="var(--bg-2)" stroke="#3a4380" strokeWidth="2" />
      {activePlayers.map((p, i) => {
        const angles = activePlayers.length === 4
          ? [[-90, 0], [0, 90], [90, 180], [180, 270]]
          : activePlayers.length === 3
            ? [[-90, 30], [30, 150], [150, 270]]
            : [[-90, 90], [90, 270]]
        const [startAngle, endAngle] = angles[i]
        const r = 22
        const startRad = (startAngle * Math.PI) / 180
        const endRad = (endAngle * Math.PI) / 180
        const x1 = 300 + r * Math.cos(startRad)
        const y1 = 300 + r * Math.sin(startRad)
        const x2 = 300 + r * Math.cos(endRad)
        const y2 = 300 + r * Math.sin(endRad)
        const largeArc = endAngle - startAngle > 180 ? 1 : 0
        return (
          <path key={`center-${p}`}
            d={`M300,300 L${x1},${y1} A${r},${r} 0 ${largeArc},1 ${x2},${y2} Z`}
            fill={PLAYER_COLORS[p]} opacity="0.4"
          />
        )
      })}

      {/* Valid move destination highlights */}
      {selectedToken != null && validMoves
        .filter((m) => m.tokenIdx === selectedToken)
        .map((m) => {
          let coords
          if (m.to === 58) {
            coords = toSvgXY(7, 7)
          } else if (m.to >= 52) {
            const stretch = HOME_STRETCHES[currentTurn]
            const cell = stretch[m.to - 52]
            coords = toSvgXY(cell[0], cell[1])
          } else {
            const tc = getTokenCoords(currentTurn, m.to)
            if (!tc) return null
            coords = toSvgXY(tc.row, tc.col)
          }
          return (
            <circle key={`dest-${m.tokenIdx}-${m.to}`}
              cx={coords.x} cy={coords.y} r="16"
              fill="none" stroke={PLAYER_COLORS[currentTurn]}
              strokeWidth="3" className="ludo-valid-dest"
              onClick={() => onTokenClick(m.tokenIdx, m)}
              style={{ cursor: 'pointer' }}
            />
          )
        })
      }

      {/* Token circles */}
      {tokenElements.map((t) => (
        <g key={t.key}
          className={`ludo-token-group ${t.isMovable ? 'movable' : ''} ${t.isSelected ? 'selected' : ''}`}
          onClick={t.isMovable ? () => onTokenClick(t.tokenIdx) : undefined}
          style={t.isMovable ? { cursor: 'pointer' } : undefined}
        >
          <circle
            cx={t.x} cy={t.y} r={t.isSelected ? 14 : 12}
            fill={PLAYER_COLORS[t.player]}
            stroke={t.isSelected ? '#fff' : 'rgba(0,0,0,0.3)'}
            strokeWidth={t.isSelected ? 3 : 2}
            className={`ludo-token ${t.isMovable ? 'ludo-token-movable' : ''} ${t.isSelected ? 'ludo-token-selected' : ''}`}
          />
          {t.isMovable && !t.isSelected && (
            <circle cx={t.x} cy={t.y} r="15"
              fill="none" stroke={PLAYER_COLORS[t.player]}
              strokeWidth="2" className="ludo-token-pulse"
            />
          )}
          <circle cx={t.x} cy={t.y} r="5"
            fill="rgba(255,255,255,0.4)" />
        </g>
      ))}
    </svg>
  )
}
