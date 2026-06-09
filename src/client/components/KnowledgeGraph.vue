<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vuepress/client'
import { knowledgeGraphData } from '@temp/knowledge-graph/data'

interface GraphNode {
  id: string
  title: string
  path: string
  file: string
  tags: string[]
  categories: string[]
  x?: number
  y?: number
  vx?: number
  vy?: number
}

interface GraphEdge {
  source: string
  target: string
  type: 'link' | 'tag' | 'category'
  label?: string
}

const router = useRouter()
const props = withDefaults(defineProps<{
  activePath?: string
  focusKey?: number
}>(), {
  activePath: '',
  focusKey: 0,
})

const canvas = ref<HTMLCanvasElement | null>(null)
const query = ref('')
const showTagEdges = ref(true)
const showCategoryEdges = ref(true)
const selected = ref<GraphNode | null>(null)
const hovered = ref<GraphNode | null>(null)

let ctx: CanvasRenderingContext2D | null = null
let frame = 0
let width = 0
let height = 0
let scale = 1
let offsetX = 0
let offsetY = 0
let draggingNode: GraphNode | null = null
let panning = false
let lastX = 0
let lastY = 0
let tick = 0

const nodes = ref<GraphNode[]>(knowledgeGraphData.nodes.map((node: GraphNode, index: number) => ({
  ...node,
  x: Math.cos(index) * 180,
  y: Math.sin(index) * 180,
  vx: 0,
  vy: 0,
})))

const nodeById = computed(() => new Map(nodes.value.map((node) => [node.id, node])))

const edges = computed<GraphEdge[]>(() => knowledgeGraphData.edges.filter((edge: GraphEdge) => {
  if (edge.type === 'tag' && !showTagEdges.value) return false
  if (edge.type === 'category' && !showCategoryEdges.value) return false
  return nodeById.value.has(edge.source) && nodeById.value.has(edge.target)
}))

const visibleNodeIds = computed(() => {
  const text = query.value.trim().toLowerCase()
  if (!text) return new Set(nodes.value.map((node) => node.id))
  const matched = new Set<string>()
  for (const node of nodes.value) {
    const haystack = [
      node.title,
      node.file,
      ...node.tags,
      ...node.categories,
    ].join(' ').toLowerCase()
    if (haystack.includes(text)) matched.add(node.id)
  }
  for (const edge of edges.value) {
    if (matched.has(edge.source)) matched.add(edge.target)
    if (matched.has(edge.target)) matched.add(edge.source)
  }
  return matched
})

const visibleNodes = computed(() => nodes.value.filter((node) => visibleNodeIds.value.has(node.id)))
const visibleEdges = computed(() => edges.value.filter((edge) => (
  visibleNodeIds.value.has(edge.source) && visibleNodeIds.value.has(edge.target)
)))

const stats = computed(() => ({
  nodes: visibleNodes.value.length,
  edges: visibleEdges.value.length,
  allNodes: nodes.value.length,
  allEdges: knowledgeGraphData.edges.length,
}))

