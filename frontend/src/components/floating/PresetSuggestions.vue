<template>
    <div id="presetSuggestions" class="tag-suggestions"
        :style="{ ...positionStyle, display: visible ? 'flex' : 'none', position: 'fixed' }">
        <!-- 搜索框-->
        <div class="preset-search-box" @click.stop>
            <input type="text" class="preset-search-input" placeholder="搜索预设提示词" v-model="query" @click.stop>
        </div>
        <!-- 预设列表 -->
        <div class="preset-list-container">
            <div v-if="filteredPresets.length === 0"
                style="padding:15px; text-align:center; color:var(--text-muted); font-size:13px;">暂无预设数据</div>
            <div v-for="preset in filteredPresets" :key="preset.uuid" class="tag-suggestion-item preset-suggestion-item"
                @click="emit('select', preset)" @mouseenter="(e) => handlePresetHover(preset, e)"
                @mouseleave="handlePresetLeave">
                <span class="preset-name tag-english">{{ preset.name }}</span>
                <span class="tag-chinese" style="font-size: 12px; color: var(--text-muted);">{{ preset.prompt?.substring(0, 60) }}{{
                    preset.prompt?.length > 60 ? '...' : '' }}</span>
            </div>
        </div>
    </div>

    <!-- 预设悬浮预览图框 -->
    <div class="preset-preview-box" :class="{ show: previewVisible }"
        :style="{ top: previewPosition.top + 'px', left: previewPosition.left + 'px' }">
        <img :src="previewImageUrl" alt="预览">
    </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, inject } from 'vue'
import type { PresetItem } from '../../types'
import type { usePresets } from '../../composables/usePresets'

const props = defineProps<{
    presets: PresetItem[]
    visible: boolean
    position: { top: number; left: number }
    searchQuery?: string
}>()

const emit = defineEmits<{
    select: [preset: PresetItem]
}>()

// 通过 inject 获取预设系统
type PresetsReturn = ReturnType<typeof usePresets>;
const presets = inject<PresetsReturn>('presets')!;

// 搜索关键词
const query = ref('')

// 根据搜索词过滤预设列表
const filteredPresets = computed(() => {
    if (!query.value) return props.presets
    const keywords = query.value.trim().toLowerCase().split(/\s+/).filter(k => k)
    if (keywords.length === 0) return props.presets
    return props.presets.filter(p => {
        const lowerName = p.name.toLowerCase()
        const lowerContent = (p.prompt || '').toLowerCase()
        return keywords.some(kw => lowerName.includes(kw) || lowerContent.includes(kw))
    })
})

// 将位置对象转为 CSS 样式
const positionStyle = computed(() => ({
    top: `${props.position.top}px`,
    left: `${props.position.left}px`,
}))

// 外部搜索词变化时同步
watch(() => props.searchQuery, (val) => {
    query.value = val ?? ''
})

// 预设悬停预览状态
const previewVisible = ref(false)
const previewImageUrl = ref('')
const previewPosition = ref({ top: 0, left: 0 })

// 鼠标悬停预设项：获取预览图并显示
async function handlePresetHover(preset: PresetItem, _event: MouseEvent) {
    // 计算预览框位置（在预设列表右侧，空间不够则在左侧）
    const suggestionBox = document.getElementById('presetSuggestions')
    if (suggestionBox) {
        const boxRect = suggestionBox.getBoundingClientRect()
        const windowWidth = window.innerWidth
        let leftPos = boxRect.right + 12
        let topPos = boxRect.top
        if (leftPos + 320 > windowWidth) leftPos = boxRect.left - 332
        previewPosition.value = { top: topPos, left: leftPos }
    }

    // 获取预览图（优先 IndexedDB 缓存，回退到 API）
    if (preset.uuid) {
        previewImageUrl.value = ''
        try {
            const base64 = await presets.getPresetImage(preset.uuid)
            if (base64) {
                previewImageUrl.value = `data:image/webp;base64,${base64}`
                previewVisible.value = true
            }
        } catch (e) {
            console.warn('获取预设预览图失败', e)
        }
    }
}

// 鼠标离开预设项：隐藏预览框
function handlePresetLeave() {
    previewVisible.value = false
    previewImageUrl.value = ''
}
</script>
