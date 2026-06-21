<script setup lang="ts">
/**
 * 实时预览组件
 * 生成完成后，后续二进制帧显示为可拖拽的浮动预览窗口
 * 状态从 generationStore 获取（由 useWebSocket.handleBinaryPreview 设置）
 */
import { ref, reactive, onMounted, onUnmounted, watch } from 'vue'
import { useGenerationStore } from '../../stores/generation'

const generationStore = useGenerationStore()

// 容器 DOM 引用
const containerRef = ref<HTMLElement | null>(null)

// 拖拽位置状态（通过 :style 绑定，避免 Vue 响应式更新覆盖 inline style）
const dragStyle = reactive({
    left: '' as string,
    top: '' as string,
    right: '' as string,
    transform: '' as string,
})

// 组件挂载后使容器可拖拽，并设置初始位置
onMounted(() => {
    if (containerRef.value) {
        makeElementDraggable(containerRef.value)
    }
})

// 当浮动预览首次显示时，从 store 读取初始位置
watch(() => generationStore.isLivePreviewVisible, (visible) => {
    if (visible) {
        // 重置拖拽位置为 store 中的初始位置
        dragStyle.left = generationStore.livePreviewLeft || ''
        dragStyle.top = generationStore.livePreviewTop || ''
        dragStyle.right = generationStore.livePreviewLeft ? 'auto' : ''
        dragStyle.transform = 'none'
    }
})

// 保存拖拽过程中 document 级事件处理器的引用，用于卸载时清理
let activeMouseUpHandler: (() => void) | null = null
let activeMouseMoveHandler: ((e: MouseEvent | TouchEvent) => void) | null = null
let activeTouchEndHandler: (() => void) | null = null
let activeTouchMoveHandler: ((e: MouseEvent | TouchEvent) => void) | null = null

// 使元素可拖拽（支持鼠标和触摸，全局范围）
// 使用 addEventListener 代替 onmousedown 赋值，确保可清理
function makeElementDraggable(el: HTMLElement): void {
    let offsetX = 0, offsetY = 0;

    // 保存事件处理器引用，用于卸载时清理
    const mouseDownHandler = dragMouseDown;
    const touchStartHandler = dragMouseDown;

    el.addEventListener('mousedown', mouseDownHandler);
    el.addEventListener('touchstart', touchStartHandler);

    function dragMouseDown(e: MouseEvent | TouchEvent) {
        e.preventDefault();
        const clientX = e.type === 'touchstart'
            ? (e as TouchEvent).touches[0].clientX
            : (e as MouseEvent).clientX;
        const clientY = e.type === 'touchstart'
            ? (e as TouchEvent).touches[0].clientY
            : (e as MouseEvent).clientY;

        const rect = el.getBoundingClientRect();
        offsetX = clientX - rect.left;
        offsetY = clientY - rect.top;

        dragStyle.left = rect.left + 'px';
        dragStyle.top = rect.top + 'px';
        dragStyle.right = 'auto';
        dragStyle.transform = 'none';

        document.addEventListener('mouseup', closeDragElement);
        document.addEventListener('touchend', closeDragElement);
        document.addEventListener('mousemove', elementDrag);
        document.addEventListener('touchmove', elementDrag);

        // 保存引用，供 onUnmounted 清理
        activeMouseUpHandler = closeDragElement
        activeMouseMoveHandler = elementDrag
        activeTouchEndHandler = closeDragElement
        activeTouchMoveHandler = elementDrag
    }

    function elementDrag(e: MouseEvent | TouchEvent) {
        const clientX = e.type === 'touchmove'
            ? (e as TouchEvent).touches[0].clientX
            : (e as MouseEvent).clientX;
        const clientY = e.type === 'touchmove'
            ? (e as TouchEvent).touches[0].clientY
            : (e as MouseEvent).clientY;

        let newLeft = clientX - offsetX;
        let newTop = clientY - offsetY;

        const margin = 20;
        if (newTop < margin) newTop = margin;
        if (newLeft < margin) newLeft = margin;
        if (newTop > window.innerHeight - el.offsetHeight - margin) {
            newTop = window.innerHeight - el.offsetHeight - margin;
        }
        if (newLeft > window.innerWidth - el.offsetWidth - margin) {
            newLeft = window.innerWidth - el.offsetWidth - margin;
        }

        dragStyle.left = newLeft + 'px';
        dragStyle.top = newTop + 'px';
    }

    function closeDragElement() {
        document.removeEventListener('mouseup', closeDragElement);
        document.removeEventListener('mousemove', elementDrag);
        document.removeEventListener('touchend', closeDragElement);
        document.removeEventListener('touchmove', elementDrag);
        // 拖拽结束，清除引用
        activeMouseUpHandler = null
        activeMouseMoveHandler = null
        activeTouchEndHandler = null
        activeTouchMoveHandler = null
    }
}

// 组件卸载时清理可能残留的 document 级事件监听器
onUnmounted(() => {
    if (activeMouseUpHandler) document.removeEventListener('mouseup', activeMouseUpHandler)
    if (activeMouseMoveHandler) document.removeEventListener('mousemove', activeMouseMoveHandler)
    if (activeTouchEndHandler) document.removeEventListener('touchend', activeTouchEndHandler)
    if (activeTouchMoveHandler) document.removeEventListener('touchmove', activeTouchMoveHandler)
})
</script>

<template>
    <!-- 原版 CSS: .live-preview-container 默认 display:none; opacity:0;
         .live-preview-container.show 设置 display:block; opacity:1;
         必须用 .show 类控制显隐，不能用 inline display 样式 -->
    <div class="live-preview-container" ref="containerRef" :class="{ show: generationStore.isLivePreviewVisible }"
        :style="{
            width: generationStore.livePreviewWidth + 'px',
            height: generationStore.livePreviewHeight + 'px',
            left: dragStyle.left || undefined,
            top: dragStyle.top || undefined,
            right: dragStyle.right || undefined,
            transform: dragStyle.transform || undefined,
        }">
        <img :src="generationStore.livePreviewUrl || ''" alt="实时预览">
    </div>
</template>