function normalizePath(value: string): string {
  return value
    .replace(/[?#].*$/, '')
    .replace(/\/index\.html$/, '/')
    .replace(/\.html$/, '')
    .replace(/\/$/, '') || '/'
}

function findNodeByPath(path: string): GraphNode | null {
  const normalized = normalizePath(path)
  return nodes.value.find((node) => normalizePath(node.path) === normalized) ?? null
}

function centerOnNode(node: GraphNode): void {
  selected.value = node
  query.value = ''
  tick = Math.min(tick, 260)
  nextTick(() => {
    resize()
    offsetX = width / 2 - (node.x ?? 0) * scale
    offsetY = height / 2 - (node.y ?? 0) * scale
    draw()
  })
}

function focusActivePath(): void {
  if (!props.activePath) return
  const node = findNodeByPath(props.activePath)
  if (node) centerOnNode(node)
}

function resize(): void {
  const el = canvas.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  width = Math.max(320, rect.width)
  height = Math.max(420, rect.height)
  el.width = Math.floor(width * dpr)
  el.height = Math.floor(height * dpr)
  ctx = el.getContext('2d')
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
  offsetX = width / 2
  offsetY = height / 2
}

function colorFor(node: GraphNode): string {
  if (selected.value?.id === node.id) return '#f59e0b'
  if (hovered.value?.id === node.id) return '#3b82f6'
  if (node.tags.length > 0) return '#10b981'
  if (node.categories.length > 0) return '#8b5cf6'
  return '#64748b'
}

function radiusFor(node: GraphNode): number {
  let degree = 0
  for (const edge of edges.value) {
    if (edge.source === node.id || edge.target === node.id) degree += 1
  }
  return Math.min(18, 6 + Math.sqrt(degree) * 2.4)
}

function relatedNodeIds(center: GraphNode | null): Set<string> {
  const ids = new Set<string>()
  if (!center) return ids
  ids.add(center.id)
  for (const edge of visibleEdges.value) {
    if (edge.source === center.id) ids.add(edge.target)
    if (edge.target === center.id) ids.add(edge.source)
  }
  return ids
}

function isRelatedEdge(edge: GraphEdge, center: GraphNode | null): boolean {
  return !!center && (edge.source === center.id || edge.target === center.id)
}

function worldToScreen(node: GraphNode): { x: number; y: number } {
  return {
    x: (node.x ?? 0) * scale + offsetX,
    y: (node.y ?? 0) * scale + offsetY,
  }
}

function screenToWorld(x: number, y: number): { x: number; y: number } {
  return {
    x: (x - offsetX) / scale,
    y: (y - offsetY) / scale,
  }
}

function hitTest(x: number, y: number): GraphNode | null {
  for (let i = visibleNodes.value.length - 1; i >= 0; i -= 1) {
    const node = visibleNodes.value[i]
    const point = worldToScreen(node)
    const radius = radiusFor(node) * scale + 4
    if ((point.x - x) ** 2 + (point.y - y) ** 2 <= radius ** 2) return node
  }
  return null
}

function simulate(): void {
  const active = visibleNodes.value
  const activeEdges = visibleEdges.value
  const byId = nodeById.value
  if (active.length === 0) return

  const repulsion = 2400
  const spring = 0.012
  const center = 0.004
  for (let i = 0; i < active.length; i += 1) {
    const a = active[i]
    for (let j = i + 1; j < active.length; j += 1) {
      const b = active[j]
      const dx = (a.x ?? 0) - (b.x ?? 0)
      const dy = (a.y ?? 0) - (b.y ?? 0)
      const dist2 = Math.max(80, dx * dx + dy * dy)
      const force = repulsion / dist2
      const dist = Math.sqrt(dist2)
      const fx = (dx / dist) * force
      const fy = (dy / dist) * force
      a.vx = (a.vx ?? 0) + fx
      a.vy = (a.vy ?? 0) + fy
      b.vx = (b.vx ?? 0) - fx
      b.vy = (b.vy ?? 0) - fy
    }
  }

  for (const edge of activeEdges) {
    const a = byId.get(edge.source)
    const b = byId.get(edge.target)
    if (!a || !b) continue
    const dx = (b.x ?? 0) - (a.x ?? 0)
    const dy = (b.y ?? 0) - (a.y ?? 0)
    const desired = edge.type === 'link' ? 120 : 180
    const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy))
    const force = (dist - desired) * spring
    const fx = (dx / dist) * force
    const fy = (dy / dist) * force
    a.vx = (a.vx ?? 0) + fx
    a.vy = (a.vy ?? 0) + fy
    b.vx = (b.vx ?? 0) - fx
    b.vy = (b.vy ?? 0) - fy
  }

  for (const node of active) {
    if (node === draggingNode) continue
    node.vx = ((node.vx ?? 0) - (node.x ?? 0) * center) * 0.82
    node.vy = ((node.vy ?? 0) - (node.y ?? 0) * center) * 0.82
    node.x = (node.x ?? 0) + node.vx
    node.y = (node.y ?? 0) + node.vy
  }
}

function draw(): void {
  if (!ctx) return
  const highlight = hovered.value
  const related = relatedNodeIds(highlight)
  ctx.clearRect(0, 0, width, height)
  ctx.save()
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--vp-c-bg-soft') || '#f8fafc'
  ctx.fillRect(0, 0, width, height)

  for (const edge of visibleEdges.value) {
    const source = nodeById.value.get(edge.source)
    const target = nodeById.value.get(edge.target)
    if (!source || !target) continue
    const a = worldToScreen(source)
    const b = worldToScreen(target)
    const highlighted = isRelatedEdge(edge, highlight)
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.lineWidth = highlighted ? 2.4 : edge.type === 'link' ? 1.2 : 0.8
    ctx.strokeStyle = highlighted
      ? 'rgba(245, 158, 11, 0.86)'
      : highlight
        ? 'rgba(100, 116, 139, 0.12)'
        : edge.type === 'link'
          ? 'rgba(59, 130, 246, 0.38)'
          : edge.type === 'tag'
            ? 'rgba(16, 185, 129, 0.24)'
            : 'rgba(139, 92, 246, 0.22)'
    ctx.stroke()
  }

  for (const node of visibleNodes.value) {
    const point = worldToScreen(node)
    const radius = radiusFor(node) * scale
    const isHovered = highlight?.id === node.id
    const isRelated = related.has(node.id)
    const dimmed = !!highlight && !isRelated
    ctx.beginPath()
    ctx.arc(point.x, point.y, Math.max(4, radius + (isHovered ? 3 : isRelated ? 1.5 : 0)), 0, Math.PI * 2)
    ctx.fillStyle = colorFor(node)
    ctx.globalAlpha = dimmed ? 0.22 : 1
    ctx.fill()
    ctx.globalAlpha = dimmed ? 0.22 : 1
    ctx.lineWidth = isHovered ? 3.4 : selected.value?.id === node.id ? 3 : isRelated ? 2.2 : 1.5
    ctx.strokeStyle = isHovered
      ? 'rgba(245, 158, 11, 0.98)'
      : isRelated
        ? 'rgba(245, 158, 11, 0.72)'
        : 'rgba(255,255,255,0.92)'
    ctx.stroke()
    ctx.globalAlpha = 1

    if (scale > 0.58 || selected.value?.id === node.id || isHovered || isRelated) {
      ctx.font = '12px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--vp-c-text-1') || '#0f172a'
      ctx.globalAlpha = dimmed ? 0.18 : 1
      ctx.fillText(node.title, point.x, point.y + radius + 5)
      ctx.globalAlpha = 1
    }
  }
  ctx.restore()
}

