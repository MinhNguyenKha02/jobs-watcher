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
      return "border-[var(--theme-accent-cyan)]/50 bg-[var(--theme-accent-cyan)]/10 text-[var(--theme-accent-cyan)]"
    case "completed":
      return "border-[var(--theme-accent-purple)]/50 bg-[var(--theme-accent-purple)]/10 text-[var(--theme-accent-purple)]"
    case "paused":
      return "border-[var(--theme-accent-pink)]/50 bg-[var(--theme-accent-pink)]/10 text-[var(--theme-accent-pink)]"
    default:
      return "border-[var(--theme-border)] bg-[var(--theme-surface)] text-[var(--theme-text-secondary)]"
  }
}
</script>

<template>
  <section class="w-full min-w-0">
    <h2 class="mb-4 text-xs font-semibold uppercase tracking-wide text-[var(--theme-text-secondary)]">Evidence Highlights</h2>
    <div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      <div
        v-for="evidence in topEvidence"
        :key="evidence.id"
        class="flex min-w-0 flex-col gap-3 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-surface-elevated)] p-5 transition-colors hover:border-[var(--theme-accent-purple)]"
      >
        <!-- Header -->
        <div class="flex items-start justify-between gap-2">
          <h3 class="text-sm font-semibold leading-tight text-[var(--theme-text-primary)]">{{ evidence.title }}</h3>
          <span
            :class="getStatusColor(evidence.status)"
            class="text-xs px-2 py-1 rounded border font-medium shrink-0"
          >
            {{ evidence.status || "active" }}
          </span>
        </div>

        <!-- Period & Type -->
        <div class="flex flex-wrap items-center gap-2 text-xs text-[var(--theme-text-secondary)]">
          <span class="font-mono">{{ evidence.period }}</span>
          <span class="text-[var(--theme-text-muted)]">•</span>
          <span class="rounded border border-[var(--theme-border)] bg-[var(--theme-surface)] px-2 py-0.5 capitalize">{{ evidence.type }}</span>
        </div>

        <!-- Summary -->
        <p class="line-clamp-3 text-xs leading-relaxed text-[var(--theme-text-secondary)]">{{ evidence.summary }}</p>

        <!-- Tech Stack -->
        <div class="flex flex-wrap gap-1.5">
          <span
            v-for="tech in evidence.tech"
            :key="tech"
            class="rounded border border-[var(--theme-border)] bg-[var(--theme-surface)] px-2 py-1 text-xs font-medium text-[var(--theme-text-primary)]"
          >
            {{ tech }}
          </span>
        </div>
      </div>
    </div>
  </section>
</template>
