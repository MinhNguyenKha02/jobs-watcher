<template>
  <section class="flex min-w-0 flex-col gap-4">
    <h2 class="text-xs font-semibold uppercase tracking-wide text-[var(--theme-text-secondary)]">Scoring Metrics</h2>
    
    <!-- Profile-level aggregates -->
    <div class="rounded border border-[var(--theme-border)] bg-[var(--theme-surface-elevated)] p-4">
      <div class="grid grid-cols-2 gap-4 text-center md:grid-cols-4">
        <div>
          <p class="text-xs text-[var(--theme-text-muted)]">Capability Avg</p>
          <p class="text-lg font-bold text-[var(--theme-text-primary)]">{{ profileScore.capabilityAverage.toFixed(2) }}</p>
        </div>
        <div>
          <p class="text-xs text-[var(--theme-text-muted)]">Fundamentals Avg</p>
          <p class="text-lg font-bold text-[var(--theme-text-primary)]">{{ profileScore.fundamentalsAverage.toFixed(2) }}</p>
        </div>
        <div>
          <p class="text-xs text-[var(--theme-text-muted)]">Overall</p>
          <p class="text-lg font-bold text-[var(--theme-accent-cyan)]">{{ profileScore.overallScore.toFixed(2) }}</p>
        </div>
        <div>
          <p class="text-xs text-[var(--theme-text-muted)]">Max Capability</p>
          <p class="text-lg font-bold text-[var(--theme-text-primary)]">{{ maxCapabilityScore.toFixed(2) }}</p>
        </div>
      </div>
    </div>

    <!-- Fundamentals breakdown -->
    <div class="rounded border border-[var(--theme-border)] bg-[var(--theme-surface-elevated)] p-4">
      <p class="mb-3 text-xs font-semibold text-[var(--theme-text-secondary)]">Fundamentals Coverage</p>
      <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div v-for="[area, score] in fundamentalsEntries" :key="area" class="flex flex-col gap-1">
          <p class="text-xs text-[var(--theme-text-secondary)]">{{ formatArea(area) }}</p>
          <div class="flex items-center gap-2">
            <div class="h-2 flex-1 overflow-hidden rounded bg-[var(--theme-surface)]">
              <div
                class="h-full bg-[var(--theme-accent-purple)] transition-all"
                :style="{ width: (score * 100) + '%' }"
              ></div>
            </div>
            <span class="text-xs font-mono text-[var(--theme-text-primary)]">{{ score.toFixed(2) }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Capability scores table -->
    <div class="rounded border border-[var(--theme-border)] bg-[var(--theme-surface-elevated)] p-4">
      <p class="mb-3 text-xs font-semibold text-[var(--theme-text-secondary)]">Capability Scores</p>
      <div class="grid grid-cols-1 gap-2 text-xs md:grid-cols-2">
        <div v-for="cap in capabilityScores" :key="cap.id" class="flex items-center justify-between rounded border border-[var(--theme-border)] bg-[var(--theme-surface)] p-2">
          <span class="truncate pr-2 text-[var(--theme-text-secondary)]">{{ cap.label }}</span>
          <span class="font-mono font-semibold text-[var(--theme-text-primary)]">{{ cap.score.toFixed(2) }}</span>
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
