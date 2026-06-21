<script setup lang="ts">
/**
 * 行内导航容器组件
 * 用于结果区域中切换历史图片（上一张/下一张）
 */
import { computed } from 'vue'

const props = defineProps<{
  visible: boolean
  canPrev: boolean
  canNext: boolean
}>()

const emit = defineEmits<{
  prev: []
  next: []
}>()

// 控制容器显示/隐藏
const containerStyle = computed(() => ({
  display: props.visible ? undefined : 'none',
}))
</script>

<template>
  <div class="inline-nav-container" :style="containerStyle">
    <button class="inline-nav-btn prev" :disabled="!canPrev" @click="emit('prev')">❮</button>
    <button class="inline-nav-btn next" :disabled="!canNext" @click="emit('next')">❯</button>
  </div>
</template>
