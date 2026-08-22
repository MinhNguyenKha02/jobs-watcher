declare module 'html-to-text' {
  export interface HtmlToTextOptions {
    wordwrap?: boolean | number | null;
    preserveNewlines?: boolean;
    selectors?: Array<{
      selector: string;
      format?: string;
      options?: Record<string, unknown>;
    }>;
  }

  export function convert(html: string, options?: HtmlToTextOptions): string;
}
