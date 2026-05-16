/* ===== Balloon Pop — app.js ===== */
'use strict';

// ─── Constants ───────────────────────────────────────────────────────────────
const BALLOON_COLORS = [
  '#FF6B6B', '#FF8E53', '#FFCC02', '#6BCB77',
  '#4DABF7', '#CC5DE8', '#FF8787', '#63E6BE',
  '#FFA94D', '#A9E34B'
];

const LABEL_SETS = {
  letters: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
  numbers: Array.from({ length: 20 }, (_, i) => String(i + 1)),
  colors:  ['RED','BLUE','GREEN','YELLOW','PINK','PURPLE','ORANGE','WHITE'],
  free:    ['🌟','🦋','🐸','🌈','🍭','🚀','🌸','⚡','🎵','🍎','🐬','🦄']
};

const LIVES_MAX = 3;
const HEART = '❤️';
const BROKEN_HEART = '🖤';

// ─── State ────────────────────────────────────────────────────────────────────
let mode = 'letters';
let score = 0;
let level = 1;
let lives = LIVES_MAX;
let balloons = [];        // active balloon elements + metadata
let animFrameId = null;
let lastSpawn = 0;
let paused = false;
let gameRunning = false;
let highScores = {};      // { mode: bestScore }
let labelQueue = [];      // shuffled labels for current set
let popCount = 0;         // pops since last level-up

// ─── Audio ────────────────────────────────────────────────────────────────────
let audioCtx = null;
function getAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function playPop(colorIndex) {
  try {
    const ctx = getAudio();
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    gain.connect(ctx.destination);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const freq = 300 + (colorIndex % BALLOON_COLORS.length) * 40;
    osc.frequency.setValueAtTime(freq * 2, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.5, ctx.currentTime + 0.12);
    osc.connect(gain);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);

    // small crackle
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.05, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.15;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.3, ctx.currentTime);
    g2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
    src.connect(g2);
    g2.connect(ctx.destination);
    src.start();
  } catch (_) { /* audio blocked — silently skip */ }
}

function playMiss() {
  try {
    const ctx = getAudio();
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    gain.connect(ctx.destination);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(200, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.3);
    osc.connect(gain);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch (_) {}
}

function playLevelUp() {
  try {
    const ctx = getAudio();
    [523, 659, 784, 1047].forEach((freq, i) => {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.3, ctx.currentTime + i * 0.12);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.2);
      g.connect(ctx.destination);
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq;
      o.connect(g);
      o.start(ctx.currentTime + i * 0.12);
      o.stop(ctx.currentTime + i * 0.12 + 0.2);
    });
  } catch (_) {}
}

// ─── Burst Particles ──────────────────────────────────────────────────────────
const burstCanvas = document.getElementById('burst-canvas');
const burstCtx = burstCanvas.getContext('2d');
let particles = [];

function resizeBurst() {
  burstCanvas.width  = window.innerWidth;
  burstCanvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeBurst);
resizeBurst();

function spawnParticles(x, y, color) {
  for (let i = 0; i < 22; i++) {
    const angle = (Math.PI * 2 * i) / 22 + Math.random() * 0.3;
    const speed = 3 + Math.random() * 6;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 2,
      r: 4 + Math.random() * 6,
      color,
      life: 1,
      decay: 0.03 + Math.random() * 0.04
    });
  }
}

function drawParticles() {
  burstCtx.clearRect(0, 0, burstCanvas.width, burstCanvas.height);
  particles = particles.filter(p => p.life > 0);
  for (const p of particles) {
    burstCtx.globalAlpha = p.life;
    burstCtx.fillStyle = p.color;
    burstCtx.beginPath();
    burstCtx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
    burstCtx.fill();
    p.x  += p.vx;
    p.y  += p.vy;
    p.vy += 0.25; // gravity
    p.life -= p.decay;
  }
  burstCtx.globalAlpha = 1;
}

