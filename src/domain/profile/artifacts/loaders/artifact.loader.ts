import {
  AnchorId,
  AnchorNode,
  EvidenceId,
  EvidenceNode,
  LexicalSurface,
  AdjacencyEdge,
} from '../../types/retrieval.types.js';
import { deserializeMap, deserializeNestedSetMap } from '../serializers/map.serializer.js';
import { ArtifactBundle } from '../types/artifact.types.js';
import { readArtifactFile } from '../utils/artifact-file.util.js';

export class ArtifactLoader {
  async load(): Promise<ArtifactBundle> {
    const [anchors, evidences, enSurfaces, viSurfaces, adjacency, anchorToEvidence] =
      await Promise.all([
        readArtifactFile<[AnchorId, AnchorNode][]>('anchors.json'),

        readArtifactFile<[EvidenceId, EvidenceNode][]>('evidences.json'),

        readArtifactFile<LexicalSurface[]>('surfaces.en.json'),

        readArtifactFile<LexicalSurface[]>('surfaces.vi.json'),

        readArtifactFile<[AnchorId, AdjacencyEdge[]][]>('adjacency.json'),

        readArtifactFile<[AnchorId, EvidenceId[]][]>('anchor-to-evidence.json'),
      ]);

    return {
      anchors: deserializeMap(anchors),

      evidences: deserializeMap(evidences),

      enSurfaces,
      viSurfaces,

      adjacency: deserializeMap(adjacency),

      anchorToEvidence: deserializeNestedSetMap(anchorToEvidence),
    };
  }
}
