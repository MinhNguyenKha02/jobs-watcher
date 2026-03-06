<template>
  <section class="w-full min-w-0">
    <div class="text-[11px] uppercase tracking-wide text-[var(--theme-text-secondary)]">
      {{ title }}
    </div>
    <div class="mb-2 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[var(--theme-text-muted)]">
      <span class="inline-flex items-center gap-1">
        <i class="h-2 w-2 rounded-full bg-[var(--theme-accent-cyan)]"></i>
        evidence/delivery
      </span>
      <span class="inline-flex items-center gap-1">
        <i class="h-2 w-2 rounded-full bg-[var(--theme-accent-purple)]"></i>
        quality/architecture
      </span>
      <span class="inline-flex items-center gap-1">
        <i class="h-2 w-2 rounded-full bg-[var(--theme-accent-pink)]"></i>
        risk/constraint
      </span>
      <span class="inline-flex items-center gap-1">
        <i class="inline-block h-[2px] w-4 bg-[var(--theme-accent-cyan)]"></i>
        support
      </span>
      <span class="inline-flex items-center gap-1">
        <i class="inline-block h-[2px] w-4 bg-[var(--theme-accent-purple)]"></i>
        derived
      </span>
      <span class="inline-flex items-center gap-1">
        <i class="inline-block h-[2px] w-4 border-t-2 border-dashed border-[var(--theme-accent-pink)]"></i>
        risk edge
      </span>
    </div>

    <div class="relative h-[200px] w-full overflow-hidden rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] px-2.5 py-2 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)]">
      <svg viewBox="0 0 690 200" class="h-full w-full" preserveAspectRatio="none" aria-label="evidence to domain connectors">
        <g>
          <path
            v-for="line in curvedLines"
            :key="line.key"
            :d="line.d"
            fill="none"
            :stroke="line.color"
            :stroke-opacity="lineOpacity(line)"
            :stroke-width="lineStrokeWidth(line)"
            :stroke-dasharray="lineDash(line)"
            stroke-linecap="round"
            class="cursor-pointer transition-all duration-200"
            :style="{ filter: `drop-shadow(0 0 ${Math.max(1.2, line.strokeWidth * 1.2)}px ${line.color})` }"
            @mouseenter="setHoveredEdge(line.key)"
            @mouseleave="clearHover"
          />
        </g>

        <g>
          <g
            v-for="(node, index) in topNodes"
            :key="`top-node-${node.id}`"
            class="cursor-pointer"
            @mouseenter="setHoveredTop(node.id)"
            @mouseleave="clearHover"
          >
            <circle
              :cx="topXs[index]"
              cy="34"
              :r="isTopActive(node.id) ? 5 : 4"
              :fill="topNodeFill(index)"
              :fill-opacity="nodeOpacity(isTopActive(node.id))"
              class="transition-all duration-150"
            />
            <text
              :x="topXs[index]"
              y="20"
              text-anchor="middle"
              class="fill-[var(--theme-text-primary)] text-[9px] transition-all duration-150"
              :fill-opacity="nodeOpacity(isTopActive(node.id))"
            >
              {{ ellipsize(node.label) }}
              <title>{{ node.label }}</title>
            </text>
            <text
              :x="topXs[index]"
              y="48"
              text-anchor="middle"
              class="fill-[var(--theme-text-secondary)] text-[8px] transition-all duration-150"
              :fill-opacity="nodeOpacity(isTopActive(node.id))"
            >
              {{ node.meta }}
            </text>
          </g>
        </g>

        <g>
          <g
            v-for="(node, index) in bottomNodes"
            :key="`bottom-node-${node.id}`"
            class="cursor-pointer"
            @mouseenter="setHoveredBottom(node.id)"
            @mouseleave="clearHover"
          >
            <circle
              :cx="bottomXs[index]"
              cy="166"
              :r="isBottomActive(node.id) ? 5 : 4"
              :fill="bottomNodeFill(index)"
              :fill-opacity="nodeOpacity(isBottomActive(node.id))"
              class="transition-all duration-150"
            />
            <text
              :x="bottomXs[index]"
              y="152"
              text-anchor="middle"
              class="fill-[var(--theme-text-primary)] text-[9px] transition-all duration-150"
              :fill-opacity="nodeOpacity(isBottomActive(node.id))"
            >
              {{ ellipsize(node.label) }}
              <title>{{ node.label }}</title>
            </text>
            <text
              :x="bottomXs[index]"
              y="182"
              text-anchor="middle"
              class="fill-[var(--theme-text-secondary)] text-[8px] transition-all duration-150"
              :fill-opacity="nodeOpacity(isBottomActive(node.id))"
            >
              {{ node.meta }}
            </text>
          </g>
        </g>
      </svg>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue"

