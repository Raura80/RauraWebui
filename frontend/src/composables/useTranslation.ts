import { ref } from 'vue';
import { useTagsStore } from '../stores/tags';
import { useTextHistory } from './useTextHistory';
import { autoResizeTextarea } from '../utils/helpers';
import { decryptTagData } from '../utils/crypto';

/**
 * 翻译 composable - 为标签提供双语对照翻译
 * 核心逻辑：加载标签词库 → 构建翻译字典 → 解析标签 → 插入中文翻译
 */
export function useTranslation() {
    // 翻译按钮加载状态
    const isTranslating = ref(false);

    // 文本撤销/重做历史管理器
    const textHistoryManager = useTextHistory();

    /**
     * 标签字典键的标准化处理
     * 统一转小写、下划线换空格、合并多余空格
     */
    function normalizeDictKey(tag: string): string {
        let s = tag.toLowerCase().replace(/_/g, ' ').trim();
        s = s.replace(/\s*\(\s*/g, ' (').replace(/\s*\)\s*/g, ')');
        return s.replace(/\s+/g, ' ').trim();
    }

    /**
     * 提取标签的核心英文部分
     * 去除权重语法 (tag:1.5)、括号 ()[]{}、中文字符
     */
    function extractCoreTag(rawTag: string): string {
        let s = rawTag;
        // 匹配权重语法，如 (tag:1.5)，提取内部标签
        const weightMatch = s.match(/^\((.*):\d+(\.\d+)?\)$/);
        if (weightMatch) s = weightMatch[1];
        // 逐层剥除成对括号
        while (s.length > 2) {
            if (s.startsWith('(') && s.endsWith(')')) s = s.substring(1, s.length - 1);
            else if (s.startsWith('[') && s.endsWith(']')) s = s.substring(1, s.length - 1);
            else if (s.startsWith('{') && s.endsWith('}')) s = s.substring(1, s.length - 1);
            else break;
        }
        // 移除中文字符和特殊符号
        s = s.replace(/[\u4e00-\u9fa5·\|、]/g, '');
        s = s.replace(/\(\s*\)/g, '').replace(/\[\s*\]/g, '');
        return normalizeDictKey(s);
    }

    /**
     * 主翻译逻辑
     * 1. 加载 tagData（如果尚未加载）
     * 2. 构建 tagDict（如果尚未构建）
     * 3. 逐标签提取核心词，查找翻译，插入到权重后缀之前
     * 4. 去重后返回翻译结果
     */
    async function performTranslation(content: string): Promise<string> {
        if (!content) return '';

        const tagsStore = useTagsStore();

        // 如果 tagData 未加载，从 ta.dat 获取并解密
        if (!tagsStore.tagData || tagsStore.tagData.length === 0) {
            try {
                const response = await fetch('ta.dat');
                const encryptedText = await response.text();
                const decrypted = decryptTagData(encryptedText);
                if (decrypted) {
                    tagsStore.setTagData(decrypted);
                }
            } catch (error) {
                console.error('加载标签数据失败:', error);
                return content;
            }
        }

        // 如果 tagDict 未构建，则构建
        if (tagsStore.tagDict.size === 0) {
            tagsStore.buildTagDict();
        }

        // 统一逗号，按逗号分割标签
        const cleanContent = content.replace(/，/g, ',').replace(/[\n\r]+/g, ',');
        const rawTags = cleanContent.split(',').map(t => t.trim()).filter(t => t);

        // 分析每个标签：提取核心词，查找翻译
        let needsTranslationCount = 0;
        const analyzedTags = rawTags.map(originalTag => {
            const coreEn = extractCoreTag(originalTag);
            const translation = tagsStore.tagDict.get(coreEn);
            if (translation && !originalTag.includes(translation)) needsTranslationCount++;
            return { original: originalTag, coreEn, translation };
        });

        let resultTags: string[] = [];

        if (needsTranslationCount > 0) {
            // 有需要翻译的标签：在权重后缀前插入翻译
            analyzedTags.forEach(item => {
                if (item.translation && !item.original.includes(item.translation)) {
                    // 找到插入位置：权重后缀之前
                    let insertIndex = item.original.length;
                    const weightMatch = item.original.match(/(:\d+(\.\d+)?)[\)\]\}]*$/);
                    if (weightMatch) {
                        insertIndex = weightMatch.index!;
                    } else {
                        // 没有权重语法时，查找尾部成对括号
                        const leadingMatch = item.original.match(/^[\(\[\{]+/);
                        if (leadingMatch) {
                            const count = leadingMatch[0].length;
                            const trailingRegex = new RegExp(`[\\)\\]\\}]{1,${count}}$`);
                            const trailingMatch = item.original.match(trailingRegex);
                            if (trailingMatch) insertIndex = trailingMatch.index!;
                        }
                    }
                    const base = item.original.substring(0, insertIndex);
                    const suffix = item.original.substring(insertIndex);
                    resultTags.push(base + item.translation + suffix);
                } else {
                    resultTags.push(item.original);
                }
            });
        } else {
            // 无需翻译：仅清理中文字符
            analyzedTags.forEach(item => {
                let restored = item.original.replace(/[\u4e00-\u9fa5·\|、]/g, '');
                restored = restored.replace(/\(\s*\)/g, '').replace(/\[\s*\]/g, '');
                restored = restored.replace(/\s+([:\)\]\}])/g, '$1').trim();
                if (restored) resultTags.push(restored);
            });
        }

        // 去重
        const finalUnique = [...new Set(resultTags)];
        let newContent = finalUnique.join(', ');
        if (newContent && !newContent.endsWith(',')) newContent += ',';

        return newContent;
    }

    /**
     * 翻译按钮点击处理
     * 获取文本框内容，执行翻译，更新文本框
     */
    async function handleTranslation(textarea: HTMLTextAreaElement): Promise<void> {
        const content = textarea.value.trim();
        if (!content) return;

        isTranslating.value = true;
        try {
            const newContent = await performTranslation(content);
            if (newContent && textarea.value !== newContent) {
                textarea.value = newContent;
                autoResizeTextarea(textarea);
                // 记录到撤销历史
                textHistoryManager.pushState(textarea.value, textarea.value.length);
            }
        } catch (error) {
            console.error('翻译处理出错:', error);
        } finally {
            isTranslating.value = false;
        }
    }

    return {
        isTranslating,
        performTranslation,
        extractCoreTag,
        handleTranslation,
    };
}