// ─── Score popup ─────────────────────────────────────────────────────────────
function showScorePopup(x, y, points) {
  const el = document.createElement('div');
  el.className = 'score-popup';
  el.textContent = `+${points}`;
  el.style.left = `${x}px`;
  el.style.top  = `${y}px`;
  document.body.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

// ─── Label helpers ────────────────────────────────────────────────────────────
function refillQueue() {
  const set = [...(LABEL_SETS[mode] || LABEL_SETS.free)];
  // Fisher-Yates shuffle
  for (let i = set.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [set[i], set[j]] = [set[j], set[i]];
  }
  labelQueue = set;
}

function nextLabel() {
  if (!labelQueue.length) refillQueue();
  return labelQueue.pop();
}

// ─── Level config ─────────────────────────────────────────────────────────────
function levelConfig() {
  return {
    spawnInterval: Math.max(600, 2000 - (level - 1) * 180), // ms between balloons
    speedMin:      60 + (level - 1) * 8,   // px/s
    speedMax:      130 + (level - 1) * 12,
    maxBalloons:   Math.min(4 + level, 10),
    sizeMin:       60,
    sizeMax:       100,
    popsPerLevel:  8 + level * 2
  };
}

// ─── Balloon DOM ──────────────────────────────────────────────────────────────
function createBalloonEl(label, colorIndex, size) {
  const color = BALLOON_COLORS[colorIndex];
  const wrap = document.createElement('div');
  wrap.className = 'balloon';
  wrap.style.setProperty('--size', `${size}px`);
  wrap.style.setProperty('--color', color);

  wrap.innerHTML = `
    <div class="balloon-body">
      <span class="balloon-label">${label}</span>
    </div>
    <div class="balloon-knot"></div>
    <div class="balloon-string"></div>
  `;
  return wrap;
}

// ─── Spawn Balloon ────────────────────────────────────────────────────────────
function spawnBalloon() {
  const cfg    = levelConfig();
  const size   = cfg.sizeMin + Math.random() * (cfg.sizeMax - cfg.sizeMin);
  const colorI = Math.floor(Math.random() * BALLOON_COLORS.length);
  const label  = nextLabel();
  const speed  = cfg.speedMin + Math.random() * (cfg.speedMax - cfg.speedMin);
  const area   = document.getElementById('game-area');
  const areaW  = area.clientWidth;

  const el = createBalloonEl(label, colorI, size);
  const x  = size / 2 + Math.random() * (areaW - size);
  const totalHeight = size * 1.2 + 10 + size * 0.6; // body + knot + string
  const startY = area.clientHeight + totalHeight;

  el.style.left   = `${x - size / 2}px`;
  el.style.bottom = `-${totalHeight}px`;
  el.style.width  = `${size}px`;

  area.appendChild(el);

  const meta = {
    el,
    x,
    y: startY,         // current y from top of area (increasing = off screen)
    speed,
    size,
    colorI,
    label,
    color: BALLOON_COLORS[colorI],
    popped: false,
    missed: false,
    totalHeight
  };

  el.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (!gameRunning || paused || meta.popped) return;
    popBalloon(meta, e.clientX, e.clientY);
  });

  balloons.push(meta);
}

// ─── Pop Balloon ─────────────────────────────────────────────────────────────
function popBalloon(meta, cx, cy) {
  meta.popped = true;
  playPop(meta.colorI);

  const rect = meta.el.getBoundingClientRect();
  const px = rect.left + rect.width / 2;
  const py = rect.top  + rect.height * 0.4;
  spawnParticles(px, py, meta.color);

  // points: bigger balloon = less points (easier target), faster = more points
  const cfg = levelConfig();
  const sizeBonus  = Math.round((cfg.sizeMax - meta.size) / 4);
  const speedBonus = Math.round((meta.speed - cfg.speedMin) / 8);
  const points = 10 + sizeBonus + speedBonus;

  score += points;
  popCount++;
  document.getElementById('score').textContent = score;
  showScorePopup(cx, cy - 30, points);
  showLabel(meta.label);

  meta.el.remove();

  // level up?
  if (popCount >= levelConfig().popsPerLevel) {
    popCount = 0;
    level++;
    document.getElementById('level').textContent = level;
    playLevelUp();
  }
}

// ─── Miss Balloon ─────────────────────────────────────────────────────────────
function missBalloon(meta) {
  if (meta.missed || meta.popped) return;
  meta.missed = true;
  lives--;
  playMiss();
  updateLivesDisplay();
  meta.el.remove();

  if (lives <= 0) {
    endGame();
  }
}

