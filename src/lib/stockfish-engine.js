/**
 * Pawnify AI Engine — Stockfish WASM wrapper for Node.js
 * Handles UCI protocol, best move extraction, and position evaluation
 */

const init = require('stockfish');
const { spawn } = require('child_process');

class StockfishEngine {
  constructor(options = {}) {
    this.depth = options.depth || 15;
    this.skill = options.skill || 20; // 0-20, Stockfish's internal skill
    this.engine = null;
    this.ready = false;
    this._pendingCallback = null;
    this._evaluationCallback = null;
  }

  init(callback) {
    init('./node_modules/stockfish/bin/stockfish-18-lite-single.js', (err, engine) => {
      if (err) return callback(err);
      this.engine = engine;

      // Override sendCommand to capture all UCI output
      const originalSend = engine.sendCommand.bind(engine);
      engine.sendCommand = (cmd) => {
        originalSend(cmd);
        // The module prints UCI output to stdout, which we can capture
        // via the listener mechanism
      };

      // Capture output by intercepting the module's print
      // The wasm module emits messages via its listener
      this._interceptOutput();

      // Initialize UCI
      this._sendRaw('uci');
      this._sendRaw('setoption name MultiPV value 1');
      this._sendRaw('setoption name Skill Level value ' + this.skill);
      this._sendRaw('isready');

      setTimeout(() => {
        this.ready = true;
        callback(null, this);
      }, 800);
    });
  }

  _sendRaw(cmd) {
    this.engine.sendCommand(cmd);
  }

  _interceptOutput() {
    // The module captures output in its internal listener
    // We hook into the engine's internal mechanism
    // Stockfish WASM calls `print` function which calls our listener
    const self = this;
    this.engine.on = function(cb) {
      this._listener = cb;
    };

    // Create a patched print that routes to our listener
    this._sendRaw('uci'); // trigger init
  }

  /**
   * Get the best move for a given FEN position
   * @param {string|null} fen - FEN position (null = startpos)
   * @param {number} depth - search depth
   * @param {function} callback - (err, bestMove: string) => void
   */
  getBestMove(fen, depth, callback) {
    if (!this.ready) return callback(new Error('Engine not ready'));

    const d = depth || this.depth;
    let completed = false;
    const self = this;

    // Set up listener for this specific request
    const listener = (msg) => {
      if (!completed && msg.startsWith('bestmove')) {
        completed = true;
        self.engine._listener = null;
        const parts = msg.trim().split(/\s+/);
        const bestMove = parts[1]; // e.g. "e2e4"
        const ponder = parts[3] || '';
        callback(null, bestMove, ponder);
      }
    };

    this.engine._listener = listener;
    const posCmd = fen ? `position fen ${fen}` : 'position startpos';
    this._sendRaw(posCmd);
    this._sendRaw(`go depth ${d}`);

    // Safety timeout
    setTimeout(() => {
      if (!completed) {
        completed = true;
        self.engine._listener = null;
        callback(new Error('Stockfish timed out'));
      }
    }, 12000);
  }

  /**
   * Evaluate a position and return centipawn score
   * @param {string} fen
   * @param {function} callback - (err, score: number) => void
   */
  evaluate(fen, callback) {
    if (!this.ready) return callback(new Error('Engine not ready'));

    let bestScore = 0;
    let done = false;
    const self = this;

    const listener = (msg) => {
      if (done) return;

      if (msg.includes('score cp')) {
        const m = msg.match(/score cp (-?\d+)/);
        if (m) bestScore = parseInt(m[1]);
      } else if (msg.includes('score mate')) {
        const m = msg.match(/score mate (-?\d+)/);
        if (m) bestScore = parseInt(m[1]) > 0 ? 9999 : -9999;
      }

      if (msg.startsWith('bestmove')) {
        done = true;
        self.engine._listener = null;
        callback(null, bestScore);
      }
    };

    this.engine._listener = listener;
    const posCmd = fen ? `position fen ${fen}` : 'position startpos';
    this._sendRaw(posCmd);
    this._sendRaw('go depth 12');

    setTimeout(() => {
      if (!done) {
        done = true;
        self.engine._listener = null;
        callback(null, bestScore);
      }
    }, 8000);
  }

  /**
   * Close the engine
   */
  quit() {
    if (this.engine) {
      try { this._sendRaw('quit'); } catch(e) {}
      this.engine = null;
      this.ready = false;
    }
  }
}

module.exports = StockfishEngine;