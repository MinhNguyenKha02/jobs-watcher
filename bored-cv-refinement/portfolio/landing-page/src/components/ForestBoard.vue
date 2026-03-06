<template>
  <div class="forest-board m-0 min-w-0 p-0 space-y-0">
    <section class="rounded border border-[var(--theme-border)] bg-[var(--theme-surface-elevated)] p-3">
      <div class="mb-2 flex items-center justify-between gap-2">
        <div class="kicker text-[11px] uppercase tracking-wide text-[var(--theme-accent-cyan)]">Recruiter scan · 3 parts · 0–6s</div>
        <div class="flex items-center gap-1">
          <button
            type="button"
            class="rounded border px-2 py-0.5 text-[10px] font-medium transition-colors"
            :class="displayMode === 'scan'
              ? 'border-[var(--theme-accent-cyan)] bg-[var(--theme-surface)] text-[var(--theme-text-primary)]'
              : 'border-[var(--theme-border)] text-[var(--theme-text-secondary)] hover:border-[var(--theme-accent-cyan)] hover:text-[var(--theme-text-primary)]'"
            @click="displayMode = 'scan'"
          >
            Scan
          </button>
          <button
            type="button"
            class="rounded border px-2 py-0.5 text-[10px] font-medium transition-colors"
            :class="displayMode === 'proof'
              ? 'border-[var(--theme-accent-cyan)] bg-[var(--theme-surface)] text-[var(--theme-text-primary)]'
              : 'border-[var(--theme-border)] text-[var(--theme-text-secondary)] hover:border-[var(--theme-accent-cyan)] hover:text-[var(--theme-text-primary)]'"
            @click="displayMode = 'proof'"
          >
            Proof
          </button>
        </div>
      </div>
      <div class="grid grid-cols-3 gap-2 text-xs text-[var(--theme-text-primary)]">
        <div class="rounded border border-[var(--theme-border)] bg-[var(--theme-surface)] p-2">
          <div class="text-[11px] text-[var(--theme-text-muted)]">Target role</div>
          <div class="mt-1 text-sm font-semibold text-[var(--theme-text-primary)]">{{ targetRole }}</div>
        </div>
        <div class="rounded border border-[var(--theme-border)] bg-[var(--theme-surface)] p-2">
          <div class="text-[11px] text-[var(--theme-text-muted)]">Verdict</div>
          <div class="mt-1 text-sm font-semibold text-[var(--theme-text-primary)]">{{ recruiterVerdict }}</div>
        </div>
        <div class="rounded border border-[var(--theme-border)] bg-[var(--theme-surface)] p-2">
          <div class="text-[11px] text-[var(--theme-text-muted)]">6 metrics</div>
          <ul class="mt-1 space-y-0.5 text-[11px] text-[var(--theme-text-primary)]">
            <li v-for="metric in recruiterMetricsShown" :key="metric">• {{ metric }}</li>
          </ul>
        </div>
      </div>
    </section>

    <section class="rounded border border-[var(--theme-border)] bg-[var(--theme-surface-elevated)] p-3">
      <div class="kicker mb-2 text-[11px] uppercase tracking-wide text-[var(--theme-accent-purple)]">HR fit · 2 parts · 6–20s</div>
      <div class="grid grid-cols-2 gap-2 text-xs text-[var(--theme-text-primary)]">
        <div class="rounded border border-[var(--theme-border)] bg-[var(--theme-surface)] p-2">
          <div class="text-[11px] text-[var(--theme-text-muted)]">Team fit</div>
          <div class="mt-1 text-sm font-semibold">{{ hrTeamFitSignal }}</div>
        </div>
        <div class="rounded border border-[var(--theme-border)] bg-[var(--theme-surface)] p-2">
          <div class="text-[11px] text-[var(--theme-text-muted)]">Org fit</div>
          <div class="mt-1 text-sm font-semibold">{{ hrOrgFitSignal }}</div>
        </div>
      </div>
    </section>

    <section class="rounded border border-[var(--theme-border)] bg-[var(--theme-surface-elevated)] p-3">
      <div class="kicker mb-2 text-[11px] uppercase tracking-wide text-[var(--theme-accent-pink)]">Engineer / CTO proof · 5 parts · 20–60s</div>

      <div class="kicker mb-2 text-[11px] uppercase tracking-wide text-[var(--theme-text-secondary)]">1) Connector strip</div>
      <ConnectorStrip
        title="Evidence → domain trace"
        :top-nodes="topNodes"
        :bottom-nodes="bottomNodes"
        :edges="connectorEdges"
      />

      <div class="kicker mb-2 mt-3 text-[11px] uppercase tracking-wide text-[var(--theme-text-secondary)]">2) Proof rows</div>
      <div class="overflow-x-auto rounded border border-[var(--theme-border)]">
        <table class="proof-table min-w-[560px] w-full text-left text-xs">
          <thead class="bg-[var(--theme-surface)] text-[var(--theme-text-secondary)]">
            <tr>
              <th class="px-2 py-2 font-medium">Claim</th>
              <th class="px-2 py-2 font-medium">Evidence ID</th>
              <th class="px-2 py-2 font-medium">Outcome</th>
              <th class="px-2 py-2 font-medium">Constraint</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in engineerRowsShown" :key="row.evidenceId" class="border-t border-[var(--theme-border)] text-[var(--theme-text-primary)] hover:bg-[var(--theme-surface)]/60">
              <td class="px-2 py-2">{{ row.claim }}</td>
              <td class="px-2 py-2 font-mono text-[11px]">{{ row.evidenceId }}</td>
              <td class="px-2 py-2">{{ row.outcome }}</td>
              <td class="px-2 py-2">{{ row.constraint }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <template v-if="displayMode === 'proof'">
        <div class="kicker mb-2 mt-3 text-[11px] uppercase tracking-wide text-[var(--theme-text-secondary)]">3) Anomalies</div>
        <ul class="space-y-1 text-xs text-[var(--theme-text-primary)]">
          <li v-for="item in anomalyItemsShown" :key="item.key" class="leading-relaxed">
            • {{ item.signal }} → mitigation {{ item.mitigation }}
          </li>
        </ul>

        <div class="kicker mb-2 mt-3 text-[11px] uppercase tracking-wide text-[var(--theme-text-secondary)]">4) Architecture snapshot</div>
        <div class="grid grid-cols-3 gap-x-2 gap-y-1 text-[11px] text-[var(--theme-text-muted)]">
          <div>overall {{ overallScorePct }}</div>
          <div>work evidence {{ workCoverage }}</div>
          <div>completed {{ completedRate }}</div>
          <div>trees {{ metrics.totalTrees }}</div>
          <div>domains {{ bottomNodes.length }}</div>
          <div>branches/tree {{ avgBranches }}</div>
        </div>
        <div class="kicker mb-2 mt-3 text-[11px] uppercase tracking-wide text-[var(--theme-text-secondary)]">5) Next action</div>
        <div class="rounded border border-[var(--theme-border)] bg-[var(--theme-surface)] px-2 py-2 text-xs text-[var(--theme-text-primary)]">
          {{ nextAction }}
        </div>
      </template>

      <div v-else class="mt-3 text-[11px] text-[var(--theme-text-muted)]">
        Scan mode shows top signals only. Switch to Proof mode for anomalies, architecture, next action, and transparency.
      </div>
    </section>

    <section v-if="displayMode === 'proof'" class="rounded border border-[var(--theme-border)] bg-[var(--theme-surface-elevated)] p-3">
      <div class="kicker mb-2 text-[11px] uppercase tracking-wide text-[var(--theme-text-secondary)]">Formula + transparency + cache</div>
      <div class="space-y-1 text-[11px] text-[var(--theme-text-muted)]">
        <div>model {{ modelName }} {{ modelVersion }}</div>
        <div>scoring driver {{ scoringDriver }}</div>
        <div>data timestamp {{ dataTimestamp }}</div>
        <div>generated at {{ generatedAt }}</div>
        <div>cache scope in-memory session by source signature</div>
      </div>
      <div class="mt-2 grid grid-cols-1 gap-1 text-[11px] text-[var(--theme-text-primary)]">
        <div v-for="formula in transparencyFormulasPreview" :key="formula">• {{ formula }}</div>
      </div>
      <div class="mt-2 grid grid-cols-1 gap-1 text-[11px] text-[var(--theme-text-muted)]">
        <div v-for="threshold in transparencyThresholdsPreview" :key="threshold">• {{ threshold }}</div>
      </div>
      <details class="mt-2 text-[11px] text-[var(--theme-text-secondary)]">
        <summary class="cursor-pointer select-none">Show full formulas + thresholds</summary>
        <div class="mt-2 grid grid-cols-1 gap-1 text-[11px] text-[var(--theme-text-primary)]">
          <div v-for="formula in transparencyFormulas" :key="`full-${formula}`">• {{ formula }}</div>
        </div>
        <div class="mt-2 grid grid-cols-1 gap-1 text-[11px] text-[var(--theme-text-muted)]">
          <div v-for="threshold in transparencyThresholds" :key="`full-${threshold}`">• {{ threshold }}</div>
        </div>
      </details>
      <div class="mt-2 text-[11px] text-[var(--theme-text-muted)]">
        Proof mode keeps full details optional to reduce cognitive load.
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue"
import { buildForest, getForestMetrics } from "../../../forest"
import { getProfileScore } from "../../../scoring"
import ConnectorStrip from "./ConnectorStrip.vue"
import {
  TRANSPARENCY_FORMULAS,
  TRANSPARENCY_GENERATED_AT,
  TRANSPARENCY_MODEL_NAME,
  TRANSPARENCY_MODEL_VERSION,
  TRANSPARENCY_SCORING_DRIVER,
  TRANSPARENCY_THRESHOLDS,
} from "../transparency"

