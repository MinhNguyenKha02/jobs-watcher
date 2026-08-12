import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockStdout = { write: vi.fn(), columns: 100, rows: 30 };
const mockStdin = { isTTY: true, setRawMode: vi.fn(), isRawMode: vi.fn(() => true) };

vi.mock('../../../../src/services/logger.js', () => ({
  getLogger: () => ({ error: vi.fn() }),
}));

const { AnsiTerminal, terminal } =
  await import('../../../../src/presentation/tui/components/AnsiTerminal.js');

describe('AnsiTerminal', () => {
  let t: InstanceType<typeof AnsiTerminal>;

  beforeEach(() => {
    vi.clearAllMocks();
    t = new AnsiTerminal();
    Object.defineProperty(process, 'stdout', { value: mockStdout });
    Object.defineProperty(process, 'stdin', { value: mockStdin });
  });

  describe('terminal control sequences', () => {
    it('GIVEN AnsiTerminal WHEN t.clear THEN clear returns expected escape code', () => {
      expect(t.clear()).toBe('\x1b[2J\x1b[H');
    });

    it('GIVEN AnsiTerminal WHEN t.home THEN home returns expected escape code', () => {
      expect(t.home()).toBe('\x1b[H');
    });

    it('GIVEN AnsiTerminal WHEN t.moveCursor THEN moveCursor returns expected escape code', () => {
      expect(t.moveCursor(3, 5)).toBe('\x1b[3;5H');
    });

    it('GIVEN AnsiTerminal WHEN t.showCursor THEN showCursor returns expected escape code', () => {
      expect(t.showCursor()).toBe('\x1b[?25h');
    });

    it('GIVEN AnsiTerminal WHEN t.hideCursor THEN hideCursor returns expected escape code', () => {
      expect(t.hideCursor()).toBe('\x1b[?25l');
    });

    it('GIVEN AnsiTerminal WHEN t.reset THEN reset returns expected escape code', () => {
      expect(t.reset()).toBe('\x1b[0m');
    });
  });

  describe('text styling', () => {
    it('GIVEN AnsiTerminal WHEN t.bold THEN bold wraps text', () => {
      expect(t.bold('hello')).toBe('\x1b[1mhello\x1b[0m');
    });

    it('GIVEN AnsiTerminal WHEN t.dim THEN dim wraps text', () => {
      expect(t.dim('test')).toBe('\x1b[2mtest\x1b[0m');
    });

    it('GIVEN AnsiTerminal WHEN t.green THEN green wraps text', () => {
      expect(t.green('ok')).toBe('\x1b[32mok\x1b[0m');
    });

    it('GIVEN AnsiTerminal WHEN t.red THEN red wraps text', () => {
      expect(t.red('err')).toBe('\x1b[31merr\x1b[0m');
    });

    it('GIVEN AnsiTerminal WHEN t.yellow THEN yellow wraps text', () => {
      expect(t.yellow('warn')).toBe('\x1b[33mwarn\x1b[0m');
    });

    it('GIVEN AnsiTerminal WHEN t.cyan THEN cyan wraps text', () => {
      expect(t.cyan('info')).toBe('\x1b[36minfo\x1b[0m');
    });

    it('GIVEN AnsiTerminal WHEN t.bright THEN bright uses specified color code', () => {
      expect(t.bright('hi', 32)).toBe('\x1b[932mhi\x1b[0m');
    });
  });

  describe('string utilities', () => {
    it('GIVEN AnsiTerminal WHEN t.truncate THEN truncate shortens long strings', () => {
      expect(t.truncate('hello world', 8)).toBe('hello...');
    });

    it('GIVEN under width WHEN t.truncate THEN truncate returns full string', () => {
      expect(t.truncate('short', 10)).toBe('short');
    });

    it('GIVEN AnsiTerminal WHEN t.padRight THEN padRight pads with default space', () => {
      expect(t.padRight('abc', 5)).toBe('abc  ');
    });

    it('GIVEN AnsiTerminal WHEN t.padRight THEN padRight pads with custom char', () => {
      expect(t.padRight('abc', 5, '-')).toBe('abc--');
    });

    it('GIVEN at width WHEN t.padRight THEN padRight does not pad', () => {
      expect(t.padRight('abcde', 5)).toBe('abcde');
    });
  });

  describe('terminal dimensions', () => {
    it('GIVEN AnsiTerminal WHEN t.getWidth THEN getWidth returns stdout.columns', () => {
      expect(t.getWidth()).toBe(100);
    });

    it('GIVEN AnsiTerminal WHEN t.getWidth THEN getWidth falls back to 80', () => {
      Object.defineProperty(process, 'stdout', { value: { columns: undefined } });
      expect(t.getWidth()).toBe(80);
    });

    it('GIVEN AnsiTerminal WHEN t.getHeight THEN getHeight returns stdout.rows', () => {
      expect(t.getHeight()).toBe(30);
    });

    it('GIVEN AnsiTerminal WHEN t.getHeight THEN getHeight falls back to 24', () => {
      Object.defineProperty(process, 'stdout', { value: { rows: undefined } });
      expect(t.getHeight()).toBe(24);
    });
  });

  describe('raw mode', () => {
    it('GIVEN AnsiTerminal WHEN t.enableRawMode THEN enableRawMode sets raw mode on TTY stdin', () => {
      t.enableRawMode();
      expect(mockStdin.setRawMode).toHaveBeenCalledWith(true);
    });

    it('GIVEN AnsiTerminal WHEN t.enableRawMode THEN enableRawMode does not throw on non-TTY', () => {
      Object.defineProperty(process, 'stdin', { value: { isTTY: false } });
      expect(() => t.enableRawMode()).not.toThrow();
    });

    it('GIVEN AnsiTerminal WHEN t.enableRawMode THEN restoreTerminal restores raw mode to false', () => {
      mockStdin.setRawMode.mockImplementation(() => {});
      t.enableRawMode();
      t.restoreTerminal();
      expect(mockStdin.setRawMode).toHaveBeenCalledWith(false);
    });

    it('GIVEN AnsiTerminal WHEN t.restoreTerminal THEN restoreTerminal does not throw on non-TTY', () => {
      Object.defineProperty(process, 'stdin', { value: { isTTY: false } });
      expect(() => t.restoreTerminal()).not.toThrow();
    });
  });

  describe('write', () => {
    it('GIVEN AnsiTerminal WHEN t.write THEN writes to stdout', () => {
      t.write('hello');
      expect(mockStdout.write).toHaveBeenCalledWith('hello');
    });
  });

  describe('singleton', () => {
    it('GIVEN AnsiTerminal WHEN exercised THEN exports a terminal instance', () => {
      expect(terminal).toBeInstanceOf(AnsiTerminal);
    });
  });
});
