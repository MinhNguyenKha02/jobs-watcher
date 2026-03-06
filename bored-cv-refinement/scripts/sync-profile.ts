#!/usr/bin/env node
/**
 * Profile Sync Script
 * Watches profile.prebuilt.json and syncs changes to portfolio/data.ts
 * 
 * Usage:
 *   ts-node scripts/sync-profile.ts [--watch]
 *   pnpm sync:profile
 *   pnpm sync:profile:watch
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const profilePath = path.join(rootDir, "profile.prebuilt.json");
const dataPath = path.join(rootDir, "portfolio", "data.ts");
const PROFILE_START_MARKER = "// <PROFILE_GENERATED_START>";
const PROFILE_END_MARKER = "// <PROFILE_GENERATED_END>";

type LooseRecord = Record<string, unknown>;

interface NormalizedProfile {
  name: string;
  email: string;
  phone: string;
  location: string;
  software_fundamentals: {
    programming_language: { solid: string[]; familiar: string[] };
    dsa: string[];
    os: string[];
    oop: string[];
    database: string[];
    networking: string[];
    security: string[];
    test: string[];
    ai: string[];
  };
  skills: {
    backend: {
      architecture: string[];
      frameworks: { solid: string[]; familiar: string[] };
      api: { solid: string[]; familiar: string[] };
      database: { solid: string[]; familiar: string[] };
      authentication_authorization: string[];
      security: string[];
    };
    frontend: {
      frameworks: { solid: string[]; familiar: string[] };
      comfort: string[];
    };
    devops: {
      containerization: { familiar: string[] };
      ci_cd: string[];
      cloud: { solid: string[]; familiar: string[] };
    };
    tooling: string[];
    methodologies: string[];
    soft_skills: string[];
  };
  projects: Array<{
    name: string;
    period: string;
    type: string;
    summary: string;
    tech: string[];
    status: string;
  }>;
  experience: Array<{
    company: string;
    position: string;
    location: string;
    startDate: string;
    endDate: string;
    highlights: string[];
  }>;
  education: Array<{
    institution: string;
    degree: string;
    field: string;
    startDate: string;
    endDate: string;
    gpa: string;
  }>;
  links: {
    linkedin: string;
    github: string;
    portfolio: string;
    website: string;
  };
}

const asRecord = (value: unknown): LooseRecord => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as LooseRecord;
  }
  return {};
};

const asString = (value: unknown, fallback = ""): string => {
  if (typeof value !== "string") return fallback;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : fallback;
};

const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const normalized = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter((item) => item.length > 0);
  return Array.from(new Set(normalized));
};

const compactText = (value: string, maxLength: number): string =>
  value.length <= maxLength ? value : `${value.slice(0, maxLength - 1).trimEnd()}…`;

const pickRecord = (source: LooseRecord, keys: string[]): LooseRecord => {
  for (const key of keys) {
    const value = source[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as LooseRecord;
    }
  }
  return {};
};

const pickArray = (source: LooseRecord, keys: string[]): string[] => {
  for (const key of keys) {
    const arr = asStringArray(source[key]);
    if (arr.length > 0) return arr;
  }
  return [];
};

function normalizeProfile(raw: unknown): NormalizedProfile {
  const root = asRecord(raw);
  const fundamentalsRoot = pickRecord(root, ["software_fundamentals", "softwareFundamentals"]);
  const programmingLanguage = pickRecord(fundamentalsRoot, ["programming_language", "programming_languages"]);
  const skillsRoot = asRecord(root.skills);
  const backend = asRecord(skillsRoot.backend);
  const frontend = asRecord(skillsRoot.frontend);
  const devops = asRecord(skillsRoot.devops);
  const projects = Array.isArray(root.projects) ? root.projects : [];
  const experience = Array.isArray(root.experience) ? root.experience : [];
  const education = Array.isArray(root.education) ? root.education : [];
  const links = asRecord(root.links);

  return {
    name: asString(root.name),
    email: asString(root.email),
    phone: asString(root.phone),
    location: asString(root.location),
    software_fundamentals: {
      programming_language: {
        solid: asStringArray(programmingLanguage.solid),
        familiar: asStringArray(programmingLanguage.familiar),
      },
      dsa: asStringArray(fundamentalsRoot.dsa),
      os: asStringArray(fundamentalsRoot.os),
      oop: asStringArray(fundamentalsRoot.oop),
      database: asStringArray(fundamentalsRoot.database),
      networking: asStringArray(fundamentalsRoot.networking),
      security: asStringArray(fundamentalsRoot.security),
      test: pickArray(fundamentalsRoot, ["test", "testing"]),
      ai: asStringArray(fundamentalsRoot.ai),
    },
    skills: {
      backend: {
        architecture: asStringArray(backend.architecture),
        frameworks: {
          solid: asStringArray(asRecord(backend.frameworks).solid),
          familiar: asStringArray(asRecord(backend.frameworks).familiar),
        },
        api: {
          solid: asStringArray(asRecord(backend.api).solid),
          familiar: asStringArray(asRecord(backend.api).familiar),
        },
        database: {
          solid: asStringArray(asRecord(backend.database).solid),
          familiar: asStringArray(asRecord(backend.database).familiar),
        },
        authentication_authorization: pickArray(backend, [
          "Authentication/Authorization",
          "Authentication\\/Authorization",
          "authentication_authorization",
          "authenticationAuthorization",
        ]),
        security: asStringArray(backend.security),
      },
      frontend: {
        frameworks: {
          solid: asStringArray(asRecord(frontend.frameworks).solid),
          familiar: asStringArray(asRecord(frontend.frameworks).familiar),
        },
        comfort: asStringArray(frontend.comfort),
      },
      devops: {
        containerization: {
          familiar: asStringArray(asRecord(devops.containerization).familiar),
        },
        ci_cd: pickArray(devops, ["ci_cd", "ciCd"]),
        cloud: {
          solid: asStringArray(asRecord(devops.cloud).solid),
          familiar: asStringArray(asRecord(devops.cloud).familiar),
        },
      },
      tooling: asStringArray(skillsRoot.tooling),
      methodologies: asStringArray(skillsRoot.methodologies),
      soft_skills: pickArray(skillsRoot, ["soft_skills", "softSkills"]),
    },
    projects: projects.map((project, index) => {
      const entry = asRecord(project);
      return {
        name: asString(entry.name, `Untitled Project ${index + 1}`),
        period: asString(entry.period, "n/a"),
        type: asString(entry.type, "lab"),
        summary: compactText(asString(entry.summary), 180),
        tech: asStringArray(entry.tech).slice(0, 8),
        status: asString(entry.status, "active"),
      };
    }),
    experience: experience.map((item) => {
      const entry = asRecord(item);
      const highlights = asStringArray(entry.highlights);
      const description = asStringArray(entry.description);
      const outcomes = asStringArray(entry.outcomes);
      const mergedHighlights = highlights.length > 0 ? highlights : description.length > 0 ? description : outcomes;
      return {
        company: asString(entry.company),
        position: asString(entry.position),
        location: asString(entry.location),
        startDate: asString(entry.startDate),
        endDate: asString(entry.endDate),
        highlights: mergedHighlights.map((item) => compactText(item, 120)).slice(0, 3),
      };
    }),
    education: education.map((item) => {
      const entry = asRecord(item);
      return {
        institution: asString(entry.institution),
        degree: asString(entry.degree),
        field: asString(entry.field),
        startDate: asString(entry.startDate),
        endDate: asString(entry.endDate),
        gpa: asString(entry.gpa),
      };
    }),
    links: {
      linkedin: asString(links.linkedin),
      github: asString(links.github),
      portfolio: asString(links.portfolio),
      website: asString(links.website),
    },
  };
}

const levelOrder: Record<"solid" | "working" | "familiar", number> = {
  solid: 3,
  working: 2,
  familiar: 1,
};

type CapabilityLevel = keyof typeof levelOrder;

interface CapabilityDraft {
  id: string;
  label: string;
  domain: string;
  level: CapabilityLevel;
}

const normalizeCapabilityId = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9./-]/g, "")
    .replace(/-+/g, "-");

const addCapability = (
  target: CapabilityDraft[],
  index: Map<string, number>,
  capability: CapabilityDraft,
) => {
  if (!capability.id) return;
  const existingIndex = index.get(capability.id);
  if (existingIndex === undefined) {
    index.set(capability.id, target.length);
    target.push(capability);
    return;
  }

  const existing = target[existingIndex];
  if (levelOrder[capability.level] > levelOrder[existing.level]) {
    target[existingIndex] = capability;
  }
};

const mapProjectTypeToEvidenceType = (value: string): "work" | "lab" => {
  const normalized = value.toLowerCase();
  if (normalized === "wxp" || normalized === "beta" || normalized === "work") return "work";
  return "lab";
};

const mapProjectStatus = (value: string): "active" | "paused" | "completed" => {
  const normalized = value.toLowerCase();
  if (normalized === "paused") return "paused";
  if (normalized === "active") return "active";
  return "completed";
};

const toTsLiteral = (value: unknown): string => JSON.stringify(value, null, 2);
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function findProfileExportRange(content: string): { start: number; end: number } | null {
  const exportToken = "export const profile: ProfileCore =";
  const exportIndex = content.indexOf(exportToken);
  if (exportIndex === -1) return null;

  const objectStart = content.indexOf("{", exportIndex);
  if (objectStart === -1) return null;

  let depth = 0;
  let quote: '"' | "'" | "`" | null = null;
  let escaped = false;

  for (let i = objectStart; i < content.length; i += 1) {
    const ch = content[i];

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }

    if (ch === "{") {
      depth += 1;
      continue;
    }

    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        let end = i + 1;
        if (content[end] === "\r" && content[end + 1] === "\n") end += 2;
        else if (content[end] === "\n") end += 1;
        return { start: exportIndex, end };
      }
    }
  }

  return null;
}

/**
 * Transform prebuilt profile to portfolio data.ts format
 */
