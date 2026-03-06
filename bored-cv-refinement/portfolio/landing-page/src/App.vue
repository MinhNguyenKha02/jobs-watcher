<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import ForestBoard from "./components/ForestBoard.vue"
import { TRANSPARENCY_GENERATED_AT, TRANSPARENCY_MODEL_VERSION } from "./transparency"

const viewportScale = ref(1)
const stageRef = ref<HTMLElement | null>(null)
let stageResizeObserver: ResizeObserver | null = null
const paperFlowRef = ref<HTMLElement | null>(null)
const measuredFlowHeight = ref(0)
let paperFlowResizeObserver: ResizeObserver | null = null

const MIN_PAPER_WIDTH = 600
const MAX_PAPER_WIDTH = 900
const DEFAULT_PAPER_WIDTH = 690
const WIDTH_PRESETS = {
  xs: 600,
  s: 700,
  m: 800,
  l: 900,
} as const
type WidthMode = "auto" | keyof typeof WIDTH_PRESETS

const paperWidth = ref(DEFAULT_PAPER_WIDTH)
const paperHeight = computed(() => Math.round(paperWidth.value * Math.SQRT2))
const PAPER_CHROME_BASE_HEIGHT = 84
const paperChromeHeight = computed(() => Math.round(PAPER_CHROME_BASE_HEIGHT * uiScale.value))
const fallbackTotalPaperHeight = computed(() => paperHeight.value + paperChromeHeight.value)
const totalPaperHeight = computed(() =>
  measuredFlowHeight.value > 0 ? measuredFlowHeight.value : fallbackTotalPaperHeight.value,
)
const stageWidth = ref(0)
const stageHeight = ref(0)
const widthMode = ref<WidthMode>("auto")

const layoutScalePercent = computed(() => `${Math.round(viewportScale.value * 100)}%`)
const uiScale = computed(() => Number((paperWidth.value / DEFAULT_PAPER_WIDTH).toFixed(3)))
const shellMaxWidth = computed(() => `${Math.round(paperWidth.value + 10)}px`)
const BASE_SPACE = 5
const HALF_SPACE = 3
const INNER_SPACE = 6
const mainPad = computed(() => `${BASE_SPACE}px`)
const cardPad = computed(() => `${BASE_SPACE}px`)
const gapSize = computed(() => `${BASE_SPACE}px`)
const innerGapSize = computed(() => `${INNER_SPACE}px`)
const titleSize = computed(() => `${Math.max(20, Math.round(22 * uiScale.value))}px`)
const subtitleSize = computed(() => `${Math.max(14, Math.round(14 * uiScale.value))}px`)
const tinyTextSize = computed(() => `${Math.max(12, Math.round(12 * uiScale.value))}px`)
const controlPadX = computed(() => `${BASE_SPACE}px`)
const controlPadY = computed(() => `${HALF_SPACE}px`)
const paperRowPadY = computed(() => `${Math.max(2, Math.round(3 * uiScale.value))}px`)
const paperRowGap = computed(() => `${Math.max(4, Math.round(6 * uiScale.value))}px`)
const paperFlowStyle = computed(() => ({ gap: paperRowGap.value }))
const paperHeaderFooterStyle = computed(() => ({
  paddingTop: paperRowPadY.value,
  paddingBottom: paperRowPadY.value,
}))
const paperBoardStyle = computed(() => ({ minHeight: `${paperHeight.value}px` }))
const boardTypographyVars = computed(() => ({
  "--pf-text-body": "14px",
  "--pf-text-meta": "12px",
  "--pf-text-kicker": "11px",
  "--pf-text-table": "13px",
  "--pf-line-body": "1.45",
  "--pf-line-tight": "1.3",
  "--pf-space-block": "10px",
  "--pf-space-row": "8px",
}))
const scaledPaperWidth = computed(() => Math.round(paperWidth.value * viewportScale.value))
const paperViewportStyle = computed(() => ({
  width: `${scaledPaperWidth.value}px`,
  maxWidth: "100%",
  overflow: "hidden",
}))
const paperScaleStyle = computed(() => ({
  width: `${paperWidth.value}px`,
  transform: `scale(${viewportScale.value})`,
  transformOrigin: "top left",
}))
const controlRailPadX = computed(() => `${HALF_SPACE}px`)
const controlRailPadY = computed(() => `${HALF_SPACE}px`)
const timedFlowLabel = "Recruiter 0–6s → HR 6–20s → Engineer 20–60s"
const timedFlowGoal = "Facts first, proofs second, decision confidence last."
const scanTransparencyStamp = `model ${TRANSPARENCY_MODEL_VERSION} · generated ${TRANSPARENCY_GENERATED_AT}`
const headingTracking = "0.01em"
const bodyTracking = "0.005em"

