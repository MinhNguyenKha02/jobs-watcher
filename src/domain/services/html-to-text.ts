import { convert } from 'html-to-text';

const SPACE_RUN = /[ \t\u00a0\f\v]+/g;

export function htmlToText(html: string): string {
  if (!html || !html.trim()) return '';
  return (
    convert(html, {
      wordwrap: false,
      preserveNewlines: true,
      selectors: [
        { selector: 'a', options: { ignoreHref: true } },
        { selector: 'img', format: 'skip' },
        { selector: 'script', format: 'skip' },
        { selector: 'style', format: 'skip' },
        { selector: 'button', format: 'skip' },
        { selector: 'h1', format: 'block' },
        { selector: 'h2', format: 'block' },
        { selector: 'h3', format: 'block' },
        { selector: 'h4', format: 'block' },
        { selector: 'h5', format: 'block' },
        { selector: 'h6', format: 'block' },
      ],
    })
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => line.replace(SPACE_RUN, ' ').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim() || ''
  );
}