function transformProfile(prebuilt: NormalizedProfile): string {
  const capabilities: CapabilityDraft[] = [];
  const capabilityIndex = new Map<string, number>();

  const addMany = (
    values: string[],
    domain: string,
    level: CapabilityLevel,
    toId: (value: string) => string = normalizeCapabilityId,
    toLabel: (value: string) => string = (value) => value,
  ) => {
    for (const value of values) {
      addCapability(capabilities, capabilityIndex, {
        id: toId(value),
        label: toLabel(value),
        domain,
        level,
      });
    }
  };

  addMany(prebuilt.software_fundamentals.programming_language.solid, "backend", "solid");
  addMany(prebuilt.software_fundamentals.programming_language.familiar, "backend", "familiar");
  addMany(prebuilt.skills.backend.frameworks.solid, "backend", "solid");
  addMany(prebuilt.skills.backend.frameworks.familiar, "backend", "familiar");
  addMany(prebuilt.skills.backend.api.solid, "backend", "solid");
  addMany(prebuilt.skills.backend.api.familiar, "backend", "familiar");

  addMany(
    prebuilt.skills.backend.architecture,
    "backend",
    "solid",
    (value) => {
      const lowered = value.toLowerCase();
      if (lowered.includes("clean architecture")) return "clean";
      if (lowered.includes("microservices")) return "microservices";
      if (lowered.includes("mvc")) return "mvc";
      return normalizeCapabilityId(value);
    },
    (value) => value.replace(/\s*\(learning\)\s*/gi, "").trim(),
  );

  for (const capability of capabilities) {
    if (capability.id === "clean" && prebuilt.skills.backend.architecture.some((item) => /learning/i.test(item))) {
      capability.level = "working";
    }
  }

  addMany(prebuilt.skills.backend.database.solid, "database", "solid");
  addMany(prebuilt.skills.backend.database.familiar, "database", "familiar");
  addMany(prebuilt.skills.frontend.frameworks.solid, "frontend", "solid");
  addMany(prebuilt.skills.frontend.frameworks.familiar, "frontend", "familiar");

  addMany(prebuilt.skills.devops.containerization.familiar, "devops", "familiar", (value) => {
    if (/docker/i.test(value)) return "docker";
    return normalizeCapabilityId(value);
  });
  addMany(prebuilt.skills.devops.ci_cd, "devops", "solid", (value) => {
    if (/github\s*actions/i.test(value)) return "cicd";
    if (/\bci\/?cd\b/i.test(value)) return "cicd";
    if (/\bgit\b/i.test(value)) return "cicd";
    return normalizeCapabilityId(value);
  });
  addMany(prebuilt.skills.devops.cloud.solid, "devops", "solid", (value) => {
    if (/aws|azure/i.test(value)) return "aws";
    return normalizeCapabilityId(value);
  });
  addMany(prebuilt.skills.devops.cloud.familiar, "devops", "familiar", (value) => {
    if (/cloud deployment/i.test(value)) return "cloudops";
    return normalizeCapabilityId(value);
  });

  addCapability(capabilities, capabilityIndex, {
    id: "auth",
    label: "AuthN/AuthZ (JWT, OAuth, MFA, RBAC)",
    domain: "security",
    level: "solid",
  });
  addCapability(capabilities, capabilityIndex, {
    id: "apigw",
    label: "Secure API gateway",
    domain: "security",
    level: "solid",
  });
  addCapability(capabilities, capabilityIndex, {
    id: "ratelimit",
    label: "Rate-limiting & abuse control",
    domain: "security",
    level: "solid",
  });
  addCapability(capabilities, capabilityIndex, {
    id: "inputval",
    label: "Input validation & sanitization",
    domain: "security",
    level: "solid",
  });

  addMany(prebuilt.skills.tooling, "tooling", "solid");

  const shouldAddShell =
    prebuilt.skills.tooling.some((item) => /bash|shell/i.test(item)) ||
    prebuilt.software_fundamentals.os.some((item) => /bash|shell|linux|ubuntu/i.test(item));
  if (shouldAddShell) {
    addCapability(capabilities, capabilityIndex, {
      id: "shell",
      label: "Shell/Bash",
      domain: "tooling",
      level: "solid",
    });
  }

  const usedEvidenceIds = new Set<string>();
  const evidence = prebuilt.projects.map((project, index) => {
    const baseId = normalizeCapabilityId(project.name || `project-${index + 1}`);
    let uniqueId = baseId || `project-${index + 1}`;
    let dedupe = 2;
    while (usedEvidenceIds.has(uniqueId)) {
      uniqueId = `${baseId}-${dedupe}`;
      dedupe += 1;
    }
    usedEvidenceIds.add(uniqueId);

    return {
      id: uniqueId,
      type: mapProjectTypeToEvidenceType(project.type),
      title: compactText(project.name || `Untitled Project ${index + 1}`, 80),
      period: project.period || "n/a",
      summary: compactText(project.summary || "No summary provided.", 180),
      tech: project.tech.slice(0, 8),
      status: mapProjectStatus(project.status),
    };
  });

  const profileObject = {
    identity: {
      name: prebuilt.name,
      email: prebuilt.email,
      phone: prebuilt.phone,
      location: prebuilt.location,
      links: {
        github: prebuilt.links.github,
        linkedin: prebuilt.links.linkedin,
        portfolio: prebuilt.links.portfolio,
        website: prebuilt.links.website || undefined,
      },
    },
    intent: {
      primary: "Backend Software Engineer",
      level: "Entry",
      focus: [
        "Backend systems",
        "RESTful APIs",
        "Networking-aware services",
        "Concurrency & resource-aware design",
      ],
    },
    fundamentals: {
      programming_languages: {
        solid: prebuilt.software_fundamentals.programming_language.solid,
        familiar: prebuilt.software_fundamentals.programming_language.familiar,
      },
      dsa: prebuilt.software_fundamentals.dsa,
      os: prebuilt.software_fundamentals.os,
      oop: prebuilt.software_fundamentals.oop,
      database: prebuilt.software_fundamentals.database,
      networking: prebuilt.software_fundamentals.networking,
      security: prebuilt.software_fundamentals.security,
      testing: prebuilt.software_fundamentals.test,
      ai: prebuilt.software_fundamentals.ai,
    },
    capabilities,
    evidence,
    experience: prebuilt.experience,
    education: prebuilt.education,
  };

  return `export const profile: ProfileCore = ${toTsLiteral(profileObject)}`;
}

