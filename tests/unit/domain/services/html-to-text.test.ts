import { describe, it, expect } from 'vitest';

import { htmlToText } from '../../../../src/domain/services/html-to-text.js';

describe('htmlToText', () => {
  it('GIVEN htmlToText input "<p>Hello world</p>" WHEN htmlToText evaluates THEN returns plain text content', () => {
    expect(htmlToText('<p>Hello world</p>')).toBe('Hello world');
  });

  it('GIVEN htmlToText input with nested lists WHEN htmlToText evaluates THEN preserves list structure as lines', () => {
    const html = '<h2>Requirements</h2><ul><li>TypeScript</li><li>Node.js</li></ul>';
    const result = htmlToText(html);

    expect(result).toContain('Requirements');
    expect(result).toContain('TypeScript');
    expect(result).toContain('Node.js');
  });

  it('GIVEN htmlToText input with anchors WHEN htmlToText evaluates THEN keeps link text and drops href', () => {
    const result = htmlToText('<a href="https://example.com/apply">Apply here</a>');

    expect(result).toContain('Apply here');
    expect(result).not.toContain('https://example.com');
  });

  it('GIVEN htmlToText input with script/style/button WHEN htmlToText evaluates THEN skips non-content elements', () => {
    const html =
      '<script>alert("x")</script><style>.a{color:red}</style><button>...more</button><p>Visible</p>';
    const result = htmlToText(html);

    expect(result).toContain('Visible');
    expect(result).not.toContain('alert');
    expect(result).not.toContain('.a{color:red}');
  });

  it('GIVEN htmlToText input "" WHEN htmlToText evaluates THEN returns empty string', () => {
    expect(htmlToText('')).toBe('');
  });

  it('GIVEN htmlToText input whitespace-only string WHEN htmlToText evaluates THEN returns empty string', () => {
    expect(htmlToText('   \n\t ')).toBe('');
  });

  it('GIVEN htmlToText input with excessive blank lines WHEN htmlToText evaluates THEN collapses to double newline', () => {
    const result = htmlToText('<p>A</p><br><br><br><br><p>B</p>');

    expect(result).not.toMatch(/\n{3,}/);
    expect(result).toContain('A');
    expect(result).toContain('B');
  });
});
