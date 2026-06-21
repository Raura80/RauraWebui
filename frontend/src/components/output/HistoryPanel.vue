<script setup lang="ts">
/**
 * 历史记录面板组件
 * 显示生成图片的历史缩略图列表，支持点击加载和删除
 * 图片 URL 从 IndexedDB 异步加载
 */
import { computed, onMounted, inject, ref, watch } from 'vue'
import type { useHistory } from '../../composables/useHistory'
import type { HistoryMeta } from '../../composables/useImageCache'

// 通过 inject 获取 App.vue 提供的共享实例
type HistoryReturn = ReturnType<typeof useHistory>;
const history = inject<HistoryReturn>('history')!;

const {
    loadHistory,
    renderHistory,
    deleteHistoryItem,
    displayHistoryImage,
    getImageUrl,
} = history

// 组件挂载时加载历史记录
onMounted(() => {
    loadHistory()
})

// 历史记录列表
const historyList = computed(() => renderHistory())

// 图片 URL 缓存
const imageUrlCache = ref<Record<string, string>>({})

// 是否为空
const isEmpty = computed(() => historyList.value.length === 0)

// 监听历史列表变化，分批并行加载图片 URL
watch(historyList, async (list) => {
    const cache = { ...imageUrlCache.value }
    const itemsToLoad = (list as HistoryMeta[]).filter(item => item.filename && !cache[item.filename])

    // 分批并行加载（每批 10 个，避免 IndexedDB 并发压力）
    for (let i = 0; i < itemsToLoad.length; i += 10) {
        const batch = itemsToLoad.slice(i, i + 10)
        const urls = await Promise.all(batch.map(item => getImageUrl(item.filename)))
        batch.forEach((item, idx) => { cache[item.filename] = urls[idx] })
    }

    imageUrlCache.value = cache
}, { immediate: true })

// 点击历史项，加载该图片（displayHistoryImage 内部会自动恢复参数）
function handleItemClick(item: HistoryMeta) {
    displayHistoryImage(item)
}

// 删除历史项
function handleDelete(index: number, e: Event) {
    e.stopPropagation()
    deleteHistoryItem(index)
}
</script>

<template>
    <div class="history-panel">
        <div class="history-title">
            <svg class="ui-icon" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2"
                fill="none">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
            历史记录
        </div>
        <div class="history-container">
            <!-- 空状态 -->
            <div v-if="isEmpty" class="history-empty">暂无历史记录</div>
            <!-- 历史缩略图列表 -->
            <div v-for="(item, index) in historyList" :key="item.filename || index" class="history-item"
                @click="handleItemClick(item)">
                <img :src="imageUrlCache[item.filename] || ''" :alt="'历史图片 ' + (index + 1)">
                <button class="delete-btn" @click="handleDelete(index, $event)" title="删除">×</button>
            </div>
        </div>
    </div>
</template>
