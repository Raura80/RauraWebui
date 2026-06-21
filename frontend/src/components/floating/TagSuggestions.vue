<template>
    <div id="tagSuggestions" class="tag-suggestions"
        :style="{ ...positionStyle, display: visible ? 'block' : 'none', position: 'fixed' }">
        <div v-for="(item, index) in suggestions" :key="item.tag" class="tag-suggestion-item"
            :class="{ active: index === activeIndex }" @click="emit('select', item)"
            @mouseenter="emit('navigate', index)">
            <span class="tag-english">{{ item.tag }}</span>
            <span class="tag-chinese">{{ item['right tag cn'] }}</span>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { TagItem } from '../../types'

const props = withDefaults(defineProps<{
    suggestions: TagItem[]
    visible: boolean
    position: { top: number; left: number }
    activeIndex?: number
}>(), {
    activeIndex: -1
})

const emit = defineEmits<{
    select: [tag: TagItem]
    navigate: [index: number]
}>()

// 将位置对象转为 CSS 样式（桌面端固定宽度 340px，与原版一致）
const positionStyle = computed(() => {
    const isMobile = window.innerWidth <= 1010;
    return {
        top: `${props.position.top}px`,
        left: `${props.position.left}px`,
        width: isMobile ? '' : '340px',
    }
})
</script>
