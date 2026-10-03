'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#90caf9', // J - pale blue
  '#ffb74d', // L - orange
  '#a1887f', // N - nut (bronze)
  '#f06292', // comodín (tinte)
  '#757585', // piedra (basura / obstáculos)
];

const WILD = 9;
const STONE = 10;
const FADE_MS = 500;

// Filas inferiores del tablero ('#' = piedra); cada fila deja al menos un hueco
const FIXED_LAYOUT = [
  '..#....#..',
  '.#..##..#.',
  '#...#..#.#',
  '..##..#...',
  '#.#...##..',
  '.#.##...#.',
];

const CHALLENGES = {
  marathon:  { name: 'Maratón',    desc: 'Sin límite: sobrevive y puntúa.' },
  sprint:    { name: 'Sprint 40',  desc: 'Limpia 40 líneas en 2 minutos.', goal: { lines: 40 }, timeLimit: 120000 },
  garbage:   { name: 'Basura',     desc: 'Sobrevive 2 min: sube una fila gris cada 10s.', goal: { survive: 120000 }, garbageEvery: 10000 },
  fixed:     { name: 'Obstáculos', desc: 'Elimina todos los bloques grises.', goal: { clearStones: true }, layout: FIXED_LAYOUT },
  invisible: { name: 'Invisible',  desc: 'Las piezas se esconden al fijarse. 20 líneas.', goal: { lines: 20 }, invisible: true },
  reverse:   { name: 'Al revés',   desc: 'Desde el nivel 6 los controles se invierten. 30 líneas.', goal: { lines: 30 }, startLevel: 5, reverseFrom: 6 },
};
const POWERUP_EVERY = 5;
const FREEZE_MS = 5000;
const STATUS_MS = 1500;

const POWERUPS = {
  bomb:    { icon: '💣', color: '#ef5350', name: 'Bomba' },
  ray:     { icon: '⚡', color: '#fdd835', name: 'Rayo' },
  tint:    { icon: '🎨', color: '#ab47bc', name: 'Tinte' },
  gravity: { icon: '⬇', color: '#66bb6a', name: 'Gravedad' },
  freeze:  { icon: '❄', color: '#4fc3f7', name: 'Congelar' },
};
const POWERUP_KINDS = Object.keys(POWERUPS);

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
  [[8,8,8],[8,0,8],[8,8,8]],                  // N (tuerca)
];

const THEMES = {
  dark:  { grid: '#22222e', highlight: 'rgba(255,255,255,0.12)' },
  light: { grid: '#e1e3ee', highlight: 'rgba(255,255,255,0.35)' },
};

const LINE_SCORES = [0, 100, 300, 500, 800];
const TSPIN_SCORES = [400, 800, 1200, 1600];
const PC_SCORES = [0, 800, 1200, 1800, 2000];
const B2B_MULT = 1.5;
const COMBO_MAX = 10;
const POPUP_MS = 1200;
const TSPIN_NAMES = ['T-SPIN', 'T-SPIN SINGLE', 'T-SPIN DOUBLE', 'T-SPIN TRIPLE'];

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const themeToggle = document.getElementById('theme-toggle');
const powerStatusEl = document.getElementById('power-status');
const comboEl = document.getElementById('combo');
const b2bEl = document.getElementById('b2b');
const soundToggle = document.getElementById('sound-toggle');
const menuEl = document.getElementById('menu');
const menuListEl = document.getElementById('menu-list');
const menuBtn = document.getElementById('menu-btn');
const goalSection = document.getElementById('goal-section');
const goalTextEl = document.getElementById('goal-text');
const goalTimerEl = document.getElementById('goal-timer');
const reverseBadge = document.getElementById('reverse-badge');

let currentTheme = 'dark';
let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let pendingPowerups, freezeMs, statusMsg, statusMs;
let combo, b2bReady, lastRotate, popups, shownCombo;
let modeKey = 'marathon', challenge = CHALLENGES.marathon;
let menuOpen = true, won = false;
let elapsedMs, garbageMs, fadeCells, fadeMs, reversed;
let muted = false;
let audioCtx = null;

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * (PIECES.length - 1)) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function randomPowerup(kind) {
  const power = kind || POWERUP_KINDS[Math.floor(Math.random() * POWERUP_KINDS.length)];
  return { power, shape: [[1]], x: Math.floor(COLS / 2), y: 0 };
}

