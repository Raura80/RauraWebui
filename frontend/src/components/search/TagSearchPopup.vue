<script setup lang="ts">
/**
 * 标签高级搜索弹窗组件
 * 包含搜索输入、分类/层级筛选、智能分割、高级筛选面板、搜索结果列表
 */
import { ref, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useTagSearchPopup } from '../../composables/useTagSearchPopup'

const {
    activeKeyword,
    fetchTagsData,
} = useTagSearchPopup()

// 弹窗可见性
const isVisible = ref(false)

// 搜索输入
const searchInput = ref('')

// 分类筛选
const categories = ref([
    { value: 'General', label: '通用', checked: true, cssClass: 'cat-general' },
    { value: 'Character', label: '角色', checked: true, cssClass: 'cat-character' },
    { value: 'Copyright', label: '作品', checked: true, cssClass: 'cat-copyright' },
])

// 层级筛选
const layers = ref([
    { value: '英文', label: '标签', checked: true },
    { value: '中文扩展词', label: '含义', checked: true },
    { value: '释义', label: '解释', checked: true },
    { value: '中文核心词', label: '综合', checked: true },
])

// 智能分割开关
const smartTokenize = ref(true)

// 高级筛选面板
const isAdvPanelVisible = ref(false)

// 高级筛选参数
const advTopK = ref(20)
const advLimit = ref(50)
const advPopWeight = ref(0.15)

// 分词结果关键词（由 composable 通过 DOM 直接操作 #tsTokenizeResult，不再用 Vue 响应式）
// const tokenizeKeywords = ref<string[]>([])

// 结果摘要（由 composable 通过 DOM 直接操作 #tsResultSummary）
// const resultSummary = ref('')

// 弹窗位置（原版通过 JS 动态计算，基于按钮位置）
const popupStyle = ref<Record<string, string>>({
    position: 'fixed',
    width: '720px',
    zIndex: '1002',
    display: 'none',
    visibility: 'hidden',
})

// 弹窗根元素引用
const popupRef = ref<HTMLElement | null>(null)

// 切换弹窗显示（原版逻辑：基于按钮位置计算弹窗位置）
function togglePopup() {
    isVisible.value = !isVisible.value
    if (isVisible.value) {
        // 先设为隐藏但 display:flex 以获取宽度
        popupStyle.value.display = 'flex'
        popupStyle.value.visibility = 'hidden'

        nextTick(() => {
            // 获取按钮位置来计算弹窗位置
            const searchBtn = document.getElementById('tagSearchBtn')
            if (searchBtn) {
                const btnRect = searchBtn.getBoundingClientRect()
                const popupWidth = popupRef.value?.offsetWidth || 680
                const isMobile = window.innerWidth <= 768

                if (isMobile) {
                    // 移动端：弹窗从底部弹出，占屏幕下方 60%
                    popupStyle.value.top = (window.innerHeight * 0.4) + 'px'
                    popupStyle.value.left = '10px'
                } else {
                    // 桌面端：弹窗在按钮右侧
                    let leftPos = btnRect.right + 10
                    let topPos = btnRect.top
                    const maxLeft = window.innerWidth - popupWidth - 10
                    if (leftPos > maxLeft) leftPos = maxLeft
                    if (leftPos < 10) leftPos = 10
                    // fixed 定位不需要加 scrollTop
                    // 确保弹窗不超出视口底部
                    const maxTop = window.innerHeight - 100
                    if (topPos > maxTop) topPos = Math.max(10, maxTop)
                    popupStyle.value.top = topPos + 'px'
                    popupStyle.value.left = leftPos + 'px'
                }
            }
            popupStyle.value.visibility = 'visible'

            // 聚焦搜索输入框
            const inputEl = document.getElementById('tagSearchInput')
            inputEl?.focus()
        })
    } else {
        popupStyle.value.display = 'none'
        popupStyle.value.visibility = 'hidden'
        // 同时关闭关联词弹窗
        const relatedPopup = document.getElementById('relatedTagsPopup')
        if (relatedPopup) relatedPopup.style.display = 'none'
    }
}

// 关闭弹窗（原版逻辑：同时关闭关联词弹窗，两者同生共死）
function closePopup() {
    isVisible.value = false
    popupStyle.value.display = 'none'
    popupStyle.value.visibility = 'hidden'
    // 同时关闭关联词弹窗
    const relatedPopup = document.getElementById('relatedTagsPopup')
    if (relatedPopup) relatedPopup.style.display = 'none'
}

// 切换高级筛选面板
function toggleAdvPanel() {
    isAdvPanelVisible.value = !isAdvPanelVisible.value
}

// 执行搜索
function doSearch(updateKeywords: boolean = true) {
    // 使用 composable 的 fetchTagsData 方法
    // 这里简化为直接调用
    fetchTagsData(updateKeywords)
}

// 分类变化
function onCategoryChange() {
    doSearch(activeKeyword.value === null)
}

// 层级变化
function onLayerChange() {
    doSearch(activeKeyword.value === null)
}

// 智能分割变化
function onSmartTokenizeChange() {
    activeKeyword.value = null
    doSearch(true)
}

// 高级参数变化
function onAdvParamChange() {
    doSearch(activeKeyword.value === null)
}

// 点击分词关键词（由 composable 通过 DOM 直接操作，不再用 Vue 事件）

// 搜索输入处理（防抖由 composable 内部处理）
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let isComposing = false

function onSearchInput() {
    if (isComposing) return
    activeKeyword.value = null
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => doSearch(true), 300)
}

