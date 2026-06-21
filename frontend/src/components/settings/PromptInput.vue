<template>
    <div class="form-group ai-generate-container">
        <label for="positivePrompt">
            <svg class="ui-icon" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2"
                fill="none">
                <path d="M12 2l3 7 7 3-7 3-3 7-3-7-7-3 7-3z"></path>
            </svg>
            提示词
        </label>
        <button class="ai-generate-btn" id="tagSearchBtn"
            style="display:flex; align-items:center; justify-content:center; gap:4px;" @click="$emit('tagSearch')">
            <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none">
                <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z">
                </path>
                <line x1="7" y1="7" x2="7.01" y2="7"></line>
            </svg>
            标签搜索
        </button>
        <div class="clear-revert-container">
            <textarea id="positivePrompt" class="form-control" placeholder="" ref="textareaRef" v-model="promptText"
                @input="onInput" @keydown="onKeydown" @blur="handleBlur"></textarea>
            <button class="clear-revert-btn preset-btn" id="presetBtn" title="预设提示词"
                style="display:flex; align-items:center; justify-content:center;" @click="$emit('preset')">
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="16" y1="13" x2="8" y2="13"></line>
                    <line x1="16" y1="17" x2="8" y2="17"></line>
                    <polyline points="10 9 9 9 8 9"></polyline>
                </svg>
            </button>
            <button class="clear-revert-btn translate-btn" id="translateBtn" title="双语对照"
                style="display:flex; align-items:center; justify-content:center;" @click="onTranslate">
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="2" y1="12" x2="22" y2="12"></line>
                    <path
                        d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z">
                    </path>
                </svg>
            </button>
            <button class="clear-revert-btn search-artist-btn" id="searchArtistBtn" title="搜索画师"
                style="display:flex; align-items:center; justify-content:center;" @click="$emit('artistSearch')">
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none">
                    <circle cx="13.5" cy="6.5" r=".5"></circle>
                    <circle cx="17.5" cy="10.5" r=".5"></circle>
                    <circle cx="8.5" cy="7.5" r=".5"></circle>
                    <circle cx="6.5" cy="12.5" r=".5"></circle>
                    <path
                        d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z">
                    </path>
                </svg>
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, nextTick, inject } from 'vue';
import type { useTagSuggestions } from '../../composables/useTagSuggestions';
import { useQuickCursor } from '../../composables/useQuickCursor';
import { useTranslation } from '../../composables/useTranslation';
import { autoResizeTextarea } from '../../utils/helpers';

// 事件定义
const emit = defineEmits<{
    tagSearch: [];
    preset: [];
    artistSearch: [];
    suggestionsPosition: [position: { top: number; left: number }];
}>();

// 提示词文本
const promptText = ref('');
// textarea DOM 引用
const textareaRef = ref<HTMLTextAreaElement | null>(null);

// 通过 inject 获取 App.vue 提供的共享 tagSuggestions 实例
type TagSuggestionsReturn = ReturnType<typeof useTagSuggestions>;
const tagSuggestions = inject<TagSuggestionsReturn>('tagSuggestions')!;
const quickCursor = useQuickCursor();
const translation = useTranslation();

// 输入事件处理：自适应高度 + 标签建议
function onInput(e: Event) {
    const textarea = e.target as HTMLTextAreaElement;
    autoResizeTextarea(textarea);
    tagSuggestions.handleTagInput(e);
    // 计算并发出建议列表位置
    updateSuggestionsPosition(textarea);
}

// 根据光标位置计算建议列表的定位（原版逻辑：桌面端在输入框右侧，移动端在输入框下方）
// 使用 fixed 定位，不需要加 scrollTop/scrollLeft
function updateSuggestionsPosition(textarea: HTMLTextAreaElement) {
    const rect = textarea.getBoundingClientRect();
    const isMobile = window.innerWidth <= 1010;
    if (isMobile) {
        // 移动端：联想词列表显示在输入框下方
        emit('suggestionsPosition', {
            top: rect.bottom + 5,
            left: rect.left,
        });
    } else {
        // 桌面端：联想词列表显示在输入框右侧
        emit('suggestionsPosition', {
            top: rect.top,
            left: rect.right + 10,
        });
    }
}

// 键盘事件处理：标签建议 + 快速光标
function onKeydown(e: KeyboardEvent) {
    // 标签建议的键盘拦截
    const handled = tagSuggestions.handleTagKeydown(e);
    if (handled && e.key === 'Enter' && textareaRef.value) {
        // 确认选择标签建议
        const idx = tagSuggestions.selectedSuggestionIndex.value;
        if (idx >= 0 && idx < tagSuggestions.currentSuggestions.value.length) {
            const selectedTag = tagSuggestions.currentSuggestions.value[idx];
            const result = tagSuggestions.selectSuggestion(selectedTag, textareaRef.value);
            promptText.value = result.newValue;
            nextTick(() => {
                textareaRef.value?.setSelectionRange(result.newCursorPos, result.newCursorPos);
            });
        }
        return;
    }
    if (handled) return;

    // Ctrl+Arrow 快速光标移动
    if (e.ctrlKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        if (textareaRef.value) {
            if (e.key === 'ArrowLeft') {
                quickCursor.moveToPreviousTag(textareaRef.value);
            } else {
                quickCursor.moveToNextTag(textareaRef.value);
            }
        }
    }
}

// 翻译按钮点击
async function onTranslate() {
    if (textareaRef.value) {
        await translation.handleTranslation(textareaRef.value);
        promptText.value = textareaRef.value.value;
    }
}

// blur 事件处理：延迟隐藏建议列表，避免点击建议项时 blur 先于 click 触发
function handleBlur() {
    setTimeout(() => {
        tagSuggestions.hideSuggestions();
    }, 200);
}

// 暴露给父组件的方法和数据
defineExpose({
    promptText,
    textareaRef,
});
</script>
