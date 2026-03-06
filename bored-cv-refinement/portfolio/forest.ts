/* ============================================================
 * Portfolio Forest Data Model
 * ============================================================
 * Represents evidence as a timeline "forest" where each evidence
 * item is a "tree" with branches to capabilities and commits.
 * 
 * Visual metaphor:
 * - Forest: All evidence grouped by type (work/lab/thesis)
 * - Tree: Individual evidence item (project/lab/research)
 * - Branches: Capabilities demonstrated by this evidence
 * - Roots: Timeline position and status
 */

import { profile, type EvidenceType } from "./data"

export interface ForestTree {
  evidenceId: string
  type: EvidenceType
  title: string
  status?: "active" | "paused" | "completed"
  period: string
  summary: string
  branches: CapabilityBranch[]
  tech: string[]
}

export interface CapabilityBranch {
  capabilityId: string
  capabilityLabel: string
  domain: string
  level: "solid" | "working" | "familiar"
  strength: number // LevelStrength value
}

export interface EvidenceForest {
  work: ForestTree[]
  lab: ForestTree[]
  thesis: ForestTree[]
}

export interface ForestMetrics {
  totalTrees: number
  activeTrees: number
  completedTrees: number
  totalBranches: number
  averageBranchesPerTree: number
  coverageByType: {
    work: number
    lab: number
    thesis: number
  }
  timelineSpan: {
    earliest?: string
    latest?: string
  }
}

/**
 * Build forest structure from profile evidence
 */
export function buildForest(): EvidenceForest {
  const forest: EvidenceForest = {
    work: [],
    lab: [],
    thesis: []
  }

  for (const evidence of profile.evidence) {
    // Extract capability IDs from tech stack or evidence summary
    // For now, we'll need to parse this from the evidence data
    // Since Evidence doesn't have a capabilities array, we'll infer from tech
    const capabilityIds = inferCapabilitiesFromEvidence(evidence)
    
    const tree: ForestTree = {
      evidenceId: evidence.id,
      type: evidence.type,
      title: evidence.title,
      status: evidence.status,
      period: evidence.period,
      summary: evidence.summary,
      branches: buildBranches(capabilityIds),
      tech: evidence.tech
    }

    forest[evidence.type].push(tree)
  }

  // Sort each forest by period (most recent first)
  for (const type of ["work", "lab", "thesis"] as EvidenceType[]) {
    forest[type].sort((a, b) => {
      return b.period.localeCompare(a.period)
    })
  }

  return forest
}

/**
 * Infer capabilities from evidence based on tech stack
 * Maps technology names to capability IDs
 */
function inferCapabilitiesFromEvidence(evidence: any): string[] {
  const capabilityIds: string[] = []
  const techLower = evidence.tech.map((t: string) => t.toLowerCase())
  
  // Map tech stack to capability IDs
  const techMap: Record<string, string> = {
    "go": "go",
    "golang": "go",
    "typescript": "typescript",
    "node.js": "node.js",
    "nodejs": "node.js",
    "node": "node.js",
    "express": "express.js",
    "express.js": "express.js",
    "gin": "gin",
    "fiber": "fiber",
    "laravel": "laravel",
    "vue": "vue.js",
    "vue.js": "vue.js",
    "nuxt": "nuxt.js",
    "nuxt.js": "nuxt.js",
    "react": "react",
    "postgres": "postgresql",
    "postgresql": "postgresql",
    "mongo": "mongodb",
    "mongodb": "mongodb",
    "sqlite": "sqlite",
    "redis": "redis",
    "supabase": "supabase",
    "docker": "docker",
    "rest": "rest",
    "restful": "rest",
    "graphql": "graphql",
    "git": "git",
    "figma": "figma",
    "wordpress": "wordpress",
    "vscode": "vscode",
    "tcp/ip": "tls/http/grpc/websocket/webrtc",
    "tls": "tls/http/grpc/websocket/webrtc",
    "http": "tls/http/grpc/websocket/webrtc",
    "https": "tls/http/grpc/websocket/webrtc",
    "auth": "auth",
    "authentication": "auth",
    "api gateway": "apigw",
    "rate limit": "ratelimit",
    "validation": "inputval",
    "ci/cd": "cicd",
    "aws": "aws",
    "microservices": "microservices",
    "mvc": "mvc",
    "clean architecture": "clean"
  }
  
  for (const tech of techLower) {
    const capId = techMap[tech]
    if (capId && !capabilityIds.includes(capId)) {
      capabilityIds.push(capId)
    }
  }
  
  return capabilityIds
}

