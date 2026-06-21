<template>
    <!-- 原版 CSS .lora-controls 默认 display:none，模型加载后添加 .show 类才显示 -->
    <div class="lora-controls" id="loraControls" :class="{ show: isLoraVisible }">
        <label class="lora-section-title">
            <svg class="ui-icon" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2"
                fill="none">
                <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
                <polyline points="2 12 12 17 22 12"></polyline>
                <polyline points="2 17 12 22 22 17"></polyline>
            </svg>
            LoRA
        </label>
        <div id="loraListContainer" class="lora-list-container">
            <!-- 动态 LoRA 行（使用原版 custom-select 自定义下拉框） -->
            <div class="lora-row" v-for="row in modelsStore.loraRows" :key="row.id" :data-row-id="row.id"
                :style="{ zIndex: openDropdownId === row.id ? 100 : 1 }">
                <!-- 自定义下拉框（与原版 DOM 结构一致） -->
                <div class="custom-select lora-custom-select" :data-value="row.filename"
                    :data-current-trigger="row.triggerWord" :class="{ open: openDropdownId === row.id }">
                    <div class="custom-select-trigger" @click.stop="toggleDropdown(row.id)">
                        <span class="selected-text" :title="row.displayName">{{ row.displayName }}</span>
                        <span class="trigger-cost">
                            <LightningIcon class="cost-icon" :size="14" :stroke-width="2.5" />
                            {{ row.quotaCost }}
                        </span>
                        <div class="custom-arrow"></div>
                    </div>
                    <div class="custom-options">
                        <div class="custom-option" v-for="option in availableLoraOptions(row.id)" :key="option.filename"
                            :data-value="option.filename" :data-name="option.displayName"
                            :data-trigger="option.triggerWord" :class="{ selected: option.filename === row.filename }"
                            :style="{ display: isOptionUsedByOtherRow(option.filename, row.id) ? 'none' : 'flex' }"
                            @click.stop="onSelectLoraOption(row.id, option)">
                            <span class="option-name">{{ option.displayName }}</span>
                            <span class="option-cost">
                                <LightningIcon class="cost-icon" :size="12" :stroke-width="2.5" />
                                {{ option.quotaCost }}
                            </span>
                        </div>
                    </div>
                </div>
                <!-- 强度滑块（与原版 DOM 结构一致：lora-slider-input + lora-weight-display） -->
                <div class="lora-slider-container"
                    @touchstart.passive="onSliderDragStart(row.id)"
                    @touchend="onSliderDragEnd"
                    @mousedown="onSliderDragStart(row.id)">
                    <input type="range" class="lora-slider-input" min="0.1" max="1" step="0.01" :value="row.strength"
                        @input="onStrengthSliderChange(row.id, ($event.target as HTMLInputElement).value)">
                    <span class="lora-weight-display" :class="{ dragging: draggingRowId === row.id }">{{ row.strength.toFixed(2) }}</span>
                </div>
                <button class="lora-delete-btn" title="删除此 LoRA"
                    @click="onDeleteRow(row.id, row.triggerWord)">✕</button>
            </div>
        </div>
        <button class="add-lora-btn" id="addLoraBtn" title="添加 LoRA" @click="onAddRow">
            <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
        </button>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useLoraConfig } from '../../composables/useLoraConfig';
import { useModelsStore } from '../../stores/models';
import LightningIcon from '../common/LightningIcon.vue';

const modelsStore = useModelsStore();
const loraConfig = useLoraConfig();

// 当前展开的下拉框行 ID（同时只能展开一个）
const openDropdownId = ref<string | null>(null);

// 当前正在拖动滑块的行 ID（用于移动端短暂显示数值）
const draggingRowId = ref<string | null>(null);
let dragHideTimer: ReturnType<typeof setTimeout> | null = null;

