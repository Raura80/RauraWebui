import { ref, readonly } from 'vue';
import { useTagsStore } from '../stores/tags';
import type { TagItem } from '../types';
import { sortTagSuggestions, isSubsequence } from '../utils/scoring';
import { autoResizeTextarea } from '../utils/helpers';

export function useTagSuggestions() {
  const tagsStore = useTagsStore();

  // 当前建议列表
  const currentSuggestions = ref<TagItem[]>([]);
  // 当前选中的建议索引
  const selectedSuggestionIndex = ref(-1);
  // 建议列表是否可见
  const isSuggestionsVisible = ref(false);

  /**
   * 获取当前光标所在的词
   * 以逗号为分隔符，提取光标所在位置的词
   */
  function getCurrentWord(text: string, cursorPos: number): string {
    let startPos = cursorPos - 1;
    // 向左查找逗号
    while (startPos >= 0 && text[startPos] !== ',' && text[startPos] !== '，') startPos--;
    startPos++;

    let endPos = cursorPos;
    // 向右查找逗号
    while (endPos < text.length && text[endPos] !== ',' && text[endPos] !== '，') endPos++;

    return text.substring(startPos, endPos).trim();
  }

  /**
   * 显示建议列表
   * 根据当前输入词过滤标签数据并排序
   */
  function showSuggestions(currentWord: string): void {
    if (!currentWord) {
      hideSuggestions();
      return;
    }

    // 过滤匹配的标签
    const matchedSuggestions = tagsStore.tagData.filter(item => {
      const searchTerm = currentWord.toLowerCase();
      const englishTag = item.tag.toLowerCase();
      const chineseTag = (item['right tag cn'] || '').toLowerCase();
      const pinyinTag = (item.pinyin || '').toLowerCase();

      // 子序列匹配英文标签
      if (isSubsequence(searchTerm, englishTag)) return true;
      // 中文包含匹配
      if (chineseTag && chineseTag.includes(searchTerm)) return true;
      // 拼音子序列匹配
      if (pinyinTag && isSubsequence(searchTerm, pinyinTag)) return true;
      // 拼音包含匹配（长度比例限制）
      if (pinyinTag && pinyinTag.includes(searchTerm) && searchTerm.length >= 3) {
        const lengthRatio = searchTerm.length / pinyinTag.length;
        return lengthRatio >= 0.2 && lengthRatio <= 0.8;
      }
      return false;
    });

    if (matchedSuggestions.length === 0) {
      hideSuggestions();
      return;
    }

    // 排序并取前 100 条
    currentSuggestions.value = sortTagSuggestions(
      matchedSuggestions,
      currentWord,
      tagsStore.tagUsageFrequency,
      tagsStore.artistStars,
    ).slice(0, 100);

    selectedSuggestionIndex.value = 0;
    isSuggestionsVisible.value = true;
  }

  /**
   * 隐藏建议列表
   */
  function hideSuggestions(): void {
    isSuggestionsVisible.value = false;
    selectedSuggestionIndex.value = -1;
  }

  /**
   * 设置当前选中的建议索引
   */
  function setSelectedSuggestion(index: number): void {
    selectedSuggestionIndex.value = index;
  }

  /**
   * 处理输入事件（防抖由组件层处理）
   * 提取当前词并显示/隐藏建议
   */
  function handleTagInput(e: Event): void {
    const input = e.target as HTMLTextAreaElement;
    const cursorPosition = input.selectionStart ?? 0;
    const value = input.value;
    const currentWord = getCurrentWord(value, cursorPosition);

    if (currentWord) {
      showSuggestions(currentWord);
    } else {
      hideSuggestions();
    }
  }

  /**
   * 处理键盘事件
   * 支持上下箭头选择、Enter 确认、Escape 关闭
   */
  function handleTagKeydown(e: KeyboardEvent): boolean {
    // 不在建议可见状态时不拦截
    if (!isSuggestionsVisible.value) return false;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        selectedSuggestionIndex.value = Math.min(
          selectedSuggestionIndex.value + 1,
          currentSuggestions.value.length - 1,
        );
        return true;

      case 'ArrowUp':
        e.preventDefault();
        selectedSuggestionIndex.value = Math.max(selectedSuggestionIndex.value - 1, 0);
        return true;

      case 'Enter':
        e.preventDefault();
        if (
          selectedSuggestionIndex.value >= 0 &&
          selectedSuggestionIndex.value < currentSuggestions.value.length
        ) {
          // 返回 true 表示需要执行 selectSuggestion
          return true;
        }
        return false;

      case 'Escape':
        hideSuggestions();
        return true;

      default:
        return false;
    }
  }

  /**
   * 选择建议标签并插入到输入框
   * @param selectedTag 选中的标签
   * @param inputElement 输入框元素
   * @returns 插入后的新文本值和光标位置
   */
  function selectSuggestion(
    selectedTag: TagItem,
    inputElement: HTMLTextAreaElement,
  ): { newValue: string; newCursorPos: number } {
    const value = inputElement.value;
    const cursorPosition = inputElement.selectionStart ?? 0;

    // 找到当前词的起止位置
    let startPos = cursorPosition - 1;
    while (startPos >= 0 && value[startPos] !== ',' && value[startPos] !== '，') startPos--;
    startPos++;

    let endPos = cursorPosition;
    while (endPos < value.length && value[endPos] !== ',' && value[endPos] !== '，') endPos++;

    const beforeText = value.substring(0, startPos);
    const afterText = value.substring(endPos);
    const englishTag = selectedTag.tag;

    // 判断是否需要逗号分隔
    let separator = ',';
    if (afterText.trim().startsWith(',') || afterText.trim().startsWith('，')) {
      separator = '';
    }

    const newValue = beforeText + englishTag + separator + afterText;
    const newCursorPos = startPos + englishTag.length + (separator ? 1 : 0);

    // 记录标签使用
    tagsStore.recordTagUsage(selectedTag.tag);

    // 隐藏建议
    hideSuggestions();

    // 自适应高度
    inputElement.value = newValue;
    inputElement.setSelectionRange(newCursorPos, newCursorPos);
    autoResizeTextarea(inputElement);

    return { newValue, newCursorPos };
  }

  return {
    // 状态
    currentSuggestions: readonly(currentSuggestions),
    selectedSuggestionIndex: readonly(selectedSuggestionIndex),
    isSuggestionsVisible: readonly(isSuggestionsVisible),

    // 方法
    getCurrentWord,
    showSuggestions,
    hideSuggestions,
    setSelectedSuggestion,
    handleTagInput,
    handleTagKeydown,
    selectSuggestion,
  };
}
