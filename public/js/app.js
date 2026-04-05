/**
 * Pawnify AI Integration
 * On server-side, Stockfish plays the AI moves.
 * Client-side also has chess.js for validation and display.
 */

const API = '/tools/alejandro/api';
let token = localStorage.getItem('pawnify_token');
let currentUser = null;
let currentGame = null;
let currentGameId = null;
let gameMode = 'ai'; // 'ai' or 'player'
let selectedTimeControl = 'rapid';
let aiDepth = 15;
let stockfishReady = false;
let pendingAIMove = null; // AI suggested move — human must enter it manually

// ── Auth ─────────────────────────────────────────────────────────────────────
function showAuth(mode) {
  const modal = document.getElementById('authModal');
  const title = document.getElementById('authTitle');
  const emailRow = document.getElementById('emailRow');
  const btn = document.getElementById('authBtn');
  const switchText = document.getElementById('switchText');
  document.getElementById('authError').style.display = 'none';

  if (mode === 'login') {
    title.textContent = 'Iniciar sesión';
    emailRow.style.display = 'none';
    btn.textContent = 'Entrar';
    switchText.innerHTML = '¿No tienes cuenta? <a onclick="showAuth(\'register\')">Regístrate</a>';
  } else {
    title.textContent = 'Crear cuenta';
    emailRow.style.display = 'none';
    btn.textContent = 'Registrarme';
    switchText.innerHTML = '¿Ya tienes cuenta? <a onclick="showAuth(\'login\')">Inicia sesión</a>';
  }
  modal.classList.add('open');
}

