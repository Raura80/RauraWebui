<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

// 接收父组件传入的加载状态
const props = defineProps<{
  loading: boolean
  loadingProgress: number
  comfyuiConnected: boolean
}>()

// 是否已滚动过 hero 区域（控制收缩状态）
const isCollapsed = ref(false)
// 一旦收缩就锁死，不再恢复展开
let locked = false

// 滚动监听：当滚动超过 100px 时收缩 hero，且锁死不再恢复
function handleScroll() {
  // 已锁死则不再响应
  if (locked) return
  // 加载中或服务器不可达时不响应滚动
  if (props.loading || !props.comfyuiConnected) return
  if (window.scrollY > 100) {
    isCollapsed.value = true
    locked = true
  }
}

// 点击 CTA：加载中或服务器不可达时无操作，加载完成后平滑滚动到创作区
function scrollToWorkspace() {
  // 加载中或服务器不可达时不响应点击
  if (props.loading || !props.comfyuiConnected) return

  const workspace = document.getElementById('workspace')
  const hero = document.querySelector('.hero-section') as HTMLElement | null
  if (!workspace || !hero) return

  // 先触发收缩并锁死，等过渡完成后滚动
  isCollapsed.value = true
  locked = true

  // 等待一帧让 DOM 更新，再计算位置
  requestAnimationFrame(() => {
    const heroRect = hero.getBoundingClientRect()
    // 目标：hero 顶部贴在视口顶部，workspace 紧跟其后
    const scrollTarget = window.scrollY + heroRect.top - 20 // 20px 上边距
    window.scrollTo({ top: scrollTarget, behavior: 'smooth' })
  })
}

onMounted(() => {
  // 刷新页面时强制回到顶部（浏览器会恢复之前的滚动位置）
  window.scrollTo(0, 0)
  // 防止浏览器 scroll restoration 覆盖
  history.scrollRestoration = 'manual'

  window.addEventListener('scroll', handleScroll, { passive: true })
})

onUnmounted(() => {
  window.removeEventListener('scroll', handleScroll)
})
</script>

<template>
  <header class="hero-section" :class="{ collapsed: isCollapsed }">
    <!-- 装饰性浮动光斑 -->
    <div class="hero-orb hero-orb-1" aria-hidden="true"></div>
    <div class="hero-orb hero-orb-2" aria-hidden="true"></div>
    <div class="hero-orb hero-orb-3" aria-hidden="true"></div>

    <!-- 主题切换按钮（独立于 hero-content，避免覆盖文本） -->
    <div class="hero-actions">
      <slot name="theme-toggle"></slot>
    </div>

    <div class="hero-content">
      <h1 class="hero-title">RauraWebui</h1>
      <p class="hero-tagline">释放创意，一键生成属于你的个性画作</p>

      <!-- CTA 按钮：加载中显示进度，服务器不可达显示维护提示，否则显示"开始创作" -->
      <button class="hero-cta" :class="{
        'hero-cta--loading': loading,
        'hero-cta--offline': !loading && !comfyuiConnected
      }" :disabled="loading || !comfyuiConnected" @click="scrollToWorkspace"
        :aria-label="loading ? '加载中' : !comfyuiConnected ? '服务器维护中' : '开始创作'">
        <!-- 加载中：进度条 + 百分比文字 -->
        <template v-if="loading">
          <span class="hero-cta-progress-bar" :style="{ width: loadingProgress + '%' }"></span>
          <span class="hero-cta-text">{{ Math.floor(loadingProgress) }}%</span>
        </template>
        <!-- 服务器不可达 -->
        <template v-else-if="!comfyuiConnected">
          <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none"
            stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
          </svg>
          服务器维护中
        </template>
        <!-- 正常状态：开始创作 -->
        <template v-else>
          开始创作
          <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none"
            stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 5v14M19 12l-7 7-7-7" />
          </svg>
        </template>
      </button>
    </div>
  </header>
</template>
