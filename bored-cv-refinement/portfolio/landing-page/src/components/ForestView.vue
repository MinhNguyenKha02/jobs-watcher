<template>
  <section class="forest-row w-full min-w-0">
    <div class="mb-2 text-[11px] uppercase tracking-wide text-[var(--theme-text-muted)]">
      {{ title }}
    </div>

    <div class="grid w-full min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <article
        v-for="item in items"
        :key="item.id"
        class="min-w-0 rounded border border-[var(--theme-border)] bg-[var(--theme-surface-elevated)] px-3 py-3"
      >
        <div class="truncate text-sm font-semibold text-[var(--theme-text-primary)]">{{ item.label }}</div>
        <div class="mt-1 text-xs text-[var(--theme-text-secondary)]">{{ item.subLabel }}</div>
        <div class="mt-2 flex flex-wrap items-center justify-between gap-1 text-xs text-[var(--theme-text-secondary)]">
          <span class="truncate">{{ item.leftMetricLabel }} {{ item.leftMetricValue }}</span>
          <span class="truncate">{{ item.rightMetricLabel }} {{ item.rightMetricValue }}</span>
        </div>
      </article>
    </div>

    <div class="mt-2 text-[11px] text-[var(--theme-text-muted)]">
      Deterministic signals derived from portfolio forest evidence and scoring weights.
    </div>
  </section>
 </template>

<script setup lang="ts">
defineProps<{
  title: string
  items: Array<{
    id: string
    label: string
    subLabel: string
    leftMetricLabel: string
    leftMetricValue: string
    rightMetricLabel: string
    rightMetricValue: string
  }>
}>()
</script>

<style scoped>
.forest-row {
  width: 100%;
}
</style>

