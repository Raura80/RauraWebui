<template>
  <div id="loadingPage" :class="{ hidden: isHidden }">
    <div class="loading-container">
      <div class="loading-spinner"></div>
      <div class="loading-progress">
        <div class="loading-progress-bar" :style="{ width: progress + '%' }"></div>
      </div>
      <div class="loading-text">{{ text }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

// 进度百分比
const progress = ref(0)
// 显示文字
const text = ref('加载中...')
// 是否隐藏
const isHidden = ref(false)

// 进度定时器
let progressInterval: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  // 模拟进度条动画，每 200ms 随机增长
  progressInterval = setInterval(() => {
    progress.value += Math.random() * 3
    if (progress.value >= 100) {
      progress.value = 100
      if (progressInterval) clearInterval(progressInterval)
    }
    text.value = `加载中... ${Math.floor(progress.value)}%`
  }, 200)

  // 页面完全加载后完成进度并隐藏
  window.addEventListener('load', onLoad)
})

onUnmounted(() => {
  if (progressInterval) clearInterval(progressInterval)
  window.removeEventListener('load', onLoad)
})

function onLoad() {
  // 停止进度模拟，直接设为 100%
  if (progressInterval) clearInterval(progressInterval)
  progress.value = 100
  text.value = '加载完成！'
  // 延迟 500ms 后添加隐藏类，再 500ms 后彻底隐藏
  setTimeout(() => {
    isHidden.value = true
  }, 500)
}
</script>
