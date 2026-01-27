<template>
  <section class="w-full">
    <!-- Table wrapper: full width, desktop-only -->
    <div class="w-full border border-slate-200 rounded bg-white">
      <table class="border-collapse" :style="{ minWidth: (cols * CELL_STRIDE + ROW_GUTTER) + 'px' }">
        <!-- Header row (column labels) -->
        <thead>
          <tr>
            <th :style="{ width: ROW_GUTTER + 'px', height: CELL_STRIDE + 'px' }"></th>
            <th
              v-for="cap in profile.capabilities"
              :key="`col-${cap.id}`"
              :style="{ width: CELL_STRIDE + 'px', height: CELL_STRIDE + 'px', fontSize: FONT_SIZE + 'px', padding: '4px' }"
              class="border-b border-slate-200 font-medium text-slate-700 text-center align-bottom overflow-hidden"
              :title="cap.label"
            >
              {{ shortLabel(cap.label) }}
            </th>
          </tr>
        </thead>

        <!-- Data rows -->
        <tbody>
          <tr v-for="evType in evidenceAxis" :key="`row-${evType}`">
            <!-- Row label -->
            <td
              :style="{ width: ROW_GUTTER + 'px', height: CELL_STRIDE + 'px', fontSize: FONT_SIZE + 'px' }"
              class="border-r border-slate-200 font-medium text-slate-600 text-right pr-2 align-middle bg-slate-50"
            >
              {{ evType }}
            </td>

            <!-- Cell data -->
            <td
              v-for="cap in profile.capabilities"
              :key="`cell-${cap.id}-${evType}`"
              :id="`cell-${cap.id}-${evType}`"
              :style="{
                width: CELL_STRIDE + 'px',
                height: CELL_STRIDE + 'px',
                padding: (GAP / 2) + 'px',
                backgroundColor: 'transparent'
              }"
              class="border-slate-200 border-r border-b"
            >
              <div
                :style="{
                  width: CELL + 'px',
                  height: CELL + 'px',
                  backgroundColor: cellFill(cap.id, evType),
                  borderRadius: '2px'
                }"
              ></div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue"
import { buildMatrix } from "../../../scoring"
import { profile, CoreDomains, EvidenceWeight } from "../../../data"
import type { EvidenceType } from "../../../data"
import type { CapabilityMatrixRow } from "../../../scoring"

const COLORS = {
  orange: [235, 170, 90],
  silver: [180, 180, 180],
} as const

const GAP = 4
const ROW_GUTTER = 60
const CELL_STRIDE = 60
const CELL = CELL_STRIDE - GAP
const FONT_SIZE = 11
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

const SHORT_LABEL_MAX = 14
const shortLabel = (label: string) => (label.length > SHORT_LABEL_MAX ? `${label.slice(0, SHORT_LABEL_MAX - 3)}...` : label)

const coreDomains = [...CoreDomains]
const evidenceAxis: EvidenceType[] = Object.keys(EvidenceWeight) as EvidenceType[]

const matrix = computed<CapabilityMatrixRow[]>(() => buildMatrix())

const cols = computed(() => profile.capabilities.length)

const cellFill = (capabilityId: string, evidenceType: EvidenceType): string => {
  const cap = profile.capabilities.find((c) => c.id === capabilityId)
  if (!cap) return `rgba(0,0,0,0)`

  const entry = matrix.value.find((m) => m.capabilityId === capabilityId)
  const domainIsCore = coreDomains.includes(cap.domain as (typeof coreDomains)[number])
  const color = domainIsCore ? COLORS.orange : COLORS.silver
  const depth = entry?.score ?? 0

  const alpha = clamp(depth, 0.15, 0.95)
  return `rgba(${color[0]},${color[1]},${color[2]},${alpha})`
}


</script>
