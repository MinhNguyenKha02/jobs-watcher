import { AnchorKind } from '../types/retrieval.types.js';
import type { TechAliases } from './relations.source.js';

export type RecruiterSurfaces = {
  en: string[];
  vi: string[];
};

export interface RelationNode {
  adjacent: string[];
  recruiter_surfaces: RecruiterSurfaces;
  retrieval_associations: string[];
  approved_aliases?: TechAliases;
}

export type RelationCategory = Record<string, RelationNode>;

export type RelationsSource = Partial<Record<AnchorKind, Record<string, RelationCategory>>>;

export enum ProfileRole {
  SoftwareEngineer = 'Software Engineer',
  BackendEngineer = 'Backend Engineer',
  FullStackEngineer = 'Full-Stack Engineer',
  SoftwareDeveloper = 'Software Developer',
  BackendDeveloper = 'Backend Developer',
  FullStackDeveloper = 'Full-Stack Developer',
}

export interface ProjectSource {
  name: string;

  position: string;

  startDate: string;

  endDate?: string;

  type: string;

  anchors: {
    cap?: ProfileAnchorSection;

    comp?: ProfileAnchorSection;

    beh?: ProfileAnchorSection;

    tech?: ProfileAnchorSection;
  };

  summary?: string;

  key_contributions: string[];

  outcomes: string[];

  status?: string;

  evidences?: Record<string, string[]>;
}

export interface ExperienceSource {
  company: string;

  position: string;

  location?: string;

  startDate: string;

  endDate?: string;

  anchors: {
    cap?: ProfileAnchorSection;

    comp?: ProfileAnchorSection;

    beh?: ProfileAnchorSection;

    tech?: ProfileAnchorSection;
  };

  responsibilities: string[];

  outcomes: string[];
}

export interface EducationSource {
  institution: string;

  degree: string;

  startDate: string;

  endDate?: string;

  grade?: string;
}

export interface ProfileAnchorSection {
  [category: string]: string[];
}

export interface ProfileSource {
  name: string;

  email: string;

  phone?: string;

  location?: string;

  title?: string;

  cap?: ProfileAnchorSection;

  comp?: ProfileAnchorSection;

  beh?: ProfileAnchorSection;

  tech?: ProfileAnchorSection;

  projects?: ProjectSource[];

  experiences?: ExperienceSource[];

  education?: EducationSource[];

  links?: Record<string, string>;
}