async function handleAuth(e) {
  e.preventDefault();
  const mode = document.getElementById('authTitle').textContent === 'Iniciar sesión' ? 'login' : 'register';
  const user = document.getElementById('authUser').value;
  const pass = document.getElementById('authPass').value;
  const errorEl = document.getElementById('authError');

  const body = mode === 'login'
    ? { username: user, password: pass }
    : { username: user, password: pass };

  try {
    const res = await fetch(`${API}/auth/${mode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) { errorEl.textContent = data.error || 'Error'; errorEl.style.display = 'block'; return; }
    token = data.token;
    currentUser = data.user;
    localStorage.setItem('pawnify_token', token);
    document.getElementById('authModal').classList.remove('open');
    showDashboard(data.user);
  } catch(e) {
    errorEl.textContent = 'Error de conexión';
    errorEl.style.display = 'block';
  }
}

async function logout() {
  token = null; currentUser = null;
  localStorage.removeItem('pawnify_token');
  location.reload();
}

// ── Dashboard ────────────────────────────────────────────────────────────────
async function loadUser() {
  if (!token) return;
  try {
    const res = await fetch(`${API}/user/me`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) { logout(); return; }
    showDashboard(await res.json());
  } catch(e) { logout(); }
}

function showDashboard(user) {
  currentUser = user;
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('dashboard').style.display = 'block';
  document.getElementById('userName').textContent = user.username;
  document.getElementById('userElo').textContent = user.elo || 1200;
  document.getElementById('userAvatar').textContent = user.avatar || '👤';
  document.getElementById('statGames').textContent = user.total_games || 0;
  document.getElementById('statWins').textContent = user.wins || 0;
  document.getElementById('statElo').textContent = user.elo || 1200;
  document.getElementById('statGames2').textContent = user.total_games || 0;
  document.getElementById('statWins2').textContent = user.wins || 0;
  document.getElementById('statElo2').textContent = user.elo || 1200;
}

// ── Game Setup ────────────────────────────────────────────────────────────────
function startGame(mode) {
  gameMode = mode;
  document.getElementById('dashboard').style.display = 'none';
  document.getElementById('setupScreen').classList.add('active');
  document.getElementById('aiDifficulty').style.display = mode === 'ai' ? 'block' : 'none';
}

function selectTC(tc, el) {
  selectedTimeControl = tc;
  document.querySelectorAll('.tc-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
}

function selectDifficulty(depth, el) {
  aiDepth = depth;
  document.querySelectorAll('#aiDifficulty .tc-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
}

async function launchGame() {
  const res = await fetch(`${API}/games`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ vs: gameMode, timeControl: selectedTimeControl })
  });
  const data = await res.json();
  if (!res.ok) { alert(data.error || 'Error'); return; }
  currentGameId = data.gameId;
  currentGame = { fen: data.fen, moves: [], gameId: data.gameId };
  document.getElementById('setupScreen').classList.remove('active');
  document.getElementById('gameScreen').style.display = 'block';
  initBoard(data.fen);
  if (gameMode === 'player') document.getElementById('whitePlayer').textContent = 'Blancas (buscando rival...)';
}

function backToDashboard() {
  document.querySelectorAll('#gameScreen,#setupScreen').forEach(s => s.style.display = 'none');
  document.getElementById('dashboard').style.display = 'block';
}

// ── Chess Board ───────────────────────────────────────────────────────────────
const files = 'abcdefgh';
const ranks = '87654321';

const pieceSymbols = {
  'K':'♔','Q':'♕','R':'♖','B':'♗','N':'♘','P':'♙',
  'k':'♚','q':'♛','r':'♜','b':'♝','n':'♞','p':'♟'
};

let chess = null; // chess.js instance
let selectedSquare = null;
let lastMove = null;
let isMyTurn = true;
let promotionPending = null;

function initBoard(fen) {
  chess = new Chess(fen || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  selectedSquare = null;
  lastMove = null;
  isMyTurn = chess.turn() === 'w';
  document.getElementById('moveList').innerHTML = '';
  document.getElementById('whitePlayer').textContent = gameMode === 'ai' ? '🤖 IA (Negras)' : 'Blancas';
  document.getElementById('blackPlayer').textContent = gameMode === 'ai' ? 'Tú (Blancas)' : 'Negras';
  renderBoard();
}

function renderBoard() {
  const board = document.getElementById('board');
  board.innerHTML = '';

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = files[c] + ranks[r];
      const piece = chess.get(sq);
      const isLight = (r + c) % 2 === 0;
      const inCheck = chess.inCheck() && piece && piece.type === 'k' && piece.color === chess.turn();

      const div = document.createElement('div');
      div.className = 'square ' + (isLight ? 'light' : 'dark');
      if (sq === selectedSquare) div.classList.add('selected');
      if (lastMove && (sq === lastMove.from || sq === lastMove.to)) div.classList.add('last-move');
      if (inCheck) div.classList.add('check');

      if (piece) {
        const span = document.createElement('span');
        span.className = 'piece';
        span.textContent = piece.color === 'w'
          ? pieceSymbols[piece.type]
          : pieceSymbols[piece.type.toLowerCase()];
        if (piece.color === 'b') span.style.color = '#1a1a1a';
        div.appendChild(span);
      }

      // Show legal move hints if square selected
      if (selectedSquare) {
        const moves = chess.moves({ square: selectedSquare, verbose: true });
        const canCapture = moves.some(m => m.to === sq && chess.get(sq));
        const canMoveTo = moves.some(m => m.to === sq && !chess.get(sq));
        if (canMoveTo) div.classList.add('square-hint');
        if (canCapture) div.classList.add('square-capture-hint');
      }

      div.dataset.square = sq;
      div.addEventListener('click', () => onSquareClick(sq));
      board.appendChild(div);
    }
  }

  // Update turn indicator
  const turnEl = document.getElementById('turnIndicator');
  if (turnEl) turnEl.textContent = isMyTurn ? '⬤ Tu turno' : '⏳ Turno del rival';
}

function onSquareClick(sq) {
  if (!chess) return;

  // ── AI SUGGESTED MOVE: human enters the AI's move manually ──
  if (pendingAIMove) {
    if (sq === pendingAIMove.from) {
      selectedSquare = sq;
      renderBoard();
    } else if (sq === pendingAIMove.to && selectedSquare) {
      const from = selectedSquare;
      const to = sq;
      const promo = pendingAIMove.promotion;
      selectedSquare = null;
      pendingAIMove = null;
      clearAIMoveSuggestion();
      // Human enters the AI's move as if playing the rival — same submitMove flow
      submitAIMove(from, to, promo);
    }
    return;
  }

  if (!isMyTurn || !chess) return;

  if (!selectedSquare) {
    // Select piece of current turn
    const piece = chess.get(sq);
    if (piece && piece.color === chess.turn()) {
      selectedSquare = sq;
      renderBoard();
    }
    return;
  }

  if (sq === selectedSquare) {
    selectedSquare = null;
    renderBoard();
    return;
  }

  // Try to make the move
  const moves = chess.moves({ square: selectedSquare, verbose: true });
  const move = moves.find(m => m.to === sq);
  if (!move) {
    // Click on another own piece — select it instead
    const piece = chess.get(sq);
    if (piece && piece.color === chess.turn()) {
      selectedSquare = sq;
      renderBoard();
    } else {
      selectedSquare = null;
      renderBoard();
    }
    return;
  }

  // Promotion?
  if (move.flags.includes('p')) {
    promotionPending = move;
    selectedSquare = sq;
    renderBoard();
    document.getElementById('promoModal').classList.add('open');
    return;
  }

  // Make move
  submitMove(move.from, move.to, 'q');
}

function submitMove(from, to, promotion) {
  if (!currentGameId) return;

  fetch(`${API}/games/${currentGameId}/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ from, to, promotion })
  })
    .then(r => r.json())
    .then(data => {
      if (data.ok) {
        // Apply our move locally
        const result = chess.move({ from, to, promotion });
        lastMove = { from, to };
        selectedSquare = null;
        promotionPending = null;
        document.getElementById('promoModal').classList.remove('open');
        addMoveToList(from + to + (promotion !== 'q' ? promotion : ''));
        renderBoard();

        // If vs AI, fetch AI suggestion (human must enter it manually)
        if (gameMode === 'ai' && chess.turn() === 'b' && !chess.isGameOver()) {
          isMyTurn = false;
          const turnEl = document.getElementById('turnIndicator') || createTurnIndicator();
          turnEl.textContent = '⏳ IA pensando...';
          document.getElementById('board').style.opacity = '0.7';
          setTimeout(() => requestAIMove(), 500);
        }

        // Check game end
        if (chess.isGameOver()) {
          setTimeout(() => showGameEnd(), 500);
        }
      }
    })
    .catch(e => console.error('Move error:', e));
}