// LoRA 区域是否可见：当前模型支持 LoRA 且有 supported_loras 列表时才显示
const isLoraVisible = computed(() => {
    const params = modelsStore.selectedModelParams;
    if (!params) return false;
    if (params.supports_lora === false) return false;
    const supportedLoras: string[] = params.supported_loras || [];
    return supportedLoras.length > 0;
});

// 获取某行可用的 LoRA 选项（当前模型支持的 LoRA 列表）
function availableLoraOptions(_rowId: string) {
    const loraConfigData = modelsStore.loraConfig;
    if (!loraConfigData) return [];

    const supportedLoras: string[] = modelsStore.selectedModelParams?.supported_loras || [];
    return supportedLoras.map(name => {
        const data = loraConfigData[name];
        const filename = typeof data === 'string' ? data : data.filename;
        const triggerWord = typeof data === 'string' ? '' : (data.trigger || '');
        const quotaCost = typeof data === 'string' ? 0 : (data.quota_cost ?? 0);
        return { filename, displayName: name, triggerWord, quotaCost };
    });
}

// 判断某个 LoRA 选项是否被其他行使用（用于隐藏已选选项）
function isOptionUsedByOtherRow(filename: string, currentRowId: string): boolean {
    return modelsStore.loraRows.some(row => row.id !== currentRowId && row.filename === filename);
}

// 切换下拉框
function toggleDropdown(rowId: string) {
    if (openDropdownId.value === rowId) {
        openDropdownId.value = null;
    } else {
        openDropdownId.value = rowId;
    }
}

// 选择 LoRA 选项
function onSelectLoraOption(rowId: string, option: { filename: string; displayName: string; triggerWord: string; quotaCost: number }) {
    const result = loraConfig.updateLoraSelection(rowId, option.filename, option.displayName, option.triggerWord, option.quotaCost);
    if (result) {
        emit('updateTrigger', result.oldTrigger, result.newTrigger);
    }
    openDropdownId.value = null;
}

// 添加 LoRA 行
function onAddRow() {
    const triggerWord = loraConfig.addLoraRow();
    if (triggerWord) {
        emit('addTrigger', triggerWord);
    }
}

// 删除 LoRA 行
function onDeleteRow(rowId: string, triggerWord: string) {
    if (triggerWord) {
        emit('removeTrigger', triggerWord);
    }
    loraConfig.removeLoraRow(rowId);
}

// 强度滑块变更
function onStrengthSliderChange(rowId: string, value: string) {
    loraConfig.updateLoraStrength(rowId, parseFloat(value));
}

// 滑块拖动开始（触摸 / 鼠标）
function onSliderDragStart(rowId: string) {
    if (dragHideTimer) { clearTimeout(dragHideTimer); dragHideTimer = null; }
    draggingRowId.value = rowId;
}

// 滑块拖动结束（触摸）
function onSliderDragEnd() {
    if (dragHideTimer) clearTimeout(dragHideTimer);
    dragHideTimer = setTimeout(() => { draggingRowId.value = null; }, 700);
}

// 点击外部关闭下拉框
function handleDocumentClick() {
    openDropdownId.value = null;
}

// 全局鼠标松开时隐藏拖动数值（处理鼠标拖出滑块后松开的情况）
function handleMouseUp() {
    if (draggingRowId.value !== null) {
        onSliderDragEnd();
    }
}

onMounted(() => {
    document.addEventListener('click', handleDocumentClick);
    document.addEventListener('mouseup', handleMouseUp);
});

onBeforeUnmount(() => {
    document.removeEventListener('click', handleDocumentClick);
    document.removeEventListener('mouseup', handleMouseUp);
    if (dragHideTimer) clearTimeout(dragHideTimer);
});

// 事件
const emit = defineEmits<{
    addTrigger: [triggerWord: string];
    removeTrigger: [triggerWord: string];
    updateTrigger: [oldTrigger: string, newTrigger: string];
}>();

// 暴露给父组件
defineExpose({
    loraConfig,
});
</script>
