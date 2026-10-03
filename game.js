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
];

const WILD = 9;
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

let currentTheme = 'dark';
let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let pendingPowerups, freezeMs, statusMsg, statusMs;

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

function tryRotate() {
  if (current.power) return;
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
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

function clearLines() {
  let cleared = 0;
  let n;
  while ((n = clearFullRows()) > 0) {
    cleared += n;
    score += (LINE_SCORES[Math.min(n, 4)] || 0) * level;
    const wilds = explodeWilds();
    if (wilds) {
      score += wilds * 50 * level;
      compactBoard();
      setStatus(`★ Comodines x${wilds}`);
    }
  }
  if (cleared) {
    const prevLines = lines;
    lines += cleared;
    pendingPowerups += Math.floor(lines / POWERUP_EVERY) - Math.floor(prevLines / POWERUP_EVERY);
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    updateHUD();
  }
}

function mostFrequentColor() {
  const counts = {};
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const v = board[r][c];
      if (v && v !== WILD) counts[v] = (counts[v] || 0) + 1;
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
      const target = below && below !== WILD ? below : mostFrequentColor();
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
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  if (current.power) applyPowerup(current);
  else merge();
  clearLines();
  spawn();
}

function spawn() {
  current = next;
  next = pendingPowerups > 0 ? (pendingPowerups--, randomPowerup()) : randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
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

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  drawPiece(ctx, current, current.x, gy, BLOCK, 0.2);

  // current piece
  drawPiece(ctx, current, current.x, current.y, BLOCK);
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  drawPiece(nextCtx, next, offX, offY, NB);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  if (freezeMs > 0) freezeMs = Math.max(0, freezeMs - dt);
  else dropAccum += dt;
  if (statusMs > 0) statusMs = Math.max(0, statusMs - dt);
  renderStatus();
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  draw();
  if (gameOver) return;
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  pendingPowerups = 0;
  freezeMs = 0;
  statusMsg = '';
  statusMs = 0;
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
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);

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
  if (board && current) draw();
  if (next) drawNext();
}

themeToggle.addEventListener('click', () => {
  setTheme(currentTheme === 'light' ? 'dark' : 'light');
  themeToggle.blur();
});

let savedTheme = null;
try { savedTheme = localStorage.getItem('theme'); } catch (e) {}
setTheme(savedTheme, false);

init();
