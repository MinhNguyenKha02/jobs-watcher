/* ============================================================
 * Gap Detection Logic
 * ============================================================
 * Identifies missing evidence, weak coverage, and capability gaps
 * to guide portfolio development priorities.
 */

import { profile, CoreDomains, CapabilityToFundamental } from "./data"
import type { EvidenceType } from "./data"
import { buildForest, getTreesByCapability, type EvidenceForest } from "./forest"

export interface CapabilityGap {
  capabilityId: string
  capabilityLabel: string
  domain: string
  level: "solid" | "working" | "familiar"
  gapType: "no-evidence" | "weak-evidence" | "missing-type"
  missingEvidenceTypes: EvidenceType[]
  currentEvidenceCount: number
  severity: "critical" | "high" | "medium" | "low"
  recommendation: string
}

export interface DomainGap {
  domain: string
  totalCapabilities: number
  capabilitiesWithGaps: number
  gapPercentage: number
  missingEvidenceTypes: {
    work: number
    lab: number
    thesis: number
  }
  severity: "critical" | "high" | "medium" | "low"
}

export interface FundamentalGap {
  fundamental: string
  weight: number
  capabilitiesCount: number
  gapsCount: number
  coverage: number
  severity: "critical" | "high" | "medium" | "low"
}

export interface GapReport {
  capabilityGaps: CapabilityGap[]
  domainGaps: DomainGap[]
  fundamentalGaps: FundamentalGap[]
  summary: {
    totalCapabilities: number
    capabilitiesWithGaps: number
    overallCoverage: number
    criticalGaps: number
    highPriorityGaps: number
  }
}

/**
 * Generate comprehensive gap analysis
 */
export function detectGaps(): GapReport {
  const forest = buildForest()
  const capabilityGaps = detectCapabilityGaps(forest)
  const domainGaps = detectDomainGaps(capabilityGaps)
  const fundamentalGaps = detectFundamentalGaps(capabilityGaps)
  
  const totalCapabilities = profile.capabilities.length
  const capabilitiesWithGaps = new Set(capabilityGaps.map(g => g.capabilityId)).size
  const overallCoverage = ((totalCapabilities - capabilitiesWithGaps) / totalCapabilities) * 100
  
  const criticalGaps = capabilityGaps.filter(g => g.severity === "critical").length
  const highPriorityGaps = capabilityGaps.filter(g => g.severity === "high").length
  
  return {
    capabilityGaps,
    domainGaps,
    fundamentalGaps,
    summary: {
      totalCapabilities,
      capabilitiesWithGaps,
      overallCoverage,
      criticalGaps,
      highPriorityGaps
    }
  }
}

/**
 * Detect gaps at capability level
 */
function detectCapabilityGaps(forest: EvidenceForest): CapabilityGap[] {
  const gaps: CapabilityGap[] = []
  
  for (const capability of profile.capabilities) {
    const trees = getTreesByCapability(forest, capability.id)
    
    if (trees.length === 0) {
      // No evidence at all - critical gap
      gaps.push({
        capabilityId: capability.id,
        capabilityLabel: capability.label,
        domain: capability.domain,
        level: capability.level,
        gapType: "no-evidence",
        missingEvidenceTypes: ["work", "lab", "thesis"],
        currentEvidenceCount: 0,
        severity: capability.level === "solid" ? "critical" : "high",
        recommendation: `Add ${capability.level === "solid" ? "work experience" : "lab project"} demonstrating ${capability.label}`
      })
      continue
    }
    
    // Check evidence type coverage
    const evidenceTypes = new Set(trees.map(t => t.type))
    const missingTypes: EvidenceType[] = []
    
    if (!evidenceTypes.has("work")) missingTypes.push("work")
    if (!evidenceTypes.has("lab")) missingTypes.push("lab")
    if (!evidenceTypes.has("thesis")) missingTypes.push("thesis")
    
    if (missingTypes.length > 0) {
      // Missing some evidence types
      const severity = determineSeverity(capability, trees.length, missingTypes)
      
      gaps.push({
        capabilityId: capability.id,
        capabilityLabel: capability.label,
        domain: capability.domain,
        level: capability.level,
        gapType: missingTypes.length === 2 ? "weak-evidence" : "missing-type",
        missingEvidenceTypes: missingTypes,
        currentEvidenceCount: trees.length,
        severity,
        recommendation: generateRecommendation(capability, missingTypes)
      })
    } else if (trees.length < 2) {
      // Has all types but only 1 piece of evidence total - weak
      gaps.push({
        capabilityId: capability.id,
        capabilityLabel: capability.label,
        domain: capability.domain,
        level: capability.level,
        gapType: "weak-evidence",
        missingEvidenceTypes: [],
        currentEvidenceCount: 1,
        severity: "medium",
        recommendation: `Add more evidence to strengthen ${capability.label} demonstration`
      })
    }
  }
  
  return gaps.sort((a, b) => {
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 }
    return severityOrder[a.severity] - severityOrder[b.severity]
  })
}

