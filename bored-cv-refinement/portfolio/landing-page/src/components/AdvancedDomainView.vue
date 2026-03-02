<template>
  <div class="w-full">
    <!-- Domain Tabs -->
    <div class="flex flex-wrap gap-2 mb-6 border-b border-slate-200 pb-4">
      <button
        v-for="domain in availableDomains"
        :key="domain"
        @click="selectedDomain = domain"
        :class="[
          'px-4 py-2 rounded-lg font-semibold text-sm transition-all',
          selectedDomain === domain
            ? 'bg-blue-600 text-white shadow-md'
            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
        ]"
      >
        <span class="inline-block w-2 h-2 rounded-full mr-2" :style="{ backgroundColor: getDomainColor(domain) }"></span>
        {{ domain }}
        <span class="ml-2 text-xs opacity-75">({{ getCapabilitiesForDomain(domain).length }})</span>
      </button>
    </div>

    <!-- Domain Matrix [N×3] -->
    <div class="overflow-x-auto rounded-lg bg-white border border-slate-200">
      <table class="w-full border-collapse text-base">
        <!-- Header -->
        <thead>
          <tr class="bg-slate-50 border-b-2 border-slate-200">
            <th class="px-8 py-5 text-left text-sm font-bold text-slate-900 w-56">
              {{ selectedDomain }} Capabilities
            </th>
            <th
              v-for="evidence in evidenceTypes"
              :key="`header-${evidence}`"
              class="px-8 py-5 text-center text-sm font-bold text-slate-700 w-40"
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
            class="border-b border-slate-100 hover:bg-slate-50 transition-colors"
            :class="{ 'bg-blue-50': idx % 2 === 0 }"
          >
            <!-- Capability Label -->
            <td class="px-8 py-5">
              <div class="flex items-center gap-3">
                <span
                  class="inline-block w-3 h-3 rounded-sm flex-shrink-0"
                  :style="{ backgroundColor: getDomainColor(cap.domain) }"
                ></span>
                <div>
                  <div class="font-semibold text-slate-900 text-base">{{ cap.label }}</div>
                  <div class="text-xs text-slate-500">{{ cap.level }}</div>
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
                class="inline-flex items-center justify-center rounded font-bold transition-all hover:shadow-md hover:scale-110 cursor-help text-4xl"
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
    <div class="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
      <div class="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-4 border border-blue-200">
        <div class="text-xs font-semibold text-blue-700 uppercase">Total Capabilities</div>
        <div class="text-3xl font-bold text-blue-900 mt-2">{{ domainCapabilities.length }}</div>
      </div>
      <div class="bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-lg p-4 border border-emerald-200">
        <div class="text-xs font-semibold text-emerald-700 uppercase">Avg Work Score</div>
        <div class="text-3xl font-bold text-emerald-900 mt-2">{{ averageScore('work').toFixed(2) }}</div>
      </div>
      <div class="bg-gradient-to-br from-orange-50 to-orange-100 rounded-lg p-4 border border-orange-200">
        <div class="text-xs font-semibold text-orange-700 uppercase">Avg Lab Score</div>
        <div class="text-3xl font-bold text-orange-900 mt-2">{{ averageScore('lab').toFixed(2) }}</div>
      </div>
      <div class="bg-gradient-to-br from-violet-50 to-violet-100 rounded-lg p-4 border border-violet-200">
        <div class="text-xs font-semibold text-violet-700 uppercase">Avg Thesis Score</div>
        <div class="text-3xl font-bold text-violet-900 mt-2">{{ averageScore('thesis').toFixed(2) }}</div>
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
  if (score === 0) return "#f1f5f9" // empty cell (slate-100)

  const isCore = CoreDomains.includes(capability.domain as any)
  const baseColor = isCore ? [235, 170, 90] : [180, 180, 180] // orange vs silver

  // Opacity based on score (0.2 min to 0.95 max)
  const opacity = Math.max(0.2, Math.min(score, 0.95))

  return `rgba(${baseColor[0]}, ${baseColor[1]}, ${baseColor[2]}, ${opacity})`
}

// Get text color (white on dark, dark on light)
const getTextColor = (capabilityId: string, evidenceType: EvidenceType): string => {
  const score = getScoreValue(capabilityId, evidenceType)
  return score >= 0.6 ? "#ffffff" : "#1e293b"
}

// Get domain color for indicator dot
const getDomainColor = (domain: string): string => {
  const colorMap: Record<string, string> = {
    backend: "#3b82f6", // blue
    database: "#10b981", // emerald
    networking: "#f59e0b", // amber
    security: "#ef4444", // red
    devops: "#8b5cf6", // violet
    frontend: "#ec4899", // pink
    tooling: "#6b7280", // gray
    os: "#14b8a6", // teal
  }
  return colorMap[domain] || "#94a3b8"
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
