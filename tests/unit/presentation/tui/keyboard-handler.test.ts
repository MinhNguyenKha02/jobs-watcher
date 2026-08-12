import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  KeyboardHandler,
  KeyAction,
} from '../../../../src/presentation/tui/components/KeyboardHandler.js';

describe('KeyboardHandler — key mapping via public API', () => {
  const handler = new KeyboardHandler();

  afterEach(() => {
    handler.detach();
  });

  it('GIVEN KeyboardHandler WHEN handler.attach THEN maps `o` to OPEN action', async () => {
    await handler.attach();
    const promise = handler.waitForAction(1000);
    process.stdin.emit('data', Buffer.from('o'));
    await expect(promise).resolves.toBe(KeyAction.OPEN);
  });

  it('GIVEN KeyboardHandler WHEN handler.attach THEN maps `p` to PREVIEW action', async () => {
    await handler.attach();
    const promise = handler.waitForAction(1000);
    process.stdin.emit('data', Buffer.from('p'));
    await expect(promise).resolves.toBe(KeyAction.PREVIEW);
  });

  it('GIVEN KeyboardHandler WHEN handler.attach THEN maps `j` to QUEUE action', async () => {
    await handler.attach();
    const promise = handler.waitForAction(1000);
    process.stdin.emit('data', Buffer.from('j'));
    await expect(promise).resolves.toBe(KeyAction.QUEUE);
  });

  it('GIVEN KeyboardHandler WHEN handler.attach THEN maps `d` to TRASH action', async () => {
    await handler.attach();
    const promise = handler.waitForAction(1000);
    process.stdin.emit('data', Buffer.from('d'));
    await expect(promise).resolves.toBe(KeyAction.TRASH);
  });

  it('GIVEN KeyboardHandler WHEN handler.attach THEN maps `i` to INGEST action', async () => {
    await handler.attach();
    const promise = handler.waitForAction(1000);
    process.stdin.emit('data', Buffer.from('i'));
    await expect(promise).resolves.toBe(KeyAction.INGEST);
  });

  it('GIVEN KeyboardHandler WHEN handler.attach THEN maps `c` to WEBHOOK_STAGE2_PARSE action', async () => {
    await handler.attach();
    const promise = handler.waitForAction(1000);
    process.stdin.emit('data', Buffer.from('c'));
    await expect(promise).resolves.toBe(KeyAction.WEBHOOK_STAGE2_PARSE);
  });

  it('GIVEN KeyboardHandler WHEN handler.attach THEN maps `b` to TOGGLE_QUEUE action', async () => {
    await handler.attach();
    const promise = handler.waitForAction(1000);
    process.stdin.emit('data', Buffer.from('b'));
    await expect(promise).resolves.toBe(KeyAction.TOGGLE_QUEUE);
  });

  it('GIVEN KeyboardHandler WHEN handler.attach THEN maps `?` to HELP action', async () => {
    await handler.attach();
    const promise = handler.waitForAction(1000);
    process.stdin.emit('data', Buffer.from('?'));
    await expect(promise).resolves.toBe(KeyAction.HELP);
  });

  it('GIVEN KeyboardHandler WHEN handler.attach THEN maps `q` to QUIT action', async () => {
    await handler.attach();
    const promise = handler.waitForAction(1000);
    process.stdin.emit('data', Buffer.from('q'));
    await expect(promise).resolves.toBe(KeyAction.QUIT);
  });

  it('GIVEN KeyboardHandler WHEN handler.attach THEN maps uppercase `O` to OPEN (case insensitive)', async () => {
    await handler.attach();
    const promise = handler.waitForAction(1000);
    process.stdin.emit('data', Buffer.from('O'));
    await expect(promise).resolves.toBe(KeyAction.OPEN);
  });

  it('GIVEN KeyboardHandler WHEN handler.attach THEN maps uppercase `P` to PREVIEW (case insensitive)', async () => {
    await handler.attach();
    const promise = handler.waitForAction(1000);
    process.stdin.emit('data', Buffer.from('P'));
    await expect(promise).resolves.toBe(KeyAction.PREVIEW);
  });

  it('GIVEN KeyboardHandler WHEN handler.attach THEN maps ESC to MODAL_DISCARD', async () => {
    await handler.attach();
    const promise = handler.waitForAction(1000);
    process.stdin.emit('data', Buffer.from([0x1b]));
    await expect(promise).resolves.toBe(KeyAction.MODAL_DISCARD);
  });

  it('GIVEN KeyboardHandler WHEN handler.attach THEN maps arrow up to MODAL_SCROLL_UP', async () => {
    await handler.attach();
    const promise = handler.waitForAction(1000);
    process.stdin.emit('data', Buffer.from([0x1b, 0x5b, 0x41]));
    await expect(promise).resolves.toBe(KeyAction.MODAL_SCROLL_UP);
  });

  it('GIVEN KeyboardHandler WHEN handler.attach THEN maps arrow down to MODAL_SCROLL_DOWN', async () => {
    await handler.attach();
    const promise = handler.waitForAction(1000);
    process.stdin.emit('data', Buffer.from([0x1b, 0x5b, 0x42]));
    await expect(promise).resolves.toBe(KeyAction.MODAL_SCROLL_DOWN);
  });

  it('GIVEN KeyboardHandler WHEN handler.attach THEN maps unknown key to NONE via timeout', async () => {
    await handler.attach();
    const promise = handler.waitForAction(100);
    process.stdin.emit('data', Buffer.from('x'));
    await expect(promise).resolves.toBe(KeyAction.NONE);
  });
});

