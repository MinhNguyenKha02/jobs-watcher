// relations.source.draft.ts

import {
  foundationCapability,
  backendCapability,
  architectureCapability,
  testingCapability,
  databaseCapability,
  observabilityCapability,
  infrastructureCapability,
  communicationCapability,
  securityCapability,
  engineeringCompetency,
  executionCompetency,
  collaborationCompetency,
  ownershipBehavior,
  engineeringBehavior,
  protocolTech,
  languageTech,
  backendFrameworkTech,
  infrastructureTech,
  databaseTech,
  testingTech,
  securityTech,
} from './profile.source.types.js';

export type RecruiterSurfaces = {
  en: string[];
  vi: string[];
};

export interface RelationNode {
  adjacent: string[];
  recruiter_surfaces: RecruiterSurfaces;
  retrieval_associations: string[];
}

type RelationCategory = Record<string, RelationNode>;
type RelationSection = Record<string, RelationCategory>;

export interface RelationsSource {
  cap: RelationSection;
  comp: RelationSection;
  beh: RelationSection;
  tech: RelationSection;
}

const r = (
  adjacent: string[],
  en: string[],
  vi: string[],
  retrieval_associations: string[] = []
): RelationNode => ({
  adjacent,
  recruiter_surfaces: { en, vi },
  retrieval_associations,
});
export const relationsSource: RelationsSource = {
  cap: {
    foundation: {},
    backend: {},
    architecture: {},
    testing: {},
    database: {},
    observability: {},
    // ... from profile.source.ts and profile.source.types.ts
  },
  comp: {
    //... from profile.source.ts and profile.source.types.ts
  },
  beh: {
    //... from profile.source.ts and profile.source.types.ts
  },
  tech: {
    //... from profile.source.ts and profile.source.types.ts
  },
} as const satisfies RelationsSource;
