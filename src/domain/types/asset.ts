import { AtsSkillSection } from "../profile/resume/compiler/ats-skill-group.compiler.js";
import { EducationSource, ExperienceSource, ProjectSource} from "../profile/source/source.types.js";

export interface PdfAsset {
  name: string;
  contact: {
    email: string;
    phone: string;
    location: string;
    linkedin?: string;
    github?: string;
  };
  skillGroups: { label: string; skills: string[] }[];
  experiences: { company: string; position: string; startDate: string; endDate: string; responsibilities: string[]; outcomes: string[] }[];
  education: EducationSource[];
  projects: { title: string; position: string; startDate: string; endDate: string; keyContributions: string[]; outcomes: string[]; evidences: { key: string; items: { alias: string; url: string }[] }[] }[];
}

export interface BuildResult {
  atsPath?: string;
  coverLetterPath?: string;
  pdfPath?: string;
}