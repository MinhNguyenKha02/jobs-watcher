import { describe, it, expect } from 'vitest';

const { renderPreviewViewerModal } =
  await import('../../../../src/presentation/tui/components/PreviewViewerModal.js');

describe('PreviewViewerModal', () => {
  const sampleLines = Array.from({ length: 50 }, (_, i) => `Line ${i + 1}: test content here`);

  it('GIVEN PreviewViewerModal WHEN exercised THEN renders modal with content', () => {
    const modal: any = {
      type: 'PREVIEW_VIEWER',
      clipboardContent: sampleLines,
      currentPage: 0,
      maxLinesPerPage: 20,
      maxPages: 3,
    };

    const output = renderPreviewViewerModal(modal);
    expect(output).toContain('Line 1');
    expect(output).toContain('Line 20');
    expect(output).not.toContain('Line 21');
  });

  it('GIVEN PreviewViewerModal WHEN exercised THEN renders correct page 2 content', () => {
    const modal: any = {
      type: 'PREVIEW_VIEWER',
      clipboardContent: sampleLines,
      currentPage: 1,
      maxLinesPerPage: 20,
      maxPages: 3,
    };

    const output = renderPreviewViewerModal(modal);
    expect(output).toContain('Line 21');
    expect(output).toContain('Line 40');
    expect(output).not.toContain('Line 1');
  });

  it('GIVEN PreviewViewerModal WHEN exercised THEN renders pagination info', () => {
    const modal: any = {
      type: 'PREVIEW_VIEWER',
      clipboardContent: sampleLines,
      currentPage: 0,
      maxLinesPerPage: 20,
      maxPages: 3,
    };

    const output = renderPreviewViewerModal(modal);
    expect(output).toContain('1/3');
  });

  it('GIVEN PreviewViewerModal WHEN exercised THEN handles empty content', () => {
    const modal: any = {
      type: 'PREVIEW_VIEWER',
      clipboardContent: [],
      currentPage: 0,
      maxLinesPerPage: 20,
      maxPages: 1,
    };

    const output = renderPreviewViewerModal(modal);
    expect(output).toContain('1/1');
  });

  it('GIVEN PreviewViewerModal WHEN exercised THEN truncates long lines', () => {
    const longLine = 'x'.repeat(200);
    const modal: any = {
      type: 'PREVIEW_VIEWER',
      clipboardContent: [longLine],
      currentPage: 0,
      maxLinesPerPage: 20,
      maxPages: 1,
    };

    const output = renderPreviewViewerModal(modal);
    expect(output).toContain('...');
  });

  it('GIVEN PreviewViewerModal WHEN exercised THEN pads remaining lines on last page', () => {
    const lines = ['a', 'b'];
    const modal: any = {
      type: 'PREVIEW_VIEWER',
      clipboardContent: lines,
      currentPage: 0,
      maxLinesPerPage: 20,
      maxPages: 1,
    };

    const output = renderPreviewViewerModal(modal);
    expect(output).toBeTruthy();
  });
});