function updateGeneratedRegion(dataTs: string, generatedProfileBlock: string): string {
  const generatedRegion = `${PROFILE_START_MARKER}\n${generatedProfileBlock}\n${PROFILE_END_MARKER}`;
  const markerRegex = new RegExp(
    `${escapeRegExp(PROFILE_START_MARKER)}[\\s\\S]*?${escapeRegExp(PROFILE_END_MARKER)}`,
  );

  if (markerRegex.test(dataTs)) {
    return dataTs.replace(markerRegex, generatedRegion);
  }

  const profileRange = findProfileExportRange(dataTs);
  if (!profileRange) {
    throw new Error("Could not find profile export in data.ts");
  }

  return `${dataTs.slice(0, profileRange.start)}${generatedRegion}\n${dataTs.slice(profileRange.end)}`;
}

/**
 * Sync profile to data.ts
 */
async function syncProfile(): Promise<void> {
  try {
    // Read profile.prebuilt.json
    const profileJson = JSON.parse(fs.readFileSync(profilePath, "utf-8"));
    const normalizedProfile = normalizeProfile(profileJson);

    // Read current data.ts
    const dataTs = fs.readFileSync(dataPath, "utf-8");

    // Generate new profile constant
    const profileCode = transformProfile(normalizedProfile);

    // Replace only generated region (or migrate once by wrapping existing profile export).
    const updatedDataTs = updateGeneratedRegion(dataTs, profileCode);

    // Write back to data.ts
    fs.writeFileSync(dataPath, updatedDataTs, "utf-8");

    console.log(`✅ Synced ${profilePath} → ${dataPath}`);
  } catch (error) {
    console.error("❌ Sync failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

/**
 * Watch for changes and sync
 */
async function watchProfile(): Promise<void> {
  console.log(`👀 Watching ${profilePath} for changes...`);

  let timeout: NodeJS.Timeout | null = null;

  fs.watch(profilePath, (eventType) => {
    if (eventType === "change") {
      // Debounce to avoid multiple syncs
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        syncProfile().catch(console.error);
      }, 100);
    }
  });

  // Keep process alive
  process.on("SIGINT", () => {
    console.log("\n👋 Watcher stopped");
    process.exit(0);
  });
}

// Main
const watch = process.argv.includes("--watch");
if (watch) {
  watchProfile().catch(console.error);
} else {
  syncProfile().catch(console.error);
}