function setStatus(msg) {
  statusMsg = msg;
  statusMs = STATUS_MS;
  renderStatus();
}

function renderStatus() {
  let text = '';
  if (freezeMs > 0) text = `❄ Congelado ${(freezeMs / 1000).toFixed(1)}s`;
  else if (statusMs > 0) text = statusMsg;
  if (powerStatusEl.textContent !== text) powerStatusEl.textContent = text;
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function rotateCCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[cols - 1 - c][r] = shape[r][c];
  return result;
}

function tryRotate(dir = 1) {
  if (current.power) return;
  const rotated = dir < 0 ? rotateCCW(current.shape) : rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      lastRotate = true;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearFullRows() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  return cleared;
}

// Cada columna cae: los bloques se apilan abajo sin huecos
function compactBoard() {
  for (let c = 0; c < COLS; c++) {
    const col = [];
    for (let r = ROWS - 1; r >= 0; r--) if (board[r][c]) col.push(board[r][c]);
    for (let r = ROWS - 1, i = 0; r >= 0; r--, i++) board[r][c] = col[i] || 0;
  }
}

function explodeWilds() {
  let n = 0;
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (board[r][c] === WILD) { board[r][c] = 0; n++; }
  return n;
}

// T-spin: pieza T, último movimiento fue una rotación y >=3 esquinas del centro ocupadas
function isTSpin() {
  if (current.power || current.type !== 3 || !lastRotate) return false;
  const cx = current.x + 1, cy = current.y + 1;
  let filled = 0;
  for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const x = cx + dx, y = cy + dy;
    if (x < 0 || x >= COLS || y >= ROWS || (y >= 0 && board[y][x])) filled++;
  }
  return filled >= 3;
}

function speedFor(lvl) {
  return Math.max(100, 1000 - (lvl - 1) * 90);
}

function comboColor(c) {
  return c >= 8 ? '#ff5252' : c >= 5 ? '#ff9800' : c >= 3 ? '#ffd54f' : '#7aa2f7';
}

function clearLines(tspin, neutral) {
  let cleared = 0, first = 0, lineScore = 0, wildScore = 0;
  let n;
  while ((n = clearFullRows()) > 0) {
    if (!cleared) first = n;
    cleared += n;
    lineScore += LINE_SCORES[Math.min(n, 4)] || 0;
    const wilds = explodeWilds();
    if (wilds) {
      wildScore += wilds * 50 * level;
      compactBoard();
      setStatus(`★ Comodines x${wilds}`);
    }
  }

  if (!cleared) {
    if (tspin) {
      score += TSPIN_SCORES[0] * level;
      addPopup(TSPIN_NAMES[0], '#ba68c8', 22);
      sfx.tspin();
      shake();
    }
    if (!neutral) combo = 0;
    updateHUD();
    return;
  }

  const difficult = tspin || first >= 4;
  if (tspin) lineScore += TSPIN_SCORES[Math.min(first, 3)] - (LINE_SCORES[Math.min(first, 4)] || 0);
  let base = lineScore * level;
  const b2b = difficult && b2bReady;
  if (b2b) base = Math.floor(base * B2B_MULT);
  b2bReady = difficult;
  combo++;
  const mult = Math.min(combo, COMBO_MAX);
  score += base * mult + wildScore;

  const perfect = board.every(row => row.every(v => !v));
  if (perfect) score += PC_SCORES[Math.min(cleared, 4)] * level;

  const prevLines = lines;
  lines += cleared;
  pendingPowerups += Math.floor(lines / POWERUP_EVERY) - Math.floor(prevLines / POWERUP_EVERY);
  level = (challenge.startLevel || 1) + Math.floor(lines / 10);
  dropInterval = speedFor(level);
  if (challenge.reverseFrom && !reversed && level >= challenge.reverseFrom) {
    reversed = true;
    addPopup('¡CONTROLES INVERTIDOS!', '#ff5252', 16);
    sfx.tspin();
    shake();
  }

  // Efectos
  const name = tspin ? TSPIN_NAMES[Math.min(first, 3)] : first >= 4 ? 'TETRIS' : '';
  if (name) addPopup((b2b ? 'B2B ' : '') + name, tspin ? '#ba68c8' : '#4dd0e1', 22);
  if (combo >= 2) addPopup(`COMBO x${mult}`, comboColor(combo), 18 + Math.min(combo, 8));
  if (perfect) addPopup('PERFECT CLEAR!', '#fff176', 24);
  sfx.clear(first);
  if (tspin) sfx.tspin();
  if (b2b) sfx.b2b();
  if (combo >= 2) sfx.combo(combo);
  if (perfect) sfx.perfect();
  if (difficult || perfect) shake();
  updateHUD();
}

