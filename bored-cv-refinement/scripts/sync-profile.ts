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

/** Profile structure from profile.prebuilt.json */
interface PrebuiltProfile {
  name: string;
  email: string;
  phone: string;
  location: string;
  title: string;
  summary: string[];
  software_fundamentals: {
    programming_language: { solid: string[]; familiar: string[] };
    dsa: string[];
    os: string[];
    oop: string[];
    database: string[];
    networking: string[];
    security: string[];
    test: string[];
    ai?: string[];
  };
  skills: {
    backend: {
      architecture: string[];
      frameworks: { solid: string[]; familiar: string[] };
      api: { solid: string[]; familiar: string[] };
      database: { solid: string[]; familiar: string[] };
      "Authentication/Authorization": string[];
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
    type: "lab" | "personal" | "beta" | "wxp";
    summary: string;
    tech: string[];
    outcomes?: string[];
    status?: "Paused" | "Active";
    evidence?: string[];
  }>;
  experience: Array<{
    company: string;
    position: string;
    location: string;
    startDate: string;
    endDate: string;
    description?: string[];
    outcomes?: string[];
    tech?: string[];
    highlights?: string[];
    type?: "wxp" | "beta";
  }>;
  education: Array<{
    institution: string;
    degree: string;
    field: string;
    startDate: string;
    endDate: string;
    gpa?: string;
  }>;
  links: {
    linkedin: string;
    github: string;
    portfolio?: string;
    website?: string;
  };
}

/**
 * Transform prebuilt profile to portfolio data.ts format
 */
function transformProfile(prebuilt: PrebuiltProfile): string {
  // Helper: safely escape quotes in strings
  const escapeQuotes = (s: string) => s.replace(/"/g, '\\"');

  // Helper: format array of strings
  const formatStringArray = (arr: string[], indent: number = 4) => {
    const spaces = " ".repeat(indent);
    if (arr.length === 0) return "[]";
    return `[\n${arr.map((s) => `${spaces}"${escapeQuotes(s)}"`).join(",\n")}\n${" ".repeat(indent - 2)}]`;
  };

  // Transform capabilities from skills
  const capabilities: Array<{ id: string; label: string; domain: string; level: string }> = [];
  const capabilityMap = new Map<string, { domain: string; level: string }>();

  // Backend frameworks
  prebuilt.skills.backend.frameworks.solid.forEach((f) => {
    const id = f.toLowerCase().replace(/\s+/g, "-");
    capabilities.push({ id, label: f, domain: "backend", level: "solid" });
    capabilityMap.set(id, { domain: "backend", level: "solid" });
  });
  prebuilt.skills.backend.frameworks.familiar.forEach((f) => {
    const id = f.toLowerCase().replace(/\s+/g, "-");
    capabilities.push({ id, label: f, domain: "backend", level: "familiar" });
    capabilityMap.set(id, { domain: "backend", level: "familiar" });
  });

  // APIs
  prebuilt.skills.backend.api.solid.forEach((f) => {
    const id = f.toLowerCase().replace(/\s+/g, "-");
    capabilities.push({ id, label: f, domain: "backend", level: "solid" });
    capabilityMap.set(id, { domain: "backend", level: "solid" });
  });
  prebuilt.skills.backend.api.familiar.forEach((f) => {
    const id = f.toLowerCase().replace(/\s+/g, "-");
    capabilities.push({ id, label: f, domain: "backend", level: "familiar" });
    capabilityMap.set(id, { domain: "backend", level: "familiar" });
  });

  // Architectures
  prebuilt.skills.backend.architecture.forEach((f) => {
    const id = f.toLowerCase().replace(/\s+.*/, "").replace(/[()]/g, "");
    const label = f.replace(" (learning)", "");
    const level = f.includes("learning") ? "working" : "solid";
    capabilities.push({ id, label, domain: "backend", level });
    capabilityMap.set(id, { domain: "backend", level });
  });

  // Databases
  prebuilt.skills.backend.database.solid.forEach((f) => {
    const id = f.toLowerCase().replace(/\s+/g, "-");
    capabilities.push({ id, label: f, domain: "database", level: "solid" });
    capabilityMap.set(id, { domain: "database", level: "solid" });
  });
  prebuilt.skills.backend.database.familiar.forEach((f) => {
    const id = f.toLowerCase().replace(/\s+/g, "-");
    capabilities.push({ id, label: f, domain: "database", level: "familiar" });
    capabilityMap.set(id, { domain: "database", level: "familiar" });
  });

  // Frontend frameworks
  prebuilt.skills.frontend.frameworks.solid.forEach((f) => {
    const id = f.toLowerCase().replace(/\s+/g, "-");
    capabilities.push({ id, label: f, domain: "frontend", level: "solid" });
    capabilityMap.set(id, { domain: "frontend", level: "solid" });
  });
  prebuilt.skills.frontend.frameworks.familiar.forEach((f) => {
    const id = f.toLowerCase().replace(/\s+/g, "-");
    capabilities.push({ id, label: f, domain: "frontend", level: "familiar" });
    capabilityMap.set(id, { domain: "frontend", level: "familiar" });
  });

  // Security capabilities
  capabilities.push(
    { id: "auth", label: "AuthN/AuthZ (JWT, OAuth, MFA, RBAC)", domain: "security", level: "solid" },
    { id: "apigw", label: "Secure API gateway", domain: "security", level: "solid" },
    { id: "ratelimit", label: "Rate-limiting & abuse control", domain: "security", level: "solid" },
    { id: "inputval", label: "Input validation & sanitization", domain: "security", level: "solid" }
  );

  // DevOps
  capabilities.push(
    { id: "docker", label: "Docker", domain: "devops", level: "familiar" },
    { id: "cicd", label: "CI/CD (GitHub Actions)", domain: "devops", level: "solid" },
    { id: "aws", label: "AWS/Azure fundamentals", domain: "devops", level: "solid" },
    { id: "cloudops", label: "Cloud deployment best practices", domain: "devops", level: "familiar" }
  );

  // Tooling
  prebuilt.skills.tooling.forEach((tool) => {
    const id = tool.toLowerCase().replace(/\s+/g, "-");
    capabilities.push({ id, label: tool, domain: "tooling", level: "solid" });
  });

  // Transform evidence/projects
  const evidence = prebuilt.projects.map((p) => ({
    id: p.name.toLowerCase().replace(/\s+/g, "-"),
    type: p.type === "wxp" ? "work" : p.type === "beta" ? "work" : "lab",
    title: p.name,
    period: p.period,
    summary: p.summary,
    tech: p.tech,
    status: p.status === "Paused" ? "paused" : p.status ? "active" : "completed",
  }));

  // Transform experience
  const experience = prebuilt.experience.map((e) => ({
    company: e.company,
    position: e.position,
    location: e.location,
    startDate: e.startDate,
    endDate: e.endDate,
    highlights: e.description || e.outcomes || [],
  }));

  // Generate TypeScript code
  const capabilitiesCode = capabilities
    .map(
      (c) =>
        `    { id: "${c.id}", label: "${escapeQuotes(c.label)}", domain: "${c.domain}", level: "${c.level}" }`
    )
    .join(",\n");

  const evidenceCode = evidence
    .map(
      (e) =>
        `    {
      id: "${e.id}",
      type: "${e.type}",
      title: "${escapeQuotes(e.title)}",
      period: "${e.period}",
      summary:
        "${escapeQuotes(e.summary)}",
      tech: ${JSON.stringify(e.tech)},
      status: "${e.status}"
    }`
    )
    .join(",\n");

  const experienceCode = experience
    .map(
      (e) =>
        `    {
      company: "${escapeQuotes(e.company)}",
      position: "${escapeQuotes(e.position)}",
      location: "${escapeQuotes(e.location)}",
      startDate: "${e.startDate}",
      endDate: "${e.endDate}",
      highlights: ${JSON.stringify(e.highlights)}
    }`
    )
    .join(",\n");

  const educationCode = prebuilt.education
    .map(
      (e) =>
        `    {
      institution: "${escapeQuotes(e.institution)}",
      degree: "${escapeQuotes(e.degree)}",
      field: "${escapeQuotes(e.field)}",
      startDate: "${e.startDate}",
      endDate: "${e.endDate}",
      gpa: "${e.gpa || ""}"
    }`
    )
    .join(",\n");

  return `export const profile: ProfileCore = {
  identity: {
    name: "${escapeQuotes(prebuilt.name)}",
    email: "${escapeQuotes(prebuilt.email)}",
    phone: "${escapeQuotes(prebuilt.phone)}",
    location: "${escapeQuotes(prebuilt.location)}",
    links: {
      github: "${escapeQuotes(prebuilt.links.github)}",
      linkedin: "${escapeQuotes(prebuilt.links.linkedin)}",
      portfolio: "${escapeQuotes(prebuilt.links.portfolio || "")}"
    }
  },

  intent: {
    primary: "Backend Software Engineer",
    level: "Entry",
    focus: [
      "Backend systems",
      "RESTful APIs",
      "Networking-aware services",
      "Concurrency & resource-aware design"
    ]
  },

  fundamentals: {
    programming_languages: {
      solid: ${JSON.stringify(prebuilt.software_fundamentals.programming_language.solid)},
      familiar: ${JSON.stringify(prebuilt.software_fundamentals.programming_language.familiar)}
    },
    dsa: ${JSON.stringify(prebuilt.software_fundamentals.dsa)},
    os: ${JSON.stringify(prebuilt.software_fundamentals.os)},
    oop: ${JSON.stringify(prebuilt.software_fundamentals.oop)},
    database: ${JSON.stringify(prebuilt.software_fundamentals.database)},
    networking: ${JSON.stringify(prebuilt.software_fundamentals.networking)},
    security: ${JSON.stringify(prebuilt.software_fundamentals.security)},
    testing: ${JSON.stringify(prebuilt.software_fundamentals.test)},
    ai: ${JSON.stringify(prebuilt.software_fundamentals.ai || [])}
  },

  capabilities: [
${capabilitiesCode}
  ],

  evidence: [
${evidenceCode}
  ],

  experience: [
${experienceCode}
  ],

  education: [
${educationCode}
  ]
}`;
}

/**
 * Sync profile to data.ts
 */
async function syncProfile(): Promise<void> {
  try {
    // Read profile.prebuilt.json
    const profileJson = JSON.parse(fs.readFileSync(profilePath, "utf-8")) as PrebuiltProfile;

    // Read current data.ts
    const dataTs = fs.readFileSync(dataPath, "utf-8");

    // Generate new profile constant
    const profileCode = transformProfile(profileJson);

    // Replace the profile export in data.ts
    const profileMatch = dataTs.match(/export const profile: ProfileCore = \{[\s\S]*?\n\}/);
    if (!profileMatch) {
      throw new Error("Could not find profile export in data.ts");
    }

    const updatedDataTs = dataTs.replace(profileMatch[0], profileCode);

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
