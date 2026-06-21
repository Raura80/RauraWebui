<template>
    <div class="toast" :class="[type, { show: isVisible }]">{{ message }}</div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'

// 消息类型：success / error / warning / info
type ToastType = 'success' | 'error' | 'warning' | 'info'

const props = withDefaults(defineProps<{
    message: string
    type?: ToastType
}>(), {
    type: 'info'
})

// 是否可见
const isVisible = ref(false)
// 自动隐藏定时器
let hideTimer: ReturnType<typeof setTimeout> | null = null

// 显示 toast 并设置自动隐藏
function showToast() {
    if (!props.message) return
    if (hideTimer) clearTimeout(hideTimer)
    isVisible.value = true
    hideTimer = setTimeout(() => {
        isVisible.value = false
    }, 6000)
}

// 组件创建时，如果已有消息则立即显示
onMounted(() => {
    if (props.message) showToast()
})

// 监听 message 变化，有新消息时显示并自动隐藏
watch(() => props.message, (newMsg) => {
    if (newMsg) showToast()
})
</script>
