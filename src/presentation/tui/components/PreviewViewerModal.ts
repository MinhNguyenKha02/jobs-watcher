/**
 * Preview Viewer Modal Renderer
 *
 * Displays clipboard content with pagination
 * Clipboard-only design (single tab)
 */

import type { PreviewViewerModal } from '../shared-tui-state.js';
import type { CurrentJobState } from '../shared-tui-state.js';
import { ANSI, MODAL_THEME } from './AnsiStyles.js';

const MODAL_WIDTH = 70;

/**
 * Render the preview viewer modal
 * Displays clipboard content with pagination controls
 */
export function renderPreviewViewerModal(modal: PreviewViewerModal, state: CurrentJobState): string {
  const lines: string[] = [];

  // Calculate centering
  const terminalWidth = process.stdout.columns || 80;
  const padding = Math.max(0, Math.floor((terminalWidth - MODAL_WIDTH) / 2));
  const paddingStr = ' '.repeat(padding);

  // Top border
  lines.push(
    paddingStr + MODAL_THEME.preview.border + '┌' + '─'.repeat(MODAL_WIDTH - 2) + '┐' + ANSI.RESET
  );

  // Header
  lines.push(
    paddingStr +
      MODAL_THEME.preview.border +
      '│' +
      ANSI.RESET +
      ' ' +
      MODAL_THEME.preview.header +
      ' '.repeat(Math.max(0, MODAL_WIDTH - 27)) +
      MODAL_THEME.preview.border +
      '│' +
      ANSI.RESET
  );

  // Divider
  lines.push(
    paddingStr + MODAL_THEME.preview.border + '├' + '─'.repeat(MODAL_WIDTH - 2) + '┤' + ANSI.RESET
  );

  // Calculate which lines to show on current page
  const startLine = modal.currentPage * modal.maxLinesPerPage;
  const endLine = Math.min(startLine + modal.maxLinesPerPage, modal.clipboardContent.length);
  const pageContent = modal.clipboardContent.slice(startLine, endLine);

  // Display content lines
  for (const contentLine of pageContent) {
    // Truncate line if too long
    const displayLine = contentLine.length > MODAL_WIDTH - 4
      ? contentLine.substring(0, MODAL_WIDTH - 7) + '...'
      : contentLine;

    lines.push(
      paddingStr +
        MODAL_THEME.preview.border +
        '│' +
        ANSI.RESET +
        ' ' +
        displayLine +
        ' '.repeat(Math.max(0, MODAL_WIDTH - 3 - displayLine.length)) +
        MODAL_THEME.preview.border +
        '│' +
        ANSI.RESET
    );
  }

  // Pad remaining lines in view
  const remainingLines = modal.maxLinesPerPage - pageContent.length;
  for (let i = 0; i < remainingLines; i++) {
    lines.push(
      paddingStr +
        MODAL_THEME.preview.border +
        '│' +
        ANSI.RESET +
        ' ' +
        ' '.repeat(MODAL_WIDTH - 3) +
        MODAL_THEME.preview.border +
        '│' +
        ANSI.RESET
    );
  }

  // Divider before pagination
  lines.push(
    paddingStr + MODAL_THEME.preview.border + '├' + '─'.repeat(MODAL_WIDTH - 2) + '┤' + ANSI.RESET
  );

  // Pagination info
  const paginationText = `${MODAL_THEME.preview.paginationLabel} ${MODAL_THEME.preview.paginationNumber}${modal.currentPage + 1}/${modal.maxPages}${ANSI.RESET}`;
  const hintText = MODAL_THEME.preview.actionHint;
  const paginationLine =
    paddingStr +
    MODAL_THEME.preview.border +
    '│' +
    ANSI.RESET +
    ' ' +
    paginationText +
    ' '.repeat(Math.max(0, MODAL_WIDTH - 15 - paginationText.replace(/\x1b\[[0-9;]*m/g, '').length)) +
    hintText +
    ' '.repeat(Math.max(0, MODAL_WIDTH - 40 - hintText.replace(/\x1b\[[0-9;]*m/g, '').length)) +
    MODAL_THEME.preview.border +
    '│' +
    ANSI.RESET;
  lines.push(paginationLine);

  // Bottom border
  lines.push(
    paddingStr + MODAL_THEME.preview.border + '└' + '─'.repeat(MODAL_WIDTH - 2) + '┘' + ANSI.RESET
  );

  return lines.join('\n');
}
