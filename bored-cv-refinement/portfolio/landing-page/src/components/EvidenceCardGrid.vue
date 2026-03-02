<script setup lang="ts">
import { computed } from "vue"
import { profile } from "../../../data"

const topEvidence = computed(() => {
  // Get the top 3 active evidence items
  return profile.evidence
    .filter((ev) => ev.status === "active" || ev.status === "completed")
    .slice(0, 3)
})

const getStatusColor = (status?: string) => {
  switch (status) {
    case "active":
      return "bg-green-100 text-green-700 border-green-200"
    case "completed":
      return "bg-blue-100 text-blue-700 border-blue-200"
    case "paused":
      return "bg-yellow-100 text-yellow-700 border-yellow-200"
    default:
      return "bg-slate-100 text-slate-700 border-slate-200"
  }
}
</script>

<template>
  <section class="w-full">
    <h2 class="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-4">Evidence Highlights</h2>
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <div
        v-for="evidence in topEvidence"
        :key="evidence.id"
        class="flex flex-col gap-3 p-5 bg-white border border-slate-200 rounded-lg hover:shadow-md transition-shadow"
      >
        <!-- Header -->
        <div class="flex items-start justify-between gap-2">
          <h3 class="text-sm font-semibold text-slate-800 leading-tight">{{ evidence.title }}</h3>
          <span
            :class="getStatusColor(evidence.status)"
            class="text-xs px-2 py-1 rounded border font-medium shrink-0"
          >
            {{ evidence.status || "active" }}
          </span>
        </div>

        <!-- Period & Type -->
        <div class="flex items-center gap-2 text-xs text-slate-600">
          <span class="font-mono">{{ evidence.period }}</span>
          <span class="text-slate-400">•</span>
          <span class="capitalize px-2 py-0.5 bg-slate-100 rounded">{{ evidence.type }}</span>
        </div>

        <!-- Summary -->
        <p class="text-xs text-slate-600 leading-relaxed line-clamp-3">{{ evidence.summary }}</p>

        <!-- Tech Stack -->
        <div class="flex flex-wrap gap-1.5">
          <span
            v-for="tech in evidence.tech"
            :key="tech"
            class="text-xs px-2 py-1 bg-orange-50 text-orange-700 border border-orange-200 rounded font-medium"
          >
            {{ tech }}
          </span>
        </div>
      </div>
    </div>
  </section>
</template>
