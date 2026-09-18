import { existsSync } from 'node:fs';
import http from 'node:http';

/**
 * P3 dual probe for TUI `infraReady{uds_client,ipc}` (PC `tui 9091` line).
 * Boolean gauge semantics: 1 = true/ready, 0 = false/not-ready (NOT unix exit codes).
 * - `ipc`: file existence of `TUI_SHARED_STATE_PATH` (local seam, no dial).
 * - `uds_client`: `existsSync(socket)` fast-fail + active `GET /` over UDS.
 *   Any HTTP status (401/404 from `UdsAdapter` unknown-path guard) proves the
 *   daemon socket is dialable. Never `POST` (no ingestor side effect).
 */

const probeAgent = new http.Agent({ keepAlive: false });

export function probeIpcPath(statePath: string): 0 | 1 {
  try {
    if (!statePath) return 0;
    return existsSync(statePath) ? 1 : 0;
  } catch {
    return 0;
  }
}

export function probeUdsActive(socketPath: string, timeoutMs = 500): Promise<0 | 1> {
  try {
    if (!socketPath || !existsSync(socketPath)) return Promise.resolve(0);
  } catch {
    return Promise.resolve(0);
  }
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: 0 | 1): void => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    try {
      const req = http.request(
        { socketPath, path: '/', method: 'GET', agent: probeAgent },
        (res) => {
          res.resume();
          res.on('end', () => done(1));
          res.on('close', () => done(1));
        },
      );
      req.on('error', () => done(0));
      req.setTimeout(timeoutMs, () => {
        req.destroy();
        done(0);
      });
      req.end();
    } catch {
      done(0);
    }
  });
}
