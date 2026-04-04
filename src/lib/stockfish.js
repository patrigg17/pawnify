/**
 * Pawnify AI — Stockfish wrapper using child process
 * More reliable than WASM in Node.js environments
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Find Stockfish binary
function findStockfish() {
  // Try the WASM-based binary in node_modules
  const wasmPath = path.join(__dirname, '..', '..', 'node_modules', 'stockfish', 'bin', 'stockfish-18-lite-single.js');
  if (fs.existsSync(wasmPath)) return wasmPath;

  // Try system stockfish
  const systemPath = '/usr/games/stockfish';
  if (fs.existsSync(systemPath)) return systemPath;

  return null;
}

class StockfishAI {
  constructor(options = {}) {
    this.depth = options.depth || 15;
    this.skill = options.skill || 20;
    this._process = null;
    this._ready = false;
    this._pending = null;
    this._buffer = '';
  }

  init(callback) {
    const binary = findStockfish();
    if (!binary) return callback(new Error('Stockfish not found'));

    const isWasm = binary.endsWith('.js');
    const isPython = binary.includes('stockfish.py') || binary.endsWith('.py');

    // Use Python wrapper for better stdin/stdout in Node.js
    // Check if stockfish python is available
    const pythonPath = path.join(__dirname, '..', '..', 'bin', 'stockfish.py');
    const usePython = fs.existsSync(pythonPath) || isPython;

    // For JS WASM: run via node directly
    const args = isWasm ? [binary] : [];
    const cmd = isWasm ? 'node' : (usePython ? 'python3' : binary);

    try {
      this._process = spawn(cmd, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, STOCKFISH_BOARD_WIDTH: '8', STOCKFISH_BOARD_HEIGHT: '8' }
      });
    } catch(e) {
      return callback(e);
    }

    this._process.stdout.on('data', (data) => {
      this._buffer += data.toString();
      this._processBuffer();
    });

    this._process.stderr.on('data', (data) => {
      // Ignore stderr from stockfish
    });

    this._process.on('error', (e) => {
      if (this._pending) this._pending.callback(e);
      this._ready = false;
    });

    this._process.on('close', () => {
      this._ready = false;
    });

    // Wait for ready
    const readyCheck = setInterval(() => {
      if (this._ready) {
        clearInterval(readyCheck);
        callback(null, this);
      }
    }, 100);

    // Initialize UCI
    this._send('uci');
    this._send('isready');
    this._send('setoption name MultiPV value 1');
    this._send('setoption name Skill Level value ' + this.skill);

    setTimeout(() => { clearInterval(readyCheck); callback(new Error('Stockfish init timeout')); }, 5000);
  }

  _send(cmd) {
    if (this._process && this._process.stdin) {
      this._process.stdin.write(cmd + '\n');
    }
  }

  _processBuffer() {
    const lines = this._buffer.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Check if it's a UCI output line
      if (trimmed.startsWith('readyok')) {
        this._ready = true;
      } else if (trimmed.startsWith('bestmove')) {
        const parts = trimmed.split(/\s+/);
        const bestMove = parts[1];
        const ponder = parts[3] || null;

        if (this._pending) {
          this._pending.type === 'bestmove'
            ? this._pending.callback(null, bestMove, ponder)
            : this._pending.callback(null, 0, bestMove);
          this._pending = null;
        }
        this._buffer = '';
        break;
      } else if (trimmed.startsWith('info') && trimmed.includes('score cp') && this._pending && this._pending.type === 'eval') {
        // Extract score from info line
        const m = trimmed.match(/score cp (-?\d+)/);
        if (m) this._pending.score = parseInt(m[1]);
      }
    }
  }

  /**
   * Get best move from position
   * @param {string|null} fen - FEN or null for startpos
   * @param {number} depth
   * @param {function} callback - (err, bestMove, ponder) => void
   */
  getBestMove(fen, depth, callback) {
    if (!this._ready) return callback(new Error('Engine not ready'));

    this._pending = { type: 'bestmove', callback };
    this._send(fen ? `position fen ${fen}` : 'position startpos');
    this._send(`go depth ${depth || this.depth}`);

    setTimeout(() => {
      if (this._pending && this._pending.type === 'bestmove') {
        this._pending.callback(new Error('Stockfish timed out'));
        this._pending = null;
        this._send('stop');
      }
    }, 12000);
  }

  /**
   * Evaluate position (centipawns)
   * @param {string} fen
   * @param {function} callback - (err, score) => void
   */
  evaluate(fen, callback) {
    if (!this._ready) return callback(new Error('Engine not ready'));

    this._pending = { type: 'eval', callback, score: 0 };
    this._send(fen ? `position fen ${fen}` : 'position startpos');
    this._send('go depth 12');

    setTimeout(() => {
      if (this._pending && this._pending.type === 'eval') {
        this._pending.callback(null, this._pending.score);
        this._pending = null;
        this._send('stop');
      }
    }, 8000);
  }

  quit() {
    if (this._process) {
      try { this._send('quit'); } catch(e) {}
      try { this._process.kill(); } catch(e) {}
      this._process = null;
      this._ready = false;
    }
  }
}

module.exports = StockfishAI;