function onCompositionStart() {
    isComposing = true
}

function onCompositionEnd() {
    isComposing = false
    activeKeyword.value = null
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => doSearch(true), 300)
}

// 点击外部关闭弹窗（原版为双击外部关闭）
let outsideClickCount = 0
let outsideClickTimer: ReturnType<typeof setTimeout> | null = null

function handleDocumentClick(e: MouseEvent) {
    if (!isVisible.value) return
    const target = e.target as HTMLElement
    // 点击弹窗内部不关闭
    if (popupRef.value && popupRef.value.contains(target)) return
    // 点击标签搜索按钮不关闭（由 togglePopup 处理）
    if (target.closest('#tagSearchBtn')) return
    // 点击关联标签弹窗不关闭（原版逻辑：relatedPopup 排除在外部点击判断之外）
    if (target.closest('#relatedTagsPopup')) return

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
    <div class="artist-search-popup" id="tagSearchPopup" ref="popupRef" :style="popupStyle">
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
                <input type="text" id="tagSearchInput" class="artist-search-input" placeholder="输入关键词搜索"
                    v-model="searchInput" @input="onSearchInput" @compositionstart="onCompositionStart"
                    @compositionend="onCompositionEnd">
            </div>

            <!-- 分类与层级筛选 -->
            <div
                style="display: flex; justify-content: space-between; align-items: center; margin-top: 15px; flex-wrap: wrap; gap: 10px;">
                <div
                    style="display: flex; gap: 20px; font-size: 13px; color: var(--text-secondary); align-items: center; flex-wrap: wrap;">
                    <!-- 类型筛选 -->
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <b>类型:</b>
                        <label v-for="cat in categories" :key="cat.value" class="ts-cat-label" :class="cat.cssClass">
                            <input type="checkbox" class="ts-cat" :value="cat.value" v-model="cat.checked"
                                @change="onCategoryChange">
                            {{ cat.label }}
                        </label>
                    </div>
                    <!-- 层级筛选 -->
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <b>层级:</b>
                        <label v-for="layer in layers" :key="layer.value" class="ts-layer-label">
                            <input type="checkbox" class="ts-layer" :value="layer.value" v-model="layer.checked"
                                @change="onLayerChange">
                            {{ layer.label }}
                        </label>
                    </div>
                    <!-- 智能分割 -->
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <b>智能分割:</b>
                        <label class="switch-toggle" style="margin: 0; flex-shrink: 0;">
                            <input type="checkbox" id="tsSmartTokenize" v-model="smartTokenize"
                                @change="onSmartTokenizeChange">
                            <span class="switch-slider"></span>
                        </label>
                    </div>
                </div>
                <button class="advanced-settings-btn" style="margin: 0;" @click="toggleAdvPanel">高级筛选</button>
            </div>

            <!-- 分词结果区域（由 composable 通过 DOM 直接操作） -->
            <div id="tsTokenizeResult"
                style="display: none; margin-top: 12px; gap: 8px; flex-wrap: wrap; align-items: center; font-size: 13px;">
            </div>

            <!-- 高级筛选面板 -->
            <div v-show="isAdvPanelVisible"
                style="margin-top: 15px; padding-top: 15px; border-top: 1px dashed rgba(0,0,0,0.1);">
                <div class="adv-row">
                    <span class="adv-row-label">搜索范围</span>
                    <div class="adv-row-control slider-row">
                        <input type="range" id="tsTopK" class="adv-slider" min="1" max="50" step="1"
                            v-model.number="advTopK" @change="onAdvParamChange">
                        <span id="tsTopKVal" class="adv-value-display">{{ advTopK }}</span>
                    </div>
                </div>
                <div class="adv-row">
                    <span class="adv-row-label">结果上限</span>
                    <div class="adv-row-control slider-row">
                        <input type="range" id="tsLimit" class="adv-slider" min="10" max="100" step="1"
                            v-model.number="advLimit" @change="onAdvParamChange">
                        <span id="tsLimitVal" class="adv-value-display">{{ advLimit }}</span>
                    </div>
                </div>
                <div class="adv-row">
                    <span class="adv-row-label">热度权重</span>
                    <div class="adv-row-control slider-row">
                        <input type="range" id="tsPopWeight" class="adv-slider" min="0.01" max="1" step="0.01"
                            v-model.number="advPopWeight" @change="onAdvParamChange">
                        <span id="tsPopWeightVal" class="adv-value-display">{{ advPopWeight }}</span>
                    </div>
                </div>
            </div>
        </div>

        <!-- 列表头 -->
        <div class="artist-list-header">
            <div class="artist-col" style="flex: 0 0 30%; cursor: default;">标签</div>
            <div class="artist-col" style="flex: 0 0 40%; cursor: default;">含义</div>
            <div class="artist-col num-col" style="flex: 0 0 15%; justify-content: center; cursor: default;">命中</div>
            <div class="artist-col num-col" style="flex: 0 0 15%; justify-content: center; cursor: default;">热度</div>
        </div>

        <!-- 搜索结果列表 -->
        <div class="artist-list-body" id="tagListBody">
            <div style="padding: 30px; text-align: center; color: var(--text-muted);">输入关键词或直接勾选上方选项开始检索...</div>
        </div>

        <!-- 结果摘要 -->
        <div
            style="padding: 12px 15px; background: rgba(0,0,0,0.02); border-top: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center;">
            <span id="tsResultSummary" style="font-size: 12px; color: var(--text-muted);"></span>
        </div>
    </div>
</template>
