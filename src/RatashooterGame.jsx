import { useState, useRef, useEffect, useCallback } from 'react'
import { useSounds } from './useSounds'
import './ratashooter.css'

// Word pool grouped loosely by length; higher levels unlock longer words.
const WORDS = [
  'cat', 'rat', 'dog', 'run', 'hat', 'map', 'sun', 'box', 'fox', 'cup', 'pen', 'key', 'owl', 'bee',
  'ant', 'cow', 'pig', 'bat', 'jam', 'log', 'net', 'paw', 'sky', 'toy', 'van', 'web', 'zip', 'bun',
  'jump', 'moon', 'star', 'ship', 'game', 'fast', 'word', 'type', 'dash', 'gold', 'wave', 'rock',
  'fire', 'leaf', 'wolf', 'bear', 'frog', 'duck', 'crab', 'mint', 'lime', 'bolt', 'gear', 'kite',
  'quiz', 'jazz', 'buzz', 'glow', 'snap', 'grip', 'vault',
  'mouse', 'cheese', 'chase', 'squeak', 'attack', 'shield', 'rocket', 'planet', 'dragon', 'castle',
  'jungle', 'wizard', 'shadow', 'thrust', 'pixel', 'laser', 'blast', 'swift', 'brave', 'quick',
  'ninja', 'tiger', 'eagle', 'storm', 'flame', 'crown', 'ghost', 'sword', 'armor', 'quest',
  'typing', 'combat', 'sprint', 'target', 'strike', 'defend', 'legend', 'mighty', 'frenzy',
  'keyboard', 'champion', 'velocity', 'accuracy', 'reaction', 'overload', 'squadron', 'invasion',
  'critical', 'firewall', 'skirmish', 'ambush', 'onslaught', 'vengeance', 'juggernaut', 'catapult',
]

const LANES = [10, 25, 40, 55, 70] // top % positions
const BASE_X = 9                    // rats breach when x <= this (%)
const START_X = 100
const BULLET_TIME = 0.09            // seconds for a tracer to reach its target
const LEVEL_COUNT = 10
const MAX_STARS = LEVEL_COUNT * 3

function getLevelConfig(level) {
  return {
    level,
    total: 6 + level * 2,                     // rats to clear: 8, 10, ... 26
    speed: 4.5 + level * 1.25,                // base rat speed (%/s)
    spawnMs: Math.max(620, 1950 - level * 130), // ms between spawns
    maxLen: Math.min(11, 3 + level),          // longest word allowed
  }
}

function pickWord(maxLen) {
  const pool = WORDS.filter((w) => w.length >= 3 && w.length <= maxLen)
  return pool[Math.floor(Math.random() * pool.length)]
}

function loadProgress() {
  try {
    const raw = JSON.parse(localStorage.getItem('ratashooter_progress'))
    if (raw && raw.stars) return { unlocked: raw.unlocked || 1, stars: raw.stars }
  } catch {}
  return { unlocked: 1, stars: {} }
}
function saveProgress(p) {
  try { localStorage.setItem('ratashooter_progress', JSON.stringify(p)) } catch {}
}

