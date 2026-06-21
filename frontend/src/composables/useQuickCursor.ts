import { useTextHistory } from './useTextHistory';

/**
 * 快速光标移动 composable
 * 支持 Ctrl+ArrowLeft/Right 在标签边界之间跳转
 */
export function useQuickCursor() {
    // 获取文本历史管理器实例，用于在移动光标前保存状态
    const textHistoryManager = useTextHistory();

    /**
     * 将光标移动到上一个标签边界（逗号分隔处）
     * 连续跳过两个逗号后停在第二个逗号之后的位置
     */
    function moveToPreviousTag(textarea: HTMLTextAreaElement): void {
        const value = textarea.value;
        const cursorPos = textarea.selectionStart;
        // 移动前先保存历史状态，以便撤销
        textHistoryManager.pushState(value, cursorPos);

        let searchPos = cursorPos - 1;
        let foundComma = false;
        while (searchPos >= 0) {
            // 同时匹配英文逗号和中文逗号
            if (value[searchPos] === ',' || value[searchPos] === '，') {
                if (foundComma) {
                    // 找到第二个逗号，定位到它之后
                    textarea.setSelectionRange(searchPos + 1, searchPos + 1);
                    return;
                } else {
                    foundComma = true;
                }
            }
            searchPos--;
        }
        // 没找到两个逗号，移到最前面
        textarea.setSelectionRange(0, 0);
    }

    /**
     * 将光标移动到下一个标签边界（逗号分隔处）
     * 找到第一个逗号后定位到它之后的位置
     */
    function moveToNextTag(textarea: HTMLTextAreaElement): void {
        const value = textarea.value;
        const cursorPos = textarea.selectionStart;
        const textLength = value.length;
        // 移动前先保存历史状态
        textHistoryManager.pushState(value, cursorPos);

        let searchPos = cursorPos;
        while (searchPos < textLength) {
            if (value[searchPos] === ',' || value[searchPos] === '，') {
                textarea.setSelectionRange(searchPos + 1, searchPos + 1);
                return;
            }
            searchPos++;
        }
        // 没找到逗号，移到最后面
        textarea.setSelectionRange(textLength, textLength);
    }

    /**
     * 初始化快速光标移动，绑定 Ctrl+ArrowLeft/Right 事件
     * @param textarea 需要绑定快捷键的文本域元素
     */
    function initQuickCursorMovement(textarea: HTMLTextAreaElement): () => void {
        const handler = (e: KeyboardEvent) => {
            if (e.ctrlKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
                e.preventDefault();
                if (e.key === 'ArrowLeft') {
                    moveToPreviousTag(textarea);
                } else {
                    moveToNextTag(textarea);
                }
            }
        };
        textarea.addEventListener('keydown', handler);
        // 返回清理函数
        return () => textarea.removeEventListener('keydown', handler);
    }

    return {
        initQuickCursorMovement,
        moveToPreviousTag,
        moveToNextTag,
    };
}
