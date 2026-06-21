<script setup lang="ts">
/**
 * 结果展示区域组件
 * 包含图片显示、占位符、行内导航、实时预览、保存预设、图生图侧边栏
 */
import { ref, computed, onMounted, onBeforeUnmount, inject, nextTick } from 'vue'
import { useGenerationStore } from '../../stores/generation'
import type { useHistory } from '../../composables/useHistory'
import { useDragAndDrop } from '../../composables/useDragAndDrop'
import type { usePresets } from '../../composables/usePresets'
import type { useGeneration } from '../../composables/useGeneration'
import InlineNavContainer from './InlineNavContainer.vue'

const generationStore = useGenerationStore()
// 通过 inject 获取 App.vue 提供的共享实例
type HistoryReturn = ReturnType<typeof useHistory>;
type PresetsReturn = ReturnType<typeof usePresets>;
type GenerationReturn = ReturnType<typeof useGeneration>;
const history = inject<HistoryReturn>('history')!;
const presets = inject<PresetsReturn>('presets')!;
const generation = inject<GenerationReturn>('generation')!;

// 从共享实例解构需要的方法
const {
    navigateInlineHistory,
    updateInlineNavigation,
    showImageModal,
} = history;

const { initDragAndDrop, clearInputImage } = useDragAndDrop()
const { savePreset, compressImageToBase64 } = presets

// 结果区域 DOM 引用
const resultAreaRef = ref<HTMLElement | null>(null)

// 当前图片 URL
const currentImageUrl = computed(() => generationStore.currentImageUrl)

// 是否有图片
const hasImage = computed(() => !!currentImageUrl.value)

// 占位符是否显示
const showPlaceholder = computed(() => !hasImage.value)

// 图片是否显示
const showResultImage = computed(() => hasImage.value)

// 行内导航状态
const inlineNav = computed(() => updateInlineNavigation())

// 图生图侧边栏是否可见
const isImg2ImgSidebarVisible = computed(() => generationStore.isImg2ImgMode)

// 删除按钮是否可见
const showImgDeleteBtn = computed(() => generationStore.isImg2ImgMode)

// 反推标签开关（与 store 双向绑定，确保生成时读取正确的值）
const taggerEnabled = computed({
    get: () => generationStore.taggerEnabled,
    set: (val: boolean) => { generationStore.taggerEnabled = val }
})

// 固定姿势开关（与 store 双向绑定）
const poseEnabled = computed({
    get: () => generationStore.poseEnabled,
    set: (val: boolean) => { generationStore.poseEnabled = val }
})

// 保存预设弹窗
const isSavePresetPopupVisible = ref(false)
const newPresetName = ref('')

// 保存预设按钮的显隐（原版逻辑：鼠标移入结果区域500ms后显示，移出时隐藏）
const isSavePresetBtnVisible = ref(false)
let hoverTimer: ReturnType<typeof setTimeout> | null = null

function handleResultAreaMouseEnter() {
    if (!hasImage.value) return
    if (hoverTimer) clearTimeout(hoverTimer)
    hoverTimer = setTimeout(() => {
        isSavePresetBtnVisible.value = true
    }, 500)
}

function handleResultAreaMouseLeave() {
    if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null }
    isSavePresetBtnVisible.value = false
}

// 行内导航事件
function handlePrev() {
    navigateInlineHistory(-1)
}

function handleNext() {
    navigateInlineHistory(1)
}

// 点击图片打开全屏查看
function handleImageClick() {
    if (currentImageUrl.value) {
        showImageModal(currentImageUrl.value)
    }
}

// 清除图生图
function handleClearInputImage() {
    clearInputImage()
}

// 切换保存预设弹窗（原版逻辑：验证提示词和图片）
function toggleSavePresetPopup() {
    // 原版验证：提示词不能为空
    const promptText = (document.getElementById('positivePrompt') as HTMLTextAreaElement)?.value?.trim() || ''
    if (!promptText) {
        generation.showToast('内容为空，无法添加', 'error')
        return
    }
    // 原版验证：必须有生成的图片
    if (!hasImage.value || !currentImageUrl.value) {
        generation.showToast('当前没有生成的图片', 'error')
        return
    }
    isSavePresetPopupVisible.value = !isSavePresetPopupVisible.value
    if (isSavePresetPopupVisible.value) {
        newPresetName.value = ''
        // 原版逻辑：弹窗显示后延迟 100ms 聚焦输入框
        nextTick(() => {
            setTimeout(() => {
                const input = document.getElementById('newPresetNameInput') as HTMLInputElement | null
                input?.focus()
            }, 100)
        })
    }
}

