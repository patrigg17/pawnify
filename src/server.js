require('dotenv').config();
const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');

// ── App Setup ─────────────────────────────────────────────────────────────────
const app = express();
const http = require('http');
const PORT = process.env.PORT || 4002;
const JWT_SECRET = process.env.JWT_SECRET || uuidv4();
const DB_PATH = path.join(__dirname, '..', 'db', 'pawnify.db');

// ── DB Init ────────────────────────────────────────────────────────────────────
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    elo INTEGER DEFAULT 1200,
    avatar TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id TEXT UNIQUE NOT NULL,
    white_id INTEGER REFERENCES users(id),
    black_id INTEGER REFERENCES users(id),
    fen TEXT DEFAULT 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    status TEXT DEFAULT 'waiting', -- waiting | active | finished | abandoned
    winner TEXT DEFAULT '', -- white | black | draw | ''
    time_control TEXT DEFAULT 'rapid',
    moves TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS game_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user_id INTEGER REFERENCES users(id),
    to_user_id INTEGER REFERENCES users(id),
    time_control TEXT DEFAULT 'rapid',
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS friends (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    friend_id INTEGER REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_games_game_id ON games(game_id);
  CREATE INDEX IF NOT EXISTS idx_games_white ON games(white_id);
  CREATE INDEX IF NOT EXISTS idx_games_black ON games(black_id);
`);

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// DEBUG: log all requests
app.use((req, res, next) => { console.log(`📩 ${req.method} ${req.url}`); next(); });

// ── Auth ───────────────────────────────────────────────────────────────────────
function signToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' });
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const { userId } = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, username, email, elo, avatar FROM users WHERE id=?').get(userId);
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────
app.set('views', path.join(__dirname, '..', 'views'));
app.set('view engine', 'ejs');

// Home
app.get('/', (req, res) => {
  const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
  let user = null;
  if (token) {
    try { const { userId } = jwt.verify(token, JWT_SECRET); user = db.prepare('SELECT id,username,elo,avatar FROM users WHERE id=?').get(userId); } catch(e) {}
  }
  res.render('index', { user });
});

// Auth
app.post('/api/auth/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) return res.status(400).json({ error: 'All fields required' });
  if (username.length < 3 || username.length > 20) return res.status(400).json({ error: 'Username 3-20 chars' });
  if (password.length < 6) return res.status(400).json({ error: 'Password min 6 chars' });
  const existing = db.prepare('SELECT id FROM users WHERE username=? OR email=?').get(username, email);
  if (existing) return res.status(409).json({ error: 'Username or email already taken' });
  const hash = await bcrypt.hash(password, 12);
  const result = db.prepare('INSERT INTO users (username, email, password_hash) VALUES (?,?,?)').run(username, email, hash);
  const token = signToken(result.lastInsertRowid);
  const user = db.prepare('SELECT id, username, email, elo, avatar FROM users WHERE id=?').get(result.lastInsertRowid);
  res.json({ token, user });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = signToken(user.id);
  res.json({ token, user: { id: user.id, username: user.username, email: user.email, elo: user.elo, avatar: user.avatar } });
});

// Profile
app.get('/api/user/me', authMiddleware, (req, res) => {
  const user = db.prepare(`
    SELECT u.id, u.username, u.email, u.elo, u.avatar, u.created_at,
      (SELECT COUNT(*) FROM games WHERE (white_id=u.id OR black_id=u.id) AND status='finished') as total_games,
      (SELECT COUNT(*) FROM games WHERE winner='white' AND white_id=u.id) +
      (SELECT COUNT(*) FROM games WHERE winner='black' AND black_id=u.id) as wins,
      (SELECT COUNT(*) FROM games WHERE (white_id=u.id OR black_id=u.id) AND winner='draw') as draws
    FROM users u WHERE u.id=?
  `).get(req.user.id);
  res.json(user);
});

app.get('/api/user/:id', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT id, username, elo, avatar, created_at FROM users WHERE id=?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const stats = db.prepare(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN (white_id=? AND winner='white') OR (black_id=? AND winner='black') THEN 1 ELSE 0 END) as wins,
      SUM(CASE WHEN winner='draw' THEN 1 ELSE 0 END) as draws
    FROM games WHERE (white_id=? OR black_id=?) AND status='finished'
  `).get(req.user.id, req.user.id, req.user.id, req.user.id);
  res.json({ ...user, ...stats });
});

// Leaderboard
app.get('/api/leaderboard', authMiddleware, (req, res) => {
  const users = db.prepare(`
    SELECT id, username, elo, avatar,
      (SELECT COUNT(*) FROM games WHERE (white_id=users.id OR black_id=users.id) AND status='finished') as games_played
    FROM users
    ORDER BY elo DESC
    LIMIT 50
  `).all();
  res.json(users);
});

// ── Stockfish AI ──────────────────────────────────────────────────────────────
let stockfish = null;

function initStockfish() {
  try {
    const StockfishProcess = require('./lib/stockfish-process');
    stockfish = new StockfishProcess();
    stockfish.start(18, 20, (err) => {
      if (err) { console.warn('[pawnify] Stockfish no disponible (fallback random):', err.message); stockfish = null; return; }
      console.log('[pawnify] ✅ Stockfish AI ready');
    });
  } catch(e) {
    console.warn('[pawnify] Stockfish no disponible:', e.message);
    stockfish = null;
  }
}

