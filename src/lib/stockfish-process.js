/**
 * Stockfish child process wrapper for Pawnify
 * Uses /usr/games/stockfish directly
 */
const { spawn } = require('child_process');

class StockfishProcess {
  constructor() {
    this.proc = null;
    this.ready = false;
    this._queue = [];
    this._outputBuffer = '';
    this._currentCallback = null;
  }

  start(depth = 15, skill = 15, callback) {
    try {
      this.proc = spawn('/usr/games/stockfish', [], {
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch(e) {
      return callback(e);
    }

    this.proc.stdout.on('data', (data) => {
      this._outputBuffer += data.toString();
      const lines = this._outputBuffer.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (trimmed === 'readyok') {
          this.ready = true;
        } else if (trimmed === 'uciok') {
          this.ready = true;
        } else if (trimmed.startsWith('bestmove')) {
          if (this._currentCallback) {
            const parts = trimmed.split(/\s+/);
            const bestMove = parts[1];
            const ponder = parts[3] || '';
            this._currentCallback(null, bestMove, ponder);
            this._currentCallback = null;
          }
          this._outputBuffer = '';
          break;
        }
      }
      // Keep buffer for next line
      const lastNewline = this._outputBuffer.lastIndexOf('\n');
      if (lastNewline >= 0) {
        this._outputBuffer = this._outputBuffer.substring(lastNewline + 1);
      }
    });

    this.proc.stderr.on('data', () => {}); // ignore stderr

    this.proc.on('error', (e) => { if (callback) callback(e); });

    // Wait for ready
    setTimeout(() => {
      this.ready = true;
      callback(null, this);
    }, 500);
  }

  cmd(cmd) {
    if (!this.proc || !this.proc.stdin) return;
    this.proc.stdin.write(cmd + '\n');
  }

  getBestMove(fen, depth, callback) {
    if (!this.ready || !this.proc) return callback(new Error('Not ready'));
    this._currentCallback = callback;
    this.cmd(fen ? `position fen ${fen}` : 'position startpos');
    this.cmd(`go depth ${depth}`);
    // Timeout
    setTimeout(() => {
      if (this._currentCallback === callback) {
        this._currentCallback(new Error('Timeout'));
        this._currentCallback = null;
        this.cmd('stop');
      }
    }, 10000);
  }

  quit() {
    if (this.proc) {
      try { this.cmd('quit'); } catch(e) {}
      try { this.proc.kill(); } catch(e) {}
      this.proc = null;
      this.ready = false;
    }
  }
}

module.exports = StockfishProcess;