<template>
  <div class="w-full min-w-0">
    <!-- Domain Tabs -->
    <div class="mb-6 flex flex-wrap gap-2 border-b border-[var(--theme-border)] pb-4">
      <button
        v-for="domain in availableDomains"
        :key="domain"
        @click="selectedDomain = domain"
        :class="[
          'rounded-lg px-4 py-2 text-sm font-semibold transition-colors',
          selectedDomain === domain
            ? 'border border-[var(--theme-accent-cyan)] bg-[var(--theme-surface)] text-[var(--theme-text-primary)]'
            : 'border border-[var(--theme-border)] bg-[var(--theme-surface-elevated)] text-[var(--theme-text-secondary)] hover:border-[var(--theme-accent-purple)] hover:text-[var(--theme-text-primary)]'
        ]"
      >
        <span class="inline-block w-2 h-2 rounded-full mr-2" :style="{ backgroundColor: getDomainColor(domain) }"></span>
        {{ domain }}
        <span class="ml-2 text-xs opacity-75">({{ getCapabilitiesForDomain(domain).length }})</span>
      </button>
    </div>

    <!-- Domain Matrix [N×3] -->
    <div class="overflow-x-auto rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)]">
      <table class="w-full border-collapse text-base">
        <!-- Header -->
        <thead>
          <tr class="border-b border-[var(--theme-border)] bg-[var(--theme-surface-elevated)]">
            <th class="w-56 px-8 py-5 text-left text-sm font-bold text-[var(--theme-text-primary)]">
              {{ selectedDomain }} Capabilities
            </th>
            <th
              v-for="evidence in evidenceTypes"
              :key="`header-${evidence}`"
              class="w-40 px-8 py-5 text-center text-sm font-bold text-[var(--theme-text-secondary)]"
            >
              {{ evidence }}
            </th>
          </tr>
        </thead>

        <!-- Body: Filtered capabilities as rows -->
        <tbody>
          <tr
            v-for="(cap, idx) in domainCapabilities"
            :key="`row-${cap.id}`"
            class="border-b border-[var(--theme-border)] transition-colors hover:bg-[var(--theme-surface-elevated)]/80"
            :class="{ 'bg-[var(--theme-surface)]': idx % 2 === 0, 'bg-[var(--theme-surface-elevated)]/50': idx % 2 !== 0 }"
          >
            <!-- Capability Label -->
            <td class="px-8 py-5">
              <div class="flex items-center gap-3">
                <span
                  class="inline-block w-3 h-3 rounded-sm flex-shrink-0"
                  :style="{ backgroundColor: getDomainColor(cap.domain) }"
                ></span>
                <div>
                  <div class="font-semibold text-[var(--theme-text-primary)] text-base">{{ cap.label }}</div>
                  <div class="text-xs text-[var(--theme-text-muted)]">{{ cap.level }}</div>
                </div>
              </div>
            </td>

            <!-- Evidence Cells -->
            <td
              v-for="evidence in evidenceTypes"
              :key="`cell-${cap.id}-${evidence}`"
              class="px-8 py-5 text-center"
            >
              <div
                class="inline-flex cursor-help items-center justify-center rounded border border-[var(--theme-border)] text-4xl font-bold transition-transform hover:scale-105"
                :style="{
                  width: '88px',
                  height: '88px',
                  backgroundColor: getCellColor(cap.id, evidence),
                  color: getTextColor(cap.id, evidence)
                }"
                :title="`${cap.label} (${cap.level}) via ${evidence}: ${getScoreValue(cap.id, evidence).toFixed(2)}`"
              >
                {{ getScoreDisplay(cap.id, evidence) }}
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Summary Stats -->
    <div class="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
      <div class="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface-elevated)] p-4">
        <div class="text-xs font-semibold uppercase text-[var(--theme-text-secondary)]">Total Capabilities</div>
        <div class="mt-2 text-3xl font-bold text-[var(--theme-text-primary)]">{{ domainCapabilities.length }}</div>
      </div>
      <div class="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface-elevated)] p-4">
        <div class="text-xs font-semibold uppercase text-[var(--theme-text-secondary)]">Avg Work Score</div>
        <div class="mt-2 text-3xl font-bold text-[var(--theme-accent-cyan)]">{{ averageScore('work').toFixed(2) }}</div>
      </div>
      <div class="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface-elevated)] p-4">
        <div class="text-xs font-semibold uppercase text-[var(--theme-text-secondary)]">Avg Lab Score</div>
        <div class="mt-2 text-3xl font-bold text-[var(--theme-accent-purple)]">{{ averageScore('lab').toFixed(2) }}</div>
      </div>
      <div class="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface-elevated)] p-4">
        <div class="text-xs font-semibold uppercase text-[var(--theme-text-secondary)]">Avg Thesis Score</div>
        <div class="mt-2 text-3xl font-bold text-[var(--theme-accent-pink)]">{{ averageScore('thesis').toFixed(2) }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue"
import { buildMatrix, getCapabilityScore } from "../../../scoring"
import { profile, CoreDomains, EvidenceWeight } from "../../../data"
import type { EvidenceType } from "../../../data"

// Get all unique domains
const allDomains = computed(() => {
  const domains = new Set(profile.capabilities.map((cap) => cap.domain))
  return Array.from(domains).sort()
})

// Core domains first, then others
const availableDomains = computed(() => {
  const core = CoreDomains.filter((d) => allDomains.value.includes(d as any))
  const others = allDomains.value.filter((d) => !CoreDomains.includes(d as any))
  return [...core, ...others]
})

const selectedDomain = ref(availableDomains.value[0])

const evidenceTypes = computed<EvidenceType[]>(() => {
  return Object.keys(EvidenceWeight) as EvidenceType[]
})

const matrix = computed(() => buildMatrix())

// Get capabilities for selected domain
const domainCapabilities = computed(() => {
  return profile.capabilities
    .filter((cap) => cap.domain === selectedDomain.value)
    .map((cap) => ({
      ...cap,
      score: getCapabilityScore(cap.id),
    }))
    .sort((a, b) => b.score - a.score)
})

const getCapabilitiesForDomain = (domain: string) => {
  return profile.capabilities.filter((cap) => cap.domain === domain)
}

// Get score for specific capability + evidence type combination
const getScoreValue = (capabilityId: string, evidenceType: EvidenceType): number => {
  const entry = matrix.value.find(
    (m) => m.capabilityId === capabilityId && m.evidenceType === evidenceType
  )
  return entry?.score ?? 0
}

// Display score as visual representation
const getScoreDisplay = (capabilityId: string, evidenceType: EvidenceType): string => {
  const score = getScoreValue(capabilityId, evidenceType)
  if (score === 0) return "—"
  if (score >= 0.95) return "█"
  if (score >= 0.80) return "▓"
  if (score >= 0.60) return "▒"
  return "░"
}

// Get cell background color based on domain and score
const getCellColor = (capabilityId: string, evidenceType: EvidenceType): string => {
  const capability = profile.capabilities.find((c) => c.id === capabilityId)
  if (!capability) return "transparent"

  const score = getScoreValue(capabilityId, evidenceType)
  if (score === 0) return "#161b22"

  const isCore = CoreDomains.includes(capability.domain as any)
  const baseColor = isCore ? [45, 212, 255] : [167, 139, 250]

  // Opacity based on score (0.2 min to 0.95 max)
  const opacity = Math.max(0.2, Math.min(score, 0.95))

  return `rgba(${baseColor[0]}, ${baseColor[1]}, ${baseColor[2]}, ${opacity})`
}

// Get text color (white on dark, dark on light)
const getTextColor = (capabilityId: string, evidenceType: EvidenceType): string => {
  const score = getScoreValue(capabilityId, evidenceType)
  return score >= 0.6 ? "#e6edf3" : "#9aa4b2"
}

// Get domain color for indicator dot
const getDomainColor = (domain: string): string => {
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
  return colorMap[domain] || "#9aa4b2"
}

// Calculate average score for a specific evidence type in current domain
const averageScore = (evidenceType: EvidenceType): number => {
  const scores = domainCapabilities.value.map((cap) =>
    getScoreValue(cap.id, evidenceType)
  )
  if (scores.length === 0) return 0
  return scores.reduce((a, b) => a + b, 0) / scores.length
}
</script>

<style scoped>
table {
  border-collapse: collapse;
}

th,
td {
  border-collapse: collapse;
}
</style>
