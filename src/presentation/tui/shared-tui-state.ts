import { constants, accessSync, mkdirSync, openSync, closeSync, unlinkSync, readFileSync, renameSync, writeFileSync, watch, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';


import { createLogger } from '../../infrastructure/outbound/logging/logger.js';
import type { Job } from '../../domain/types/job.js';
import { JobStage } from '../../domain/types/job-lifecycle.js';

const logger = createLogger('TUI-State');

export type CurrentJobStage = JobStage.PARTIAL_PARSED | JobStage.FULL_PARSED | null;

export type ModalType = 'PREVIEW_VIEWER';

export interface PreviewViewerModal {
  type: 'PREVIEW_VIEWER';
  clipboardContent: string[];
  currentPage: number;
  maxPages: number;
  maxLinesPerPage: number;
  createdAt: string;
}

export type ModalState = PreviewViewerModal | null;

export interface CurrentJobState {
  version: number;
  jobLifecycleId: string | null;
  job: Job | null;
  stage: CurrentJobStage;
  editedFields: Record<string, unknown> | null;
  modal: ModalState;
  updatedAt: string | null;
}

interface ModeSubState {
  jobLifecycleId: string | null;
  job: Job | null;
  stage: CurrentJobStage;
  editedFields: Record<string, unknown> | null;
  modal: ModalState;
}

interface TuiSharedState {
  version: number;
  queueMode: boolean;
  updatedAt: string | null;
  queue: ModeSubState;
  direct: ModeSubState;
}

const getStateDir = () => {
  const uid = process.getuid?.();
  if (uid !== undefined) {
    const runtimeDir = `/run/user/${uid}`;
    try {
      accessSync(runtimeDir, constants.W_OK);
      return runtimeDir;
    } catch {
      return join(homedir(), '.cache');
    }
  }
  return join(homedir(), '.cache');
};

const sharedStatePath = process.env.TUI_SHARED_STATE_PATH || join(getStateDir(), 'jobs-watcher-tui-state.json');
const STATE_VERSION = 2;

function createDefaultModeSubState(): ModeSubState {
  return {
    jobLifecycleId: null,
    job: null,
    stage: null,
    editedFields: null,
    modal: null,
  };
}

const ACTIVE_SUB = Symbol('activeSub');
type RootWithActive = TuiSharedState & { [ACTIVE_SUB]: ModeSubState };

let sharedState: TuiSharedState = {
  version: STATE_VERSION,
  queueMode: true,
  updatedAt: null,
  queue: createDefaultModeSubState(),
  direct: createDefaultModeSubState(),
};

let stateWatcher: ReturnType<typeof watch> | null = null;

function activeModeKey(queueMode: boolean): 'queue' | 'direct' {
  return queueMode ? 'queue' : 'direct';
}

function readSharedStateFromDisk(): TuiSharedState {
  try {
    const raw = readFileSync(sharedStatePath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    // v1 → v2 migration
    if (parsed.version === 1 || (!parsed.version && parsed.messageId !== undefined)) {
      const old = parsed as any;
      const queue: ModeSubState = {
        jobLifecycleId: typeof old.messageId === 'string' ? old.messageId : null,
        job: old.job && typeof old.job === 'object' ? (old.job as Job) : null,
        stage: old.stage === JobStage.PARTIAL_PARSED || old.stage === 'PARTIAL' ? JobStage.PARTIAL_PARSED
          : old.stage === JobStage.FULL_PARSED || old.stage === 'FULL_PARSED' ? JobStage.FULL_PARSED
          : null,
        editedFields:
          old.editedFields && typeof old.editedFields === 'object'
            ? (old.editedFields as Record<string, unknown>)
            : null,
        modal: old.modal && typeof old.modal === 'object' ? (old.modal as ModalState) : null,
      };
      const migrated: TuiSharedState = {
        version: STATE_VERSION,
        queueMode: true,
        updatedAt: typeof old.updatedAt === 'string' ? old.updatedAt : null,
        queue,
        direct: createDefaultModeSubState(),
      };
      sharedState = migrated;
      writeSharedStateToDisk(migrated);
      return migrated;
    }

    sharedState = {
      version: typeof parsed.version === 'number' ? parsed.version : STATE_VERSION,
      queueMode: parsed.queueMode === false ? false : true,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
      queue: parsed.queue && typeof parsed.queue === 'object'
        ? parseModeSubState(parsed.queue as Record<string, unknown>)
        : createDefaultModeSubState(),
      direct: parsed.direct && typeof parsed.direct === 'object'
        ? parseModeSubState(parsed.direct as Record<string, unknown>)
        : createDefaultModeSubState(),
    };
    return sharedState;
  } catch {
    return sharedState;
  }
}

function parseModeSubState(raw: Record<string, unknown>): ModeSubState {
  return {
    jobLifecycleId: typeof raw.jobLifecycleId === 'string' ? raw.jobLifecycleId : (typeof raw.messageId === 'string' ? raw.messageId : null),
    job: raw.job && typeof raw.job === 'object' ? (raw.job as Job) : null,
    stage: raw.stage === JobStage.PARTIAL_PARSED || raw.stage === 'PARTIAL' ? JobStage.PARTIAL_PARSED
      : raw.stage === JobStage.FULL_PARSED || raw.stage === 'FULL_PARSED' ? JobStage.FULL_PARSED
      : null,
    editedFields:
      raw.editedFields && typeof raw.editedFields === 'object'
        ? (raw.editedFields as Record<string, unknown>)
        : null,
    modal: raw.modal && typeof raw.modal === 'object' ? (raw.modal as ModalState) : null,
  };
}

const LOCK_RETRY_MS = 10;
const LOCK_MAX_RETRIES = 50;
const STALE_LOCK_MS = 30_000;

function acquireExclusiveLock(): string {
  const lockPath = `${sharedStatePath}.lock`;
  for (let attempt = 0; attempt < LOCK_MAX_RETRIES; attempt++) {
    try {
      const fd = openSync(lockPath, 'wx');
      closeSync(fd);
      return lockPath;
    } catch (err: any) {
      if (err.code !== 'EEXIST') throw err;
      try {
        const st = statSync(lockPath);
        if (Date.now() - st.mtimeMs > STALE_LOCK_MS) {
          unlinkSync(lockPath);
          attempt--;
          continue;
        }
      } catch {}
      if (attempt < LOCK_MAX_RETRIES - 1) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_RETRY_MS);
      }
    }
  }
  throw new Error(`Could not acquire lock: ${lockPath}`);
}

