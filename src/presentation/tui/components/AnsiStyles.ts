/**
 * ANSI Styling Component - Color codes and theme definitions for TUI modals
 */

// GitHub Dark palette (truecolor) + ANSI fallbacks
// bg #0d1117 fg #c9d1d9 muted #8b949e border #30363d blue #58a6ff green #3fb950 red #ff7b72 yellow #d29922 purple #d2a8ff cyan #39d2c0
export const ANSI = {
  // Foreground colors — GitHub Dark truecolor
  RED: '\x1b[38;2;255;123;114m',
  GREEN: '\x1b[38;2;63;185;80m',
  YELLOW: '\x1b[38;2;210;153;34m',
  BLUE: '\x1b[38;2;88;166;255m',
  MAGENTA: '\x1b[38;2;210;168;255m',
  CYAN: '\x1b[38;2;57;210;192m',
  WHITE: '\x1b[38;2;230;237;243m',
  GRAY: '\x1b[38;2;139;148;158m',
  BRIGHT_RED: '\x1b[38;2;248;81;73m',
  BRIGHT_GREEN: '\x1b[38;2;63;185;80m',
  BRIGHT_YELLOW: '\x1b[38;2;210;153;34m',
  BRIGHT_BLUE: '\x1b[38;2;88;166;255m',
  BRIGHT_MAGENTA: '\x1b[38;2;210;168;255m',
  BRIGHT_CYAN: '\x1b[38;2;57;210;192m',
  BRIGHT_WHITE: '\x1b[38;2;230;237;243m',

  // Background colors — GitHub Dark
  BG_RED: '\x1b[48;2;255;123;114m',
  BG_GREEN: '\x1b[48;2;63;185;80m',
  BG_YELLOW: '\x1b[48;2;210;153;34m',
  BG_BLUE: '\x1b[48;2;13;17;23m',
  BG_MAGENTA: '\x1b[48;2;210;168;255m',
  BG_CYAN: '\x1b[48;2;57;210;192m',
  BG_WHITE: '\x1b[48;2;48;54;61m',

  // Text styles
  RESET: '\x1b[0m',
  BOLD: '\x1b[1m',
  DIM: '\x1b[2m',
  ITALIC: '\x1b[3m',
  UNDERLINE: '\x1b[4m',
  BLINK: '\x1b[5m',
  REVERSE: '\x1b[7m',
  HIDDEN: '\x1b[8m',
  STRIKETHROUGH: '\x1b[9m',
};

// Modal theme definitions
export const MODAL_THEME = {
  edit: {
    headerBorder: ANSI.CYAN + '┌' + ANSI.RESET,
    header: ANSI.BRIGHT_CYAN + ANSI.BOLD + '[EDIT] Confirmation' + ANSI.RESET,
    border: ANSI.CYAN,
    borderReset: ANSI.RESET,
    textHighlight: ANSI.BRIGHT_WHITE + ANSI.BOLD,
    actionApply: ANSI.BRIGHT_GREEN + '[A] Apply' + ANSI.RESET,
    actionDiscard: ANSI.BRIGHT_RED + '[D] Discard' + ANSI.RESET,
  },
  preview: {
    headerBorder: ANSI.MAGENTA + '┌' + ANSI.RESET,
    header: ANSI.BRIGHT_MAGENTA + ANSI.BOLD + '[PREVIEW] Clipboard Content' + ANSI.RESET,
    border: ANSI.MAGENTA,
    borderReset: ANSI.RESET,
    paginationLabel: ANSI.DIM + 'Page',
    paginationNumber: ANSI.BRIGHT_WHITE,
    actionHint: ANSI.GRAY + '[↑/↓] scroll • [q/ESC] close' + ANSI.RESET,
  },
  filter: {
    enabled: ANSI.BRIGHT_GREEN + '✓' + ANSI.RESET,
    disabled: ANSI.BRIGHT_RED + '✗' + ANSI.RESET,
    textOn: ANSI.GREEN + 'ON' + ANSI.RESET,
    textOff: ANSI.RED + 'OFF' + ANSI.RESET,
    message: ANSI.BRIGHT_WHITE,
    notification: ANSI.BLUE,
  },
};