// 确认保存预设（原版逻辑：保存后显示成功/失败通知）
async function handleConfirmSavePreset() {
    const name = newPresetName.value.trim()
    if (!name) return

    try {
        // 获取当前图片的 base64
        let imageBase64: string | undefined
        if (currentImageUrl.value) {
            const response = await fetch(currentImageUrl.value)
            const blob = await response.blob()
            imageBase64 = await compressImageToBase64(blob)
        }

        // 收集当前参数
        const params = generationStore.tempCurrentGenerationParams || {}

        const result = await savePreset(name, params.original_prompt || params.prompt || '', params, imageBase64)
        isSavePresetPopupVisible.value = false

        // 原版逻辑：保存成功后显示通知
        if (result) {
            const actionText = result.action === 'updated' ? '更新' : '保存'
            generation.showToast(`${actionText}预设成功：${name}`, 'success')
        } else {
            generation.showToast('保存预设失败', 'error')
        }
    } catch (e: any) {
        generation.showToast(e.message || '保存预设失败', 'error')
    }
}

// 初始化拖放
let dragCleanup: (() => void) | null = null

onMounted(() => {
    if (resultAreaRef.value) {
        dragCleanup = initDragAndDrop(resultAreaRef.value)
    }
    // 点击外部关闭保存预设弹窗
    document.addEventListener('click', handleDocumentClickForPresetPopup)
})

onBeforeUnmount(() => {
    if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null }
    if (dragCleanup) {
        dragCleanup()
        dragCleanup = null
    }
    document.removeEventListener('click', handleDocumentClickForPresetPopup)
})

// 点击外部关闭保存预设弹窗
function handleDocumentClickForPresetPopup(e: MouseEvent) {
    if (!isSavePresetPopupVisible.value) return
    const target = e.target as HTMLElement
    if (!target.closest('.save-preset-popup') && !target.closest('.download-btn')) {
        isSavePresetPopupVisible.value = false
    }
}
</script>

<template>
    <div class="result-area" ref="resultAreaRef" :class="{ 'has-image': hasImage }"
        @mouseenter="handleResultAreaMouseEnter" @mouseleave="handleResultAreaMouseLeave">
        <!-- 取消图生图按钮 -->
        <div class="img-delete-btn" v-show="showImgDeleteBtn" title="取消图生图" @click="handleClearInputImage">✕</div>

        <!-- 图生图侧边栏（原版 CSS 用 visibility:hidden + .show 类控制显隐） -->
        <div class="img2img-sidebar" :class="{ show: isImg2ImgSidebarVisible }">
            <div class="sidebar-switch">
                <span>反推标签</span>
                <label class="switch-toggle">
                    <input type="checkbox" v-model="taggerEnabled">
                    <span class="switch-slider"></span>
                </label>
            </div>
            <div class="sidebar-switch">
                <span>固定姿势</span>
                <label class="switch-toggle">
                    <input type="checkbox" v-model="poseEnabled">
                    <span class="switch-slider"></span>
                </label>
            </div>
            <div class="source-thumb-container">
                <span class="source-thumb-label"></span>
                <img src="" alt="原图" class="source-thumb-img">
            </div>
        </div>

        <!-- 占位符 -->
        <div class="result-placeholder" v-show="showPlaceholder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <circle cx="8.5" cy="8.5" r="1.5"></circle>
                <polyline points="21 15 16 10 5 21"></polyline>
            </svg>
        </div>

        <!-- 结果图片 -->
        <img class="result-image" v-show="showResultImage" :src="currentImageUrl || ''" alt="生成的图片"
            @click="handleImageClick">

        <!-- 行内导航 -->
        <InlineNavContainer :visible="inlineNav.visible" :can-prev="inlineNav.canPrev" :can-next="inlineNav.canNext"
            @prev="handlePrev" @next="handleNext" />

        <!-- 保存为预设按钮（原版 CSS 用 opacity:0 + .show 类控制显隐，鼠标悬停500ms后显示） -->
        <button class="download-btn" :class="{ show: isSavePresetBtnVisible }" title="保存当前提示词和此图作为预设"
            @click="toggleSavePresetPopup">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                <polyline points="17 21 17 13 7 13 7 21"></polyline>
                <polyline points="7 3 7 8 15 8"></polyline>
            </svg>
            保存为预设
        </button>

        <!-- 保存预设弹窗（原版 CSS 用 visibility:hidden + .show 类控制显隐） -->
        <div class="save-preset-popup" :class="{ show: isSavePresetPopupVisible }">
            <div class="popup-arrow"></div>
            <div class="popup-content">
                <input type="text" id="newPresetNameInput" placeholder="取一个专属的预设名吧" maxlength="20"
                    v-model="newPresetName" @keyup.enter="handleConfirmSavePreset">
                <button @click="handleConfirmSavePreset">确定</button>
            </div>
        </div>
    </div>
</template>