const setWidthMode = (mode: WidthMode): void => {
  widthMode.value = mode
  updateViewportScale()
}

const updateViewportScale = () => {
  const stageEl = stageRef.value
  if (!stageEl) {
    viewportScale.value = 1
    return
  }

  const availableWidth = Math.max(320, stageEl.clientWidth)
  const availableHeight = Math.max(320, stageEl.clientHeight)

  stageWidth.value = availableWidth
  stageHeight.value = availableHeight

  const autoWidth = Math.max(
    MIN_PAPER_WIDTH,
    Math.min(MAX_PAPER_WIDTH, Math.floor(availableWidth - 8)),
  )
  const presetWidth = widthMode.value === "auto" ? autoWidth : WIDTH_PRESETS[widthMode.value]
  const targetPaperWidth = Math.max(MIN_PAPER_WIDTH, Math.min(MAX_PAPER_WIDTH, presetWidth))
  paperWidth.value = targetPaperWidth

  const widthFitScale = availableWidth / paperWidth.value
  const heightFitScale = availableHeight / totalPaperHeight.value
  viewportScale.value = Number(Math.min(1, Math.max(0.6, Math.min(widthFitScale, heightFitScale))).toFixed(3))
}


onMounted(() => {
  updateViewportScale()

  if (typeof window !== "undefined") {
    stageResizeObserver = new ResizeObserver(() => {
      updateViewportScale()
    })

    if (stageRef.value) {
      stageResizeObserver.observe(stageRef.value)
    }

    paperFlowResizeObserver = new ResizeObserver(() => {
      if (!paperFlowRef.value) return
      const nextHeight = Math.round(paperFlowRef.value.getBoundingClientRect().height)
      if (nextHeight > 0 && nextHeight !== measuredFlowHeight.value) {
        measuredFlowHeight.value = nextHeight
        updateViewportScale()
      }
    })

    if (paperFlowRef.value) {
      paperFlowResizeObserver.observe(paperFlowRef.value)
    }

    window.addEventListener("resize", updateViewportScale)
  }

  updateViewportScale()
})

onBeforeUnmount(() => {
  if (typeof window !== "undefined") {
    window.removeEventListener("resize", updateViewportScale)
  }

  if (stageResizeObserver) {
    stageResizeObserver.disconnect()
    stageResizeObserver = null
  }

  if (paperFlowResizeObserver) {
    paperFlowResizeObserver.disconnect()
    paperFlowResizeObserver = null
  }
})
</script>

