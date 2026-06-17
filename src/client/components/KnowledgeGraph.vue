<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vuepress/client'
import { knowledgeGraphData } from '@temp/knowledge-graph/data'

interface SourceNode {
  id: string
  title: string
  path: string
  file: string
  tags: string[]
  kind: 'note' | 'tag' | 'attachment' | 'missing'
}

interface GraphNode extends SourceNode {
  degree: number
  x?: number
  y?: number
  vx?: number
  vy?: number
  fx?: number
  fy?: number
}

interface GraphLink {
  source: string | GraphNode
  target: string | GraphNode
  type: 'link' | 'tag' | 'attachment'
  label?: string
}

interface ColorGroup {
  id: number
  name: string
  query: string
  color: string
  enabled: boolean
}

interface GraphSettings {
  showTags: boolean
  showAttachments: boolean
  showMissing: boolean
  showOrphans: boolean
  showArrows: boolean
  nodeSize: number
  textFadeThreshold: number
  linkThickness: number
  centerStrength: number
  repelStrength: number
  linkStrength: number
  linkDistance: number
  groups: ColorGroup[]
}

const SETTINGS_KEY = 'knowledge-graph-settings-v3'
const LOCAL_MODE_KEY = 'knowledge-graph-local-mode'

function defaultSettings(): GraphSettings {
  return {
    showTags: true,
    showAttachments: true,
    showMissing: true,
    showOrphans: true,
    showArrows: false,
    nodeSize: 1,
    textFadeThreshold: 1,
    linkThickness: 1,
    centerStrength: 0.08,
    repelStrength: 85,
    linkStrength: 0.65,
    linkDistance: 46,
    groups: []
  }
}

const router = useRouter()
const props = withDefaults(defineProps<{
  activePath?: string
  focusKey?: number
}>(), {
  activePath: '',
  focusKey: 0
})

const shell = ref<HTMLElement | null>(null)
const container = ref<HTMLElement | null>(null)
const query = ref('')
const settings = reactive<GraphSettings>(defaultSettings())
const settingsOpen = ref(false)
const localMode = ref(false)
const localDepth = ref(1)
const isFullscreen = ref(false)
const hoveredId = ref<string | null>(null)
const loading = ref(true)
const errorMessage = ref('')

const sourceNodes = knowledgeGraphData.nodes as SourceNode[]
const sourceLinks = knowledgeGraphData.edges as GraphLink[]
const degree = new Map<string, number>()
const searchActive = computed(() => query.value.trim().length > 0)

for (const link of sourceLinks) {
  degree.set(String(link.source), (degree.get(String(link.source)) ?? 0) + 1)
  degree.set(String(link.target), (degree.get(String(link.target)) ?? 0) + 1)
}

const nodes: GraphNode[] = sourceNodes.map((node) => ({
  ...node,
  degree: degree.get(node.id) ?? 0
}))
const nodeById = new Map(nodes.map((node) => [node.id, node]))

let graph: any = null
let resizeObserver: ResizeObserver | null = null
let themeObserver: MutationObserver | null = null
let fitTimer = 0
let groupId = 0
let textColor = '#0f172a'
let noteColor = '#ffffff'
let attachmentColor = '#8b5cf6'
let darkTheme = false

function nodeId(value: string | GraphNode): string {
  return typeof value === 'object' ? value.id : value
}

function linkIsEnabled(link: GraphLink): boolean {
  if (link.type === 'tag') return settings.showTags
  if (link.type === 'attachment') return settings.showAttachments
  return true
}

const enabledLinks = computed(() => sourceLinks.filter(linkIsEnabled))

function nodeTypeEnabled(node: GraphNode): boolean {
  if (node.kind === 'tag') return settings.showTags
  if (node.kind === 'attachment') return settings.showAttachments
  if (node.kind === 'missing') return settings.showMissing
  return true
}

const enabledDegree = computed(() => {
  const result = new Map<string, number>()
  for (const link of enabledLinks.value) {
    const source = nodeId(link.source)
    const target = nodeId(link.target)
    result.set(source, (result.get(source) ?? 0) + 1)
    result.set(target, (result.get(target) ?? 0) + 1)
  }
  return result
})