export default function RatashooterGame({ onBack }) {
  const [screen, setScreen] = useState('select') // select | playing | clear | over
  const [, setFrame] = useState(0)
  const [levelNum, setLevelNum] = useState(1)
  const [score, setScore] = useState(0)
  const [lives, setLives] = useState(3)
  const [wpm, setWpm] = useState(0)
  const [killed, setKilled] = useState(0)
  const [starsEarned, setStarsEarned] = useState(0)
  const [progress, setProgress] = useState(loadProgress)
  const [missFlash, setMissFlash] = useState(false)
  const [fireKey, setFireKey] = useState(0)

  const { playCapture, playNotify, playBingo, muted, toggleMute } = useSounds()

  // Mutable game state (refs avoid stale closures in the rAF loop)
  const rats = useRef([])
  const bullets = useRef([])
  const targetId = useRef(null)
  const nextId = useRef(1)
  const bulletId = useRef(1)
  const levelRef = useRef(getLevelConfig(1))
  const livesRef = useRef(3)
  const scoreRef = useRef(0)
  const killedRef = useRef(0)
  const spawnedRef = useRef(0)
  const correctChars = useRef(0)
  const errorChars = useRef(0)
  const startTime = useRef(0)
  const spawnAcc = useRef(0)
  const running = useRef(false)
  const rafRef = useRef(null)
  const lastTime = useRef(0)
  const inputRef = useRef(null)

  const ratSpeed = () => levelRef.current.speed * (0.82 + Math.random() * 0.36)

  const spawnRat = useCallback(() => {
    rats.current.push({
      id: nextId.current++,
      word: pickWord(levelRef.current.maxLen),
      typed: 0,
      x: START_X,
      y: LANES[Math.floor(Math.random() * LANES.length)],
      speed: ratSpeed(),
      dead: false,
      boomUntil: 0,
    })
  }, [])

  const stopLoop = () => {
    running.current = false
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
  }

  const completeLevel = useCallback(() => {
    stopLoop()
    const lv = levelRef.current.level
    const stars = Math.max(1, livesRef.current) // 1..3 (lives left)
    setStarsEarned(stars)
    setProgress((prev) => {
      const next = {
        unlocked: Math.max(prev.unlocked, Math.min(LEVEL_COUNT, lv + 1)),
        stars: { ...prev.stars, [lv]: Math.max(prev.stars[lv] || 0, stars) },
      }
      saveProgress(next)
      return next
    })
    playBingo()
    setScreen('clear')
  }, [playBingo])

  const failLevel = useCallback(() => {
    stopLoop()
    setScreen('over')
  }, [])

  const tick = useCallback((now) => {
    if (!running.current) return
    const dt = Math.min(0.05, (now - lastTime.current) / 1000)
    lastTime.current = now
    const lv = levelRef.current

    // Spawn until the whole wave is out
    spawnAcc.current += dt * 1000
    if (spawnedRef.current < lv.total && spawnAcc.current >= lv.spawnMs) {
      spawnAcc.current = 0
      spawnRat()
      spawnedRef.current++
    }

    // Move + breaches
    let breaches = 0
    for (const r of rats.current) {
      if (r.dead) continue
      r.x -= r.speed * dt
      if (r.x <= BASE_X) {
        r.dead = true
        r.boomUntil = now + 250
        if (targetId.current === r.id) targetId.current = null
        breaches++
      }
    }
    if (breaches > 0) {
      livesRef.current = Math.max(0, livesRef.current - breaches)
      setLives(livesRef.current)
      playNotify()
      if (livesRef.current <= 0) { setFrame((f) => f + 1); failLevel(); return }
    }

    // Advance tracers
    for (const b of bullets.current) b.p += dt / BULLET_TIME
    bullets.current = bullets.current.filter((b) => b.p < 1)

    // Cleanup
    rats.current = rats.current.filter((r) => (r.dead ? now < r.boomUntil : r.x > -12))

    // Live WPM
    const mins = (now - startTime.current) / 60000
    if (mins > 0) setWpm(Math.round((correctChars.current / 5) / mins))

    // Wave cleared?
    if (spawnedRef.current >= lv.total && rats.current.filter((r) => !r.dead).length === 0) {
      setFrame((f) => f + 1)
      completeLevel()
      return
    }

    setFrame((f) => f + 1)
    rafRef.current = requestAnimationFrame(tick)
  }, [spawnRat, completeLevel, failLevel, playNotify])

  const startLevel = useCallback((level) => {
    levelRef.current = getLevelConfig(level)
    rats.current = []
    bullets.current = []
    targetId.current = null
    nextId.current = 1
    bulletId.current = 1
    livesRef.current = 3
    scoreRef.current = 0
    killedRef.current = 0
    spawnedRef.current = 0
    correctChars.current = 0
    errorChars.current = 0
    spawnAcc.current = 0
    setLevelNum(level)
    setScore(0); setLives(3); setWpm(0); setKilled(0)
    setScreen('playing')
    const now = performance.now()
    startTime.current = now
    lastTime.current = now
    running.current = true
    setTimeout(() => inputRef.current?.focus(), 0)
    rafRef.current = requestAnimationFrame(tick)
  }, [tick])

  const handleChar = useCallback((raw) => {
    if (!running.current) return
    const ch = raw.toLowerCase()
    if (ch < 'a' || ch > 'z') return

    const live = rats.current.filter((r) => !r.dead)
    let target = targetId.current != null ? live.find((r) => r.id === targetId.current) : null

    if (!target) {
      const candidates = live.filter((r) => r.word[0] === ch).sort((a, b) => a.x - b.x)
      if (candidates.length === 0) {
        errorChars.current++
        setMissFlash(true); setTimeout(() => setMissFlash(false), 120)
        return
      }
      target = candidates[0]
      targetId.current = target.id
      target.typed = 1
      correctChars.current++
    } else {
      if (ch === target.word[target.typed]) {
        target.typed++
        correctChars.current++
      } else {
        errorChars.current++
        setMissFlash(true); setTimeout(() => setMissFlash(false), 120)
        return
      }
    }

    // Fire a laser tracer from the turret toward the target rat
    bullets.current.push({ id: bulletId.current++, sx: BASE_X + 1.5, sy: 50, tx: target.x, ty: target.y, p: 0 })
    setFireKey((k) => k + 1)

    // Word complete -> destroy
    if (target.typed >= target.word.length) {
      target.dead = true
      target.boomUntil = performance.now() + 260
      targetId.current = null
      killedRef.current++
      setKilled(killedRef.current)
      scoreRef.current += 10 + target.word.length * 5
      setScore(scoreRef.current)
      playCapture()
    }
    setFrame((f) => f + 1)
  }, [playCapture])

  const onInput = (e) => {
    const v = e.target.value
    for (const ch of v) handleChar(ch)
    e.target.value = ''
  }

  useEffect(() => { if (screen === 'playing') inputRef.current?.focus() }, [screen])
  useEffect(() => () => stopLoop(), [])

  const refocus = () => { if (screen === 'playing') inputRef.current?.focus() }

  const accuracy = (() => {
    const total = correctChars.current + errorChars.current
    return total === 0 ? 100 : Math.round((correctChars.current / total) * 100)
  })()

  const totalStars = Object.values(progress.stars).reduce((a, b) => a + b, 0)

  const targetRat = rats.current.find((r) => r.id === targetId.current && !r.dead)
  const aim = targetRat ? Math.max(-58, Math.min(58, (targetRat.y - 50) * 0.95)) : 0

  const Stars = ({ n }) => (
    <span className="rs-stars">
      {[1, 2, 3].map((i) => <span key={i} className={`rs-star ${i <= n ? 'on' : ''}`}>{'★'}</span>)}
    </span>
  )

  // ---- Level select ----
  if (screen === 'select') {
    return (
      <div className="rs-container">
        <header className="header">
          <button className="back-to-games" onClick={onBack}>&larr; Back to Games</button>
          <h1 className="title rs-title">RATASHOOTER</h1>
          <p className="subtitle">Clear each wave by typing the rats' words. Pick a level:</p>
        </header>
        <div className="rs-star-total">{'⭐'} {totalStars} / {MAX_STARS} stars</div>
        <div className="rs-level-grid">
          {Array.from({ length: LEVEL_COUNT }).map((_, i) => {
            const lv = i + 1
            const locked = lv > progress.unlocked
            const st = progress.stars[lv] || 0
            return (
              <button key={lv}
                className={`rs-level-tile ${locked ? 'locked' : ''} ${st > 0 ? 'done' : ''}`}
                onClick={() => !locked && startLevel(lv)}
                disabled={locked}>
                <span className="rs-level-num">{locked ? '\u{1F512}' : lv}</span>
                {!locked && <Stars n={st} />}
                {!locked && <span className="rs-level-goal">{getLevelConfig(lv).total} rats</span>}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  // ---- Playing / clear / over ----
  const lv = levelRef.current
  const pct = Math.min(100, Math.round((killed / lv.total) * 100))

  return (
    <div className="rs-container">
      <header className="header header-compact">
        <button className="back-to-games" onClick={() => { stopLoop(); setScreen('select') }}>&larr; Levels</button>
        <h1 className="title title-small rs-title">LEVEL {levelNum}</h1>
      </header>

      <div className="rs-hud">
        <div className="rs-lives" aria-label={`${lives} lives`}>
          {Array.from({ length: 3 }).map((_, i) => (
            <span key={i} className={`rs-heart ${i < lives ? '' : 'lost'}`}>{'❤️'}</span>
          ))}
        </div>
        <div className="rs-progress" title={`${killed}/${lv.total} rats`}>
          <div className="rs-progress-fill" style={{ width: `${pct}%` }} />
          <span className="rs-progress-label">{killed}/{lv.total}</span>
        </div>
        <div className="rs-stat"><span className="rs-stat-label">Score</span><span className="rs-stat-val">{score}</span></div>
        <div className="rs-stat"><span className="rs-stat-label">WPM</span><span className="rs-stat-val">{wpm}</span></div>
        <button className="mute-btn" onClick={toggleMute} title={muted ? 'Unmute' : 'Mute'}>
          {muted ? '\u{1F507}' : '\u{1F50A}'}
        </button>
      </div>

      <div className={`rs-field ${missFlash ? 'miss' : ''}`} onClick={refocus}>
        <div className="rs-defense-line" style={{ left: `${BASE_X}%` }} />
        <span className="rs-cheese">{'\u{1F9C0}'}</span>

        <div className="rs-turret" style={{ left: `${BASE_X}%` }}>
          <div className="rs-turret-glow" />
          <div className="rs-turret-pivot" style={{ transform: `rotate(${aim}deg)` }}>
            <div className="rs-turret-barrel" />
            {screen === 'playing' && <span key={fireKey} className="rs-muzzle" />}
          </div>
          <div className="rs-turret-base" />
        </div>

        {screen === 'playing' && bullets.current.map((b) => {
          const x = b.sx + (b.tx - b.sx) * b.p
          const y = b.sy + (b.ty - b.sy) * b.p
          return <span key={b.id} className="rs-bullet" style={{ left: `${x}%`, top: `${y}%` }} />
        })}

        {screen === 'playing' && rats.current.map((r) => {
          if (r.dead) {
            return (
              <div key={r.id} className="rs-rat boom" style={{ left: `${r.x}%`, top: `${r.y}%` }}>
                <span className="rs-boom">{'\u{1F4A5}'}</span>
              </div>
            )
          }
          const isTarget = r.id === targetId.current
          return (
            <div key={r.id} className={`rs-rat ${isTarget ? 'target' : ''}`} style={{ left: `${r.x}%`, top: `${r.y}%` }}>
              <span className="rs-word">
                <span className="rs-typed">{r.word.slice(0, r.typed)}</span>
                <span className="rs-rest">{r.word.slice(r.typed)}</span>
              </span>
              <span className="rs-rat-emoji">{'\u{1F400}'}</span>
              {isTarget && <span className="rs-crosshair" />}
            </div>
          )
        })}

        {/* Level cleared */}
        {screen === 'clear' && (
          <div className="rs-overlay">
            <div className="rs-card">
              <div className="rs-card-title">{'\u{1F389}'} Level {levelNum} Clear!</div>
              <div className="rs-earned-stars"><Stars n={starsEarned} /></div>
              <div className="rs-final-stats">
                <span>Score <b>{score}</b></span>
                <span>WPM <b>{wpm}</b></span>
                <span>Accuracy <b>{accuracy}%</b></span>
              </div>
              <div className="rs-card-actions">
                {levelNum < LEVEL_COUNT ? (
                  <button className="new-game" onClick={() => startLevel(levelNum + 1)}>Next Level {'→'}</button>
                ) : (
                  <p className="rs-best-line">{'\u{1F3C6}'} All levels complete — you cleared Ratashooter!</p>
                )}
                <button className="new-game ghost" onClick={() => startLevel(levelNum)}>Replay</button>
                <button className="new-game ghost" onClick={() => setScreen('select')}>Level Map</button>
              </div>
            </div>
          </div>
        )}

        {/* Level failed */}
        {screen === 'over' && (
          <div className="rs-overlay">
            <div className="rs-card">
              <div className="rs-card-title">The rats got the cheese!</div>
              <p className="rs-card-sub">You cleared {killed} of {lv.total} rats on Level {levelNum}.</p>
              <div className="rs-card-actions">
                <button className="new-game" onClick={() => startLevel(levelNum)}>Retry Level</button>
                <button className="new-game ghost" onClick={() => setScreen('select')}>Level Map</button>
              </div>
            </div>
          </div>
        )}

        <input
          ref={inputRef}
          className="rs-input"
          type="text"
          defaultValue=""
          onChange={onInput}
          onBlur={() => { if (screen === 'playing') setTimeout(refocus, 0) }}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          inputMode="text"
          aria-hidden="true"
        />
      </div>

      {screen === 'playing' && (
        <p className="rs-hint">Type a rat's word to blast it. On phone, tap the field if the keyboard hides.</p>
      )}
    </div>
  )
}
