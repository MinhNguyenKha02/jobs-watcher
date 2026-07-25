import path from 'node:path';
import { createLogger } from '../logging/logger.js';
import type { AssetProducingPort } from '../../../application/ports/asset-producing.port.js';
import { renderPdf } from './renderer/pdf-renderer.js';
import { profileSource } from '../../../domain/profile/source/profile.source.js';
import { ResolveOutput } from '../../../domain/profile/types/resolve.types.js';
import { ProfileSource } from '../../../domain/profile/source/source.types.js';
import { BuildResult, PdfAsset } from '../../../domain/types/asset.js';

import { AtsSkillGroup } from '../../../domain/profile/resume/compiler/ats-skill-group.compiler.js';
import { SkillKeyNormalizer } from '../../../domain/profile/resume/normalization/skill-key-normalizer.js';

const logger = createLogger('AssetProducer');

export class AssetProducingAdapter implements AssetProducingPort {
  private outputDir: string = path.resolve(process.cwd(), 'assets');

  private profile: ProfileSource;

  private result: BuildResult = {};

  constructor() {
    this.profile = profileSource;
  }

  async toAsset(resolved: ResolveOutput, outputDir?: string): Promise<BuildResult> {
    const asset = this.toPdf(resolved, this.profile);
    this.result.pdfPath = await renderPdf(asset, outputDir ?? this.outputDir);

    logger.info('Generated PDF asset', { pdfPath: this.result.pdfPath });

    return this.result;
  }

  toPdf(
    resolved: ResolveOutput,
    profile: Pick<ProfileSource, 'name' | 'email' | 'phone' | 'location' | 'education' | 'links'>
  ): PdfAsset {
    const skillGroups = this.reSkillGroups(resolved.skills.primary);

    const experiences = resolved.experiences.map((item) => {
      const bullets = item.evidence?.bullets || [];
      return {
        title: item.evidence?.title || '',
        position: item.evidence?.position || '',
        company: item.evidence?.company || '',
        startDate: item.evidence?.startDate || '',
        endDate: item.evidence?.endDate || 'Present',
        responsibilities: bullets.filter((b) => b.kind === 'responsibility').map((b) => b.text),
        outcomes: bullets.filter((b) => b.kind === 'outcome').map((b) => b.text),
      };
    });

    const education = profile.education || [];

    const projects = resolved.projects.map((item) => {
      const bullets = item.evidence?.bullets || [];
      return {
        title: item.evidence?.title || '',
        position: item.evidence?.position || '',
        description: item.evidence?.summary || '',
        keyContributions: bullets.filter((b) => b.kind === 'responsibility').map((b) => b.text),
        outcomes: bullets.filter((b) => b.kind === 'outcome').map((b) => b.text),
        startDate: item.evidence?.startDate || '',
        endDate: item.evidence?.endDate || 'Present',
        evidences: this.flattenEvidences(item.evidence?.links),
      };
    });

    return {
      skillGroups,
      experiences,
      education,
      projects,
      name: profile.name || 'Unknown',
      contact: {
        email: profile.email || '',
        phone: profile.phone || '',
        location: profile.location || '',
        linkedin: profile.links?.linkedin || '',
        github: profile.links?.github || '',
      },
    };
  }

  private flattenEvidences(
    ev: Record<string, string[]> | undefined
  ): { key: string; items: { alias: string; url: string }[] }[] {
    return Object.entries(ev ?? {}).map(([key, values]) => ({
      key: SkillKeyNormalizer.normalizeSkillName(key),
      items: values.map((v) => {
        const idx = v.indexOf(':');
        if (idx === -1) return { alias: v, url: v };
        return { alias: v.slice(0, idx), url: v.slice(idx + 1) };
      }),
    }));
  }

  private reSkillGroups(groups: AtsSkillGroup[]): AtsSkillGroup[] {
    const CATEGORY_REMAP: Record<string, string> = {
      Backend: 'Backend',
      Architecture: 'Backend',
      Security: 'Backend',
      Communication: 'Backend',
      Fundamentals: 'Backend',
      Frameworks: 'Backend',
      Protocols: 'Backend',
      Languages: 'Languages',
      Databases: 'Databases',
      Infrastructure: 'Infrastructure',
      Testing: 'Testing',
      Observability: 'Observability',
    };
    const merged = new Map<string, Set<string>>();
    for (const group of groups) {
      const target = CATEGORY_REMAP[group.label];
      if (!target) continue;
      if (!merged.has(target)) merged.set(target, new Set());
      for (const skill of group.skills) {
        merged.get(target)!.add(skill);
      }
    }
    return Array.from(merged.entries())
      .map(([label, skills]) => ({ label, skills: Array.from(skills) }))
      .sort((a, b) => {
        const order = SkillKeyNormalizer.getCategoryOrder();
        return order.indexOf(a.label) - order.indexOf(b.label);
      });
  }
}