interface ConnectorNode {
  id: string
  label: string
  meta: string
  color?: string
}

type EdgeKind = "support" | "derived" | "risk"

interface ConnectorEdge {
  sourceId: string
  targetId: string
  strength: number
  weight?: number
  importance?: number
  kind?: EdgeKind
  color?: string
  isRisk?: boolean
  riskReason?: string
}

const props = defineProps<{
  title: string
  topNodes: ConnectorNode[]
  bottomNodes: ConnectorNode[]
  edges: ConnectorEdge[]
}>()

const width = 690
const margin = 86
const synthwavePalette = ["var(--theme-accent-cyan)", "var(--theme-accent-purple)", "var(--theme-accent-pink)"]
const META_COLOR_MAP: Record<string, string> = {
  evidence: "var(--theme-accent-cyan)",
  delivery: "var(--theme-accent-cyan)",
  quality: "var(--theme-accent-purple)",
  architecture: "var(--theme-accent-purple)",
  risk: "var(--theme-accent-pink)",
  constraint: "var(--theme-accent-pink)",
}
const FILL_PROMINENCE_BOOST = 1.03
const MAX_NODE_LABEL = 16

const normalizeMetaKey = (meta: string): string => meta.trim().toLowerCase()

const colorFromMeta = (meta: string): string | undefined => {
  const normalized = normalizeMetaKey(meta)
  if (!normalized) return undefined

  if (META_COLOR_MAP[normalized]) return META_COLOR_MAP[normalized]

  const segments = normalized.split(/[^a-z]+/).filter(Boolean)
  const matchedSegment = segments.find((segment) => META_COLOR_MAP[segment])
  return matchedSegment ? META_COLOR_MAP[matchedSegment] : undefined
}

const distributeX = (count: number): number[] => {
  if (count <= 0) return []
  if (count === 1) return [width / 2]
  const usableWidth = width - margin * 2
  const step = usableWidth / (count - 1)
  return Array.from({ length: count }, (_, index) => margin + index * step)
}

const topXs = computed(() => distributeX(props.topNodes.length))
const bottomXs = computed(() => distributeX(props.bottomNodes.length))
const hoveredEdgeKey = ref<string | null>(null)
const hoveredTopId = ref<string | null>(null)
const hoveredBottomId = ref<string | null>(null)

const setHoveredEdge = (edgeKey: string): void => {
  hoveredEdgeKey.value = edgeKey
  hoveredTopId.value = null
  hoveredBottomId.value = null
}

const setHoveredTop = (nodeId: string): void => {
  hoveredTopId.value = nodeId
  hoveredEdgeKey.value = null
  hoveredBottomId.value = null
}

const setHoveredBottom = (nodeId: string): void => {
  hoveredBottomId.value = nodeId
  hoveredEdgeKey.value = null
  hoveredTopId.value = null
}

const clearHover = (): void => {
  hoveredEdgeKey.value = null
  hoveredTopId.value = null
  hoveredBottomId.value = null
}

