import { AhoCorasick } from '../../retrieval/aho-corasick.js';
import { NormalizationPipeline } from '../../retrieval/normalization.pipeline.js';
import { LexicalSurface } from '../../types/retrieval.types.js';

export class AhoProducer {
  produce(surfaces: LexicalSurface[]) {
    const aho = new AhoCorasick();
    const normalizer = new NormalizationPipeline();

    for (const surface of surfaces) {
      aho.insert({
        pattern: normalizer.boundaryWrap(normalizer.normalize(`${surface.pattern.toLowerCase()}`)),

        anchorId: surface.anchorId,

        weight: surface.weight,

        source: surface.source,
      });
    }

    aho.buildFallbackLinks();

    return aho;
  }
}
