import { describe, it, expect } from 'vitest';
import { ANSI, MODAL_THEME } from '../../../../src/presentation/tui/components/AnsiStyles.js';

describe('ANSI constants', () => {
  it('has foreground colors', () => {
    expect(ANSI.RED).toBe('\x1b[31m');
    expect(ANSI.GREEN).toBe('\x1b[32m');
    expect(ANSI.RESET).toBe('\x1b[0m');
  });

  it('has background colors', () => {
    expect(ANSI.BG_RED).toBe('\x1b[41m');
    expect(ANSI.BG_GREEN).toBe('\x1b[42m');
  });

  it('has text style codes', () => {
    expect(ANSI.BOLD).toBe('\x1b[1m');
    expect(ANSI.DIM).toBe('\x1b[2m');
    expect(ANSI.ITALIC).toBe('\x1b[3m');
  });

  it('has bright colors', () => {
    expect(ANSI.BRIGHT_RED).toBe('\x1b[91m');
    expect(ANSI.BRIGHT_CYAN).toBe('\x1b[96m');
  });
});

describe('MODAL_THEME', () => {
  it('has edit section', () => {
    expect(MODAL_THEME.edit.headerBorder).toContain(ANSI.CYAN);
    expect(MODAL_THEME.edit.header).toContain('[EDIT]');
    expect(MODAL_THEME.edit.actionApply).toContain('[A] Apply');
    expect(MODAL_THEME.edit.actionDiscard).toContain('[D] Discard');
  });

  it('has preview section', () => {
    expect(MODAL_THEME.preview.header).toContain('[PREVIEW]');
    expect(MODAL_THEME.preview.actionHint).toContain('[↑/↓]');
  });

  it('has filter section', () => {
    expect(MODAL_THEME.filter.enabled).toContain('\x1b[92m');
    expect(MODAL_THEME.filter.textOn).toContain('ON');
    expect(MODAL_THEME.filter.textOff).toContain('OFF');
  });

  it('edit section wraps with ANSI reset', () => {
    expect(MODAL_THEME.edit.header).toContain(ANSI.RESET);
    expect(MODAL_THEME.preview.actionHint).toContain(ANSI.RESET);
  });
});
