<template>
    <div class="form-group">
        <div class="style-select-wrapper">
            <label>
                <svg class="ui-icon" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2"
                    fill="none">
                    <path
                        d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z">
                    </path>
                    <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                    <line x1="12" y1="22.08" x2="12" y2="12"></line>
                </svg>
                模型
            </label>
            <div class="custom-select" id="customModelSelect" ref="selectRef" :class="{ open: isOpen }">
                <div class="custom-select-trigger" @click="toggleDropdown">
                    <span class="selected-text">{{ displayText }}</span>
                    <span v-if="!modelSelect.isLoading.value && !modelSelect.loadError.value" class="trigger-cost">
                        <LightningIcon class="cost-icon" :size="14" :stroke-width="2.5" />
                        {{ modelsStore.selectedModelQuotaCost }}
                    </span>
                    <div class="custom-arrow"></div>
                </div>
                <div class="custom-options" v-show="isOpen">
                    <template v-for="(group, groupKey) in groupedOptions" :key="groupKey">
                        <div class="custom-option-group-label" v-if="group.label">{{ group.label }}</div>
                        <div class="custom-option" v-for="option in group.items" :key="option.displayName"
                            :class="{ selected: option.displayName === modelsStore.selectedModelDisplayName }"
                            :data-value="option.filename" :title="option.displayName" @click="onSelectOption(option)">
                            <span class="option-name">{{ option.displayName }}</span>
                            <span class="option-cost">
                                <LightningIcon class="cost-icon" :size="12" :stroke-width="2.5" />
                                {{ option.quotaCost }}
                            </span>
                        </div>
                    </template>
                </div>
                <input type="hidden" id="modelSelectValue" :value="modelsStore.selectedModelFilename">
                <input type="hidden" id="modelSelectCategory" :value="modelsStore.currentStyleCategory">
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useModelSelect } from '../../composables/useModelSelect';
import { useModelsStore } from '../../stores/models';
import { useLoraConfig } from '../../composables/useLoraConfig';
import type { ModelOption } from '../../composables/useModelSelect';
import LightningIcon from '../common/LightningIcon.vue';

const modelsStore = useModelsStore();
const modelSelect = useModelSelect();
const loraConfig = useLoraConfig();

const selectRef = ref<HTMLElement | null>(null);
const isOpen = ref(false);

// 显示文本：加载中 / 选中模型名
const displayText = computed(() => {
    if (modelSelect.isLoading.value) return '加载中...';
    if (modelSelect.loadError.value) return modelSelect.loadError.value;
    return modelsStore.selectedModelDisplayName || '加载中...';
});

// 按分类分组模型选项
const groupedOptions = computed(() => {
    const groups: Record<string, { label: string; items: ModelOption[] }> = {};
    for (const option of modelSelect.modelOptions.value) {
        const category = option.category;
        if (!groups[category]) {
            groups[category] = {
                label: modelSelect.groupLabels.value[category] || category,
                items: [],
            };
        }
        groups[category].items.push(option);
    }
    return groups;
});

// 切换下拉框
function toggleDropdown() {
    isOpen.value = !isOpen.value;
}

// 选择模型
function onSelectOption(option: ModelOption) {
    modelSelect.selectOption(option);
    isOpen.value = false;
}

// 点击外部关闭下拉框
function onClickOutside(e: MouseEvent) {
    if (selectRef.value && !selectRef.value.contains(e.target as Node)) {
        isOpen.value = false;
    }
}

onMounted(async () => {
    document.addEventListener('click', onClickOutside);
    // 初始化模型列表，完成后初始化 LoRA（与原版流程一致）
    await modelSelect.initModelSelection();
    await loraConfig.initLoraConfig();
});

onBeforeUnmount(() => {
    document.removeEventListener('click', onClickOutside);
});
</script>
