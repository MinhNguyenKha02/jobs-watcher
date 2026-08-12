// src/services/profile/resume/normalization/skill-cluster-resolver.ts

import { AnchorNode } from '../../types/retrieval.types.js';

import { canonicalSkillMap } from './canonical-skill.map.js';
import { SkillKeyNormalizer } from './skill-key-normalizer.js';

export class SkillClusterResolver {
  resolve(anchorNode: AnchorNode): string {
    const normalizedSkillName = SkillKeyNormalizer.normalizeSkillName(anchorNode.key);
    return canonicalSkillMap[normalizedSkillName] ?? normalizedSkillName;
  }
}
