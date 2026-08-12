import { AhoProducer } from '../producers/aho.producer.js';
import { ArtifactBundle, HydratedArtifactBundle } from '../types/artifact.types.js';

export class ArtifactHydrator {
  hydrate(artifacts: ArtifactBundle): HydratedArtifactBundle {
    const aho = {
      en: new AhoProducer().produce(artifacts.enSurfaces),

      vi: new AhoProducer().produce(artifacts.viSurfaces),
    };

    return {
      ...artifacts,
      aho,
    };
  }
}