function updateLivesDisplay() {
  let s = '';
  for (let i = 0; i < LIVES_MAX; i++) {
    s += i < lives ? HEART : BROKEN_HEART;
  }
  document.getElementById('lives').textContent = s;
}

// ─── Label display ────────────────────────────────────────────────────────────
let labelTimer = null;
function showLabel(text) {
  const el = document.getElementById('label-display');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(labelTimer);
  labelTimer = setTimeout(() => el.classList.remove('show'), 1200);
}

// ─── Game Loop ────────────────────────────────────────────────────────────────
function gameLoop(timestamp) {
  if (!gameRunning) return;
  if (paused) { animFrameId = requestAnimationFrame(gameLoop); return; }

  const area = document.getElementById('game-area');
  const areaH = area.clientHeight;
  const cfg = levelConfig();

  // Spawn
  if (timestamp - lastSpawn > cfg.spawnInterval &&
      balloons.filter(b => !b.popped && !b.missed).length < cfg.maxBalloons) {
    spawnBalloon();
    lastSpawn = timestamp;
  }

  // Move balloons upward
  const dt = 1 / 60; // approximate
  for (const meta of balloons) {
    if (meta.popped || meta.missed) continue;

    meta.y -= meta.speed * dt;
    const bottomPx = areaH - meta.y;
    meta.el.style.bottom = `${bottomPx}px`;

    // Off screen at top?
    if (meta.y + meta.totalHeight < 0) {
      missBalloon(meta);
    }
  }

  // Prune finished balloons
  balloons = balloons.filter(b => !b.popped && !b.missed);

  drawParticles();
  animFrameId = requestAnimationFrame(gameLoop);
}

// ─── Start / End Game ────────────────────────────────────────────────────────
function startGame(selectedMode) {
  mode  = selectedMode;
  score = 0;
  level = 1;
  lives = LIVES_MAX;
  popCount = 0;
  paused = false;
  balloons = [];
  particles = [];
  lastSpawn = 0;
  labelQueue = [];
  refillQueue();

  document.getElementById('score').textContent = '0';
  document.getElementById('level').textContent = '1';
  updateLivesDisplay();
  document.getElementById('game-area').innerHTML = '';

  showScreen('game-screen');
  gameRunning = true;
  animFrameId = requestAnimationFrame(gameLoop);
}

function endGame() {
  gameRunning = false;
  cancelAnimationFrame(animFrameId);
  balloons.forEach(b => { if (b.el.parentNode) b.el.remove(); });
  balloons = [];

  // high score
  const prev = highScores[mode] || 0;
  if (score > prev) {
    highScores[mode] = score;
    try { localStorage.setItem('bp_highscores', JSON.stringify(highScores)); } catch (_) {}
  }

  document.getElementById('final-score').textContent = score;
  document.getElementById('high-score').textContent = highScores[mode] || 0;
  showScreen('gameover-screen');
}

// ─── Screen helpers ───────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.toggle('active', s.id === id);
    if (s.id === 'pause-screen') s.classList.remove('active');
  });
}

function showOverlay(id) {
  document.getElementById(id).classList.add('active');
}
function hideOverlay(id) {
  document.getElementById(id).classList.remove('active');
}

// ─── Buttons ──────────────────────────────────────────────────────────────────
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => startGame(btn.dataset.mode));
});

document.getElementById('pause-btn').addEventListener('click', () => {
  paused = true;
  showOverlay('pause-screen');
});

document.getElementById('resume-btn').addEventListener('click', () => {
  paused = false;
  hideOverlay('pause-screen');
});

document.getElementById('quit-btn').addEventListener('click', () => {
  gameRunning = false;
  cancelAnimationFrame(animFrameId);
  balloons.forEach(b => { if (b.el.parentNode) b.el.remove(); });
  balloons = [];
  hideOverlay('pause-screen');
  showScreen('start-screen');
});

document.getElementById('play-again-btn').addEventListener('click', () => startGame(mode));
document.getElementById('home-btn').addEventListener('click', () => showScreen('start-screen'));

// ─── Load persisted high scores ──────────────────────────────────────────────
try {
  const saved = JSON.parse(localStorage.getItem('bp_highscores') || '{}');
  if (saved && typeof saved === 'object') highScores = saved;
} catch (_) {}

// ─── Service Worker ───────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  });
}
