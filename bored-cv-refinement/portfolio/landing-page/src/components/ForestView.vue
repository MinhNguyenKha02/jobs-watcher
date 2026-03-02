<template>
  <div class="w-full">
    <!-- Forest Header -->
    <div class="mb-[17px] rounded-lg border border-slate-200 bg-white p-[17px]">
      <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-[17px]">
        <div>
          <h2 class="text-2xl font-bold text-slate-900">Evidence Forest</h2>
          <p class="text-sm text-slate-600 mt-1">
            {{ metrics.totalTrees }} projects organized by domain clusters
          </p>
        </div>
        
        <!-- Gap Indicator -->
        <div class="flex items-center gap-[17px]">
          <div class="flex items-center gap-2">
            <div
              v-if="gapReport.summary.criticalGaps > 0"
              class="px-3 py-1 rounded-full bg-red-100 border border-red-300 text-red-800 text-xs font-semibold"
            >
              {{ gapReport.summary.criticalGaps }} Critical Gaps
            </div>
            <div
              v-if="gapReport.summary.highPriorityGaps > 0"
              class="px-3 py-1 rounded-full bg-orange-100 border border-orange-300 text-orange-800 text-xs font-semibold"
            >
              {{ gapReport.summary.highPriorityGaps }} High Priority
            </div>
          </div>
          <div class="text-right">
            <div class="text-2xl font-bold text-emerald-600">
              {{ gapReport.summary.overallCoverage.toFixed(0) }}%
            </div>
            <div class="text-xs text-slate-600">Coverage</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Cluster Selector -->
    <div class="mb-[17px] rounded-lg border border-slate-200 bg-white p-[17px]">
      <div class="mb-[17px] text-xs font-semibold uppercase tracking-wide text-slate-600">
        Domain Clusters
      </div>
      <div class="flex flex-wrap gap-[17px]">
        <button
          v-for="cluster in clusters"
          :key="cluster.domain"
          @click="selectedCluster = cluster.domain"
          :class="[
            'rounded-md border px-[17px] py-[8px] text-sm font-semibold transition-all',
            selectedCluster === cluster.domain
              ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-md'
              : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
          ]"
        >
          <span class="inline-block w-2 h-2 rounded-full mr-2" :style="{ backgroundColor: getDomainColor(cluster.domain) }"></span>
          {{ cluster.domain }}
          <span class="ml-2 text-xs opacity-75">({{ cluster.capabilities.length }})</span>
          <span
            v-if="getClusterGapCount(cluster.domain) > 0"
            class="ml-2 inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-red-500 rounded-full"
          >
            {{ getClusterGapCount(cluster.domain) }}
          </span>
        </button>
      </div>
    </div>

    <!-- Forest View: Clustered Capabilities -->
    <div class="rounded-lg border border-slate-200 bg-white p-[17px]">
      <!-- Desktop: Tree Grid -->
      <div class="hidden md:grid md:grid-cols-2 lg:grid-cols-3 gap-[17px]">
        <div
          v-for="cap in currentClusterCapabilities"
          :key="cap.id"
          class="border border-slate-200 rounded-lg p-[17px] hover:shadow-md transition-shadow"
          :class="{
            'border-l-4 border-l-red-500': hasGap(cap.id),
            'border-l-4 border-l-emerald-500': !hasGap(cap.id)
          }"
        >
          <!-- Capability Header -->
          <div class="flex items-start justify-between mb-[17px]">
            <div class="flex-1">
              <div class="font-semibold text-slate-900 text-base">{{ cap.label }}</div>
              <div class="flex items-center gap-2 mt-1">
                <span class="text-xs text-slate-500">{{ cap.level }}</span>
                <span
                  class="inline-block w-2 h-2 rounded-full"
                  :style="{ backgroundColor: getDomainColor(cap.domain) }"
                ></span>
              </div>
            </div>
            <div
              v-if="hasGap(cap.id)"
              class="flex-shrink-0"
              :title="getGapSeverity(cap.id)"
            >
              <svg class="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
              </svg>
            </div>
          </div>

          <!-- Evidence Trees (Branches) -->
          <div class="space-y-[8px]">
            <div
              v-for="tree in getTreesForCapability(cap.id)"
              :key="tree.evidenceId"
              class="flex items-center gap-2 text-xs"
            >
              <span
                class="inline-flex items-center px-2 py-1 rounded font-semibold"
                :class="getEvidenceTypeClass(tree.type)"
              >
                {{ tree.type }}
              </span>
              <span class="text-slate-700 truncate flex-1" :title="tree.title">
                {{ tree.title }}
              </span>
              <span
                class="inline-flex items-center px-2 py-1 rounded text-xs font-medium"
                :class="getStatusClass(tree.status)"
              >
                {{ tree.status }}
              </span>
            </div>
            
            <!-- No Evidence Indicator -->
            <div
              v-if="getTreesForCapability(cap.id).length === 0"
              class="text-xs text-slate-500 italic"
            >
              No evidence yet
            </div>
            
            <!-- Gap Warning -->
            <div
              v-if="hasGap(cap.id)"
              class="mt-[8px] p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700"
            >
              <div class="font-semibold">{{ getGapType(cap.id) }}</div>
              <div class="mt-1 text-red-600">{{ getGapRecommendation(cap.id) }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Mobile: Stacked Cards -->
      <div class="md:hidden space-y-[17px]">
        <div
          v-for="cap in currentClusterCapabilities"
          :key="cap.id"
          class="border border-slate-200 rounded-lg p-[17px]"
          :class="{
            'border-l-4 border-l-red-500': hasGap(cap.id),
            'border-l-4 border-l-emerald-500': !hasGap(cap.id)
          }"
        >
          <!-- Same content as desktop -->
          <div class="flex items-start justify-between mb-[17px]">
            <div class="flex-1">
              <div class="font-semibold text-slate-900 text-base">{{ cap.label }}</div>
              <div class="flex items-center gap-2 mt-1">
                <span class="text-xs text-slate-500">{{ cap.level }}</span>
                <span
                  class="inline-block w-2 h-2 rounded-full"
                  :style="{ backgroundColor: getDomainColor(cap.domain) }"
                ></span>
              </div>
            </div>
            <div
              v-if="hasGap(cap.id)"
              class="flex-shrink-0"
            >
              <svg class="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
              </svg>
            </div>
          </div>

          <div class="space-y-[8px]">
            <div
              v-for="tree in getTreesForCapability(cap.id)"
              :key="tree.evidenceId"
              class="flex flex-col gap-1 text-xs"
            >
              <div class="flex items-center gap-2">
                <span
                  class="inline-flex items-center px-2 py-1 rounded font-semibold"
                  :class="getEvidenceTypeClass(tree.type)"
                >
                  {{ tree.type }}
                </span>
                <span
                  class="inline-flex items-center px-2 py-1 rounded text-xs font-medium"
                  :class="getStatusClass(tree.status)"
                >
                  {{ tree.status }}
                </span>
              </div>
              <span class="text-slate-700">{{ tree.title }}</span>
            </div>
            
            <div
              v-if="getTreesForCapability(cap.id).length === 0"
              class="text-xs text-slate-500 italic"
            >
              No evidence yet
            </div>
            
            <div
              v-if="hasGap(cap.id)"
              class="mt-[8px] p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700"
            >
              <div class="font-semibold">{{ getGapType(cap.id) }}</div>
              <div class="mt-1 text-red-600">{{ getGapRecommendation(cap.id) }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Gap Summary Panel -->
    <div
      v-if="gapReport.summary.capabilitiesWithGaps > 0"
      class="mt-[17px] rounded-lg border border-orange-200 bg-orange-50 p-[17px]"
    >
      <div class="flex items-center gap-2 mb-[17px]">
        <svg class="w-5 h-5 text-orange-600" fill="currentColor" viewBox="0 0 20 20">
          <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd" />
        </svg>
        <span class="font-semibold text-orange-800">Gap Analysis Summary</span>
      </div>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-[17px]">
        <div class="text-center">
          <div class="text-2xl font-bold text-orange-900">
            {{ gapReport.summary.capabilitiesWithGaps }}
          </div>
          <div class="text-xs text-orange-700">Capabilities with Gaps</div>
        </div>
        <div class="text-center">
          <div class="text-2xl font-bold text-red-900">
            {{ gapReport.summary.criticalGaps }}
          </div>
          <div class="text-xs text-red-700">Critical</div>
        </div>
        <div class="text-center">
          <div class="text-2xl font-bold text-orange-900">
            {{ gapReport.summary.highPriorityGaps }}
          </div>
          <div class="text-xs text-orange-700">High Priority</div>
        </div>
        <div class="text-center">
          <div class="text-2xl font-bold text-emerald-900">
            {{ gapReport.summary.overallCoverage.toFixed(1) }}%
          </div>
          <div class="text-xs text-emerald-700">Overall Coverage</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue"
import { clusterCapabilities } from "../../../data"
import { buildForest, getTreesByCapability, getForestMetrics } from "../../../forest"
import { detectGaps } from "../../../gap-detection"
import type { ForestTree } from "../../../forest"

// Build data models
const clusters = computed(() => clusterCapabilities())
const forest = computed(() => buildForest())
const metrics = computed(() => getForestMetrics(forest.value))
const gapReport = computed(() => detectGaps())

// Select first cluster by default
const selectedCluster = ref(clusters.value[0]?.domain || "backend")

// Get capabilities for selected cluster
const currentClusterCapabilities = computed(() => {
  const cluster = clusters.value.find(c => c.domain === selectedCluster.value)
  return cluster?.capabilities || []
})

// Get trees (evidence) for a specific capability
const getTreesForCapability = (capabilityId: string): ForestTree[] => {
  return getTreesByCapability(forest.value, capabilityId)
}

// Check if capability has gaps
const hasGap = (capabilityId: string): boolean => {
  return gapReport.value.capabilityGaps.some(g => g.capabilityId === capabilityId)
}

// Get gap severity for capability
const getGapSeverity = (capabilityId: string): string => {
  const gap = gapReport.value.capabilityGaps.find(g => g.capabilityId === capabilityId)
  return gap?.severity || ""
}

// Get gap type label
const getGapType = (capabilityId: string): string => {
  const gap = gapReport.value.capabilityGaps.find(g => g.capabilityId === capabilityId)
  if (!gap) return ""
  
  const typeMap = {
    "no-evidence": "No Evidence",
    "weak-evidence": "Weak Evidence",
    "missing-type": "Missing Evidence Type"
  }
  return typeMap[gap.gapType]
}

// Get gap recommendation
const getGapRecommendation = (capabilityId: string): string => {
  const gap = gapReport.value.capabilityGaps.find(g => g.capabilityId === capabilityId)
  return gap?.recommendation || ""
}

// Get gap count for cluster
const getClusterGapCount = (domain: string): number => {
  return gapReport.value.capabilityGaps.filter(g => g.domain === domain).length
}

// Get domain color
const getDomainColor = (domain: string): string => {
  const colorMap: Record<string, string> = {
    backend: "#3b82f6",
    database: "#10b981",
    networking: "#f59e0b",
    security: "#ef4444",
    devops: "#8b5cf6",
    frontend: "#ec4899",
    tooling: "#6b7280",
    os: "#14b8a6",
  }
  return colorMap[domain] || "#94a3b8"
}

// Get evidence type styling
const getEvidenceTypeClass = (type: string): string => {
  const classMap: Record<string, string> = {
    work: "bg-emerald-100 text-emerald-800 border border-emerald-300",
    lab: "bg-blue-100 text-blue-800 border border-blue-300",
    thesis: "bg-violet-100 text-violet-800 border border-violet-300"
  }
  return classMap[type] || "bg-slate-100 text-slate-800"
}

// Get status styling
const getStatusClass = (status?: string): string => {
  const classMap: Record<string, string> = {
    active: "bg-green-100 text-green-800",
    completed: "bg-blue-100 text-blue-800",
    archived: "bg-slate-100 text-slate-600",
    paused: "bg-yellow-100 text-yellow-800"
  }
  return classMap[status || ""] || "bg-slate-100 text-slate-600"
}
</script>

<style scoped>
/* Additional styling if needed */
</style>