const ellipsize = (text: string, max = MAX_NODE_LABEL): string => {
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}…`
}

const edgeKind = (edge: ConnectorEdge): EdgeKind => {
  if (edge.kind) return edge.kind
  return edge.isRisk ? "risk" : "support"
}

const edgeStroke = (kind: EdgeKind): string => {
  if (kind === "risk") return "var(--theme-accent-pink)"
  if (kind === "derived") return "var(--theme-accent-purple)"
  return "var(--theme-accent-cyan)"
}

const edgeDash = (kind: EdgeKind): string => (kind === "risk" ? "5 4" : "0")

const edgeOpacity = (kind: EdgeKind): number => (kind === "risk" ? 0.75 : 0.5)

const topNodeFill = (index: number): string => {
  const node = props.topNodes[index]
  return (
    node?.color ??
    (node?.meta ? colorFromMeta(node.meta) : undefined) ??
    synthwavePalette[index % synthwavePalette.length] ??
    "var(--theme-accent-cyan)"
  )
}

const bottomNodeFill = (index: number): string => {
  const node = props.bottomNodes[index]
  return (
    node?.color ??
    (node?.meta ? colorFromMeta(node.meta) : undefined) ??
    synthwavePalette[(index + 1) % synthwavePalette.length] ??
    "var(--theme-accent-cyan)"
  )
}

const curvedLines = computed(() => {
  const topY = 34
  const bottomY = 166

  return props.edges
    .map((edge) => {
      const sourceIndex = props.topNodes.findIndex((item) => item.id === edge.sourceId)
      const targetIndex = props.bottomNodes.findIndex((item) => item.id === edge.targetId)
      if (sourceIndex < 0 || targetIndex < 0) return null

      const x1 = topXs.value[sourceIndex]
      const x2 = bottomXs.value[targetIndex]
      if (x1 === undefined || x2 === undefined) return null
      const dx = x2 - x1
      const controlOffset = dx * 0.18
      const d = `M ${x1} ${topY} C ${x1 + controlOffset} 90, ${x2 - controlOffset} 110, ${x2} ${bottomY}`
      const kind = edgeKind(edge)
      const confidence = edge.weight ?? edge.strength
      const importance = edge.importance ?? edgeOpacity(kind)

      return {
        key: `${edge.sourceId}-${edge.targetId}`,
        sourceId: edge.sourceId,
        targetId: edge.targetId,
        d,
        kind,
        color: edgeStroke(kind),
        dash: edgeDash(kind),
        opacity: Math.max(0.2, Math.min(1, importance)),
        strokeWidth: Math.max(1.25, Math.min(2.25, confidence || 1.5)),
      }
    })
    .filter((line): line is NonNullable<typeof line> => line !== null)
})

const activeEdges = computed(() => {
  return curvedLines.value.filter((line) => {
    if (hoveredEdgeKey.value) return line.key === hoveredEdgeKey.value
    if (hoveredTopId.value) return line.sourceId === hoveredTopId.value
    if (hoveredBottomId.value) return line.targetId === hoveredBottomId.value
    return true
  })
})

const activeTopIds = computed(() => {
  if (hoveredTopId.value) return new Set([hoveredTopId.value])
  const ids = activeEdges.value.map((line) => line.sourceId)
  return new Set(ids)
})

const activeBottomIds = computed(() => {
  if (hoveredBottomId.value) return new Set([hoveredBottomId.value])
  const ids = activeEdges.value.map((line) => line.targetId)
  return new Set(ids)
})

const hasHover = computed(() => {
  return Boolean(hoveredEdgeKey.value || hoveredTopId.value || hoveredBottomId.value)
})

const isTopActive = (nodeId: string): boolean => activeTopIds.value.has(nodeId)
const isBottomActive = (nodeId: string): boolean => activeBottomIds.value.has(nodeId)

const nodeOpacity = (isActive: boolean): number => {
  const baseOpacity = !hasHover.value ? 1 : isActive ? 1 : 0.24
  return Math.min(1, baseOpacity * FILL_PROMINENCE_BOOST)
}

const lineOpacity = (line: { key: string; sourceId: string; targetId: string; opacity: number }): number => {
  if (!hasHover.value) return Math.min(1, line.opacity * FILL_PROMINENCE_BOOST)
  const isActive = activeEdges.value.some((item) => item.key === line.key)
  const baseOpacity = isActive ? Math.min(1, line.opacity + 0.14) : 0.16
  return Math.min(1, baseOpacity * FILL_PROMINENCE_BOOST)
}

const lineStrokeWidth = (line: { key: string; sourceId: string; targetId: string; strokeWidth: number }): number => {
  if (!hasHover.value) return line.strokeWidth * FILL_PROMINENCE_BOOST
  const isActive = activeEdges.value.some((item) => item.key === line.key)
  const baseWidth = isActive ? line.strokeWidth + 0.45 : Math.max(1, line.strokeWidth - 0.2)
  return baseWidth * FILL_PROMINENCE_BOOST
}

const lineDash = (line: { dash?: string }): string => {
  return line.dash ?? "0"
}
</script>