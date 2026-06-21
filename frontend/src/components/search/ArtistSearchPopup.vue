<script setup lang="ts">
/**
 * 画师搜索弹窗组件
 * 包含搜索输入、列表头排序、画师列表渲染
 */
import { ref, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useArtistSearch } from '../../composables/useArtistSearch'

const {
    currentSort,
    sortAsc,
    renderArtistList,
} = useArtistSearch()

// 弹窗可见性
const isVisible = ref(false)

// 搜索输入
const searchInput = ref('')

// 弹窗位置
const popupStyle = ref<Record<string, string>>({
    position: 'fixed',
    display: 'none',
    visibility: 'hidden',
})

// 弹窗根元素引用
const popupRef = ref<HTMLElement | null>(null)

// 切换弹窗显示
function togglePopup() {
    isVisible.value = !isVisible.value
    if (isVisible.value) {
        // 先设为隐藏但 display:flex 以获取宽度
        popupStyle.value.display = 'flex'
        popupStyle.value.visibility = 'hidden'

        nextTick(() => {
            // 获取按钮位置来计算弹窗位置
            const searchBtn = document.getElementById('searchArtistBtn')
            if (searchBtn) {
                const btnRect = searchBtn.getBoundingClientRect()
                const popupWidth = popupRef.value?.offsetWidth || 650
                const isMobile = window.innerWidth <= 768

                if (isMobile) {
                    // 移动端：弹窗从底部弹出，占屏幕下方 60%
                    popupStyle.value.top = (window.innerHeight * 0.4) + 'px'
                    popupStyle.value.left = '10px'
                } else {
                    // 桌面端：弹窗居中于按钮下方
                    let leftPos = btnRect.left + (btnRect.width / 2) - (popupWidth / 2)
                    if (leftPos < 10) leftPos = 10
                    const maxLeft = window.innerWidth - popupWidth - 10
                    if (leftPos > maxLeft) leftPos = maxLeft
                    // fixed 定位不需要加 scrollTop
                    let topPos = btnRect.bottom + 10
                    // 确保弹窗不超出视口底部
                    const maxTop = window.innerHeight - 100
                    if (topPos > maxTop) topPos = Math.max(10, maxTop)
                    popupStyle.value.top = topPos + 'px'
                    popupStyle.value.left = leftPos + 'px'
                }
            }
            popupStyle.value.visibility = 'visible'

            renderArtistList(searchInput.value)
            const inputEl = document.getElementById('artistSearchInput')
            inputEl?.focus()
        })
    } else {
        popupStyle.value.display = 'none'
        popupStyle.value.visibility = 'hidden'
    }
}

// 关闭弹窗
function closePopup() {
    isVisible.value = false
    popupStyle.value.display = 'none'
    popupStyle.value.visibility = 'hidden'
}

// 列头排序点击
function handleSort(sortKey: string) {
    if (!sortKey) return
    if (currentSort.value === sortKey) {
        sortAsc.value = !sortAsc.value
    } else {
        currentSort.value = sortKey
        sortAsc.value = false
    }
    renderArtistList(searchInput.value)
}

// 搜索输入防抖
let debounceTimer: ReturnType<typeof setTimeout> | null = null
function onSearchInput() {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
        renderArtistList(searchInput.value)
    }, 150)
}

// 点击外部关闭弹窗
let outsideClickCount = 0
let outsideClickTimer: ReturnType<typeof setTimeout> | null = null

function handleDocumentClick(e: MouseEvent) {
    if (!isVisible.value) return
    const target = e.target as HTMLElement
    // 点击弹窗内部不关闭
    if (popupRef.value && popupRef.value.contains(target)) return
    // 点击画师搜索按钮不关闭
    if (target.closest('#searchArtistBtn')) return

    outsideClickCount++
    if (outsideClickCount >= 2) {
        closePopup()
        outsideClickCount = 0
        if (outsideClickTimer) clearTimeout(outsideClickTimer)
    } else {
        if (outsideClickTimer) clearTimeout(outsideClickTimer)
        outsideClickTimer = setTimeout(() => { outsideClickCount = 0 }, 1500)
    }
}

onMounted(() => {
    document.addEventListener('click', handleDocumentClick)
})

onBeforeUnmount(() => {
    document.removeEventListener('click', handleDocumentClick)
    if (debounceTimer) clearTimeout(debounceTimer)
    if (outsideClickTimer) clearTimeout(outsideClickTimer)
})

// 暴露方法给父组件
defineExpose({
    togglePopup,
    isVisible,
})
</script>

<template>
    <div class="artist-search-popup" ref="popupRef" :style="popupStyle">
        <!-- 关闭按钮 -->
        <button class="popup-close-btn" @click="closePopup" title="关闭"
            style="position: absolute; top: 10px; right: 12px; background: none; border: none; font-size: 20px; cursor: pointer; color: var(--text-muted); line-height: 1; padding: 4px; z-index: 10;">&times;</button>
        <div class="artist-search-header">
            <!-- 搜索输入框 -->
            <div class="search-input-wrapper">
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none">
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
                <input type="text" id="artistSearchInput" class="artist-search-input" placeholder="搜索画师"
                    v-model="searchInput" @input="onSearchInput">
            </div>
        </div>

        <!-- 列表头 -->
        <div class="artist-list-header">
            <div class="artist-col no-sort" style="flex: 0 0 25%; cursor: default;">艺术家</div>
            <div class="artist-col no-sort" style="flex: 0 0 30%; cursor: default;">别名</div>
            <div class="artist-col num-col" data-sort="post" style="flex: 0 0 15%; justify-content: center;"
                @click="handleSort('post')">作品量</div>
            <div class="artist-col num-col" data-sort="usage" style="flex: 0 0 10%; justify-content: center;"
                @click="handleSort('usage')">引用量</div>
            <div class="artist-col star-col" data-sort="stars" style="flex: 0 0 20%; justify-content: center;"
                @click="handleSort('stars')">星级</div>
        </div>

        <!-- 画师列表 -->
        <div class="artist-list-body" id="artistListBody">
            <!-- 动态生成画师列表 -->
        </div>
    </div>
</template>
