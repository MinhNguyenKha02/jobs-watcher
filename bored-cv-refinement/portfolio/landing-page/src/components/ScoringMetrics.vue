<template>
  <section class="flex flex-col gap-4">
    <h2 class="text-xs font-semibold text-slate-700 uppercase tracking-wide">Scoring Metrics</h2>
    
    <!-- Profile-level aggregates -->
    <div class="border border-slate-200 rounded bg-white p-4">
      <div class="grid grid-cols-4 gap-4 text-center">
        <div>
          <p class="text-xs text-slate-500">Capability Avg</p>
          <p class="text-lg font-bold text-slate-800">{{ profileScore.capabilityAverage.toFixed(2) }}</p>
        </div>
        <div>
          <p class="text-xs text-slate-500">Fundamentals Avg</p>
          <p class="text-lg font-bold text-slate-800">{{ profileScore.fundamentalsAverage.toFixed(2) }}</p>
        </div>
        <div>
          <p class="text-xs text-slate-500">Overall</p>
          <p class="text-lg font-bold text-orange-600">{{ profileScore.overallScore.toFixed(2) }}</p>
        </div>
        <div>
          <p class="text-xs text-slate-500">Max Capability</p>
          <p class="text-lg font-bold text-slate-800">{{ maxCapabilityScore.toFixed(2) }}</p>
        </div>
      </div>
    </div>

    <!-- Fundamentals breakdown -->
    <div class="border border-slate-200 rounded bg-white p-4">
      <p class="text-xs font-semibold text-slate-700 mb-3">Fundamentals Coverage</p>
      <div class="grid grid-cols-3 gap-3">
        <div v-for="[area, score] in fundamentalsEntries" :key="area" class="flex flex-col gap-1">
          <p class="text-xs text-slate-600">{{ formatArea(area) }}</p>
          <div class="flex items-center gap-2">
            <div class="flex-1 h-2 bg-slate-100 rounded overflow-hidden">
              <div
                class="h-full bg-orange-400 transition-all"
                :style="{ width: (score * 100) + '%' }"
              ></div>
            </div>
            <span class="text-xs font-mono text-slate-700">{{ score.toFixed(2) }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Capability scores table -->
    <div class="border border-slate-200 rounded bg-white p-4">
      <p class="text-xs font-semibold text-slate-700 mb-3">Capability Scores</p>
      <div class="grid grid-cols-2 gap-2 text-xs">
        <div v-for="cap in capabilityScores" :key="cap.id" class="flex justify-between items-center p-2 bg-slate-50 rounded">
          <span class="text-slate-700 truncate">{{ cap.label }}</span>
          <span class="font-mono text-slate-800 font-semibold">{{ cap.score.toFixed(2) }}</span>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue"
import { getProfileScore, getCapabilityScore } from "../../../scoring"
import { profile } from "../../../data"
import type { Fundamentals } from "../../../data"

const profileScore = computed(() => getProfileScore())

const fundamentalsEntries = computed(() => {
  const entries = Object.entries(profileScore.value.fundamentals) as Array<[keyof Fundamentals, number]>
  return entries.sort((a, b) => b[1] - a[1])
})

const capabilityScores = computed(() =>
  profile.capabilities.map((cap) => ({
    id: cap.id,
    label: cap.label,
    score: getCapabilityScore(cap.id),
  })).sort((a, b) => b.score - a.score)
)

const maxCapabilityScore = computed(() =>
  Math.max(...capabilityScores.value.map((c) => c.score), 0)
)

const formatArea = (area: string) =>
  area.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
</script>