// ---- Popups y shake ----
function addPopup(text, color, size) {
  popups.push({ text, color, size, age: 0 });
}

function shake() {
  canvas.classList.remove('shake');
  void canvas.offsetWidth;
  canvas.classList.add('shake');
}

// ---- Sonido (WebAudio sintetizado) ----
function tone(freq, durMs, type = 'sine', delayMs = 0, vol = 0.12) {
  if (muted || !audioCtx) return;
  const t0 = audioCtx.currentTime + delayMs / 1000;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durMs / 1000);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0 + durMs / 1000 + 0.02);
}

const sfx = {
  clear(n) {
    const f = [330, 392, 440, 523, 659][Math.min(n, 4)];
    tone(f, 140, 'triangle');
  },
  combo(c) {
    tone(440 * Math.pow(2, Math.min(c, 12) / 12), 160, 'square', 80, 0.08);
  },
  tspin() {
    if (muted || !audioCtx) return;
    const t0 = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(200, t0);
    osc.frequency.exponentialRampToValueAtTime(800, t0 + 0.25);
    gain.gain.setValueAtTime(0.08, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.32);
  },
  b2b() {
    tone(587, 120, 'sawtooth', 120, 0.07);
    tone(880, 180, 'sawtooth', 240, 0.07);
  },
  perfect() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 220, 'triangle', 150 + i * 90, 0.12));
  },
};

function ensureAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { audioCtx = new AC(); } catch (e) { return; }
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function setMuted(value, persist = true) {
  muted = !!value;
  soundToggle.setAttribute('aria-checked', String(!muted));
  soundToggle.setAttribute('aria-label', muted ? 'Activar sonido' : 'Silenciar');
  soundToggle.textContent = muted ? '🔇' : '🔊';
  if (persist) {
    try { localStorage.setItem('muted', muted ? '1' : '0'); } catch (e) {}
  }
}

function mostFrequentColor() {
  const counts = {};
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const v = board[r][c];
      if (v && v !== WILD && v !== STONE) counts[v] = (counts[v] || 0) + 1;
    }
  let best = 0, bestN = 0;
  for (const k in counts) if (counts[k] > bestN) { best = +k; bestN = counts[k]; }
  return best;
}

