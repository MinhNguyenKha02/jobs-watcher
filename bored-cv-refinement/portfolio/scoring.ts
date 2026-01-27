import {
  profile,
  LevelStrength,
  EvidenceWeight,
  FundamentalsSlices,
  CapabilityPrimaryEvidence,
  getCapabilitiesForFundamental,
} from "./data"
import type { EvidenceType, Fundamentals } from "./data"

export interface CapabilityMatrixRow {
  capabilityId: string
  evidenceType: EvidenceType
  score: number
}

const fallbackEvidenceType: EvidenceType = "lab"

const resolveEvidenceType = (capabilityId: string): EvidenceType =>
  CapabilityPrimaryEvidence[capabilityId] ?? fallbackEvidenceType

const computeCapabilityScore = (capabilityId: string): number => {
  const capability = profile.capabilities.find((cap) => cap.id === capabilityId)
  if (!capability) return 0

  const evidenceType = resolveEvidenceType(capabilityId)
  const levelWeight = LevelStrength[capability.level] ?? 0
  const evidenceWeight = EvidenceWeight[evidenceType] ?? EvidenceWeight[fallbackEvidenceType]

  return levelWeight * evidenceWeight
}

export const getCapabilityScore = (capabilityId: string): number =>
  computeCapabilityScore(capabilityId)

export const getFundamentalScore = (area: keyof Fundamentals): number => {
  const weight = FundamentalsSlices[area] ?? 0
  const capabilityIds = getCapabilitiesForFundamental(area)
  const scoreSum = capabilityIds
    .map((capId) => computeCapabilityScore(capId))
    .reduce((sum, score) => sum + score, 0)

  return scoreSum * weight
}

export const buildMatrix = (): CapabilityMatrixRow[] =>
  profile.capabilities.map((capability) => {
    const evidenceType = resolveEvidenceType(capability.id)
    return {
      capabilityId: capability.id,
      evidenceType,
      score: computeCapabilityScore(capability.id),
    }
  })

export const getProfileScore = () => {
  const capabilityScores = profile.capabilities.map((cap) => computeCapabilityScore(cap.id))
  const capabilityAverage = capabilityScores.length
    ? capabilityScores.reduce((sum, score) => sum + score, 0) / capabilityScores.length
    : 0

  const fundamentalsEntries = (Object.keys(FundamentalsSlices) as Array<keyof Fundamentals>).map(
    (area) => [area, getFundamentalScore(area)] as const,
  )

  const fundamentals: Record<keyof Fundamentals, number> = fundamentalsEntries.reduce(
    (acc, [area, score]) => {
      acc[area] = score
      return acc
    },
    {} as Record<keyof Fundamentals, number>,
  )

  const fundamentalsValues = Object.values(fundamentals)
  const fundamentalsAverage = fundamentalsValues.length
    ? fundamentalsValues.reduce((sum, score) => sum + score, 0) / fundamentalsValues.length
    : 0

  const overallScore = (capabilityAverage + fundamentalsAverage) / 2

  return { capabilityAverage, fundamentals, fundamentalsAverage, overallScore }
}
