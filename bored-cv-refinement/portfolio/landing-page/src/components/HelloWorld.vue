<script setup lang="ts">
import { computed } from "vue"
import { profile } from "../../../data"
import { getProfileScore, getCapabilityScore } from "../../../scoring"

const profileScore = computed(() => getProfileScore())

const topCapabilities = computed(() => {
  const capabilities = profile.capabilities.map((cap) => ({
    id: cap.id,
    label: cap.label,
    score: getCapabilityScore(cap.id),
    domain: cap.domain
  }))
  return capabilities
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
})
</script>

<template>
  <section class="w-full bg-white border border-slate-200 rounded-lg p-8 mb-8">
    <!-- Name & Title -->
    <div class="mb-6">
      <h1 class="text-3xl font-bold text-slate-900 mb-2">{{ profile.identity.name }}</h1>
      <p class="text-lg text-slate-700 mb-1">{{ profile.intent.primary }}</p>
      <p class="text-sm text-slate-500">{{ profile.intent.level }} Level</p>
    </div>

    <!-- Overall Score Badge -->
    <div class="inline-flex items-center gap-3 px-5 py-3 bg-orange-50 border border-orange-200 rounded-lg mb-6">
      <span class="text-xs font-semibold text-orange-700 uppercase tracking-wide">Overall Score</span>
      <span class="text-2xl font-bold text-orange-600">{{ profileScore.overallScore.toFixed(2) }}</span>
    </div>

    <!-- Top 3 Capabilities -->
    <div>
      <h2 class="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-3">Top Capabilities</h2>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div
          v-for="cap in topCapabilities"
          :key="cap.id"
          class="flex flex-col gap-2 p-4 bg-slate-50 border border-slate-200 rounded-lg"
        >
          <div class="flex items-center justify-between">
            <span class="text-sm font-medium text-slate-800">{{ cap.label }}</span>
            <span class="text-xs font-mono font-semibold text-orange-600">{{ cap.score.toFixed(2) }}</span>
          </div>
          <span class="text-xs text-slate-500 capitalize">{{ cap.domain }}</span>
        </div>
      </div>
    </div>
  </section>
</template>