function loop(): void {
  for (let i = 0; i < 2 && tick < 900; i += 1) {
    simulate()
    tick += 1
  }
  draw()
  frame = requestAnimationFrame(loop)
}

function onPointerDown(event: PointerEvent): void {
  const el = canvas.value
  if (!el) return
  el.setPointerCapture(event.pointerId)
  lastX = event.offsetX
  lastY = event.offsetY
  draggingNode = hitTest(event.offsetX, event.offsetY)
  if (draggingNode) {
    selected.value = draggingNode
  } else {
    panning = true
  }
}

function onPointerMove(event: PointerEvent): void {
  hovered.value = hitTest(event.offsetX, event.offsetY)
  const current = screenToWorld(event.offsetX, event.offsetY)
  if (draggingNode) {
    draggingNode.x = current.x
    draggingNode.y = current.y
    draggingNode.vx = 0
    draggingNode.vy = 0
    tick = Math.min(tick, 200)
  } else if (panning) {
    offsetX += event.offsetX - lastX
    offsetY += event.offsetY - lastY
  }
  lastX = event.offsetX
  lastY = event.offsetY
}

function onPointerUp(event: PointerEvent): void {
  canvas.value?.releasePointerCapture(event.pointerId)
  draggingNode = null
  panning = false
}

function onWheel(event: WheelEvent): void {
  event.preventDefault()
  const before = screenToWorld(event.offsetX, event.offsetY)
  const factor = event.deltaY > 0 ? 0.9 : 1.1
  scale = Math.min(2.4, Math.max(0.35, scale * factor))
  offsetX = event.offsetX - before.x * scale
  offsetY = event.offsetY - before.y * scale
}

function openSelected(): void {
  if (selected.value) router.push(selected.value.path)
}

watch([query, showTagEdges, showCategoryEdges], () => {
  selected.value = null
  tick = 0
})

watch(() => props.focusKey, () => {
  focusActivePath()
})

onMounted(async () => {
  await nextTick()
  resize()
  focusActivePath()
  window.addEventListener('resize', resize)
  loop()
})

onBeforeUnmount(() => {
  cancelAnimationFrame(frame)
  window.removeEventListener('resize', resize)
})
</script>

<template>
  <div class="kg-shell">
    <div class="kg-toolbar">
      <input v-model="query" class="kg-search" type="search" placeholder="搜索标题、路径、标签" />
      <label class="kg-toggle">
        <input v-model="showTagEdges" type="checkbox" />
        标签关系
      </label>
      <label class="kg-toggle">
        <input v-model="showCategoryEdges" type="checkbox" />
        分类关系
      </label>
      <span class="kg-stat">{{ stats.nodes }}/{{ stats.allNodes }} 节点 · {{ stats.edges }}/{{ stats.allEdges }} 关系</span>
    </div>

    <div class="kg-stage">
      <canvas
        ref="canvas"
        class="kg-canvas"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @dblclick="openSelected"
        @wheel="onWheel"
      />
    </div>
  </div>
</template>

<style scoped>
.kg-shell {
  width: 100%;
}

.kg-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin: 14px 0;
}

.kg-search {
  min-width: min(100%, 260px);
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
}

.kg-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--vp-c-text-2);
}

.kg-stat {
  margin-left: auto;
  font-size: 13px;
  color: var(--vp-c-text-2);
}

.kg-stage {
  position: relative;
  width: 100%;
  height: min(72vh, 720px);
  min-height: 460px;
  overflow: hidden;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
}

.kg-canvas {
  display: block;
  width: 100%;
  height: 100%;
  cursor: grab;
}

.kg-canvas:active {
  cursor: grabbing;
}

@media (max-width: 640px) {
  .kg-stat {
    width: 100%;
    margin-left: 0;
  }
}
</style>
