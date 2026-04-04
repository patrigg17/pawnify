#!/usr/bin/env python3
"""Stockfish Python wrapper — provides clean UCI interface for Node.js"""
import subprocess
import sys

def main():
    proc = subprocess.Popen(
        ['stockfish'],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        bufsize=0,
        text=True
    )

    while True:
        try:
            line = sys.stdin.readline()
            if not line:
                break
            cmd = line.strip()
            if not cmd:
                continue

            proc.stdin.write(cmd + '\n')
            proc.stdin.flush()

            # Read all available output until next command or block
            while True:
                import select
                r, _, _ = select.select([proc.stdout], [], [], 0.1)
                if not r:
                    break
                out = proc.stdout.readline()
                if out:
                    sys.stdout.write(out)
                    sys.stdout.flush()
                    if out.strip() == 'uciok' or out.strip() == 'readyok' or out.strip().startswith('bestmove'):
                        break
        except KeyboardInterrupt:
            break
        except Exception as e:
            sys.stderr.write(str(e) + '\n')
            break

    try:
        proc.stdin.write('quit\n')
        proc.stdin.flush()
    except:
        pass
    proc.terminate()

if __name__ == '__main__':
    main()