/**
 * Aggregate gaps by domain
 */
function detectDomainGaps(capabilityGaps: CapabilityGap[]): DomainGap[] {
  const domainMap = new Map<string, CapabilityGap[]>()
  
  for (const gap of capabilityGaps) {
    if (!domainMap.has(gap.domain)) {
      domainMap.set(gap.domain, [])
    }
    domainMap.get(gap.domain)!.push(gap)
  }
  
  const domainGaps: DomainGap[] = []
  
  // Get all domains from capabilities
  const allDomains = new Set(profile.capabilities.map(c => c.domain))
  
  for (const domain of allDomains) {
    const gaps = domainMap.get(domain) || []
    const totalCapabilities = profile.capabilities.filter(c => c.domain === domain).length
    const capabilitiesWithGaps = new Set(gaps.map(g => g.capabilityId)).size
    const gapPercentage = (capabilitiesWithGaps / totalCapabilities) * 100
    
    // Count missing evidence types
    const missingEvidenceTypes = {
      work: gaps.filter(g => g.missingEvidenceTypes.includes("work")).length,
      lab: gaps.filter(g => g.missingEvidenceTypes.includes("lab")).length,
      thesis: gaps.filter(g => g.missingEvidenceTypes.includes("thesis")).length
    }
    
    // Determine domain-level severity
    let severity: "critical" | "high" | "medium" | "low"
    const isCoreDomain = CoreDomains.includes(domain as any)
    
    if (gapPercentage > 50 && isCoreDomain) {
      severity = "critical"
    } else if (gapPercentage > 50 || (gapPercentage > 30 && isCoreDomain)) {
      severity = "high"
    } else if (gapPercentage > 30) {
      severity = "medium"
    } else {
      severity = "low"
    }
    
    domainGaps.push({
      domain,
      totalCapabilities,
      capabilitiesWithGaps,
      gapPercentage,
      missingEvidenceTypes,
      severity
    })
  }
  
  return domainGaps.sort((a, b) => {
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 }
    return severityOrder[a.severity] - severityOrder[b.severity]
  })
}

/**
 * Aggregate gaps by fundamental area
 */
function detectFundamentalGaps(capabilityGaps: CapabilityGap[]): FundamentalGap[] {
  const fundamentalGaps: FundamentalGap[] = []
  
  for (const [fundamental, capabilityIds] of Object.entries(CapabilityToFundamental)) {
    if (capabilityIds.length === 0) continue
    
    const gaps = capabilityGaps.filter(g => capabilityIds.includes(g.capabilityId))
    const gapsCount = new Set(gaps.map(g => g.capabilityId)).size
    const coverage = ((capabilityIds.length - gapsCount) / capabilityIds.length) * 100
    
    let severity: "critical" | "high" | "medium" | "low"
    const weight = (CapabilityToFundamental as any)[fundamental] || 0
    
    if (coverage < 50 && weight > 0.15) {
      severity = "critical"
    } else if (coverage < 50) {
      severity = "high"
    } else if (coverage < 75) {
      severity = "medium"
    } else {
      severity = "low"
    }
    
    fundamentalGaps.push({
      fundamental,
      weight,
      capabilitiesCount: capabilityIds.length,
      gapsCount,
      coverage,
      severity
    })
  }
  
  return fundamentalGaps.sort((a, b) => {
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 }
    return severityOrder[a.severity] - severityOrder[b.severity]
  })
}

/**
 * Determine severity based on capability level and evidence count
 */
function determineSeverity(
  capability: any,
  _evidenceCount: number,
  missingTypes: EvidenceType[]
): "critical" | "high" | "medium" | "low" {
  const isCoreDomain = CoreDomains.includes(capability.domain as any)
  const isSolidLevel = capability.level === "solid"
  
  if (missingTypes.includes("work") && (isSolidLevel || isCoreDomain)) {
    return "critical"
  }
  
  if (missingTypes.length >= 2 && isSolidLevel) {
    return "high"
  }
  
  if (missingTypes.length >= 2 || (missingTypes.includes("work") && isCoreDomain)) {
    return "medium"
  }
  
  return "low"
}

/**
 * Generate actionable recommendation
 */
function generateRecommendation(capability: any, missingTypes: EvidenceType[]): string {
  if (missingTypes.includes("work")) {
    return `Add work experience demonstrating ${capability.label} in production environment`
  }
  
  if (missingTypes.includes("lab") && missingTypes.includes("thesis")) {
    return `Create lab project and document ${capability.label} research/exploration`
  }
  
  if (missingTypes.includes("lab")) {
    return `Build hands-on lab project showcasing ${capability.label} capabilities`
  }
  
  if (missingTypes.includes("thesis")) {
    return `Document technical research or deep-dive into ${capability.label}`
  }
  
  return `Strengthen ${capability.label} evidence across all types`
}
