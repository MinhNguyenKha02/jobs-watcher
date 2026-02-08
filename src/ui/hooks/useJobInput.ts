import type { JobUIState, ActionType, Mode } from './useJobState.js';
import { openUrlInBrowser } from '../services/urlHandler.js';

/**
 * Input handlers for core TUI actions
 * Actions: open browser (o), paste HTML (p), apply (a submenu), queue (q)
 */
export interface InputHandlers {
  onApplyMode: () => void;
  onHtmlPaste: () => void;
  onOpenUrl: () => void;
  onConfirm: () => void;
  onEscape: () => void;
  onCustomApply: () => void;
  onGenerateApply: () => void;
  onEditApply: () => void;
  onBackFromSubmenu: () => void;
  onInputChar: (char: string) => void;
  onBackspace: () => void;
}

export function createInputHandlers(
  state: JobUIState,
  handlers: {
    setSelected: (action: ActionType) => void;
    setMode: (mode: Mode) => void;
    setInputBuffer: (text: string) => void;
    onInputReturn: () => void;
    onOpenUrl: () => void;
    onConfirm: () => void;
    onEscape: () => void;
  }
): InputHandlers {
  return {
    onApplyMode: () => {
      if (state.mode === 'menu' && state.selected.startsWith('apply')) {
        handlers.setMode('apply-submenu');
      }
    },

    onHtmlPaste: () => {
      if (state.mode === 'menu') {
        handlers.setMode('html');
        handlers.setInputBuffer('');
      }
    },

    onOpenUrl: () => {
      handlers.onOpenUrl();
    },

    onConfirm: () => {
      if (state.mode === 'menu') {
        handlers.onConfirm();
      } else {
        handlers.onInputReturn();
      }
    },

    onEscape: () => {
      handlers.onEscape();
    },

    onCustomApply: () => {
      if (state.mode === 'apply-submenu') {
        handlers.setSelected('apply-custom');
        handlers.setMode('menu');
      }
    },

    onGenerateApply: () => {
      if (state.mode === 'apply-submenu') {
        handlers.setSelected('apply-generate');
        handlers.setMode('menu');
      }
    },

    onEditApply: () => {
      if (state.mode === 'apply-submenu') {
        handlers.setSelected('apply-edit');
        handlers.setMode('menu');
      }
    },

    onBackFromSubmenu: () => {
      if (state.mode === 'apply-submenu') {
        handlers.setMode('menu');
      }
    },

    onInputChar: (char: string) => {
      if (state.mode !== 'menu' && state.mode !== 'apply-submenu') {
        handlers.setInputBuffer(state.inputBuffer + char);
      }
    },

    onBackspace: () => {
      if (state.mode !== 'menu' && state.mode !== 'apply-submenu') {
        handlers.setInputBuffer(state.inputBuffer.slice(0, -1));
      }
    },
  };
}
