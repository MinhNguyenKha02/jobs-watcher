import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockStdout = { write: vi.fn(), columns: 100, rows: 30 };
const mockStdin = { isTTY: true, setRawMode: vi.fn(), isRawMode: vi.fn(() => true) };

vi.mock('../../../../src/services/logger.js', () => ({
  getLogger: () => ({ error: vi.fn() }),
}));

const { AnsiTerminal, terminal } = await import('../../../../src/presentation/tui/components/AnsiTerminal.js' );

describe('AnsiTerminal', () => {
  let t: AnsiTerminal;

  beforeEach(() => {
    vi.clearAllMocks();
    t = new AnsiTerminal();
    Object.defineProperty(process, 'stdout', { value: mockStdout });
    Object.defineProperty(process, 'stdin', { value: mockStdin });
  });

  describe('terminal control sequences', () => {
    it('clear returns expected escape code', () => {
      expect(t.clear()).toBe('\x1b[2J\x1b[H');
    });

    it('home returns expected escape code', () => {
      expect(t.home()).toBe('\x1b[H');
    });

    it('moveCursor returns expected escape code', () => {
      expect(t.moveCursor(3, 5)).toBe('\x1b[3;5H');
    });

    it('showCursor returns expected escape code', () => {
      expect(t.showCursor()).toBe('\x1b[?25h');
    });

    it('hideCursor returns expected escape code', () => {
      expect(t.hideCursor()).toBe('\x1b[?25l');
    });

    it('reset returns expected escape code', () => {
      expect(t.reset()).toBe('\x1b[0m');
    });
  });

  describe('text styling', () => {
    it('bold wraps text', () => {
      expect(t.bold('hello')).toBe('\x1b[1mhello\x1b[0m');
    });

    it('dim wraps text', () => {
      expect(t.dim('test')).toBe('\x1b[2mtest\x1b[0m');
    });

    it('green wraps text', () => {
      expect(t.green('ok')).toBe('\x1b[32mok\x1b[0m');
    });

    it('red wraps text', () => {
      expect(t.red('err')).toBe('\x1b[31merr\x1b[0m');
    });

    it('yellow wraps text', () => {
      expect(t.yellow('warn')).toBe('\x1b[33mwarn\x1b[0m');
    });

    it('cyan wraps text', () => {
      expect(t.cyan('info')).toBe('\x1b[36minfo\x1b[0m');
    });

    it('bright uses specified color code', () => {
      expect(t.bright('hi', 32)).toBe('\x1b[932mhi\x1b[0m');
    });
  });

  describe('string utilities', () => {
    it('truncate shortens long strings', () => {
      expect(t.truncate('hello world', 8)).toBe('hello...');
    });

    it('truncate returns full string when under width', () => {
      expect(t.truncate('short', 10)).toBe('short');
    });

    it('padRight pads with default space', () => {
      expect(t.padRight('abc', 5)).toBe('abc  ');
    });

    it('padRight pads with custom char', () => {
      expect(t.padRight('abc', 5, '-')).toBe('abc--');
    });

    it('padRight does not pad when at width', () => {
      expect(t.padRight('abcde', 5)).toBe('abcde');
    });
  });

  describe('terminal dimensions', () => {
    it('getWidth returns stdout.columns', () => {
      expect(t.getWidth()).toBe(100);
    });

    it('getWidth falls back to 80', () => {
      Object.defineProperty(process, 'stdout', { value: { columns: undefined } });
      expect(t.getWidth()).toBe(80);
    });

    it('getHeight returns stdout.rows', () => {
      expect(t.getHeight()).toBe(30);
    });

    it('getHeight falls back to 24', () => {
      Object.defineProperty(process, 'stdout', { value: { rows: undefined } });
      expect(t.getHeight()).toBe(24);
    });
  });

  describe('raw mode', () => {
    it('enableRawMode sets raw mode on TTY stdin', () => {
      t.enableRawMode();
      expect(mockStdin.setRawMode).toHaveBeenCalledWith(true);
    });

    it('enableRawMode does not throw on non-TTY', () => {
      Object.defineProperty(process, 'stdin', { value: { isTTY: false } });
      expect(() => t.enableRawMode()).not.toThrow();
    });

    it('restoreTerminal restores raw mode to false', () => {
      mockStdin.setRawMode.mockImplementation(() => {});
      t.enableRawMode();
      t.restoreTerminal();
      expect(mockStdin.setRawMode).toHaveBeenCalledWith(false);
    });

    it('restoreTerminal does not throw on non-TTY', () => {
      Object.defineProperty(process, 'stdin', { value: { isTTY: false } });
      expect(() => t.restoreTerminal()).not.toThrow();
    });
  });

  describe('write', () => {
    it('writes to stdout', () => {
      t.write('hello');
      expect(mockStdout.write).toHaveBeenCalledWith('hello');
    });
  });

  describe('singleton', () => {
    it('exports a terminal instance', () => {
      expect(terminal).toBeInstanceOf(AnsiTerminal);
    });
  });
});
