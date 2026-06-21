<template>
    <div class="slider-group">
        <label>
            <svg class="ui-icon" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2"
                fill="none">
                <rect x="3" y="5" width="18" height="14" rx="2" ry="2"></rect>
                <path d="M3 12h18"></path>
                <path d="M12 5v14"></path>
            </svg>
            图片比例
        </label>
        <div class="size-controls">
            <div class="slider-container">
                <span class="slider-label"></span>
                <input type="range" id="ratioSlider" class="slider" min="0" max="200" :value="sliderValue" step="1"
                    @input="onSliderInput" @mousedown="onSliderDragStart" @mouseup="onSliderDragEnd"
                    @touchstart="onSliderDragStart" @touchend="onSliderDragEnd">
                <span class="slider-label"></span>
            </div>
            <div class="ratio-preview-container" :class="{ 'preview-collapsed': !isPreviewExpanded }">
                <div class="ratio-preview-label"></div>
                <div class="ratio-preview-box" id="ratioPreviewBox" ref="previewBoxRef" :style="previewBoxStyle"></div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useRatioSlider } from '../../composables/useRatioSlider';

const ratioSlider = useRatioSlider();
const sliderValue = ref(51); // 默认值与原始 HTML 一致

// 移动端：拖动时展开预览，松开时收起
const isPreviewExpanded = ref(true);
let previewCollapseTimer: ReturnType<typeof setTimeout> | null = null;

function onSliderDragStart() {
    if (previewCollapseTimer) {
        clearTimeout(previewCollapseTimer);
        previewCollapseTimer = null;
    }
    isPreviewExpanded.value = true;
}

function onSliderDragEnd() {
    // 松开后延迟收起，给用户看到最终效果
    previewCollapseTimer = setTimeout(() => {
        isPreviewExpanded.value = false;
    }, 500);
}

// 预览框样式
const previewBoxStyle = computed(() => {
    const width = ratioSlider.currentWidth.value;
    const height = ratioSlider.currentHeight.value;
    const maxSize = 240;
    const targetArea = 150 * 150;
    const currentArea = width * height;
    const scaleFactor = Math.sqrt(targetArea / currentArea);
    let previewWidth = width * scaleFactor;
    let previewHeight = height * scaleFactor;
    if (previewWidth > maxSize) {
        const reduce = maxSize / previewWidth;
        previewWidth *= reduce;
        previewHeight *= reduce;
    }
    if (previewHeight > maxSize) {
        const reduce = maxSize / previewHeight;
        previewWidth *= reduce;
        previewHeight *= reduce;
    }
    return {
        width: Math.round(previewWidth) + 'px',
        height: Math.round(previewHeight) + 'px',
    };
});

// 滑块输入事件
function onSliderInput(e: Event) {
    const input = e.target as HTMLInputElement;
    sliderValue.value = parseInt(input.value);
    ratioSlider.updateState(sliderValue.value);
}

onMounted(() => {
    // 初始化滑块状态
    ratioSlider.initRatioSlider(sliderValue.value);

    // 移动端默认收起预览
    if (window.innerWidth <= 768) {
        isPreviewExpanded.value = false;
    }
});

onBeforeUnmount(() => {
    if (previewCollapseTimer) {
        clearTimeout(previewCollapseTimer);
    }
});

// 暴露给父组件
defineExpose({
    sliderValue,
    ratioSlider,
});
</script>