/**
 * Convert capability IDs to branch objects with metadata
 */
function buildBranches(capabilityIds: string[]): CapabilityBranch[] {
  const branches: CapabilityBranch[] = []

  for (const capId of capabilityIds) {
    const capability = profile.capabilities.find(c => c.id === capId)
    if (!capability) continue

    branches.push({
      capabilityId: capId,
      capabilityLabel: capability.label,
      domain: capability.domain,
      level: capability.level,
      strength: getStrength(capability.level)
    })
  }

  // Sort by strength descending
  return branches.sort((a, b) => b.strength - a.strength)
}

function getStrength(level: "solid" | "working" | "familiar"): number {
  const map = { solid: 1.0, working: 0.8, familiar: 0.6 }
  return map[level]
}

/**
 * Calculate forest-wide metrics
 */
export function getForestMetrics(forest: EvidenceForest): ForestMetrics {
  const allTrees = [...forest.work, ...forest.lab, ...forest.thesis]
  
  const totalTrees = allTrees.length
  const activeTrees = allTrees.filter(t => t.status === "active").length
  const completedTrees = allTrees.filter(t => t.status === "completed").length
  
  const totalBranches = allTrees.reduce((sum, tree) => sum + tree.branches.length, 0)
  const averageBranchesPerTree = totalTrees > 0 ? totalBranches / totalTrees : 0
  
  const coverageByType = {
    work: forest.work.length,
    lab: forest.lab.length,
    thesis: forest.thesis.length
  }
  
  // Find earliest and latest periods
  const periods = allTrees
    .map(t => t.period)
    .filter((p): p is string => p !== undefined && p.length > 0)
    .sort()
  
  const timelineSpan = {
    earliest: periods[0],
    latest: periods[periods.length - 1]
  }
  
  return {
    totalTrees,
    activeTrees,
    completedTrees,
    totalBranches,
    averageBranchesPerTree,
    coverageByType,
    timelineSpan
  }
}

/**
 * Get trees for a specific domain (cross-cutting view)
 */
export function getTreesByDomain(forest: EvidenceForest, domain: string): ForestTree[] {
  const allTrees = [...forest.work, ...forest.lab, ...forest.thesis]
  
  return allTrees.filter(tree => 
    tree.branches.some(branch => branch.domain === domain)
  )
}

/**
 * Get trees for a specific capability
 */
export function getTreesByCapability(forest: EvidenceForest, capabilityId: string): ForestTree[] {
  const allTrees = [...forest.work, ...forest.lab, ...forest.thesis]
  
  return allTrees.filter(tree =>
    tree.branches.some(branch => branch.capabilityId === capabilityId)
  )
}

/**
 * Group trees by year for timeline visualization
 */
export function groupTreesByYear(forest: EvidenceForest): Map<string, ForestTree[]> {
  const allTrees = [...forest.work, ...forest.lab, ...forest.thesis]
  const grouped = new Map<string, ForestTree[]>()
  
  for (const tree of allTrees) {
    // Extract year from period (e.g., "2024-10 → 2025-01" or "2024")
    const periodParts = tree.period.split("→").map(p => p.trim())
    const lastPeriod = periodParts[periodParts.length - 1] || tree.period
    const year = lastPeriod.split("-")[0] || "unknown"
    
    if (!grouped.has(year)) {
      grouped.set(year, [])
    }
    grouped.get(year)!.push(tree)
  }
  
  return grouped
}
