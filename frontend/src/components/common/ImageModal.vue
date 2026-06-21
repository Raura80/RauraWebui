<template>
    <div class="image-modal" :class="{ show: visible }" @click.self="emit('close')">
        <div class="modal-nav prev" @click="emit('navigate', -1)">❮</div>
        <img class="modal-image" :src="imageUrl" alt="原图查看">
        <div class="modal-nav next" @click="emit('navigate', 1)">❯</div>
    </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'

const props = defineProps<{
    visible: boolean
    imageUrl: string
}>()

const emit = defineEmits<{
    close: []
    navigate: [direction: number]
}>()

// 键盘事件处理：Escape 关闭，左右箭头导航
// 必须检查 visible，因为组件始终挂载（用 .show 类控制显隐）
function onKeydown(e: KeyboardEvent) {
    if (!props.visible) return
    if (e.key === 'Escape') {
        emit('close')
    } else if (e.key === 'ArrowLeft') {
        emit('navigate', -1)
    } else if (e.key === 'ArrowRight') {
        emit('navigate', 1)
    }
}

onMounted(() => {
    window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
    window.removeEventListener('keydown', onKeydown)
})
</script>
