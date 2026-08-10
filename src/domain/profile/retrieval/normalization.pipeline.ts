export class NormalizationPipeline {
  normalize(text: string) {
    return text
      .toLowerCase()

      .normalize('NFKC')

      .replace(/[^a-z0-9+#.\-/\s]/g, ' ')

      .replace(/\s+/g, ' ')

      .trim();
  }

  tokenize(text: string) {
    return this.normalize(text).split(' ');
  }

  boundaryWrap(text: string) {
    return ` ${this.normalize(text)} `;
  }

  prepare(text: string) {
    return this.boundaryWrap(this.normalize(text));
  }
}