initStockfish();

function getAIMove(fen, callback) {
  if (!stockfish || !stockfish.ready) {
    // Fallback: random legal move
    const Chess = require('chess.js').Chess;
    const c = new Chess(fen);
    const moves = c.moves();
    return callback(null, moves[Math.floor(Math.random() * moves.length)]);
  }
  stockfish.getBestMove(fen, 18, callback);
}

// ── Chess Game Routes ─────────────────────────────────────────────────────────

// Create game (play vs AI or vs player)
app.post('/api/games', authMiddleware, (req, res) => {
  const { timeControl, vs } = req.body; // vs: 'ai' or 'player'
  const gameId = uuidv4().slice(0, 12);
  const status = vs === 'ai' ? 'ai' : 'waiting';

  const result = db.prepare(
    'INSERT INTO games (game_id, white_id, status, time_control, fen) VALUES (?,?,?,?,?)'
  ).run(gameId, req.user.id, status, timeControl || 'rapid', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');

  res.json({ id: result.lastInsertRowid, gameId, fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', status });
});

// Join waiting game
app.post('/api/games/join', authMiddleware, (req, res) => {
  const game = db.prepare("SELECT * FROM games WHERE status='waiting' AND time_control=? AND id!=? ORDER BY RANDOM() LIMIT 1")
    .get(req.body.timeControl || 'rapid', req.user.id);
  if (!game) return res.status(404).json({ error: 'No games available' });
  db.prepare("UPDATE games SET black_id=?, status='active', updated_at=datetime('now') WHERE id=?")
    .run(req.user.id, game.id);
  res.json({ id: game.id, gameId: game.game_id, fen: game.fen, status: 'active' });
});

// Get game state
app.get('/api/games/:gameId', authMiddleware, (req, res) => {
  const game = db.prepare('SELECT * FROM games WHERE game_id=?').get(req.params.gameId);
  if (!game) return res.status(404).json({ error: 'Game not found' });
  const moves = JSON.parse(game.moves || '[]');
  res.json({ ...game, moves });
});

// Make move
app.post('/api/games/:gameId/move', authMiddleware, (req, res) => {
  const { from, to, promotion } = req.body;
  const game = db.prepare('SELECT * FROM games WHERE game_id=?').get(req.params.gameId);
  if (!game) return res.status(404).json({ error: 'Game not found' });
  const moves = JSON.parse(game.moves || '[]');
  moves.push({ from, to, promotion, by: req.user.id, at: new Date().toISOString() });
  db.prepare('UPDATE games SET moves=?, updated_at=datetime("now", "+02:00") WHERE game_id=?')
    .run(JSON.stringify(moves), req.params.gameId);
  res.json({ ok: true, moves });
});

// AI endpoint — client polls for AI move after submitting their move
app.get('/api/games/:gameId/ai-move', authMiddleware, (req, res) => {
  const game = db.prepare('SELECT * FROM games WHERE game_id=?').get(req.params.gameId);
  if (!game) return res.status(404).json({ error: 'Game not found' });

  getAIMove(game.fen, (err, aiMove) => {
    if (err || !aiMove) return res.status(500).json({ error: 'AI failed to respond' });
    res.json({ move: aiMove });
  });
});

// ── Socket.IO ─────────────────────────────────────────────────────────────────
const httpServer = http.createServer(app);
const io = new Server(httpServer);
httpServer.listen(PORT, () => {
  console.log(`🏁 Pawnify running on port ${PORT}`);
});

io.on('connection', (socket) => {
  const token = socket.handshake.auth?.token;
  if (!token) return;
  try {
    const { userId } = jwt.verify(token, JWT_SECRET);
    socket.userId = userId;
    const user = db.prepare('SELECT id, username, elo FROM users WHERE id=?').get(userId);
    socket.user = user;
    socket.join('user_' + userId);
    console.log(`[pawnify] ${user.username} connected`);
  } catch(e) { socket.disconnect(); return; }

  socket.on('game:join', (gameId) => {
    socket.join('game_' + gameId);
    console.log(`[pawnify] ${socket.user.username} joined game ${gameId}`);
  });

  socket.on('game:move', ({ gameId, from, to, promotion }) => {
    // Validate and apply move
    const game = db.prepare('SELECT * FROM games WHERE game_id=?').get(gameId);
    if (!game) return;
    const moves = JSON.parse(game.moves || '[]');
    moves.push({ from, to, promotion, by: socket.user.id, at: new Date().toISOString() });
    // TODO: use chess.js to update FEN properly
    db.prepare('UPDATE games SET moves=?, updated_at=datetime("now","+02:00") WHERE game_id=?')
      .run(JSON.stringify(moves), gameId);
    io.to('game_' + gameId).emit('game:move', { from, to, promotion, by: socket.user.id });
  });

  socket.on('disconnect', () => {
    if (socket.user) console.log(`[pawnify] ${socket.user.username} disconnected`);
  });
});

console.log('✅ Pawnify server ready');
module.exports = app;