type VmTopNode = {
  id: string
  label: string
  meta: string
  color: string
}

type VmBottomNode = {
  id: string
  label: string
  meta: string
  color: string
}

type VmEdge = {
  sourceId: string
  targetId: string
  strength: number
  color: string
  isRisk: boolean
  riskReason: string
}

type VmProofRow = {
  claim: string
  evidenceId: string
  outcome: string
  constraint: string
}

type VmAnomaly = {
  key: string
  signal: string
  mitigation: string
}

type ForestViewModel = {
  topNodes: VmTopNode[]
  bottomNodes: VmBottomNode[]
  connectorEdges: VmEdge[]
  engineerRows: VmProofRow[]
  anomalyItems: VmAnomaly[]
}

const MAX_CONNECTOR_NODES = 6
const MAX_PROOF_ROWS = 3
const MAX_ANOMALIES = 3
const sessionViewCache = new Map<string, ForestViewModel>()
type DisplayMode = "scan" | "proof"
const displayMode = ref<DisplayMode>("scan")

const forest = computed(() => buildForest())
const allTrees = computed(() => [...forest.value.work, ...forest.value.lab, ...forest.value.thesis])
const stripEvidenceTrees = computed(() => [...forest.value.work, ...forest.value.lab])
const metrics = computed(() => getForestMetrics(forest.value))
const profileScore = computed(() => getProfileScore())
const dataTimestamp = computed(() => metrics.value.timelineSpan.latest ?? "n/a")

