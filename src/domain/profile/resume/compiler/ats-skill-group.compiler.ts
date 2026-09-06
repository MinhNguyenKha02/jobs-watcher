import { retrievalPolicy } from '../../retrieval/policies/retrieval.policy.js';
import { RankedSignal } from '../../retrieval/ranking/retrieval-ranker.js';
import { MatchSignal, AnchorNode } from '../../types/retrieval.types.js';
import { SkillClusterResolver } from '../normalization/skill-cluster-resolver.js';
import { SkillKeyNormalizer } from '../normalization/skill-key-normalizer.js';

import { AtsSkillGroupMapper } from './ats-skill-group.mapper.js';

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
    matchedSignals: (RankedSignal | MatchSignal)[],
    unmatchedSignals: (RankedSignal | MatchSignal)[],
    anchorMap: Map<string, AnchorNode>
  ): AtsSkillSection {
    const result: AtsSkillSection = {
      primary: [],
      secondary: [],
    };

    // Strict 3 per label, matched first / unmatched second, maxScore DESC (no localeCompare)
    const primaryGroups = new Map<
      string,
      {
        matched: { name: string; score: number }[];
        unmatched: { name: string; score: number }[];
        maxScore: number;
      }
    >();

    const isRanked = (v: RankedSignal | MatchSignal): v is RankedSignal =>
      (v as RankedSignal).signal !== undefined && (v as RankedSignal).finalScore !== undefined;

    const processSignals = (signals: (RankedSignal | MatchSignal)[], isMatched: boolean) => {
      for (const item of signals) {
        const signal: MatchSignal = isRanked(item) ? item.signal : (item as MatchSignal);
        const score: number = isRanked(item) ? item.finalScore : 0;

        const anchorNode = anchorMap.get(signal.anchorId);
        if (!anchorNode) continue;

        const normalizedSkillName = SkillKeyNormalizer.normalizeSkillName(anchorNode.key);

        const canonicalSkillName = this.clusterResolver.resolve({
          kind: anchorNode.kind,
          category: anchorNode.category,
          key: normalizedSkillName,
        } as AnchorNode);

        const sectionKind = AtsSkillGroupMapper.getSectionKind(
          anchorNode.kind as 'cap' | 'comp' | 'beh' | 'tech'
        );

        if (anchorNode.kind === 'beh') {
          continue;
        }

        const groupLabel = AtsSkillGroupMapper.mapCategoryToGroupLabel(anchorNode.category);
        // third_party hidden sentinel
        if (!groupLabel) continue;

        const groupMap = sectionKind === 'primary' ? primaryGroups : undefined;
        if (!groupMap) continue;

        let entry = groupMap.get(groupLabel);
        if (!entry) {
          entry = { matched: [], unmatched: [], maxScore: -Infinity };
          groupMap.set(groupLabel, entry);
        }

        // track maxScore per label for inter-group ordering
        if (score > entry.maxScore) entry.maxScore = score;

        const list = isMatched ? entry.matched : entry.unmatched;
        if (!list.some((e) => e.name === canonicalSkillName)) {
          list.push({ name: canonicalSkillName, score });
        }
      }
    };

    // Process matched first, then unmatched (global finalScore DESC already from resolver)
    processSignals(matchedSignals, true);
    processSignals(unmatchedSignals, false);

    result.primary = Array.from(primaryGroups.entries())
      .map(([label, { matched, unmatched, maxScore }]) => {
        // per-label maxScore DESC before strict cap
        matched.sort((a, b) => b.score - a.score);
        unmatched.sort((a, b) => b.score - a.score);
        const takeMatched = matched.slice(0, 3);
        const need = 3 - takeMatched.length;
        const takeUnmatched = need > 0 ? unmatched.slice(0, need) : [];
        return {
          label,
          maxScore,
          skills: [...takeMatched, ...takeUnmatched].map((e) => e.name),
        };
      })
      .filter((g) => g.skills.length > 0)
      .sort((a, b) => b.maxScore - a.maxScore)
      .map(({ label, skills }) => ({ label, skills }));

    return result;
  }
}
