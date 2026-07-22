import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { KeyboardHandler } = await import('../../../../src/presentation/tui/components/KeyboardHandler.js' );

describe('KeyboardHandler', () => {
  let handler: KeyboardHandler;

  beforeEach(() => {
    handler = new KeyboardHandler();
  });

  afterEach(() => {
    try { handler.detach(); } catch {}
  });

  describe('keyToAction mapping', () => {
    function buffer(char: string): Buffer {
      return Buffer.from(char);
    }

    function escapeSeq(code: number): Buffer {
      return Buffer.from([0x1b, 0x5b, code]);
    }

    it('maps j to queue', () => {
      expect((handler as any).keyToAction(buffer('j'))).toBe('queue');
    });

    it('maps d to trash', () => {
      expect((handler as any).keyToAction(buffer('d'))).toBe('trash');
    });

    it('maps p to preview', () => {
      expect((handler as any).keyToAction(buffer('p'))).toBe('preview');
    });

    it('maps i to ingest', () => {
      expect((handler as any).keyToAction(buffer('i'))).toBe('ingest');
    });

    it('maps c to webhook_stage2_parse', () => {
      expect((handler as any).keyToAction(buffer('c'))).toBe('webhook_stage2_parse');
    });

    it('maps o to open', () => {
      expect((handler as any).keyToAction(buffer('o'))).toBe('open');
    });

    it('maps b to toggle_queue', () => {
      expect((handler as any).keyToAction(buffer('b'))).toBe('toggle_queue');
    });

    it('maps ? to help', () => {
      expect((handler as any).keyToAction(buffer('?'))).toBe('help');
    });

    it('maps q to quit', () => {
      expect((handler as any).keyToAction(buffer('q'))).toBe('quit');
    });

    it('maps ESC to modal_discard', () => {
      expect((handler as any).keyToAction(Buffer.from([0x1b]))).toBe('modal_discard');
    });

    it('maps Arrow Up to modal_scroll_up', () => {
      expect((handler as any).keyToAction(escapeSeq(0x41))).toBe('modal_scroll_up');
    });

    it('maps Arrow Down to modal_scroll_down', () => {
      expect((handler as any).keyToAction(escapeSeq(0x42))).toBe('modal_scroll_down');
    });

    it('maps unknown keys to none', () => {
      expect((handler as any).keyToAction(buffer('x'))).toBe('none');
      expect((handler as any).keyToAction(buffer('z'))).toBe('none');
      expect((handler as any).keyToAction(buffer('1'))).toBe('none');
    });

    it('is case-insensitive', () => {
      expect((handler as any).keyToAction(buffer('J'))).toBe('queue');
      expect((handler as any).keyToAction(buffer('C'))).toBe('webhook_stage2_parse');
      expect((handler as any).keyToAction(buffer('B'))).toBe('toggle_queue');
    });
  });

  describe('showHelp', () => {
    it('returns a non-empty help string', () => {
      const help = KeyboardHandler.showHelp();
      expect(help).toBeTruthy();
      expect(help.length).toBeGreaterThan(50);
    });

    it('contains routing section', () => {
      const help = KeyboardHandler.showHelp();
      expect(help).toContain('ROUTING');
    });

    it('contains ingestion section', () => {
      const help = KeyboardHandler.showHelp();
      expect(help).toContain('INGESTION');
    });

    it('contains system section', () => {
      const help = KeyboardHandler.showHelp();
      expect(help).toContain('SYSTEM');
    });
  });

  describe('waitForAction', () => {
    it('times out with none when no action within timeout', async () => {
      vi.useFakeTimers();
      const promise = handler.waitForAction(1000);
      vi.advanceTimersByTime(1000);
      const result = await promise;
      expect(result).toBe('none');
      vi.useRealTimers();
    });
  });
});
