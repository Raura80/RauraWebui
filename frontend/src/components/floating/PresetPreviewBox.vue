<template>
  <div
    class="preset-preview-box"
    :class="{ show: visible }"
    :style="positionStyle"
  >
    <img :src="imageSrc" alt="预览">
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  visible: boolean
  imageSrc: string
  position?: { top: number; left: number }
}>()

// 将位置转为 CSS 样式，默认不设置（由 CSS 控制）
const positionStyle = computed(() => {
  if (!props.position) return {}
  return {
    top: `${props.position.top}px`,
    left: `${props.position.left}px`
  }
})
</script>
