export const TRANSPARENCY_MODEL_NAME = "Portfolio Forest Evidence-First"
export const TRANSPARENCY_MODEL_VERSION = "v1.2.0"
export const TRANSPARENCY_SCORING_DRIVER = "Deterministic rules from profile, forest metrics, and threshold gates"
export const TRANSPARENCY_GENERATED_AT = new Date().toISOString()

export const TRANSPARENCY_FORMULAS: string[] = [
  "overall = (capabilityAverage + fundamentalsAverage) / 2",
  "work coverage = coverageByType.work / totalTrees",
  "completed rate = completedTrees / totalTrees",
  "connector risk = paused OR familiar-level OR strength < 0.72",
  "proof rows = top non-redundant complete rows capped at 3",
  "anomalies = top risk items capped at 3 with mitigation",
]

export const TRANSPARENCY_THRESHOLDS: string[] = [
  "verdict strong: overall >= 74% and work evidence >= 2",
  "verdict moderate: overall >= 62%",
  "verdict weak: overall < 62%",
  "connector caps: top <= 6, bottom <= 6",
  "connector risk threshold: strength < 0.72",
]
