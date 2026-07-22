import { MatchSignal, AnchorNode } from '../../types/retrieval.types.js';
import { retrievalPolicy } from '../../retrieval/policies/retrieval.policy.js';
import { SkillKeyNormalizer } from '../normalization/skill-key-normalizer.js';
import { AtsSkillGroupMapper } from './ats-skill-group.mapper.js';
import { SkillClusterResolver } from '../normalization/skill-cluster-resolver.js';

export interface AtsSkillGroup {
  label: string;
  skills: string[];
}

export interface AtsSkillSection {
  primary: AtsSkillGroup[];
  secondary?: AtsSkillGroup[];
}

export class AtsSkillGroupCompiler {
  private readonly mapper = new AtsSkillGroupMapper();
  private readonly clusterResolver = new SkillClusterResolver();
  private readonly policy = retrievalPolicy;

  constructor() {}

  compile(
    matchedSignals: MatchSignal[],
    unmatchedSignals: MatchSignal[],
    anchorMap: Map<string, AnchorNode>
  ): AtsSkillSection {
    const result: AtsSkillSection = {
      primary: [],
      secondary: []
    };

    // Use ordered arrays per group: matched first, then unmatched
    const primaryGroups = new Map<string, { matched: string[]; unmatched: string[] }>();

    const processSignals = (signals: MatchSignal[], isMatched: boolean) => {
      for (const signal of signals) {
        const anchorNode = anchorMap.get(signal.anchorId);
        if (!anchorNode) continue;

        const normalizedSkillName = SkillKeyNormalizer.normalizeSkillName(anchorNode.key);

        const canonicalSkillName = this.clusterResolver.resolve({
          kind: anchorNode.kind,
          category: anchorNode.category,
          key: normalizedSkillName
        } as AnchorNode);

        const sectionKind = AtsSkillGroupMapper.getSectionKind(anchorNode.kind as 'cap' | 'comp' | 'beh' | 'tech');

        if (anchorNode.kind === 'beh') {
          continue;
        }

        const groupLabel = AtsSkillGroupMapper.mapCategoryToGroupLabel(anchorNode.category);

        const groupMap = sectionKind === 'primary' ? primaryGroups : undefined;
        if (!groupMap) continue;

        let entry = groupMap.get(groupLabel);
        if (!entry) {
          entry = { matched: [], unmatched: [] };
          groupMap.set(groupLabel, entry);
        }

        const list = isMatched ? entry.matched : entry.unmatched;
        if (!list.includes(canonicalSkillName)) {
          list.push(canonicalSkillName);
        }
      }
    };

    // Process matched first, then unmatched
    processSignals(matchedSignals, true);
    processSignals(unmatchedSignals, false);

    result.primary = Array.from(primaryGroups.entries())
      .map(([label, { matched, unmatched }]) => ({
        label,
        skills: [...matched, ...unmatched]
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    return result;
  }
}
