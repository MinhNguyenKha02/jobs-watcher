import { profileSource } from '../../source/profile.source.js';

import { relationsSource } from '../../source/relations.source.js';

import { AnchorProducer } from '../producers/anchor.producer.js';

import { EvidenceProducer } from '../producers/evidence.producer.js';

import { LexicalSurfaceProducer } from '../producers/lexical-surface.producer.js';

import { AdjacencyProducer } from '../producers/adjacency.producer.js';

import { AnchorEvidenceProducer } from '../producers/anchor-evidence.producer.js';

import { serializeMap, serializeNestedSetMap } from '../serializers/map.serializer.js';
import { getLogger } from '../../../../infrastructure/outbound/logging/logger.js';

import { ensureArtifactDirectory, writeArtifactFile } from '../utils/artifact-file.util.js';

import { ARTIFACT_VERSION } from '../constants/artifact.constants.js';

export async function buildArtifacts(): Promise<void> {
  await ensureArtifactDirectory();

  const anchors = new AnchorProducer().produce(profileSource);

  const evidences = new EvidenceProducer().produce(profileSource);

  const surfaces = new LexicalSurfaceProducer().produce(relationsSource);

  const adjacency = new AdjacencyProducer(new Set(anchors.keys())).produce(relationsSource);

  const anchorToEvidence = new AnchorEvidenceProducer().produce({
    evidences,
  });

  const enSurfaces = surfaces.filter(s => s.language === 'en');
  const viSurfaces = surfaces.filter(s => s.language === 'vi');

  await Promise.all([
    writeArtifactFile('anchors.json', serializeMap(anchors)),

    writeArtifactFile('evidences.json', serializeMap(evidences)),

    writeArtifactFile('surfaces.en.json', enSurfaces),

    writeArtifactFile('surfaces.vi.json', viSurfaces),

    writeArtifactFile('adjacency.json', serializeMap(adjacency)),

    writeArtifactFile('anchor-to-evidence.json', serializeNestedSetMap(anchorToEvidence)),

    writeArtifactFile('metadata.json', {
      generatedAt: new Date().toISOString(),

      version: ARTIFACT_VERSION,
    }),
  ]);

  getLogger().info('Artifacts built successfully.');
}

// Run directly when invoked as CLI script
const __filename = new URL(import.meta.url).pathname;
const isMainModule = process.argv[1] && (
  process.argv[1] === __filename ||
  process.argv[1].endsWith('/artifact.builder.ts') ||
  process.argv[1].endsWith('/artifact.builder.js')
);
if (isMainModule) {
  buildArtifacts().catch((error) => {
    getLogger().error(String(error));
    process.exit(1);
  });
}