function applyPowerup(piece) {
  const px = piece.x, py = piece.y;
  const info = POWERUPS[piece.power];
  switch (piece.power) {
    case 'bomb': {
      let destroyed = 0;
      for (let r = Math.max(0, py - 1); r <= Math.min(ROWS - 1, py + 1); r++)
        for (let c = Math.max(0, px - 1); c <= Math.min(COLS - 1, px + 1); c++)
          if (board[r][c]) { board[r][c] = 0; destroyed++; }
      score += destroyed * 10 * level;
      break;
    }
    case 'ray':
      for (let r = 0; r < ROWS; r++) board[r][px] = 0;
      board.splice(py, 1);
      board.unshift(new Array(COLS).fill(0));
      score += 100 * level;
      break;
    case 'tint': {
      const below = py + 1 < ROWS ? board[py + 1][px] : 0;
      const target = below && below !== WILD && below !== STONE ? below : mostFrequentColor();
      if (target)
        for (let r = 0; r < ROWS; r++)
          for (let c = 0; c < COLS; c++)
            if (board[r][c] === target) board[r][c] = WILD;
      break;
    }
    case 'gravity':
      compactBoard();
      break;
    case 'freeze':
      freezeMs = FREEZE_MS;
      break;
  }
  setStatus(`${info.icon} ${info.name}!`);
  updateHUD();
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  if (gy > current.y) lastRotate = false;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    lastRotate = false;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  let tspin = false;
  const isPower = !!current.power;
  const linesBefore = lines;
  if (isPower) {
    applyPowerup(current);
    fadeCells = [];
  } else {
    tspin = isTSpin();
    if (challenge.invisible) {
      fadeCells = [];
      current.shape.forEach((row, r) => row.forEach((v, c) => {
        if (v) fadeCells.push({ x: current.x + c, y: current.y + r, v });
      }));
      fadeMs = FADE_MS;
    }
    merge();
  }
  clearLines(tspin, isPower);
  if (lines !== linesBefore) fadeCells = [];
  if (checkGoal()) return;
  spawn();
}

function spawn() {
  lastRotate = false;
  current = next;
  next = pendingPowerups > 0 ? (pendingPowerups--, randomPowerup()) : randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame(false, null, true);
  }
  drawNext();
}

// ---- Desafíos ----
function checkGoal() {
  const g = challenge.goal;
  if (!g || gameOver) return false;
  let ok = false;
  if (g.lines) ok = lines >= g.lines;
  else if (g.survive) ok = elapsedMs >= g.survive;
  else if (g.clearStones) ok = countStones() === 0;
  if (ok) {
    endGame(true);
    return true;
  }
  if (challenge.timeLimit && elapsedMs >= challenge.timeLimit) {
    endGame(false, '¡TIEMPO!');
    return true;
  }
  return false;
}

function countStones() {
  let n = 0;
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (board[r][c] === STONE) n++;
  return n;
}

// Sube todo el tablero una fila y agrega una fila de piedra con un hueco
function addGarbageRow() {
  if (board[0].some(v => v)) {
    endGame(false);
    return;
  }
  board.shift();
  const row = new Array(COLS).fill(STONE);
  row[Math.floor(Math.random() * COLS)] = 0;
  board.push(row);
  if (collide(current.shape, current.x, current.y)) {
    current.y--;
    if (collide(current.shape, current.x, current.y)) endGame(false);
  }
}

function loadProgress() {
  try {
    return JSON.parse(localStorage.getItem('challenges')) || {};
  } catch (e) {
    return {};
  }
}

function saveResult() {
  const data = loadProgress();
  const entry = data[modeKey] || {};
  entry.done = true;
  if (challenge.timeLimit) entry.bestMs = Math.min(entry.bestMs ?? Infinity, elapsedMs);
  else entry.bestScore = Math.max(entry.bestScore || 0, score);
  data[modeKey] = entry;
  try { localStorage.setItem('challenges', JSON.stringify(data)); } catch (e) {}
}

