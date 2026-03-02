<script setup lang="ts">
import HelloWorld from "./components/HelloWorld.vue"
import ForestView from "./components/ForestView.vue"
</script>

<template>
  <main class="min-h-screen bg-slate-50 text-slate-900">
    <div class="mx-auto w-full max-w-[1200px] px-6 py-8">
      <!-- Tier 1: Hero Section -->
      <HelloWorld />

      <!-- Tier 2: Portfolio Forest -->
      <section class="mb-8">
        <h2 class="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-4">
          Evidence Forest · Domain Clusters
        </h2>
        <p class="text-xs text-slate-600 mb-4 max-w-[600px] leading-relaxed">
          Capabilities organized by domain with evidence visualization and gap detection. Red border = missing evidence, green border = complete coverage.
        </p>
        <ForestView />
      </section>
    </div>
  </main>
</template>