function releaseLock(lockPath: string): void {
  try { unlinkSync(lockPath); } catch {}
}

function withExclusiveLock<T>(fn: () => T): T {
  const lockPath = acquireExclusiveLock();
  try {
    return fn();
  } finally {
    releaseLock(lockPath);
  }
}

function writeSharedStateToDisk(nextState: TuiSharedState): void {
  mkdirSync(dirname(sharedStatePath), { recursive: true });
  const tempPath = `${sharedStatePath}.tmp`;
  const jsonStr = JSON.stringify(nextState, null, 2);
  writeFileSync(tempPath, jsonStr, 'utf8');
  renameSync(tempPath, sharedStatePath);
  const active = activeModeKey(nextState.queueMode);
  logger.info('[STATE] ✅ File written successfully (atomic)', {
    jobLifecycleId: nextState[active].jobLifecycleId,
    mode: active,
    filePath: sharedStatePath,
    stateSize: jsonStr.length,
  });
}

function getActiveSub(root: TuiSharedState): ModeSubState {
  const key = activeModeKey(root.queueMode);
  return root[key];
}

function withUpdatedActiveSub(
  root: TuiSharedState,
  patch: Partial<ModeSubState>
): TuiSharedState {
  const key = activeModeKey(root.queueMode);
  return {
    ...root,
    [key]: { ...root[key], ...patch },
    updatedAt: new Date().toISOString(),
  };
}

function persist(root: TuiSharedState): void {
  sharedState = root;
  writeSharedStateToDisk(root);
}

export function setCurrentJob(jobLifecycleId: string, job: Job, stage: CurrentJobStage = JobStage.FULL_PARSED): void {
  withExclusiveLock(() => {
    const root = readSharedStateFromDisk();
    const key = activeModeKey(root.queueMode);
    const sub = root[key];

    if (sub.jobLifecycleId && sub.jobLifecycleId !== jobLifecycleId) {
      if (key === 'direct') {
        logger.info('[STATE] Direct mode — latest wins, overwriting job', {
          previousId: sub.jobLifecycleId,
          newId: jobLifecycleId,
        });
      } else {
        logger.warn('[STATE] ⚠️ Rejecting setCurrentJob overwrite for different displayed job', {
          currentMessageId: sub.jobLifecycleId,
          attemptedMessageId: jobLifecycleId,
          mode: key,
        });
        return;
      }
    }

    const updated = withUpdatedActiveSub(root, {
      jobLifecycleId,
      job,
      stage,
      editedFields: null,
      modal: null,
    });
    persist(updated);

    logger.info('[STATE] ✅ Job set complete', {
      jobLifecycleId,
      stage: stage ?? 'FULL_PARSED',
      mode: activeModeKey(root.queueMode),
      company: job?.company,
    });
  });
}