function fmtSec(s) {
  s = Math.max(0, s);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

function updateGoal() {
  const g = challenge.goal;
  goalSection.classList.toggle('hidden', !g);
  if (!g) return;
  let text = 'Sobrevive';
  if (g.lines) text = `Líneas ${Math.min(lines, g.lines)}/${g.lines}`;
  else if (g.clearStones) text = `Grises: ${countStones()}`;
  const limit = challenge.timeLimit || g.survive;
  const secs = limit ? Math.ceil((limit - elapsedMs) / 1000) : Math.floor(elapsedMs / 1000);
  setText(goalTextEl, text);
  setText(goalTimerEl, fmtSec(secs));
  reverseBadge.classList.toggle('hidden', !reversed);
}

function showMenu() {
  menuOpen = true;
  cancelAnimationFrame(animId);
  overlay.classList.add('hidden');
  const progress = loadProgress();
  menuListEl.replaceChildren();
  Object.entries(CHALLENGES).forEach(([key, ch]) => {
    const p = progress[key] || {};
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'menu-item' + (p.done ? ' done' : '');
    const name = document.createElement('span');
    name.className = 'menu-name';
    name.textContent = (p.done ? '✓ ' : '') + ch.name;
    const desc = document.createElement('span');
    desc.className = 'menu-desc';
    desc.textContent = ch.desc;
    btn.append(name, desc);
    if (p.done) {
      const best = document.createElement('span');
      best.className = 'menu-best';
      best.textContent = p.bestMs != null
        ? `Mejor: ${fmtSec(Math.ceil(p.bestMs / 1000))}`
        : `Mejor: ${(p.bestScore || 0).toLocaleString()}`;
      btn.append(best);
    }
    btn.addEventListener('click', () => init(key));
    menuListEl.append(btn);
  });
  menuEl.classList.remove('hidden');
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
  comboEl.textContent = combo >= 2 ? `x${Math.min(combo, COMBO_MAX)}` : '–';
  comboEl.classList.toggle('hot', combo >= 5);
  if (combo >= 2 && combo !== shownCombo) {
    comboEl.classList.remove('pulse');
    void comboEl.offsetWidth;
    comboEl.classList.add('pulse');
  }
  shownCombo = combo;
  b2bEl.classList.toggle('hidden', !b2bReady);
  updateGoal();
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = THEMES[currentTheme].highlight;
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  if (colorIndex === WILD) drawIcon(context, x, y, '★', size, '#fff');
  context.globalAlpha = 1;
}

function drawIcon(context, x, y, icon, size, color) {
  context.fillStyle = color;
  context.font = `${Math.floor(size * 0.6)}px system-ui, "Segoe UI Emoji", sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(icon, x * size + size / 2, y * size + size / 2 + 1);
}

function drawPowerBlock(context, x, y, power, size, alpha) {
  const info = POWERUPS[power];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = info.color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  context.fillStyle = THEMES[currentTheme].highlight;
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  drawIcon(context, x, y, info.icon, size, '#fff');
  context.globalAlpha = 1;
}

function drawPiece(context, piece, ox, oy, size, alpha) {
  if (piece.power) {
    drawPowerBlock(context, ox, oy, piece.power, size, alpha);
    return;
  }
  for (let r = 0; r < piece.shape.length; r++)
    for (let c = 0; c < piece.shape[r].length; c++)
      drawBlock(context, ox + c, oy + r, piece.shape[r][c], size, alpha);
}

function drawGrid() {
  ctx.strokeStyle = THEMES[currentTheme].grid;
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board (en modo invisible solo se ve la última pieza, desvaneciéndose)
  const hidden = challenge.invisible && !gameOver;
  if (hidden) {
    if (fadeMs > 0)
      fadeCells.forEach(({ x, y, v }) => {
        if (board[y] && board[y][x]) drawBlock(ctx, x, y, v, BLOCK, fadeMs / FADE_MS);
      });
  } else {
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        drawBlock(ctx, c, r, board[r][c], BLOCK);
  }

  if (current) {
    // ghost
    const gy = ghostY();
    drawPiece(ctx, current, current.x, gy, BLOCK, 0.2);

    // current piece
    drawPiece(ctx, current, current.x, current.y, BLOCK);
  }

  drawPopups();
}

function drawPopups() {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  popups.forEach((p, i) => {
    const t = p.age / POPUP_MS;
    const fade = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
    const y = ROWS * BLOCK * 0.4 + i * 34 - t * 40;
    ctx.globalAlpha = Math.max(0, fade);
    ctx.font = `800 ${p.size}px system-ui, sans-serif`;
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.strokeText(p.text, canvas.width / 2, y);
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, canvas.width / 2, y);
  });
  ctx.globalAlpha = 1;
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  drawPiece(nextCtx, next, offX, offY, NB);
}

function endGame(didWin, title, keepPiece) {
  gameOver = true;
  won = !!didWin;
  cancelAnimationFrame(animId);
  if (!keepPiece) current = null;
  if (won) saveResult();
  overlayTitle.textContent = won ? '¡COMPLETADO!' : (title || 'GAME OVER');
  overlayTitle.classList.toggle('win', won);
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}` +
    (challenge.goal ? ` · Tiempo ${fmtSec(Math.floor(elapsedMs / 1000))}` : '');
  overlay.classList.remove('hidden');
  updateGoal();
  draw();
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    overlay.classList.add('hidden');
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayTitle.classList.remove('win');
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  const tdt = Math.min(dt, 250); // pestaña en segundo plano: no cuenta como tiempo de juego
  const frozen = freezeMs > 0;
  elapsedMs += tdt;
  if (frozen) freezeMs = Math.max(0, freezeMs - dt);
  else dropAccum += dt;
  if (statusMs > 0) statusMs = Math.max(0, statusMs - dt);
  if (fadeMs > 0) fadeMs = Math.max(0, fadeMs - dt);
  if (popups.length) popups = popups.filter(p => (p.age += dt) < POPUP_MS);
  renderStatus();
  if (challenge.garbageEvery && !frozen) {
    garbageMs += tdt;
    if (garbageMs >= challenge.garbageEvery) {
      garbageMs -= challenge.garbageEvery;
      addGarbageRow();
    }
  }
  if (!gameOver) checkGoal();
  if (!gameOver) updateGoal();
  if (gameOver) return;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
      lastRotate = false;
    } else {
      lockPiece();
    }
  }
  draw();
  if (gameOver) return;
  animId = requestAnimationFrame(loop);
}

