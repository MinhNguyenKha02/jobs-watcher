/**
 * ANSI Styling Component - Color codes and theme definitions for TUI modals
 */

// ANSI color codes
export const ANSI = {
  // Foreground colors
  RED: '\x1b[31m',
  GREEN: '\x1b[32m',
  YELLOW: '\x1b[33m',
  BLUE: '\x1b[34m',
  MAGENTA: '\x1b[35m',
  CYAN: '\x1b[36m',
  WHITE: '\x1b[37m',
  GRAY: '\x1b[90m',
  BRIGHT_RED: '\x1b[91m',
  BRIGHT_GREEN: '\x1b[92m',
  BRIGHT_YELLOW: '\x1b[93m',
  BRIGHT_BLUE: '\x1b[94m',
  BRIGHT_MAGENTA: '\x1b[95m',
  BRIGHT_CYAN: '\x1b[96m',
  BRIGHT_WHITE: '\x1b[97m',

  // Background colors
  BG_RED: '\x1b[41m',
  BG_GREEN: '\x1b[42m',
  BG_YELLOW: '\x1b[43m',
  BG_BLUE: '\x1b[44m',
  BG_MAGENTA: '\x1b[45m',
  BG_CYAN: '\x1b[46m',
  BG_WHITE: '\x1b[47m',

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
