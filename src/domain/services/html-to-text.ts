import { convert } from 'html-to-text';

export function htmlToText(html: string): string {
  if (!html || !html.trim()) return '';
  return convert(html, {
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
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
