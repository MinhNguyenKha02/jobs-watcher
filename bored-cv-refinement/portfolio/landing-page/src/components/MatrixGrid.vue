<template>
  <!-- [12 rows × 3 columns] Matrix: Capabilities as rows, Evidence as columns -->
  <div class="w-full">
    <!-- Domain-tree progressive controls -->
    <div
      v-if="props.mode !== 'hero'"
      class="mb-[17px] rounded-lg border border-slate-200 bg-white p-[17px]"
    >
      <div class="mb-[17px] text-xs font-semibold uppercase tracking-wide text-slate-600">
        Domain Filter
      </div>
      <div class="flex flex-wrap gap-[17px]">
        <button
          v-for="domain in domainFilterOptions"
          :key="`domain-filter-${domain}`"
          @click="selectedDomain = domain"
          class="rounded-md border px-[17px] py-[8px] text-xs font-semibold transition-colors"
          :class="
            selectedDomain === domain
              ? 'border-slate-700 bg-slate-700 text-white'
              : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
          "
        >
          {{ domain }}
        </button>
      </div>

      <div
        v-if="props.mode === 'full' && selectedDomain === 'all'"
        class="mt-[17px]"
      >
        <button
          @click="showAllRows = !showAllRows"
          class="text-xs font-semibold text-slate-700 underline-offset-2 hover:underline"
        >
          {{ showAllRows ? 'Show fewer rows' : 'Show more rows' }}
        </button>
      </div>
    </div>

    <!-- Desktop: Table view (3 columns visible) -->
    <div class="hidden md:block overflow-x-auto rounded-lg bg-white border border-slate-200">
      <table class="w-full border-collapse text-[17px]">
        <!-- Header -->
        <thead>
          <tr class="bg-slate-50 border-b-2 border-slate-200">
            <th class="px-[17px] py-[17px] text-left text-sm font-bold text-slate-900 w-56">
              Capability
            </th>
            <th
              v-for="evidence in evidenceTypes"
              :key="`header-${evidence}`"
              class="px-[17px] py-[17px] text-center text-sm font-bold text-slate-700 w-40"
            >
              {{ evidence }}
            </th>
          </tr>
        </thead>

        <!-- Body: 12 capabilities as rows -->
        <tbody>
          <tr
            v-for="(cap, idx) in renderedCapabilities"
            :key="`row-${cap.id}`"
            class="border-b border-slate-100 hover:bg-slate-50 transition-colors"
            :class="{ 'bg-blue-50': idx % 2 === 0 }"
          >
            <!-- Capability Label (Left) -->
            <td class="px-[17px] py-[17px]">
              <div class="flex items-center gap-3">
                <span
                  class="inline-block w-3 h-3 rounded-sm flex-shrink-0"
                  :style="{ backgroundColor: getDomainColor(cap.domain) }"
                  :title="cap.domain"
                ></span>
                <div>
                  <div class="font-semibold text-slate-900 text-base">{{ cap.label }}</div>
                  <div class="text-xs text-slate-500">{{ cap.level }}</div>
                </div>
              </div>
            </td>

            <!-- Evidence Cells (3 columns: work, lab, thesis) -->
            <td
              v-for="evidence in evidenceTypes"
              :key="`cell-${cap.id}-${evidence}`"
              class="px-[17px] py-[17px] text-center"
            >
              <div
                class="inline-flex items-center justify-center rounded font-bold leading-none transition-all hover:shadow-md hover:scale-105 cursor-help"
                :style="{
                  width: '85px',
                  height: '85px',
                  backgroundColor: getCellColor(cap.id, evidence),
                  color: getTextColor(cap.id, evidence),
                  fontSize: '68px'
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

    <!-- Mobile: Card view (1 column, stacked) -->
    <div class="md:hidden space-y-[17px]">
      <div
        v-for="(cap, idx) in renderedCapabilities"
        :key="`card-${cap.id}`"
        class="bg-white border border-slate-200 rounded-lg p-[17px]"
      >
        <div class="flex items-start justify-between mb-[17px]">
          <div class="flex items-center gap-2">
            <span
              class="inline-block w-2.5 h-2.5 rounded-sm"
              :style="{ backgroundColor: getDomainColor(cap.domain) }"
            ></span>
            <div>
              <h4 class="font-semibold text-slate-900">{{ cap.label }}</h4>
              <p class="text-xs text-slate-500">{{ cap.domain }}</p>
            </div>
          </div>
          <span class="text-xs px-2.5 py-1 bg-slate-100 text-slate-600 rounded font-medium">
            {{ cap.level }}
          </span>
        </div>

        <div class="grid grid-cols-3 gap-[17px]">
          <div
            v-for="evidence in evidenceTypes"
            :key="`mobile-cell-${cap.id}-${evidence}`"
            class="text-center"
          >
            <div
              class="inline-flex items-center justify-center rounded mx-auto mb-[17px] transition-all font-semibold text-base"
              :style="{
                width: '51px',
                height: '51px',
                backgroundColor: getCellColor(cap.id, evidence),
                color: getTextColor(cap.id, evidence)
              }"
            >
              {{ getScoreDisplay(cap.id, evidence) }}
            </div>
            <span class="text-xs text-slate-500 font-medium">{{ evidence }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue"
import { buildMatrix, getCapabilityScore } from "../../../scoring"
import { profile, CoreDomains, EvidenceWeight } from "../../../data"
import type { EvidenceType } from "../../../data"
import type { CapabilityMatrixRow } from "../../../scoring"

interface Props {
  mode?: "hero" | "core" | "full"
}

const props = withDefaults(defineProps<Props>(), { mode: "hero" })
const selectedDomain = ref<string>("all")
const showAllRows = ref(false)

// Evidence types in display order
const evidenceTypes = computed<EvidenceType[]>(() => {
  return Object.keys(EvidenceWeight) as EvidenceType[]
})

// All capabilities with computed scores
const allCapabilities = computed(() => {
  return profile.capabilities.map((cap) => ({
    ...cap,
    score: getCapabilityScore(cap.id),
  }))
})

// Filter based on mode
const displayCapabilities = computed(() => {
  if (props.mode === "hero") {
    // Top 12 by score
    return allCapabilities.value
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
  }

  if (props.mode === "core") {
    // CoreDomains only
    return allCapabilities.value.filter((cap) =>
      CoreDomains.includes(cap.domain as any)
    )
  }

  // Full mode - all capabilities
  return allCapabilities.value
})

const domainFilterOptions = computed<string[]>(() => {
  const domains = Array.from(new Set(displayCapabilities.value.map((c) => c.domain))).sort()
  return ["all", ...domains]
})

const renderedCapabilities = computed(() => {
  const filteredByDomain =
    selectedDomain.value === "all"
      ? displayCapabilities.value
      : displayCapabilities.value.filter((c) => c.domain === selectedDomain.value)

  if (props.mode === "full" && selectedDomain.value === "all" && !showAllRows.value) {
    return filteredByDomain.slice(0, 12)
  }

  return filteredByDomain
})

const matrix = computed(() => buildMatrix())

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