describe('KeyboardHandler', () => {
  let handler: KeyboardHandler;

  beforeEach(() => {
    handler = new KeyboardHandler();
  });

  afterEach(() => {
    try {
      handler.detach();
    } catch {}
  });

  describe('keyToAction mapping', () => {
    function buffer(char: string): Buffer {
      return Buffer.from(char);
    }

    function escapeSeq(code: number): Buffer {
      return Buffer.from([0x1b, 0x5b, code]);
    }

    it('GIVEN KeyboardHandler WHEN exercised THEN maps j to queue', () => {
      expect((handler as any).keyToAction(buffer('j'))).toBe('queue');
    });

    it('GIVEN KeyboardHandler WHEN exercised THEN maps d to trash', () => {
      expect((handler as any).keyToAction(buffer('d'))).toBe('trash');
    });

    it('GIVEN KeyboardHandler WHEN exercised THEN maps p to preview', () => {
      expect((handler as any).keyToAction(buffer('p'))).toBe('preview');
    });

    it('GIVEN KeyboardHandler WHEN exercised THEN maps i to ingest', () => {
      expect((handler as any).keyToAction(buffer('i'))).toBe('ingest');
    });

    it('GIVEN KeyboardHandler WHEN exercised THEN maps c to webhook_stage2_parse', () => {
      expect((handler as any).keyToAction(buffer('c'))).toBe('webhook_stage2_parse');
    });

    it('GIVEN KeyboardHandler WHEN exercised THEN maps o to open', () => {
      expect((handler as any).keyToAction(buffer('o'))).toBe('open');
    });

    it('GIVEN KeyboardHandler WHEN exercised THEN maps b to toggle_queue', () => {
      expect((handler as any).keyToAction(buffer('b'))).toBe('toggle_queue');
    });

    it('GIVEN KeyboardHandler WHEN exercised THEN maps ? to help', () => {
      expect((handler as any).keyToAction(buffer('?'))).toBe('help');
    });

    it('GIVEN KeyboardHandler WHEN exercised THEN maps q to quit', () => {
      expect((handler as any).keyToAction(buffer('q'))).toBe('quit');
    });

    it('GIVEN KeyboardHandler WHEN exercised THEN maps ESC to modal_discard', () => {
      expect((handler as any).keyToAction(Buffer.from([0x1b]))).toBe('modal_discard');
    });

    it('GIVEN KeyboardHandler WHEN exercised THEN maps Arrow Up to modal_scroll_up', () => {
      expect((handler as any).keyToAction(escapeSeq(0x41))).toBe('modal_scroll_up');
    });

    it('GIVEN KeyboardHandler WHEN exercised THEN maps Arrow Down to modal_scroll_down', () => {
      expect((handler as any).keyToAction(escapeSeq(0x42))).toBe('modal_scroll_down');
    });

    it('GIVEN KeyboardHandler WHEN exercised THEN maps unknown keys to none', () => {
      expect((handler as any).keyToAction(buffer('x'))).toBe('none');
      expect((handler as any).keyToAction(buffer('z'))).toBe('none');
      expect((handler as any).keyToAction(buffer('1'))).toBe('none');
    });

    it('GIVEN KeyboardHandler WHEN exercised THEN is case-insensitive', () => {
      expect((handler as any).keyToAction(buffer('J'))).toBe('queue');
      expect((handler as any).keyToAction(buffer('C'))).toBe('webhook_stage2_parse');
      expect((handler as any).keyToAction(buffer('B'))).toBe('toggle_queue');
    });
  });

  describe('showHelp', () => {
    it('GIVEN KeyboardHandler WHEN KeyboardHandler.showHelp THEN returns a non-empty help string', () => {
      const help = KeyboardHandler.showHelp();
      expect(help).toBeTruthy();
      expect(help.length).toBeGreaterThan(50);
    });

    it('GIVEN KeyboardHandler WHEN KeyboardHandler.showHelp THEN contains routing section', () => {
      const help = KeyboardHandler.showHelp();
      expect(help).toContain('ROUTING');
    });

    it('GIVEN KeyboardHandler WHEN KeyboardHandler.showHelp THEN contains ingestion section', () => {
      const help = KeyboardHandler.showHelp();
      expect(help).toContain('INGESTION');
    });

    it('GIVEN KeyboardHandler WHEN KeyboardHandler.showHelp THEN contains system section', () => {
      const help = KeyboardHandler.showHelp();
      expect(help).toContain('SYSTEM');
    });
  });

  describe('waitForAction', () => {
    it('GIVEN no action within timeout WHEN vi.useFakeTimers THEN times out with none', async () => {
      vi.useFakeTimers();
      const promise = handler.waitForAction(1000);
      vi.advanceTimersByTime(1000);
      const result = await promise;
      expect(result).toBe('none');
      vi.useRealTimers();
    });
  });
});