function init(key = modeKey) {
  modeKey = key;
  challenge = CHALLENGES[key];
  board = createBoard();
  if (challenge.layout) {
    const top = ROWS - challenge.layout.length;
    challenge.layout.forEach((row, i) => {
      for (let c = 0; c < COLS; c++) if (row[c] === '#') board[top + i][c] = STONE;
    });
  }
  score = 0;
  lines = 0;
  level = challenge.startLevel || 1;
  paused = false;
  gameOver = false;
  won = false;
  menuOpen = false;
  menuEl.classList.add('hidden');
  overlayTitle.classList.remove('win');
  elapsedMs = 0;
  garbageMs = 0;
  fadeCells = [];
  fadeMs = 0;
  reversed = !!challenge.reverseFrom && level >= challenge.reverseFrom;
  dropInterval = speedFor(level);
  dropAccum = 0;
  pendingPowerups = 0;
  freezeMs = 0;
  statusMsg = '';
  statusMs = 0;
  combo = 0;
  shownCombo = 0;
  b2bReady = false;
  lastRotate = false;
  popups = [];
  renderStatus();
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  ensureAudio();
  if (e.code === 'KeyM') { setMuted(!muted); return; }
  if (menuOpen) return;
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  const dir = reversed ? -1 : 1; // controles invertidos
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - dir, current.y)) { current.x -= dir; lastRotate = false; }
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + dir, current.y)) { current.x += dir; lastRotate = false; }
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate(dir);
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', () => init(modeKey));
menuBtn.addEventListener('click', showMenu);

function setTheme(name, persist = true) {
  currentTheme = name === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = currentTheme;
  const isLight = currentTheme === 'light';
  themeToggle.setAttribute('aria-checked', String(isLight));
  themeToggle.setAttribute('aria-label', isLight ? 'Modo oscuro' : 'Modo claro');
  themeToggle.textContent = isLight ? '☾' : '☀';
  if (persist) {
    try { localStorage.setItem('theme', currentTheme); } catch (e) {}
  }
  // Redibuja para reflejar el tema aunque el juego esté en pausa o terminado
  if (board) draw();
  if (next) drawNext();
}

themeToggle.addEventListener('click', () => {
  setTheme(currentTheme === 'light' ? 'dark' : 'light');
  themeToggle.blur();
});

soundToggle.addEventListener('click', () => {
  ensureAudio();
  setMuted(!muted);
  soundToggle.blur();
});

let savedTheme = null, savedMuted = null;
try {
  savedTheme = localStorage.getItem('theme');
  savedMuted = localStorage.getItem('muted');
} catch (e) {}
setTheme(savedTheme, false);
setMuted(savedMuted === '1', false);

showMenu();