const sourceSignature = computed(() => {
  return JSON.stringify({
    trees: stripEvidenceTrees.value.map((tree) => ({
      id: tree.evidenceId,
      status: tree.status ?? "unknown",
      branches: tree.branches.map((branch) => ({
        domain: branch.domain,
        level: branch.level,
        strength: branch.strength,
      })),
    })),
    score: profileScore.value.overallScore,
    metrics: metrics.value,
  })
})

const topEvidenceTrees = computed(() => {
  return [...stripEvidenceTrees.value]
    .sort((a, b) => b.branches.length - a.branches.length)
    .slice(0, MAX_CONNECTOR_NODES)
})

const topDomains = computed(() => {
  const counts = new Map<string, number>()
  for (const tree of topEvidenceTrees.value) {
    for (const branch of tree.branches) {
      counts.set(branch.domain, (counts.get(branch.domain) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_CONNECTOR_NODES)
    .map(([domain]) => domain)
})

const domainColor = (domain: string): string => {
  const colorMap: Record<string, string> = {
    backend: "#2dd4ff",
    database: "#2dd4ff",
    networking: "#a78bfa",
    security: "#f472b6",
    devops: "#a78bfa",
    frontend: "#f472b6",
    tooling: "#9aa4b2",
    os: "#2dd4ff",
  }
  return colorMap[domain] ?? "#9aa4b2"
}

const viewModel = computed<ForestViewModel>(() => {
  const cacheKey = sourceSignature.value
  const cached = sessionViewCache.get(cacheKey)
  if (cached) return cached

  const topNodes: VmTopNode[] = topEvidenceTrees.value.map((tree) => ({
    id: tree.evidenceId,
    label: tree.title,
    meta: `${tree.type} · ${tree.branches.length}`,
    color: "#a78bfa",
  }))

  const bottomNodes: VmBottomNode[] = topDomains.value.map((domain) => {
    const evidenceCount = topEvidenceTrees.value.filter((tree) =>
      tree.branches.some((branch) => branch.domain === domain),
    ).length

    return {
      id: domain,
      label: domain,
      meta: `evidence ${evidenceCount}`,
      color: domainColor(domain),
    }
  })

  const connectorEdges: VmEdge[] = []

  topEvidenceTrees.value.forEach((tree) => {
    topDomains.value.forEach((domain) => {
      const matched = tree.branches.filter((branch) => branch.domain === domain)
      if (matched.length === 0) return

      const avgStrength = matched.reduce((sum, branch) => sum + branch.strength, 0) / matched.length
      const hasFamiliar = matched.some((branch) => branch.level === "familiar")
      const isPaused = tree.status === "paused"
      const isRisk = isPaused || hasFamiliar || avgStrength < 0.72
      const riskReason = isPaused
        ? "paused evidence"
        : hasFamiliar
          ? "familiar-level branch"
          : avgStrength < 0.72
            ? "lower confidence"
            : ""

      connectorEdges.push({
        sourceId: tree.evidenceId,
        targetId: domain,
        strength: avgStrength,
        color: domainColor(domain),
        isRisk,
        riskReason,
      })
    })
  })

  const treeById = new Map(topEvidenceTrees.value.map((tree) => [tree.evidenceId, tree] as const))
  const rankedEdges = [...connectorEdges].sort((a, b) => {
    if (a.isRisk !== b.isRisk) return a.isRisk ? 1 : -1
    return b.strength - a.strength
  })

  const seenSentences = new Set<string>()
  const connectorSentences = connectorEdges.map((edge) =>
    `${edge.sourceId} maps to ${edge.targetId} (${edge.riskReason || "stable"})`.toLowerCase(),
  )
  connectorSentences.forEach((sentence) => seenSentences.add(sentence))

  const engineerRows: VmProofRow[] = []
  for (const edge of rankedEdges) {
    if (engineerRows.length >= MAX_PROOF_ROWS) break
    const tree = treeById.get(edge.sourceId)
    const row: VmProofRow = {
      claim: `${edge.targetId} outcome under delivery constraints`,
      evidenceId: edge.sourceId,
      outcome: `strength ${edge.strength.toFixed(2)} · status ${tree?.status ?? "n/a"} · branches ${tree?.branches.length ?? 0}`,
      constraint: edge.isRisk ? `constraint ${edge.riskReason}` : "constraint trade-offs handled with stable delivery",
    }

    const rowSentence = `${row.claim}. ${row.outcome}. ${row.constraint}.`.toLowerCase()
    const isComplete = row.claim && row.evidenceId && row.outcome && row.constraint
    if (!isComplete || seenSentences.has(rowSentence)) continue

    seenSentences.add(rowSentence)
    engineerRows.push(row)
  }

  const anomalyItems: VmAnomaly[] = []
  for (const edge of rankedEdges.filter((item) => item.isRisk)) {
    if (anomalyItems.length >= MAX_ANOMALIES) break
    const mitigation =
      edge.riskReason === "paused evidence"
        ? "resume with scoped milestone"
        : edge.riskReason === "familiar-level branch"
          ? "add one focused production-grade iteration"
          : "add reliability tests and postmortem notes"

    const signal = `risk in ${edge.targetId} from ${edge.sourceId}: ${edge.riskReason}`
    const anomalySentence = `${signal}. mitigation ${mitigation}.`.toLowerCase()
    if (seenSentences.has(anomalySentence)) continue

    seenSentences.add(anomalySentence)
    anomalyItems.push({
      key: `${edge.sourceId}-${edge.targetId}`,
      signal,
      mitigation,
    })
  }

  const built: ForestViewModel = {
    topNodes,
    bottomNodes,
    connectorEdges,
    engineerRows,
    anomalyItems,
  }

  if (sessionViewCache.size > 8) {
    sessionViewCache.clear()
  }
  sessionViewCache.set(cacheKey, built)
  return built
})

const topNodes = computed(() => viewModel.value.topNodes)
const bottomNodes = computed(() => viewModel.value.bottomNodes)
const connectorEdges = computed(() => viewModel.value.connectorEdges)

const pct = (value: number): string => `${Math.round(value * 100)}%`

const overallScorePct = computed(() => pct(profileScore.value.overallScore))
const workCoverage = computed(() => {
  if (!metrics.value.totalTrees) return "0%"
  return pct(metrics.value.coverageByType.work / metrics.value.totalTrees)
})
const completedRate = computed(() => {
  if (!metrics.value.totalTrees) return "0%"
  return pct(metrics.value.completedTrees / metrics.value.totalTrees)
})
const avgBranches = computed(() => metrics.value.averageBranchesPerTree.toFixed(1))
const targetRole = computed(() => {
  const leadDomain = topDomains.value[0]
  if (leadDomain === "backend" || leadDomain === "database" || leadDomain === "devops") {
    return "Backend / Platform Engineer"
  }
  return "Software Engineer"
})

const recruiterVerdict = computed(() => {
  if (profileScore.value.overallScore >= 0.74 && metrics.value.coverageByType.work >= 2) {
    return "Proceed to interview"
  }
  if (profileScore.value.overallScore >= 0.62) {
    return "Proceed with caution"
  }
  return "Hold"
})

const evidenceQuality = computed(() => {
  const work = metrics.value.coverageByType.work
  const lab = metrics.value.coverageByType.lab
  if (work >= 2 && lab >= 3) return "balanced (work + lab)"
  if (work >= 2) return "work-heavy"
  return "lab-heavy"
})

const confidenceLabel = computed(() => {
  const hasPaused = allTrees.value.some((tree) => tree.status === "paused")
  if (profileScore.value.overallScore >= 0.74 && !hasPaused) return "high"
  if (profileScore.value.overallScore >= 0.62) return "medium"
  return "low"
})

const engineerRows = computed(() => viewModel.value.engineerRows)
const anomalyItems = computed(() => viewModel.value.anomalyItems)

const hrTeamFitSignal = computed(() => {
  if (metrics.value.coverageByType.work >= 2 && profileScore.value.overallScore >= 0.7) {
    return "collab + ownership + delivery signals are strong"
  }
  if (metrics.value.coverageByType.work >= 1) {
    return "partial team-context signal; add one stronger delivery artifact"
  }
  return "team delivery evidence needed"
})

const hrOrgFitSignal = computed(() => {
  if (metrics.value.completedTrees >= 2) return "docs/CI/reliability habits are present"
  if (metrics.value.completedTrees >= 1) return "org-fit signal emerging; reinforce reliability practices"
  return "insufficient reliability habit evidence"
})

const recruiterMetrics = computed(() => {
  return [
    `overall ${overallScorePct.value}`,
    `work coverage ${workCoverage.value}`,
    `completed ${completedRate.value}`,
    `evidence quality ${evidenceQuality.value}`,
    `confidence ${confidenceLabel.value}`,
    `domains ${bottomNodes.value.length}`,
  ]
})

const recruiterMetricsShown = computed(() => {
  return displayMode.value === "scan"
    ? recruiterMetrics.value.slice(0, 3)
    : recruiterMetrics.value
})

const engineerRowsShown = computed(() => {
  return displayMode.value === "scan"
    ? engineerRows.value.slice(0, 2)
    : engineerRows.value
})

const anomalyItemsShown = computed(() => {
  return displayMode.value === "scan"
    ? []
    : anomalyItems.value
})

const transparencyThresholds = computed(() => {
  return [...TRANSPARENCY_THRESHOLDS, `cache keys in session: ${sessionViewCache.size}`]
})
const transparencyFormulasPreview = computed(() => transparencyFormulas.value.slice(0, 2))
const transparencyThresholdsPreview = computed(() => transparencyThresholds.value.slice(0, 2))

const nextAction = computed(() => {
  const firstRisk = anomalyItems.value[0]
  if (firstRisk) return `Prioritize ${firstRisk.signal}; ${firstRisk.mitigation}.`
  return "Prepare deep-dive narrative for top 3 proof rows with measurable outcomes."
})

const modelName = TRANSPARENCY_MODEL_NAME
const modelVersion = TRANSPARENCY_MODEL_VERSION
const scoringDriver = TRANSPARENCY_SCORING_DRIVER
const generatedAt = TRANSPARENCY_GENERATED_AT
const transparencyFormulas = computed(() => TRANSPARENCY_FORMULAS)
</script>

<style scoped>
.forest-board {
  font-size: var(--pf-text-body, 14px);
  line-height: var(--pf-line-body, 1.45);
}

.forest-board .kicker {
  font-size: var(--pf-text-kicker, 11px);
  text-transform: uppercase;
  letter-spacing: 0.045em;
  line-height: var(--pf-line-tight, 1.3);
}

.forest-board .proof-table {
  font-size: var(--pf-text-table, 13px);
  line-height: 1.4;
}

.forest-board .proof-table th,
.forest-board .proof-table td {
  padding: var(--pf-space-row, 8px) 10px;
  vertical-align: top;
}
</style>