import { vi } from 'vitest';

/**
 * `EventRecorder` receives the event tag plus the payload args for each emit.
 * Callers adapt to their own log shape, e.g. `(tag, args) => log.push([tag, ...args])`
 * or `(tag) => log.push(tag)`.
 */
export type EventRecorder = (tag: string, args: unknown[]) => void;

function makeEmit(recorder?: EventRecorder) {
  return (tag: string) =>
    vi.fn((...args: unknown[]) => {
      recorder?.(tag, args);
      return Promise.resolve();
    });
}

/** Fake `ParsePort` with spy emitters. Always resolves; records when `recorder` is given. */
export function createParseEventPort(recorder?: EventRecorder) {
  const emit = makeEmit(recorder);
  return {
    emitGenerated: emit('generated'),
    emitCompleted: emit('completed'),
    emitFailed: emit('failed'),
  };
}

/** Fake `RoutePort` with spy emitters. Always resolves; records when `recorder` is given. */
export function createRoutingPort(recorder?: EventRecorder, routeFailedTag = 'failed') {
  const emit = makeEmit(recorder);
  return {
    emitJobQueued: emit('queued'),
    emitJobTrashed: emit('trashed'),
    emitRouteFailed: emit(routeFailedTag),
  };
}
