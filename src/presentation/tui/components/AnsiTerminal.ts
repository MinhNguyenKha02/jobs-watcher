/**
 * ANSI Terminal Control
 *
 * Low-level terminal control using ANSI escape codes.
 * Handles raw mode, cursor movement, clearing, styling, and safe restoration.
 */

import { createLogger } from '../../../infrastructure/outbound/logging/logger.js';

export class AnsiTerminal {
  private originalRawMode: boolean = false;

  private get stdinWithRawMode(): NodeJS.ReadStream & { isRawMode?: () => boolean } {
    return process.stdin as NodeJS.ReadStream & { isRawMode?: () => boolean };
  }

  /**
   * Enable raw mode for single-character input without buffering.
   */
  enableRawMode(): void {
    try {
      if (this.stdinWithRawMode.isTTY) {
        this.originalRawMode = this.stdinWithRawMode.isRawMode?.() ?? false;
        this.stdinWithRawMode.setRawMode(true);
      }
    } catch (err) {
      createLogger('AnsiTerminal').error('Failed to enable raw mode', { error: err });
    }
  }

  /**
   * Restore terminal to original state.
   */
  restoreTerminal(): void {
    try {
      if (this.stdinWithRawMode.isTTY && this.stdinWithRawMode.isRawMode?.()) {
        this.stdinWithRawMode.setRawMode(false);
      }
    } catch (err) {
      createLogger('AnsiTerminal').error('Failed to restore terminal', { error: err });
    }
  }

  /**
   * Clear the entire screen and move cursor to top-left.
   */
  clear(): string {
    return '\x1b[2J\x1b[H';
  }

  /**
   * Move cursor to home position (1,1).
   */
  home(): string {
    return '\x1b[H';
  }

  /**
   * Move cursor to row, col (1-indexed).
   */
  moveCursor(row: number, col: number): string {
    return `\x1b[${row};${col}H`;
  }

  /**
   * Show cursor.
   */
  showCursor(): string {
    return '\x1b[?25h';
  }

  /**
   * Hide cursor.
   */
  hideCursor(): string {
    return '\x1b[?25l';
  }

  /**
   * Reset text styling (color, bold, etc) to default.
   */
  reset(): string {
    return '\x1b[0m';
  }

  /**
   * Bold text style.
   */
  bold(text: string): string {
    return `\x1b[1m${text}\x1b[0m`;
  }

  /**
   * Dim text style.
   */
  dim(text: string): string {
    return `\x1b[2m${text}\x1b[0m`;
  }

  /**
   * Bright/High-intensity foreground color.
   */
  bright(text: string, colorCode: number = 32): string {
    return `\x1b[9${colorCode}m${text}\x1b[0m`;
  }

  /**
   * Green text.
   */
  green(text: string): string {
    return `\x1b[32m${text}\x1b[0m`;
  }

  /**
   * Red text.
   */
  red(text: string): string {
    return `\x1b[31m${text}\x1b[0m`;
  }

  /**
   * Yellow text.
   */
  yellow(text: string): string {
    return `\x1b[33m${text}\x1b[0m`;
  }

  /**
   * Cyan text.
   */
  cyan(text: string): string {
    return `\x1b[36m${text}\x1b[0m`;
  }

  /**
   * Truncate a string to fit within terminal width, adding ellipsis if needed.
   */
  truncate(text: string, width: number): string {
    if (text.length > width) {
      return text.substring(0, Math.max(0, width - 3)) + '...';
    }
    return text;
  }

  /**
   * Pad a string to fill terminal width.
   */
  padRight(text: string, width: number, char: string = ' '): string {
    if (text.length >= width) return text;
    return text + char.repeat(width - text.length);
  }

  /**
   * Write to stdout (UI output).
   */
  write(data: string): void {
    process.stdout.write(data);
  }

  /**
   * Get terminal width (fallback to 80 if unavailable).
   */
  getWidth(): number {
    return process.stdout.columns ?? 80;
  }

  /**
   * Get terminal height (fallback to 24 if unavailable).
   */
  getHeight(): number {
    return process.stdout.rows ?? 24;
  }
}

// Singleton instance
export const terminal = new AnsiTerminal();