// Fetches AI suggestion and displays it — does NOT auto-apply
function requestAIMove() {
  fetch(`${API}/games/${currentGameId}/ai-move`, {
    headers: { Authorization: `Bearer ${token}` }
  })
    .then(r => r.json())
    .then(data => {
      if (data.move) {
        const from = data.move.slice(0, 2);
        const to = data.move.slice(2, 4);
        const promo = data.move.length > 4 ? data.move[4] : 'q';

        pendingAIMove = { from, to, promotion: promo };

        document.getElementById('board').style.opacity = '1';
        const turnEl = document.getElementById('turnIndicator') || createTurnIndicator();
        turnEl.textContent = '🤖 IA sugiere: ' + data.move + ' — haz click en la jugadad del rival';
        showAIMoveSuggestion(from, to);

        if (chess.isGameOver()) setTimeout(() => showGameEnd(), 500);
      }
    })
    .catch(e => {
      console.error('AI move fetch error:', e);
      isMyTurn = true;
      document.getElementById('board').style.opacity = '1';
    });
}

// Submits the AI's move (human entered it manually as the rival)
function submitAIMove(from, to, promotion) {
  fetch(`${API}/games/${currentGameId}/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ from, to, promotion })
  })
    .then(r => r.json())
    .then(data => {
      if (data.ok) {
        const result = chess.move({ from, to, promotion });
        if (result) {
          lastMove = { from, to };
          addMoveToList(from + to + (promotion !== 'q' ? promotion : ''));
        }
        renderBoard();
        isMyTurn = true;
        const turnEl = document.getElementById('turnIndicator') || createTurnIndicator();
        turnEl.textContent = '⬤ Tu turno';

        if (chess.isGameOver()) {
          setTimeout(() => showGameEnd(), 500);
        } else if (gameMode === 'ai' && chess.turn() === 'b' && !chess.isGameOver()) {
          // Next AI turn — request suggestion again
          isMyTurn = false;
          turnEl.textContent = '⏳ IA pensando...';
          document.getElementById('board').style.opacity = '0.7';
          setTimeout(() => requestAIMove(), 500);
        }
      }
    })
    .catch(e => console.error('AI move submit error:', e));
}

function showAIMoveSuggestion(from, to) {
  const squares = document.querySelectorAll('.square');
  squares.forEach(sq => {
    const name = sq.dataset.square;
    if (name === from || name === to) {
      sq.classList.add('ai-suggestion');
    }
  });
}

function clearAIMoveSuggestion() {
  document.querySelectorAll('.square.ai-suggestion').forEach(sq => {
    sq.classList.remove('ai-suggestion');
  });
}

function createTurnIndicator() {
  const el = document.createElement('div');
  el.id = 'turnIndicator';
  el.style.cssText = 'text-align:center;padding:.5rem;font-size:.85rem;font-weight:700;';
  document.querySelector('.board-wrap').appendChild(el);
  return el;
}

function choosePromo(piece) {
  document.getElementById('promoModal').classList.remove('open');
  if (promotionPending) {
    submitMove(promotionPending.from, promotionPending.to, piece);
  }
}

function addMoveToList(moveStr) {
  const list = document.getElementById('moveList');
  const moveNum = Math.ceil(chess.history().length / 2);
  const isWhite = chess.history().length % 2 === 1;
  const span = document.createElement('span');
  span.textContent = (isWhite ? moveNum + '. ' : '') + moveStr + ' ';
  list.appendChild(span);
  list.scrollTop = list.scrollHeight;
}

function showGameEnd() {
  let msg = '';
  if (chess.isCheckmate()) {
    msg = chess.turn() === 'w' ? '🏆 ¡Negras ganan por jaque mate!' : '🏆 ¡Blancas ganan por jaque mate!';
  } else if (chess.isDraw()) {
    msg = '🤝 ¡Empate!';
  } else {
    msg = '🏁 Partida finalizada';
  }
  alert(msg);
}

// Init
loadUser();