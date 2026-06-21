<template>
  <div
    id="tagDetailTooltip"
    class="tag-detail-tooltip"
    :class="[
      { show: visible },
      category ? `border-${category.toLowerCase()}` : ''
    ]"
    :style="tooltipStyle"
  >
    <div id="tooltipWiki" class="tooltip-wiki">{{ wiki }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'

const props = defineProps<{
  visible: boolean
  tag: string
  wiki: string
  category: string
}>()

// 鼠标位置
const mouseX = ref(0)
const mouseY = ref(0)

// 根据鼠标位置计算浮层定位
const tooltipStyle = computed(() => ({
  left: `${mouseX.value + 15}px`,
  top: `${mouseY.value + 15}px`
}))

// 跟踪鼠标位置，让浮层跟随光标
function onMousemove(e: MouseEvent) {
  mouseX.value = e.clientX
  mouseY.value = e.clientY
}

onMounted(() => {
  window.addEventListener('mousemove', onMousemove)
})

onUnmounted(() => {
  window.removeEventListener('mousemove', onMousemove)
})
</script>
