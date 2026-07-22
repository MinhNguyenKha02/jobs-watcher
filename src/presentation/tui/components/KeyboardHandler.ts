/**
 * Keyboard Handler
 *
 * Captures keyboard input in non-blocking mode.
 * Supports vim-like keybindings (hjkl, d for delete, etc.).
 */

import readline from 'readline';

export type KeyAction = 'queue' | 'trash' | 'preview' | 'webhook_stage2_parse' | 'open' | 'ingest' | 'toggle_queue' | 'help' | 'quit' | 'modal_discard' | 'modal_scroll_up' | 'modal_scroll_down' | 'none';

export class KeyboardHandler {
  private rl: readline.Interface | null = null;
  private listeners: ((action: KeyAction) => void)[] = [];
  private isRawMode = false;

  constructor() {
    // Will be initialized on attach()
  }

  /**
   * Attach to stdin and enable raw mode for non-blocking input.
   * Must be called before waitForAction().
   */
  attach(): Promise<void> {
    return new Promise((resolve) => {
      this.rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      // Switch to raw mode for single-key input
      try {
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(true);
          this.isRawMode = true;
        }
      } catch (_) {
        // Raw mode may not be available in some environments
      }

      // Set up key listener
      process.stdin.on('data', (buffer) => {
        const action = this.keyToAction(buffer);

        if (action !== 'none') {
          this.listeners.forEach((listener) => listener(action));
        }
      });

      resolve();
    });
  }

  /**
   * Wait for the next key action with an optional timeout.
   */
  async waitForAction(timeoutMs?: number): Promise<KeyAction> {
    return new Promise((resolve) => {
      let resolved = false;
      const timeout = timeoutMs ? setTimeout(() => {
        if (!resolved) {
          resolved = true;
          unsubscribe();
          resolve('none');
        }
      }, timeoutMs) : null;

      const unsubscribe = () => {
        const idx = this.listeners.indexOf(listener);
        if (idx >= 0) {
          this.listeners.splice(idx, 1);
        }
        if (timeout) clearTimeout(timeout);
      };

      const listener = (action: KeyAction) => {
        if (!resolved) {
          resolved = true;
          unsubscribe();
          resolve(action);
        }
      };

      this.listeners.push(listener);
    });
  }

  /**
   * Detach from stdin and restore terminal settings.
   */
  detach(): void {
    try {
      if (this.isRawMode && process.stdin.isTTY) {
        process.stdin.setRawMode(false);
        this.isRawMode = false;
      }
    } catch (_err) {
      // Ignore errors when restoring terminal mode
    }

    try {
      if (this.rl) {
        this.rl.close();
        this.rl = null;
      }
    } catch (_err) {
      // Ignore errors when closing readline
    }

    this.listeners = [];
  }

  /**
   * Map a key character to an action.
   */
  private keyToAction(input: Buffer): KeyAction {
    // Arrow keys are emitted as ANSI escape sequences.
    if (input.length >= 3 && input[0] === 0x1b && input[1] === 0x5b) {
      if (input[2] === 0x41) return 'modal_scroll_up';
      if (input[2] === 0x42) return 'modal_scroll_down';
    }

    // ESC alone should dismiss modal without quitting app.
    if (input.length === 1 && input[0] === 0x1b) {
      return 'modal_discard';
    }

    const char = String.fromCharCode(input[0]).toLowerCase();
    switch (char) {
      // Routing/Ingestion
      case 'j':
        return 'queue';
      case 'd':
        return 'trash'; // Context: trash in normal mode, modal_discard in edit modal
      // case 's': skip removed - not implemented

      // Preview/Clipboard
      case 'p':
        return 'preview';
      case 'i':
        return 'ingest';

      // Webhook stage 2 parsing
      case 'c':
        return 'webhook_stage2_parse';

      // Open URL
      case 'o':
        return 'open';

      // Mode toggle: queue ↔ direct
      case 'b':
        return 'toggle_queue';

      // Help
      case '?':
        return 'help';

      // Quit (can also close modal when active)
      case 'q':
        return 'quit';

      default:
        return 'none';
    }
  }

  /**
   * Display extended help message (for ? action).
   */
  static showHelp(): string {
    const lines = [
      '',
      '╔════════════════════════════════════════════════════════╗',
      '║  JOBS WATCHER - Keyboard Reference                    ║',
      '║                                                        ║',
      '║  ROUTING:                                              ║',
      '║    j - Queue job (enriched → queued)                  ║',
      '║    d - Trash job (discard)                           ║',
      '║                                                        ║',
      '║  INGESTION:                                            ║',
      '║    p - Preview job (clipboard preview + valid)        ║',
      '║    i - Ingest job (validate + store)                  ║',
      '║    c - Stage 2 parse (clipboard → server)            ║',
      '║    o - Open job URL in browser                        ║',
      '║                                                        ║',
      '║  SYSTEM:                                               ║',
      '║    b - Toggle queue/direct mode                       ║',
      '║    ? - Show this help                                  ║',
      '║    q - Quit TUI                                        ║',
      '║                                                        ║',
      '║  Status: 🟢 SSE connected  ↕ UDS ready                ║',
      '╚════════════════════════════════════════════════════════╝',
      '',
    ];
    return lines.join('\n');
  }
}
