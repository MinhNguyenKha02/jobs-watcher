<script setup lang="ts">
import MatrixGrid from "./components/MatrixGrid.vue"
import ScoringMetrics from "./components/ScoringMetrics.vue"
</script>

<template>
  <main class="min-h-screen bg-slate-50 text-slate-900">
    <div class="mx-auto w-full max-w-[1200px] px-6 py-8">
      <!-- Header -->
      <header class="mb-8">
        <p class="text-xs uppercase tracking-wide text-slate-500 mb-2">Portfolio · Metrics</p>
        <h1 class="text-xl font-bold text-slate-900 mb-3">Capability Matrix</h1>
        <p class="text-xs text-slate-600 max-w-[600px] leading-relaxed">
          Deterministic skill matrix. Opacity = depth (score × evidence). Color = domain (orange = core, gray = support).
        </p>
      </header>

      <!-- Matrix -->
      <section class="mb-6">
        <MatrixGrid />
      </section>

      <!-- Metrics -->
      <section class="mb-6">
        <ScoringMetrics />
      </section>
    </div>
  </main>
</template>