<template>
  <main
    class="h-[100dvh] min-h-0 overflow-x-hidden overflow-y-auto bg-[var(--theme-surface)] text-[var(--theme-text-primary)] [--theme-text-primary:#e6edf3] [--theme-text-secondary:#9aa4b2] [--theme-text-muted:#7d8590] [--theme-surface:#0d1117] [--theme-surface-elevated:#161b22] [--theme-border:#30363d] [--theme-accent-cyan:#2dd4ff] [--theme-accent-purple:#a78bfa] [--theme-accent-pink:#f472b6]"
    :style="{ padding: mainPad }"
  >
    <div class="mx-auto flex min-h-full w-full flex-col" :style="{ maxWidth: shellMaxWidth, gap: gapSize }">
      <div class="flex min-h-full flex-1 flex-col rounded-md border border-[var(--theme-border)] bg-[var(--theme-surface)]" :style="{ padding: cardPad, gap: innerGapSize }">
        <div
          ref="stageRef"
          class="m-0 flex flex-1 min-h-0 items-start justify-center overflow-x-hidden overflow-y-auto p-0"
        >
          <div
            class="mx-auto"
            :style="paperViewportStyle"
          >
            <div :style="paperScaleStyle">
              <div ref="paperFlowRef" class="m-0 flex flex-col p-0" :style="paperFlowStyle">
                <div class="m-0 p-0" :style="paperHeaderFooterStyle">
                  <h1 class="font-semibold text-[var(--theme-text-primary)]" :style="{ fontSize: titleSize, lineHeight: 1.2, letterSpacing: headingTracking }">Portfolio Forest</h1>
                  <p class="text-[var(--theme-text-secondary)]" :style="{ fontSize: subtitleSize, lineHeight: 1.35, letterSpacing: bodyTracking }">{{ timedFlowLabel }}</p>
                </div>

                <div class="m-0 p-0" :style="{ ...paperBoardStyle, ...boardTypographyVars }">
                  <ForestBoard />
                </div>

                <div class="m-0 p-0 text-[var(--theme-text-muted)]" :style="{ fontSize: tinyTextSize, lineHeight: 1.35, letterSpacing: bodyTracking, ...paperHeaderFooterStyle }">
                  {{ timedFlowGoal }} · paper {{ MIN_PAPER_WIDTH }}–{{ MAX_PAPER_WIDTH }} · current {{ paperWidth }} · scale {{ layoutScalePercent }} · {{ scanTransparencyStamp }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="flex flex-wrap items-center overflow-x-hidden rounded-md bg-[var(--theme-surface-elevated)]" :style="{ gap: gapSize, padding: `${controlRailPadY} ${controlRailPadX}` }">
        <button
          type="button"
          class="rounded border font-medium transition-colors"
          :style="{ padding: `${controlPadY} ${controlPadX}`, fontSize: tinyTextSize }"
          :class="widthMode === 'auto'
            ? 'border-[var(--theme-accent-cyan)] bg-[var(--theme-surface-elevated)] text-[var(--theme-text-primary)]'
            : 'border-[var(--theme-border)] text-[var(--theme-text-secondary)] hover:border-[var(--theme-accent-cyan)] hover:text-[var(--theme-text-primary)]'"
          @click="setWidthMode('auto')"
        >
          Auto
        </button>
        <button
          type="button"
          class="rounded border font-medium transition-colors"
          :style="{ padding: `${controlPadY} ${controlPadX}`, fontSize: tinyTextSize }"
          :class="widthMode === 'xs'
            ? 'border-[var(--theme-accent-cyan)] bg-[var(--theme-surface-elevated)] text-[var(--theme-text-primary)]'
            : 'border-[var(--theme-border)] text-[var(--theme-text-secondary)] hover:border-[var(--theme-accent-cyan)] hover:text-[var(--theme-text-primary)]'"
          @click="setWidthMode('xs')"
        >
          XS 600
        </button>
        <button
          type="button"
          class="rounded border font-medium transition-colors"
          :style="{ padding: `${controlPadY} ${controlPadX}`, fontSize: tinyTextSize }"
          :class="widthMode === 's'
            ? 'border-[var(--theme-accent-cyan)] bg-[var(--theme-surface-elevated)] text-[var(--theme-text-primary)]'
            : 'border-[var(--theme-border)] text-[var(--theme-text-secondary)] hover:border-[var(--theme-accent-cyan)] hover:text-[var(--theme-text-primary)]'"
          @click="setWidthMode('s')"
        >
          S 700
        </button>
        <button
          type="button"
          class="rounded border font-medium transition-colors"
          :style="{ padding: `${controlPadY} ${controlPadX}`, fontSize: tinyTextSize }"
          :class="widthMode === 'm'
            ? 'border-[var(--theme-accent-cyan)] bg-[var(--theme-surface-elevated)] text-[var(--theme-text-primary)]'
            : 'border-[var(--theme-border)] text-[var(--theme-text-secondary)] hover:border-[var(--theme-accent-cyan)] hover:text-[var(--theme-text-primary)]'"
          @click="setWidthMode('m')"
        >
          M 800
        </button>
        <button
          type="button"
          class="rounded border font-medium transition-colors"
          :style="{ padding: `${controlPadY} ${controlPadX}`, fontSize: tinyTextSize }"
          :class="widthMode === 'l'
            ? 'border-[var(--theme-accent-cyan)] bg-[var(--theme-surface-elevated)] text-[var(--theme-text-primary)]'
            : 'border-[var(--theme-border)] text-[var(--theme-text-secondary)] hover:border-[var(--theme-accent-cyan)] hover:text-[var(--theme-text-primary)]'"
          @click="setWidthMode('l')"
        >
          L 900
        </button>
        <div class="text-[var(--theme-text-muted)]" :style="{ fontSize: tinyTextSize }">
          Preset width is independent from browser/device zoom.
        </div>
      </div>
    </div>
  </main>
</template>
