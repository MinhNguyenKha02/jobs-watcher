import { describe, it, expect, afterEach } from 'vitest';
import { KeyboardHandler, KeyAction } from '../../../src/presentation/tui/components/KeyboardHandler.js';

describe('KeyboardHandler — key mapping via public API', () => {
  const handler = new KeyboardHandler();

  afterEach(() => {
    handler.detach();
  });

  it('maps `o` to OPEN action', async () => {
    await handler.attach();
    const promise = handler.waitForAction(1000);
    process.stdin.emit('data', Buffer.from('o'));
    await expect(promise).resolves.toBe(KeyAction.OPEN);
  });

  it('maps `p` to PREVIEW action', async () => {
    await handler.attach();
    const promise = handler.waitForAction(1000);
    process.stdin.emit('data', Buffer.from('p'));
    await expect(promise).resolves.toBe(KeyAction.PREVIEW);
  });

  it('maps `j` to QUEUE action', async () => {
    await handler.attach();
    const promise = handler.waitForAction(1000);
    process.stdin.emit('data', Buffer.from('j'));
    await expect(promise).resolves.toBe(KeyAction.QUEUE);
  });

  it('maps `d` to TRASH action', async () => {
    await handler.attach();
    const promise = handler.waitForAction(1000);
    process.stdin.emit('data', Buffer.from('d'));
    await expect(promise).resolves.toBe(KeyAction.TRASH);
  });

  it('maps `i` to INGEST action', async () => {
    await handler.attach();
    const promise = handler.waitForAction(1000);
    process.stdin.emit('data', Buffer.from('i'));
    await expect(promise).resolves.toBe(KeyAction.INGEST);
  });

  it('maps `c` to WEBHOOK_STAGE2_PARSE action', async () => {
    await handler.attach();
    const promise = handler.waitForAction(1000);
    process.stdin.emit('data', Buffer.from('c'));
    await expect(promise).resolves.toBe(KeyAction.WEBHOOK_STAGE2_PARSE);
  });

  it('maps `b` to TOGGLE_QUEUE action', async () => {
    await handler.attach();
    const promise = handler.waitForAction(1000);
    process.stdin.emit('data', Buffer.from('b'));
    await expect(promise).resolves.toBe(KeyAction.TOGGLE_QUEUE);
  });

  it('maps `?` to HELP action', async () => {
    await handler.attach();
    const promise = handler.waitForAction(1000);
    process.stdin.emit('data', Buffer.from('?'));
    await expect(promise).resolves.toBe(KeyAction.HELP);
  });

  it('maps `q` to QUIT action', async () => {
    await handler.attach();
    const promise = handler.waitForAction(1000);
    process.stdin.emit('data', Buffer.from('q'));
    await expect(promise).resolves.toBe(KeyAction.QUIT);
  });

  it('maps uppercase `O` to OPEN (case insensitive)', async () => {
    await handler.attach();
    const promise = handler.waitForAction(1000);
    process.stdin.emit('data', Buffer.from('O'));
    await expect(promise).resolves.toBe(KeyAction.OPEN);
  });

  it('maps uppercase `P` to PREVIEW (case insensitive)', async () => {
    await handler.attach();
    const promise = handler.waitForAction(1000);
    process.stdin.emit('data', Buffer.from('P'));
    await expect(promise).resolves.toBe(KeyAction.PREVIEW);
  });

  it('maps ESC to MODAL_DISCARD', async () => {
    await handler.attach();
    const promise = handler.waitForAction(1000);
    process.stdin.emit('data', Buffer.from([0x1b]));
    await expect(promise).resolves.toBe(KeyAction.MODAL_DISCARD);
  });

  it('maps arrow up to MODAL_SCROLL_UP', async () => {
    await handler.attach();
    const promise = handler.waitForAction(1000);
    process.stdin.emit('data', Buffer.from([0x1b, 0x5b, 0x41]));
    await expect(promise).resolves.toBe(KeyAction.MODAL_SCROLL_UP);
  });

  it('maps arrow down to MODAL_SCROLL_DOWN', async () => {
    await handler.attach();
    const promise = handler.waitForAction(1000);
    process.stdin.emit('data', Buffer.from([0x1b, 0x5b, 0x42]));
    await expect(promise).resolves.toBe(KeyAction.MODAL_SCROLL_DOWN);
  });

  it('maps unknown key to NONE via timeout', async () => {
    await handler.attach();
    const promise = handler.waitForAction(100);
    process.stdin.emit('data', Buffer.from('x'));
    await expect(promise).resolves.toBe(KeyAction.NONE);
  });
});
