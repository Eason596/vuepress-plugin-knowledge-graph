<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vuepress/client'
import KnowledgeGraph from './KnowledgeGraph.vue'

const route = useRoute()
const open = ref(false)
const width = ref(560)
const resizing = ref(false)
const focusKey = ref(0)

const sidebarStyle = computed(() => ({
  width: `${width.value}px`,
}))

function clampWidth(value: number): number {
  if (typeof window === 'undefined') return value
  const max = Math.floor(window.innerWidth * 0.92)
  return Math.min(Math.max(value, 360), Math.max(360, max))
}

function rememberWidth(value: number): void {
  width.value = clampWidth(value)
  localStorage.setItem('knowledge-graph-sidebar-width', String(width.value))
  window.dispatchEvent(new Event('resize'))
}

function onResizeMove(event: PointerEvent): void {
  if (!resizing.value) return
  rememberWidth(window.innerWidth - event.clientX)
}

function stopResize(): void {
  if (!resizing.value) return
  resizing.value = false
  document.body.classList.remove('kg-sidebar-resizing')
  window.removeEventListener('pointermove', onResizeMove)
  window.removeEventListener('pointerup', stopResize)
  window.removeEventListener('pointercancel', stopResize)
}

function startResize(event: PointerEvent): void {
  event.preventDefault()
  resizing.value = true
  document.body.classList.add('kg-sidebar-resizing')
  window.addEventListener('pointermove', onResizeMove)
  window.addEventListener('pointerup', stopResize)
  window.addEventListener('pointercancel', stopResize)
}

onMounted(() => {
  open.value = localStorage.getItem('knowledge-graph-sidebar-open') === '1'
  const savedWidth = Number(localStorage.getItem('knowledge-graph-sidebar-width'))
  if (Number.isFinite(savedWidth) && savedWidth > 0) {
    width.value = clampWidth(savedWidth)
  }
})

onBeforeUnmount(stopResize)

watch(open, (value) => {
  localStorage.setItem('knowledge-graph-sidebar-open', value ? '1' : '0')
  if (value) {
    focusKey.value += 1
    nextTick(() => window.dispatchEvent(new Event('resize')))
  }
})

watch(() => route.path, () => {
  open.value = false
})
</script>

<template>
  <Teleport to="body">
    <button
      class="kg-floating-button"
      type="button"
      :aria-expanded="open"
      aria-controls="knowledge-graph-sidebar"
      title="知识图谱"
      @click="open = !open"
    >
      <img
        class="kg-button-icon"
        src="https://api.iconify.design/carbon/chart-relationship.svg"
        alt=""
        aria-hidden="true"
      />
      <span>图谱</span>
    </button>

    <div
      v-if="open"
      class="kg-sidebar-mask"
      aria-hidden="true"
      @click="open = false"
    ></div>

    <aside
      id="knowledge-graph-sidebar"
      class="kg-sidebar"
      :class="{ open }"
      :style="sidebarStyle"
      aria-label="知识图谱侧边栏"
    >
      <button
        class="kg-sidebar-resize"
        type="button"
        title="拖动调整宽度"
        aria-label="拖动调整知识图谱侧边栏宽度"
        @pointerdown="startResize"
      ></button>
      <header class="kg-sidebar-header">
        <strong>知识图谱</strong>
        <button type="button" title="关闭" @click="open = false">×</button>
      </header>
      <KnowledgeGraph
        class="kg-sidebar-graph"
        :active-path="route.path"
        :focus-key="focusKey"
      />
    </aside>
  </Teleport>
</template>

<style scoped>
.kg-floating-button {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 40;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 38px;
  padding: 0 13px;
  border: 1px solid var(--vp-c-brand-1);
  border-radius: 999px;
  background: var(--vp-c-brand-1);
  color: var(--vp-c-white);
  font-size: 14px;
  font-weight: 600;
  box-shadow: var(--vp-shadow-3);
  cursor: pointer;
}

.kg-button-icon {
  width: 21px;
  height: 21px;
  filter: brightness(0) invert(1);
  flex: 0 0 auto;
}

.kg-sidebar-mask {
  position: fixed;
  inset: 0;
  z-index: 38;
  background: rgba(15, 23, 42, 0.18);
}

.kg-sidebar {
  position: fixed;
  top: 0;
  right: 0;
  z-index: 39;
  display: flex;
  flex-direction: column;
  max-width: 92vw;
  height: 100vh;
  padding: 0;
  border-left: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
  box-shadow: var(--vp-shadow-4);
  transform: translateX(100%);
  transition: transform 180ms ease;
}

.kg-sidebar.open {
  transform: translateX(0);
}

.kg-sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 52px;
  padding: 0 16px;
  border-bottom: 1px solid var(--vp-c-divider);
}

.kg-sidebar-resize {
  position: absolute;
  top: 0;
  left: -5px;
  width: 10px;
  height: 100%;
  border: 0;
  border-radius: 0;
  background: transparent;
  cursor: col-resize;
}

.kg-sidebar-resize::before {
  content: "";
  position: absolute;
  top: 50%;
  left: 3px;
  width: 3px;
  height: 54px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--vp-c-brand-1) 52%, transparent);
  transform: translateY(-50%);
  opacity: 0;
  transition: opacity 160ms ease;
}

.kg-sidebar-resize:hover::before,
:global(.kg-sidebar-resizing) .kg-sidebar-resize::before {
  opacity: 1;
}

:global(.kg-sidebar-resizing) {
  cursor: col-resize !important;
  user-select: none !important;
}

.kg-sidebar-header button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}

.kg-sidebar-graph {
  flex: 1;
  min-height: 0;
  padding: 12px;
}

.kg-sidebar-graph :deep(.kg-toolbar) {
  margin-top: 0;
}

.kg-sidebar-graph :deep(.kg-stage) {
  height: calc(100vh - 132px);
  min-height: 360px;
}

@media (max-width: 640px) {
  .kg-floating-button {
    right: 12px;
    bottom: 12px;
  }

  .kg-sidebar {
    width: 100vw;
    max-width: 100vw;
  }

  .kg-sidebar-resize {
    display: none;
  }

  .kg-sidebar-graph :deep(.kg-stage) {
    height: calc(100vh - 164px);
  }
}
</style>
