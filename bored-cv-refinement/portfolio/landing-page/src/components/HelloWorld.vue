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
  <section class="mb-8 w-full min-w-0 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface-elevated)] p-8">
    <!-- Name & Title -->
    <div class="mb-6">
      <h1 class="mb-2 text-3xl font-bold text-[var(--theme-text-primary)]">{{ profile.identity.name }}</h1>
      <p class="mb-1 text-lg text-[var(--theme-text-secondary)]">{{ profile.intent.primary }}</p>
      <p class="text-sm text-[var(--theme-text-muted)]">{{ profile.intent.level }} Level</p>
    </div>

    <!-- Overall Score Badge -->
    <div class="mb-6 inline-flex items-center gap-3 rounded-lg border border-[var(--theme-accent-cyan)]/50 bg-[var(--theme-accent-cyan)]/10 px-5 py-3">
      <span class="text-xs font-semibold uppercase tracking-wide text-[var(--theme-accent-cyan)]">Overall Score</span>
      <span class="text-2xl font-bold text-[var(--theme-text-primary)]">{{ profileScore.overallScore.toFixed(2) }}</span>
    </div>

    <!-- Top 3 Capabilities -->
    <div>
      <h2 class="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--theme-text-secondary)]">Top Capabilities</h2>
      <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div
          v-for="cap in topCapabilities"
          :key="cap.id"
          class="flex min-w-0 flex-col gap-2 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface)] p-4"
        >
          <div class="flex items-center justify-between">
            <span class="truncate pr-2 text-sm font-medium text-[var(--theme-text-primary)]">{{ cap.label }}</span>
            <span class="text-xs font-mono font-semibold text-[var(--theme-accent-purple)]">{{ cap.score.toFixed(2) }}</span>
          </div>
          <span class="text-xs capitalize text-[var(--theme-text-muted)]">{{ cap.domain }}</span>
        </div>
      </div>
    </div>
  </section>
</template>
