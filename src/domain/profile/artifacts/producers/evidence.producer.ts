import {
  ExperienceSource,
  ProfileAnchorSection,
  ProfileSource,
  ProjectSource,
} from '../../source/source.types.js';

import { AnchorId, EvidenceBullet, EvidenceId, EvidenceNode } from '../../types/retrieval.types.js';

export class EvidenceProducer {
  private extractAnchorIds(anchor?: {
    cap?: ProfileAnchorSection;
    comp?: ProfileAnchorSection;
    beh?: ProfileAnchorSection;
    tech?: ProfileAnchorSection;
  }): AnchorId[] {
    if (!anchor) return [];

    const result: AnchorId[] = [];

    for (const [kind, categories] of Object.entries(anchor)) {
      if (!categories) continue;

      for (const [category, values] of Object.entries(categories)) {
        for (const value of values) {
          result.push(`${kind}.${category}.${value}` as AnchorId);
        }
      }
    }

    return result;
  }

  produce(profile: ProfileSource) {
    const evidences = new Map<EvidenceId, EvidenceNode>();

    let counter = 0;

    for (const project of profile.projects ?? []) {
      const id = `ev.project.${counter++}` as EvidenceId;

      evidences.set(id, this.projectNode(id, project));
    }

    for (const experience of profile.experiences ?? []) {
      const id = `ev.exp.${counter++}` as EvidenceId;

      evidences.set(id, this.experienceNode(id, experience));
    }

    return evidences;
  }

  private projectNode(id: EvidenceId, project: ProjectSource): EvidenceNode {
    return {
      id,

      anchorIds: this.extractAnchorIds(project.anchors),

      type: 'project',

      title: project.name,

      position: project.position,

      startDate: project.startDate,

      endDate: project.endDate ?? 'Present',

      summary: project.summary?.trim(),

      bullets: this.buildBullets({
        responsibilities: project.key_contributions,

        outcomes: project.outcomes,
      }),

      links: project.evidences,
    };
  }

  private experienceNode(id: EvidenceId, experience: ExperienceSource): EvidenceNode {
    return {
      id,

      anchorIds: this.extractAnchorIds(experience.anchors),

      type: 'experience',

      company: experience.company,

      position: experience.position,

      startDate: experience.startDate,

      endDate: experience.endDate ?? 'Present',

      bullets: this.buildBullets({
        responsibilities: experience.responsibilities,

        outcomes: experience.outcomes,
      }),
    };
  }

  private buildBullets({
    responsibilities,
    outcomes,
  }: {
    responsibilities: string[];
    outcomes: string[];
  }) {
    const bullets: EvidenceBullet[] = [];

    for (const responsibility of responsibilities) {
      bullets.push({
        text: responsibility,

        kind: 'responsibility',

        weight: 0.8,
      });
    }

    for (const outcome of outcomes) {
      bullets.push({
        text: outcome,

        kind: 'outcome',

        weight: 1,
      });
    }

    return bullets;
  }
}
