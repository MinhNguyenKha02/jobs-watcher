import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  KeyboardHandler,
  KeyAction,
} from '../../../../src/presentation/tui/components/KeyboardHandler.js';

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

  describe('key mapping via public attach', () => {
    it.each([
      ['o', [0x6f], KeyAction.OPEN],
      ['O (case insensitive)', [0x4f], KeyAction.OPEN],
      ['p', [0x70], KeyAction.PREVIEW],
      ['P (case insensitive)', [0x50], KeyAction.PREVIEW],
      ['j', [0x6a], KeyAction.QUEUE],
      ['d', [0x64], KeyAction.TRASH],
      ['i', [0x69], KeyAction.INGEST],
      ['c', [0x63], KeyAction.WEBHOOK_STAGE2_PARSE],
      ['b', [0x62], KeyAction.TOGGLE_QUEUE],
      ['?', [0x3f], KeyAction.HELP],
      ['q', [0x71], KeyAction.QUIT],
      ['esc', [0x1b], KeyAction.MODAL_DISCARD],
      ['arrow up', [0x1b, 0x5b, 0x41], KeyAction.MODAL_SCROLL_UP],
      ['arrow down', [0x1b, 0x5b, 0x42], KeyAction.MODAL_SCROLL_DOWN],
    ] as const)(
      'GIVEN KeyboardHandler WHEN handler.attach THEN %s emits its mapped action',
      async (_label: string, bites: readonly number[], action: KeyAction) => {
        await handler.attach();
        const promise = handler.waitForAction(1000);
        process.stdin.emit('data', Buffer.from(bites));
        await expect(promise).resolves.toBe(action);
      }
    );

    it('GIVEN KeyboardHandler WHEN handler.attach THEN maps unknown key to NONE via timeout', async () => {
      await handler.attach();
      const promise = handler.waitForAction(100);
      process.stdin.emit('data', Buffer.from('x'));
      await expect(promise).resolves.toBe(KeyAction.NONE);
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

  describe('waitForAction timeout', () => {
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