const localCenterId = computed(() => {
  if (props.activePath) return findNodeByPath(props.activePath)?.id ?? null
  return null
})

const localNodeIds = computed(() => {
  if (!localMode.value || !localCenterId.value) {
    return new Set(nodes.map((node) => node.id))
  }

  const visible = new Set<string>([localCenterId.value])
  let frontier = new Set<string>([localCenterId.value])
  for (let depth = 0; depth < localDepth.value; depth += 1) {
    const next = new Set<string>()
    for (const link of enabledLinks.value) {
      const source = nodeId(link.source)
      const target = nodeId(link.target)
      if (frontier.has(source) && !visible.has(target)) next.add(target)
      if (frontier.has(target) && !visible.has(source)) next.add(source)
    }
    for (const id of next) visible.add(id)
    frontier = next
    if (frontier.size === 0) break
  }
  return visible
})

const visibleNodeIds = computed(() => {
  const scoped = new Set(
    nodes
      .filter(nodeTypeEnabled)
      .filter((node) => localNodeIds.value.has(node.id))
      .filter((node) => settings.showOrphans || (enabledDegree.value.get(node.id) ?? 0) > 0)
      .map((node) => node.id)
  )
  const text = query.value.trim().toLowerCase()
  if (!text) return scoped

  const visible = new Set<string>()
  for (const node of nodes) {
    if (!scoped.has(node.id)) continue
    const haystack = [
      node.title,
      node.file,
      node.kind,
      ...node.tags
    ].join(' ').toLowerCase()
    if (haystack.includes(text)) visible.add(node.id)
  }
  return visible
})

const visibleLinks = computed(() => enabledLinks.value.filter((link) => (
  visibleNodeIds.value.has(nodeId(link.source))
  && visibleNodeIds.value.has(nodeId(link.target))
)))

const stats = computed(() => ({
  nodes: visibleNodeIds.value.size,
  edges: visibleLinks.value.length,
  allNodes: nodes.length,
  allEdges: sourceLinks.length
}))

const relatedIds = computed(() => {
  const center = hoveredId.value
  const related = new Set<string>()
  if (!center) return related
  related.add(center)
  for (const link of visibleLinks.value) {
    const source = nodeId(link.source)
    const target = nodeId(link.target)
    if (source === center) related.add(target)
    if (target === center) related.add(source)
  }
  return related
})

function graphData(): { nodes: GraphNode[]; links: GraphLink[] } {
  return {
    nodes: nodes.filter((node) => visibleNodeIds.value.has(node.id)),
    links: visibleLinks.value.map((link) => ({
      ...link,
      source: nodeId(link.source),
      target: nodeId(link.target)
    }))
  }
}