export function getCurrentJob(): CurrentJobState {
  const root = readSharedStateFromDisk();
  const sub = getActiveSub(root);
  return {
    version: root.version,
    jobLifecycleId: sub.jobLifecycleId,
    job: sub.job,
    stage: sub.stage,
    editedFields: sub.editedFields,
    modal: sub.modal,
    updatedAt: root.updatedAt,
  };
}

export function clearCurrentJob(): void {
  withExclusiveLock(() => {
    const root = readSharedStateFromDisk();
    const key = activeModeKey(root.queueMode);
    const nextState: TuiSharedState = {
      ...root,
      [key]: createDefaultModeSubState(),
      updatedAt: new Date().toISOString(),
    };
    persist(nextState);
    logger.info('[STATE] ✅ Current job cleared', { mode: key });
  });
}

export function setQueueMode(enabled: boolean): void {
  withExclusiveLock(() => {
    const root = readSharedStateFromDisk();
    if (root.queueMode === enabled) return;

    persist({
      ...root,
      queueMode: enabled,
      updatedAt: new Date().toISOString(),
    });
    logger.info('[STATE] Mode switched', {
      from: enabled ? 'direct → queue' : 'queue → direct',
    });
  });
}

export function resetState(): void {
  withExclusiveLock(() => {
    persist({
      ...readSharedStateFromDisk(),
      queueMode: true,
      updatedAt: new Date().toISOString(),
      queue: createDefaultModeSubState(),
      direct: createDefaultModeSubState(),
    });
  });
}

export function getQueueMode(): boolean {
  const root = readSharedStateFromDisk();
  return root.queueMode;
}

/**
 * Watch state file for changes and invoke callback on state transitions.
 * Debounced to 100ms to avoid duplicate events.
 */
export function watchStateFile(callback: (state: CurrentJobState) => void): () => void {
  const debounceMs = 100;
  let debounceTimer: NodeJS.Timeout | null = null;

  const handler = (): void => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      callback(getCurrentJob());
    }, debounceMs);
  };

  try {
    stateWatcher = watch(sharedStatePath, { persistent: false }, handler);
    logger.info('[STATE] Watching state file', { filePath: sharedStatePath });
  } catch (err) {
    logger.error('[STATE] Failed to watch state file', { error: String(err) });
  }

  return (): void => {
    if (stateWatcher) {
      stateWatcher.close();
      stateWatcher = null;
    }
    if (debounceTimer) clearTimeout(debounceTimer);
  };
}

function readForMutate(): { root: TuiSharedState; key: 'queue' | 'direct' } {
  const root = readSharedStateFromDisk();
  return { root, key: activeModeKey(root.queueMode) };
}

function persistMode(key: 'queue' | 'direct', patch: Partial<ModeSubState>): void {
  const root = readSharedStateFromDisk();
  persist({
    ...root,
    [key]: { ...root[key], ...patch },
    updatedAt: new Date().toISOString(),
  });
}

export function setPreviewViewerModal(clipboard: string, maxLinesPerPage: number = 20): void {
  const lines = clipboard.split('\n');
  const maxPages = Math.ceil(lines.length / maxLinesPerPage);

  withExclusiveLock(() => {
    const { key } = readForMutate();
    persistMode(key, {
      modal: {
        type: 'PREVIEW_VIEWER',
        clipboardContent: lines,
        currentPage: 0,
        maxPages,
        maxLinesPerPage,
        createdAt: new Date().toISOString(),
      } as PreviewViewerModal,
    });
  });

  logger.info('[MODAL] Preview viewer shown', {
    totalLines: lines.length,
    maxPages,
    maxLinesPerPage,
  });
}

export function updatePreviewPage(direction: 'up' | 'down'): void {
  withExclusiveLock(() => {
    const root = readSharedStateFromDisk();
    const { key } = readForMutate();
    const sub = root[key];

    if (!sub.modal || sub.modal.type !== 'PREVIEW_VIEWER') return;

    const modal = sub.modal as PreviewViewerModal;
    const nextPage =
      direction === 'down'
        ? Math.min(modal.currentPage + 1, modal.maxPages - 1)
        : Math.max(modal.currentPage - 1, 0);

    persistMode(key, {
      modal: { ...modal, currentPage: nextPage },
    });
  });
}

export function clearModal(): void {
  withExclusiveLock(() => {
    const { key } = readForMutate();
    persistMode(key, { modal: null });
  });
  logger.info('[MODAL] Modal cleared');
}


