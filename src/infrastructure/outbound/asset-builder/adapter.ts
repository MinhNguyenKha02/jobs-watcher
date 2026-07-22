import type { Job } from '../../../domain/types/job.js';
import type { ApplicationAsset } from '../../../domain/types/profile-normalized.js';
import type { AtsSkillSection } from '../../../domain/profile/resume/compiler/ats-skill-group.compiler.js';
import type { RetrievalEvidenceScore } from '../../../domain/profile/artifacts/types/artifact.types.js';
import type { ProfileSource } from '../../../domain/profile/source/source.types.js';
import { SkillKeyNormalizer } from '../../../domain/profile/resume/normalization/skill-key-normalizer.js';

export interface ResolveOutput {
  skills: AtsSkillSection;
  experience: RetrievalEvidenceScore[];
  projects: RetrievalEvidenceScore[];
  traces: { anchorId: string; score: number; trace: unknown[] }[];
}

function flattenEvidences(
  ev: Record<string, string[]> | undefined
): { key: string; items: { alias: string; url: string }[] }[] {
  return Object.entries(ev ?? {}).map(([key, values]) => ({
    key: SkillKeyNormalizer.normalizeSkillName(key),
    items: values.map(v => {
      const idx = v.indexOf(':');
      if (idx === -1) return { alias: v, url: v };
      return { alias: v.slice(0, idx), url: v.slice(idx + 1) };
    }),
  }));
}

export function toAsset(
  resolved: ResolveOutput,
  profile: Pick<ProfileSource, 'name' | 'email' | 'phone' | 'location' | 'education' | 'links'>,
  job: Job
): ApplicationAsset {
  const nameParts = profile.name.split(' ');
  const firstName = nameParts[0] || '';
  const lastName = nameParts.slice(1).join(' ') || '';

  const skillGroups = resolved.skills.primary.map((g) => ({
    label: g.label,
    skills: [...g.skills],
  }));

  const allSkills: string[] = [];
  for (const group of resolved.skills.primary) {
    allSkills.push(...group.skills);
  }
  if (resolved.skills.secondary) {
    for (const group of resolved.skills.secondary) {
      allSkills.push(...group.skills);
    }
  }

  const experience = resolved.experience.map((item) => {
    const bullets = item.evidence?.bullets || [];
    return {
      title: item.evidence?.title || '',
      company: item.evidence?.organization || '',
      startDate: item.evidence?.startDate || '',
      endDate: item.evidence?.endDate || 'Present',
      responsibilities: bullets.filter((b) => b.kind === 'responsibility').map((b) => b.text),
      outcomes: bullets.filter((b) => b.kind === 'outcome').map((b) => b.text),
    };
  });

  const education = (profile.education || []).map((edu) => ({
    degree: edu.degree || '',
    school: edu.institution || '',
    year: edu.endDate || '',
    startDate: (edu as any).startDate || '',
    grade: (edu as any).grade || '',
  }));

  const projects = resolved.projects.map((item) => {
    const bullets = item.evidence?.bullets || [];
    return {
      title: item.evidence?.title || '',
      position: item.evidence?.position || '',
      description: item.evidence?.summary || '',
      techStack: item.evidence?.techStack || {},
      responsibilities: bullets.filter((b) => b.kind === 'responsibility').map((b) => b.text),
      outcomes: bullets.filter((b) => b.kind === 'outcome').map((b) => b.text),
      startDate: item.evidence?.startDate || '',
      endDate: item.evidence?.endDate || 'Present',
      evidences: flattenEvidences(item.evidence?.links),
    };
  });

  return {
    jobId: String(job._id || ''),
    jobTitle: (job as any).role || (job as any).position || '',
    company: job.company || '',
    sections: [],
    matchedSkills: [...new Set(allSkills)],
    skillGroups,
    skillGaps: [],
    relevanceScore: 0,
    evidenceMappings: [],
    draftedAt: new Date().toISOString(),
    profileHash: '',
    experience,
    education,
    projects,
    firstName,
    lastName,
    email: profile.email,
    phone: profile.phone,
    location: profile.location,
    linkedin: profile.links?.linkedin || '',
    github: profile.links?.github || '',
  };
}
