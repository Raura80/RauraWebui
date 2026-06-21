// 随机种子生成
export function generateRandomSeed(): number {
    return Math.floor(Math.random() * 100000000000000) + 1;
}

// 数值限制
export function clamp(value: number | string, min: number, max: number): number {
    const num = parseFloat(String(value));
    if (isNaN(num)) return min;
    return Math.min(Math.max(num, min), max);
}

// 防抖 - 使用 lodash
import _debounce from 'lodash/debounce';
export function debounce<T extends (...args: any[]) => any>(func: T, wait: number): T {
    return _debounce(func, wait) as unknown as T;
}

// 正则转义
export function escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 移除中文字符
export function removeChineseCharacters(text: string): string {
    return text.replace(/[\u4e00-\u9fa5]/g, '');
}

// 文本框高度自适应
export function autoResizeTextarea(textarea: HTMLTextAreaElement): void {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 600) + 'px';
}

// 设置自定义下拉框的值
export function setCustomSelectValue(inputId: string, val: string): void {
    const input = document.getElementById(inputId) as HTMLInputElement | null;
    if (!input) return;
    const wrapper = input.closest('.custom-select');
    if (wrapper) {
        const options = wrapper.querySelectorAll('.custom-option');
        const textSpan = wrapper.querySelector('.selected-text');
        options.forEach(opt => {
            const el = opt as HTMLElement;
            if (el.dataset.value === val) {
                el.classList.add('selected');
                if (textSpan) textSpan.textContent = el.textContent;
                input.value = val;
            } else {
                el.classList.remove('selected');
            }
        });
    }
}
