import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const statePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tui-xproc-')), 'tui-state.json');
process.env.TUI_SHARED_STATE_PATH = statePath;

const tsxBin = fileURLToPath(new URL('../../../../node_modules/.bin/tsx', import.meta.url));

interface PublishResult {
  success: boolean;
  error?: string;
}

function runWorker(role: string, company: string): Promise<PublishResult> {
  return new Promise((resolve) => {
    const sharedModulePath = fileURLToPath(
      new URL('../../../../src/presentation/tui/shared-tui-state.ts', import.meta.url)
    );
    const script = `
      import { setCurrentJob } from ${JSON.stringify(sharedModulePath)};
      for (let i = 0; i < 20; i++) {
        setCurrentJob('job-${role}-' + i, { role: ${JSON.stringify(role)}, company: ${JSON.stringify(company)} }, 'FULL_PARSED');
      }
    `;
    execFile(
      tsxBin,
      ['--eval', script],
      {
        cwd: new URL('../..', import.meta.url).pathname,
        env: { ...process.env, TUI_SHARED_STATE_PATH: statePath },
        timeout: 20000,
      },
      (err, stdout, stderr) => {
        resolve({ success: !err, error: err ? `${String(err)}\n${stdout}\n${stderr}` : undefined });
      }
    );
  });
}

describe('PRC-005 — TUI shared state cross-process integrity', () => {
  beforeAll(() => {
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        version: 2,
        queueMode: true,
        updatedAt: null,
        queue: { jobLifecycleId: null, job: null, stage: null, editedFields: null, modal: null },
        direct: { jobLifecycleId: null, job: null, stage: null, editedFields: null, modal: null },
      })
    );
  });

  afterAll(() => {
    fs.rmSync(path.dirname(statePath), { recursive: true, force: true });
  });

  it('concurrent workers from separate processes never corrupt the JSON file', async () => {
    const results = await Promise.all([
      runWorker('A', 'AlphaCo'),
      runWorker('B', 'BetaCo'),
      runWorker('C', 'GammaCo'),
    ]);

    for (const r of results) {
      expect(r.success).toBe(true);
    }

    const raw = fs.readFileSync(statePath, 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(2);
    expect(typeof parsed.queueMode).toBe('boolean');
  });

  it('no temp or lock files remain after concurrent writes', () => {
    const leftovers = fs.readdirSync(path.dirname(statePath));
    expect(leftovers.filter((f) => f.endsWith('.tmp'))).toEqual([]);
    expect(leftovers.filter((f) => f.endsWith('.lock'))).toEqual([]);
  });

  it('state file reflects a coherent single job (last writer wins, no interleave)', async () => {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const active = parsed.queue;
    expect(active).toBeDefined();
    if (active.jobLifecycleId) {
      expect(active.jobLifecycleId).toMatch(/^job-[ABC]-/);
      expect(active.job?.company).toMatch(/^(AlphaCo|BetaCo|GammaCo)$/);
    }
  });

  it('rewriting via worker then reading from parent yields consistent version', async () => {
    await runWorker('D', 'DeltaCo');
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    expect(parsed.version).toBe(2);
    expect(parsed.updatedAt).toBeTypeOf('string');
  });
});