function normalizePath(value: string): string {
  return value
    .replace(/[?#].*$/, '')
    .replace(/\/index\.html$/, '/')
    .replace(/\.html$/, '')
    .replace(/\/$/, '') || '/'
}

function findNodeByPath(path: string): GraphNode | null {
  const normalized = normalizePath(path)
  return nodes.find((node) => normalizePath(node.path) === normalized) ?? null
}

function nodeBaseColor(node: GraphNode): string {
  const haystack = [
    node.title,
    node.path,
    node.file,
    node.kind,
    ...node.tags
  ].join(' ').toLowerCase()
  const group = settings.groups.find((item) => (
    item.enabled
    && item.query.trim()
    && haystack.includes(item.query.trim().toLowerCase())
  ))
  if (group) return group.color
  if (node.kind === 'tag') return '#ef4444'
  if (node.kind === 'missing') return '#94a3b8'
  if (node.kind === 'attachment') return attachmentColor
  return noteColor
}

function nodeColor(node: GraphNode): string {
  if (hoveredId.value === node.id) return attachmentColor
  if (relatedIds.value.size > 0 && !relatedIds.value.has(node.id)) return '#64748b'
  return nodeBaseColor(node)
}

function linkColor(link: GraphLink): string {
  const source = nodeId(link.source)
  const target = nodeId(link.target)
  const center = hoveredId.value
  if (center && (source === center || target === center)) return attachmentColor
  if (center) return 'rgba(100, 116, 139, 0.08)'
  if (link.type === 'link') return darkTheme ? 'rgba(148, 163, 184, 0.38)' : 'rgba(255, 255, 255, 0.82)'
  if (link.type === 'tag') return 'rgba(239, 68, 68, 0.3)'
  return 'rgba(139, 92, 246, 0.3)'
}

function linkWidth(link: GraphLink): number {
  const center = hoveredId.value
  const connected = center
    && (nodeId(link.source) === center || nodeId(link.target) === center)
  const base = connected ? 2.1 : link.type === 'link' ? 1.05 : 0.7
  return base * settings.linkThickness
}

function nodeScale(): number {
  if (!searchActive.value) return 1
  const count = visibleNodeIds.value.size
  if (count <= 8) return 1.9
  if (count <= 20) return 1.6
  if (count <= 50) return 1.35
  return 1.15
}

function nodeRadius(node: GraphNode): number {
  const typeScale = node.kind === 'tag' ? 0.9 : node.kind === 'missing' ? 0.75 : 1
  return Math.min(12, 3.8 + Math.sqrt(node.degree) * 0.8)
    * nodeScale()
    * settings.nodeSize
    * typeScale
}

function drawNode(node: GraphNode, ctx: CanvasRenderingContext2D, scale: number): void {
  if (node.x === undefined || node.y === undefined) return
  const highlighted = hoveredId.value === node.id
  const related = relatedIds.value.size === 0 || relatedIds.value.has(node.id)
  const radius = nodeRadius(node)

  const typeOpacity = node.kind === 'missing' ? 0.48 : 1
  ctx.globalAlpha = (related ? 1 : 0.34) * typeOpacity
  ctx.beginPath()
  ctx.arc(node.x, node.y, radius + (highlighted ? 1.8 : 0), 0, Math.PI * 2)
  ctx.fillStyle = nodeColor(node)
  ctx.fill()

  if (highlighted || (node.kind === 'note' && !darkTheme)) {
    ctx.lineWidth = (highlighted ? 1.8 : 0.7) / scale
    ctx.strokeStyle = highlighted ? '#ffffff' : 'rgba(100, 116, 139, 0.5)'
    ctx.stroke()
  }

  const textVisible = highlighted
    || relatedIds.value.has(node.id)
    || scale >= settings.textFadeThreshold
    || (node.degree >= 5 && scale >= settings.textFadeThreshold * 0.72)
  if (textVisible) {
    const fontSize = Math.max(3.5, (searchActive.value ? 14 : 12) / scale)
    ctx.font = `${highlighted ? 600 : 400} ${fontSize}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillStyle = textColor
    ctx.globalAlpha = (related ? 1 : 0.34) * typeOpacity
    ctx.fillText(node.title, node.x, node.y + radius + 2.5 / scale)
  }
  ctx.globalAlpha = 1
}

function drawPointerArea(
  node: GraphNode,
  color: string,
  ctx: CanvasRenderingContext2D
): void {
  if (node.x === undefined || node.y === undefined) return
  const radius = nodeRadius(node) + 4
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(node.x, node.y, radius, 0, Math.PI * 2)
  ctx.fill()
}

function resizeGraph(): void {
  if (!graph || !container.value) return
  const rect = container.value.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return
  graph.width(rect.width).height(rect.height)
}

function fitGraph(duration = 350): void {
  if (!graph || visibleNodeIds.value.size === 0) return
  if (searchActive.value && visibleNodeIds.value.size === 1) {
    const node = nodes.find((item) => visibleNodeIds.value.has(item.id))
    if (node?.x !== undefined && node.y !== undefined) {
      graph.centerAt(node.x, node.y, duration)
      graph.zoom(4, duration)
    }
    return
  }
  graph.zoomToFit(duration, searchActive.value ? 28 : 42)
}

function focusNode(node: GraphNode): void {
  query.value = ''
  nextTick(() => {
    if (!graph || node.x === undefined || node.y === undefined) return
    if (node.degree === 0) {
      fitGraph()
      return
    }
    graph.centerAt(node.x, node.y, 500)
    graph.zoom(3.2, 500)
  })
}

function focusActivePath(): void {
  if (!props.activePath) return
  const node = findNodeByPath(props.activePath)
  if (node) focusNode(node)
}

function arrangeFilteredNodes(): void {
  const visibleNodes = nodes
    .filter((node) => visibleNodeIds.value.has(node.id))
    .sort((left, right) => right.degree - left.degree)
  const spacing = visibleNodes.length <= 12 ? 16 : 12
  const goldenAngle = Math.PI * (3 - Math.sqrt(5))

  visibleNodes.forEach((node, index) => {
    const radius = spacing * Math.sqrt(index)
    const angle = index * goldenAngle
    const x = Math.cos(angle) * radius
    const y = Math.sin(angle) * radius
    node.x = x
    node.y = y
    node.vx = 0
    node.vy = 0
    if (node.fx !== undefined) node.fx = x
    if (node.fy !== undefined) node.fy = y
  })
}

function configureForces(): void {
  if (!graph) return
  const compact = searchActive.value || localMode.value
  const charge = graph.d3Force('charge')
  charge?.strength?.(-settings.repelStrength * (compact ? 0.55 : 1))
  charge?.distanceMax?.(compact ? 240 : 600)

  const center = graph.d3Force('center')
  center?.strength?.(settings.centerStrength)

  const linkForce = graph.d3Force('link')
  linkForce?.distance?.((link: GraphLink) => {
    const distance = settings.linkDistance
    if (compact) return link.type === 'link' ? distance * 0.68 : distance * 0.9
    return link.type === 'link' ? distance : distance * 1.55
  })
  linkForce?.strength?.((link: GraphLink) => {
    if (compact) return link.type === 'link'
      ? Math.min(1, settings.linkStrength * 1.2)
      : settings.linkStrength * 0.65
    return link.type === 'link' ? settings.linkStrength : settings.linkStrength * 0.38
  })
}

function updateGraph(): void {
  if (!graph) return
  arrangeFilteredNodes()
  graph.graphData(graphData())
  configureForces()
  graph.d3ReheatSimulation()
  window.clearTimeout(fitTimer)
  fitTimer = window.setTimeout(() => fitGraph(300), searchActive.value ? 420 : 160)
}

function refreshVisuals(): void {
  if (!graph) return
  graph
    .nodeCanvasObject(drawNode)
    .nodePointerAreaPaint(drawPointerArea)
    .linkColor(linkColor)
    .linkWidth(linkWidth)
    .linkDirectionalArrowLength((link: GraphLink) => (
      settings.showArrows && link.type === 'link' ? 3 : 0
    ))
}

function applySettings(updateStructure = false): void {
  if (!graph) return
  refreshVisuals()
  configureForces()
  if (updateStructure) updateGraph()
  else graph.d3ReheatSimulation()
}

function addGroup(): void {
  settings.groups.push({
    id: ++groupId,
    name: `分组 ${settings.groups.length + 1}`,
    query: '',
    color: '#ef4444',
    enabled: true
  })
}

function removeGroup(id: number): void {
  const index = settings.groups.findIndex((group) => group.id === id)
  if (index >= 0) settings.groups.splice(index, 1)
}

function resetSettings(): void {
  Object.assign(settings, defaultSettings())
  localMode.value = !!props.activePath
  localDepth.value = 1
  applySettings(true)
}

async function toggleFullscreen(): Promise<void> {
  if (!shell.value) return
  if (document.fullscreenElement === shell.value) {
    await document.exitFullscreen()
  } else {
    await shell.value.requestFullscreen()
  }
}

function onFullscreenChange(): void {
  isFullscreen.value = document.fullscreenElement === shell.value
  nextTick(() => {
    resizeGraph()
    fitGraph(250)
  })
}

function updateThemeColors(): void {
  const styles = getComputedStyle(document.documentElement)
  darkTheme = document.documentElement.classList.contains('dark')
  textColor = styles.getPropertyValue('--vp-c-text-1').trim() || (darkTheme ? '#e2e8f0' : '#0f172a')
  attachmentColor = styles.getPropertyValue('--vp-c-brand-1').trim() || '#8b5cf6'
  noteColor = darkTheme ? '#315d8a' : '#ffffff'
  refreshVisuals()
}

function onGraphKeydown(event: KeyboardEvent): void {
  if (!graph) return
  const zoom = graph.zoom()
  if (event.key === '+' || event.key === '=') {
    event.preventDefault()
    graph.zoom(Math.min(12, zoom * 1.25), 180)
    return
  }
  if (event.key === '-') {
    event.preventDefault()
    graph.zoom(Math.max(0.12, zoom / 1.25), 180)
    return
  }
  const step = (event.shiftKey ? 120 : 40) / zoom
  const center = graph.centerAt()
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
  event.preventDefault()
  graph.centerAt(
    center.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0),
    center.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0),
    120
  )
}

function loadSettings(): void {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}')
    const defaults = defaultSettings()
    Object.assign(settings, defaults, stored)
    settings.groups = Array.isArray(stored.groups)
      ? stored.groups.map((group: Partial<ColorGroup>) => ({
          id: Number(group.id) || ++groupId,
          name: String(group.name || '分组'),
          query: String(group.query || ''),
          color: String(group.color || '#ef4444'),
          enabled: group.enabled !== false
        }))
      : []
    groupId = Math.max(groupId, ...settings.groups.map((group) => group.id), 0)
    const context = props.activePath ? 'sidebar' : 'page'
    const storedLocalMode = localStorage.getItem(`${LOCAL_MODE_KEY}-${context}`)
    localMode.value = storedLocalMode === null ? !!props.activePath : storedLocalMode === '1'
  } catch {
    Object.assign(settings, defaultSettings())
    localMode.value = !!props.activePath
  }
}

async function initializeGraph(): Promise<void> {
  if (!container.value) return
  try {
    const { default: ForceGraph } = await import('force-graph')
    graph = new ForceGraph(container.value)
      .backgroundColor('rgba(0,0,0,0)')
      .nodeId('id')
      .nodeVal((node: GraphNode) => Math.max(1, Math.sqrt(node.degree + 1)))
      .nodeLabel((node: GraphNode) => node.title)
      .nodeCanvasObject(drawNode)
      .nodePointerAreaPaint(drawPointerArea)
      .linkColor(linkColor)
      .linkWidth(linkWidth)
      .linkLineDash((link: GraphLink) => link.type === 'link' ? null : [3, 4])
      .linkDirectionalArrowLength((link: GraphLink) => (
        settings.showArrows && link.type === 'link' ? 3 : 0
      ))
      .linkDirectionalArrowRelPos(0.82)
      .enableNodeDrag(true)
      .enablePanInteraction(true)
      .enableZoomInteraction(true)
      .minZoom(0.12)
      .maxZoom(12)
      .warmupTicks(nodes.length > 1000 ? 80 : 40)
      .cooldownTime(nodes.length > 1000 ? 14000 : 8000)
      .d3VelocityDecay(0.28)
      .onNodeHover((node: GraphNode | null) => {
        hoveredId.value = node?.id ?? null
        container.value?.classList.toggle('is-node-hovered', !!node)
      })
      .onNodeClick((node: GraphNode) => {
        if (!node.path || node.kind === 'tag' || node.kind === 'missing') return
        if (node.kind === 'attachment') {
          window.location.assign(node.path)
          return
        }
        router.push(node.path)
      })
      .onNodeDragEnd((node: GraphNode) => {
        node.fx = undefined
        node.fy = undefined
        graph.d3ReheatSimulation()
      })
      .onEngineStop(() => {
        if (!hoveredId.value) fitGraph(300)
      })

    const charge = graph.d3Force('charge')
    charge?.theta?.(0.9)
    configureForces()

    resizeObserver = new ResizeObserver(resizeGraph)
    resizeObserver.observe(container.value)
    themeObserver = new MutationObserver(updateThemeColors)
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    updateThemeColors()
    resizeGraph()
    graph.graphData(graphData())
    loading.value = false

    window.clearTimeout(fitTimer)
    fitTimer = window.setTimeout(() => {
      fitGraph(0)
      focusActivePath()
    }, 350)
  } catch (error) {
    loading.value = false
    errorMessage.value = error instanceof Error ? error.message : String(error)
  }
}

watch(query, () => {
  updateGraph()
})

watch([
  localMode,
  localDepth,
  () => settings.showTags,
  () => settings.showAttachments,
  () => settings.showMissing,
  () => settings.showOrphans
], () => {
  updateGraph()
})

watch(hoveredId, () => {
  refreshVisuals()
})

watch([
  () => settings.showArrows,
  () => settings.nodeSize,
  () => settings.textFadeThreshold,
  () => settings.linkThickness,
  () => settings.groups
], () => {
  refreshVisuals()
}, { deep: true })

watch([
  () => settings.centerStrength,
  () => settings.repelStrength,
  () => settings.linkStrength,
  () => settings.linkDistance
], () => {
  configureForces()
  graph?.d3ReheatSimulation()
})

watch(settings, (value) => {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(value))
}, { deep: true })

watch(localMode, (value) => {
  const context = props.activePath ? 'sidebar' : 'page'
  localStorage.setItem(`${LOCAL_MODE_KEY}-${context}`, value ? '1' : '0')
})

watch(() => props.focusKey, () => {
  nextTick(() => {
    resizeGraph()
    focusActivePath()
  })
})

watch(() => props.activePath, () => {
  if (localMode.value) updateGraph()
})

onMounted(async () => {
  loadSettings()
  document.addEventListener('fullscreenchange', onFullscreenChange)
  await nextTick()
  await initializeGraph()
})

onBeforeUnmount(() => {
  window.clearTimeout(fitTimer)
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  resizeObserver?.disconnect()
  themeObserver?.disconnect()
  graph?._destructor()
  resizeObserver = null
  themeObserver = null
  graph = null
})
</script>

<template>
  <div ref="shell" class="kg-shell">
    <div class="kg-toolbar">
      <input
        v-model="query"
        class="kg-search"
        type="search"
        placeholder="搜索标题、路径、标签或分类"
      />
      <button
        class="kg-tool-button"
        type="button"
        :class="{ active: localMode }"
        :disabled="!props.activePath"
        title="仅显示当前页面或选中节点附近的关系"
        @click="localMode = !localMode"
      >
        局部图谱
      </button>
      <label v-if="localMode" class="kg-depth">
        深度
        <select v-model.number="localDepth">
          <option v-for="depth in 5" :key="depth" :value="depth">{{ depth }}</option>
        </select>
      </label>
      <span class="kg-stat">
        {{ stats.nodes }}/{{ stats.allNodes }} 节点 ·
        {{ stats.edges }}/{{ stats.allEdges }} 关系
      </span>
      <button
        class="kg-icon-button"
        type="button"
        :class="{ active: settingsOpen }"
        title="图谱设置"
        aria-label="图谱设置"
        @click="settingsOpen = !settingsOpen"
      >
        ⚙
      </button>
      <button
        class="kg-icon-button"
        type="button"
        :title="isFullscreen ? '退出全屏' : '全屏显示'"
        :aria-label="isFullscreen ? '退出全屏' : '全屏显示'"
        @click="toggleFullscreen"
      >
        {{ isFullscreen ? '↙' : '⛶' }}
      </button>
    </div>

    <div class="kg-stage">
      <div
        ref="container"
        class="kg-renderer"
        tabindex="0"
        aria-label="关系图谱，使用方向键平移，使用加号和减号缩放"
        @keydown="onGraphKeydown"
      ></div>

      <aside v-if="settingsOpen" class="kg-settings" aria-label="图谱设置">
        <header class="kg-settings-header">
          <strong>图谱设置</strong>
          <button type="button" aria-label="关闭设置" @click="settingsOpen = false">×</button>
        </header>

        <details open>
          <summary>过滤</summary>
          <label class="kg-switch"><span>显示标签</span><input v-model="settings.showTags" type="checkbox" /></label>
          <label class="kg-switch"><span>显示附件</span><input v-model="settings.showAttachments" type="checkbox" /></label>
          <label class="kg-switch"><span>显示未创建文件</span><input v-model="settings.showMissing" type="checkbox" /></label>
          <label class="kg-switch"><span>显示孤立节点</span><input v-model="settings.showOrphans" type="checkbox" /></label>
          <label class="kg-switch"><span>显示方向箭头</span><input v-model="settings.showArrows" type="checkbox" /></label>
        </details>

        <details>
          <summary>分组与颜色</summary>
          <p class="kg-help">关键词会匹配标题、路径、标签和节点类型，靠前的分组优先。</p>
          <div v-for="group in settings.groups" :key="group.id" class="kg-group">
            <div class="kg-group-row">
              <input v-model="group.enabled" type="checkbox" />
              <input v-model="group.name" class="kg-group-name" aria-label="分组名称" />
              <input v-model="group.color" type="color" aria-label="分组颜色" />
              <button type="button" title="删除分组" @click="removeGroup(group.id)">×</button>
            </div>
            <input v-model="group.query" class="kg-group-query" placeholder="匹配关键词，例如 paper" />
          </div>
          <button class="kg-wide-button" type="button" @click="addGroup">添加分组</button>
        </details>

        <details>
          <summary>显示</summary>
          <label class="kg-range">
            <span>节点大小 <b>{{ settings.nodeSize.toFixed(1) }}</b></span>
            <input v-model.number="settings.nodeSize" type="range" min="0.6" max="2.2" step="0.1" />
          </label>
          <label class="kg-range">
            <span>文字淡入阈值 <b>{{ settings.textFadeThreshold.toFixed(1) }}</b></span>
            <input v-model.number="settings.textFadeThreshold" type="range" min="0.3" max="3" step="0.1" />
          </label>
          <label class="kg-range">
            <span>连线粗细 <b>{{ settings.linkThickness.toFixed(1) }}</b></span>
            <input v-model.number="settings.linkThickness" type="range" min="0.4" max="3" step="0.1" />
          </label>
        </details>

        <details>
          <summary>力学</summary>
          <label class="kg-range">
            <span>中心力 <b>{{ settings.centerStrength.toFixed(2) }}</b></span>
            <input v-model.number="settings.centerStrength" type="range" min="0" max="0.5" step="0.01" />
          </label>
          <label class="kg-range">
            <span>排斥力 <b>{{ settings.repelStrength }}</b></span>
            <input v-model.number="settings.repelStrength" type="range" min="10" max="240" step="5" />
          </label>
          <label class="kg-range">
            <span>链接力 <b>{{ settings.linkStrength.toFixed(2) }}</b></span>
            <input v-model.number="settings.linkStrength" type="range" min="0.05" max="1" step="0.05" />
          </label>
          <label class="kg-range">
            <span>链接距离 <b>{{ settings.linkDistance }}</b></span>
            <input v-model.number="settings.linkDistance" type="range" min="20" max="160" step="5" />
          </label>
        </details>

        <button class="kg-reset-button" type="button" @click="resetSettings">恢复默认设置</button>
      </aside>

      <div v-if="loading" class="kg-message">正在计算图谱布局…</div>
      <div v-else-if="errorMessage" class="kg-message kg-error">图谱加载失败：{{ errorMessage }}</div>
      <div v-else-if="stats.nodes === 0" class="kg-empty">没有符合当前过滤条件的节点</div>
    </div>
  </div>
</template>

<style scoped>
.kg-shell {
  width: 100%;
  background: var(--vp-c-bg);
}

.kg-shell:fullscreen {
  display: flex;
  flex-direction: column;
  padding: 12px;
}

.kg-shell:fullscreen .kg-stage {
  flex: 1;
  height: auto;
  min-height: 0;
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

.kg-depth {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
  color: var(--vp-c-text-2);
}

.kg-depth select,
.kg-group input:not([type="checkbox"]):not([type="color"]) {
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
}

.kg-depth select {
  height: 30px;
  padding: 0 5px;
}

.kg-tool-button,
.kg-icon-button,
.kg-wide-button,
.kg-reset-button,
.kg-settings button {
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  cursor: pointer;
}

.kg-tool-button {
  height: 34px;
  padding: 0 10px;
}

.kg-tool-button.active,
.kg-icon-button.active {
  border-color: var(--vp-c-brand-1);
  background: color-mix(in srgb, var(--vp-c-brand-1) 14%, var(--vp-c-bg));
  color: var(--vp-c-brand-1);
}

.kg-tool-button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.kg-icon-button {
  width: 34px;
  height: 34px;
  font-size: 17px;
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

.kg-renderer {
  width: 100%;
  height: 100%;
  cursor: grab;
}

.kg-renderer.is-node-hovered {
  cursor: pointer;
}

.kg-renderer:active {
  cursor: grabbing;
}

.kg-renderer :deep(canvas) {
  display: block;
}

.kg-settings {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 3;
  width: min(310px, calc(100% - 20px));
  max-height: calc(100% - 20px);
  overflow: auto;
  border: 1px solid var(--vp-c-divider);
  border-radius: 9px;
  background: color-mix(in srgb, var(--vp-c-bg) 96%, transparent);
  box-shadow: var(--vp-shadow-3);
  color: var(--vp-c-text-1);
  backdrop-filter: blur(8px);
}

.kg-settings-header {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
}

.kg-settings-header button,
.kg-group-row button {
  width: 26px;
  height: 26px;
}

.kg-settings details {
  padding: 0 12px 10px;
  border-bottom: 1px solid var(--vp-c-divider);
}

.kg-settings summary {
  padding: 11px 0;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.kg-switch,
.kg-range {
  display: flex;
  gap: 10px;
  padding: 6px 0;
  font-size: 13px;
}

.kg-switch {
  align-items: center;
  justify-content: space-between;
}

.kg-range {
  flex-direction: column;
}

.kg-range span {
  display: flex;
  justify-content: space-between;
}

.kg-range b {
  color: var(--vp-c-text-2);
  font-weight: 400;
}

.kg-range input {
  width: 100%;
}

.kg-help {
  margin: 0 0 8px;
  color: var(--vp-c-text-2);
  font-size: 12px;
  line-height: 1.45;
}

.kg-group {
  margin-bottom: 9px;
  padding: 8px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 7px;
}

.kg-group-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

.kg-group-name {
  min-width: 0;
  flex: 1;
  height: 28px;
  padding: 0 7px;
}

.kg-group-row input[type="color"] {
  width: 30px;
  height: 28px;
  padding: 2px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 5px;
  background: transparent;
}

.kg-group-query {
  box-sizing: border-box;
  width: 100%;
  height: 30px;
  padding: 0 7px;
}

.kg-wide-button,
.kg-reset-button {
  width: 100%;
  height: 32px;
}

.kg-reset-button {
  width: calc(100% - 24px);
  margin: 12px;
  color: var(--vp-c-danger-1, #dc2626);
}

.kg-message {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  background: color-mix(in srgb, var(--vp-c-bg-soft) 86%, transparent);
  color: var(--vp-c-text-2);
  text-align: center;
}

.kg-empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  color: var(--vp-c-text-2);
  text-align: center;
  pointer-events: none;
}

.kg-error {
  color: var(--vp-c-danger-1, #dc2626);
}

@media (max-width: 640px) {
  .kg-search {
    width: 100%;
  }

  .kg-stat {
    order: 5;
    width: 100%;
    margin-left: 0;
  }

  .kg-settings {
    top: 6px;
    right: 6px;
    width: calc(100% - 12px);
    max-height: calc(100% - 12px);
  }
}
</style>
