import { ref } from 'vue';
import { searchTags, getRelatedTags } from '../services/api';
import { debounce, escapeRegExp, autoResizeTextarea } from '../utils/helpers';
import { useTextHistory } from './useTextHistory';
import type { TagSearchResponse, TagSearchResult, RelatedTag } from '../types';

/** 获取当前主题的 CSS 变量值 */
function getThemeVar(name: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * 标签搜索弹窗 composable
 * 提供标签搜索、关联词查询、标签插入/移除等功能
 */
export function useTagSearchPopup() {
    const textHistoryManager = useTextHistory();

    // 当前激活的关键词（用于分词后点击某个关键词聚焦搜索）
    const activeKeyword = ref<string | null>(null);

    // AbortController 统一管理事件监听器，卸载时一次性清理
    let abortController: AbortController | null = null;

    /**
     * 检查标签是否已存在于提示词中
     * 使用正则精确匹配逗号分隔的标签项
     */
    function isTagInPrompt(tag: string, promptText: string): boolean {
        if (!promptText) return false;
        // 先做快速排除：不包含则肯定不在
        if (!promptText.toLowerCase().includes(tag.toLowerCase())) return false;
        // 精确匹配：标签必须出现在逗号分隔的边界内
        const regex = new RegExp(`(^|,)\\s*${escapeRegExp(tag)}(?=[^a-zA-Z0-9_\\-]|$)[^,]*(,|$)`, 'i');
        return regex.test(promptText);
    }

    /**
     * 在光标位置安全插入文本
     * 自动处理逗号分隔符
     * 移动端不聚焦输入框，避免弹出键盘
     */
    function insertTextAtCursorSafely(textArea: HTMLTextAreaElement, text: string): void {
        const isMobile = window.innerWidth <= 768;
        if (!isMobile) {
            textArea.focus();
        }
        const currentVal = textArea.value;
        const cursorPos = isMobile ? currentVal.length : textArea.selectionStart;
        let prefix = '';
        // 如果光标前不是逗号/空格/换行，需要添加逗号分隔
        if (cursorPos > 0) {
            const prevChar = currentVal[cursorPos - 1];
            if (prevChar !== ',' && prevChar !== ' ' && prevChar !== '\n') {
                prefix = ', ';
            }
        }
        const start = isMobile ? currentVal.length : textArea.selectionStart;
        const end = isMobile ? currentVal.length : textArea.selectionEnd;
        textArea.setRangeText(prefix + text + ', ', start, end, 'end');
        textArea.dispatchEvent(new Event('input'));
    }

    /**
     * 更新提示词文本框内容（带历史记录）
     */
    function updatePromptTextarea(newText: string): void {
        const positivePrompt = document.getElementById('positivePrompt') as HTMLTextAreaElement | null;
        if (!positivePrompt) return;
        textHistoryManager.pushState(positivePrompt.value, positivePrompt.selectionStart);
        positivePrompt.value = newText;
        textHistoryManager.pushState(newText, newText.length);
        autoResizeTextarea(positivePrompt);
    }

    /**
     * 渲染标签搜索结果列表
     */
    function renderTagList(data: TagSearchResponse): void {
        const listBody = document.getElementById('tagListBody');
        const resultSummary = document.getElementById('tsResultSummary');
        const positivePrompt = document.getElementById('positivePrompt') as HTMLTextAreaElement | null;
        if (!listBody) return;

        listBody.innerHTML = '';
        const results = data.results || [];

        if (results.length === 0) {
            listBody.innerHTML = '<div style="padding: 30px; text-align: center; color: var(--text-muted);">未找到匹配的标签</div>';
            return;
        }

        if (resultSummary) resultSummary.textContent = `找到 ${results.length} 个结果`;

        const fragment = document.createDocumentFragment();

        results.forEach((item: TagSearchResult) => {
            const row = document.createElement('div');
            // 根据分类设置样式
            let rowClass = 'artist-list-row';
            let badgeClass = '';
            let textCol = 'var(--primary-color)';
            let iconSvg = '';

            if (item.category === 'General') {
                rowClass += ' row-cat-general';
                badgeClass = 'badge-general';
                textCol = getThemeVar('--cat-general-color');
                iconSvg = '<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="none" style="margin-right:4px; vertical-align:-1px;"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>';
            } else if (item.category === 'Character') {
                rowClass += ' row-cat-character';
                badgeClass = 'badge-character';
                textCol = getThemeVar('--cat-character-color');
                iconSvg = '<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="none" style="margin-right:4px; vertical-align:-1px;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>';
            } else if (item.category === 'Copyright') {
                rowClass += ' row-cat-copyright';
                badgeClass = 'badge-copyright';
                textCol = getThemeVar('--cat-copyright-color');
                iconSvg = '<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="none" style="margin-right:4px; vertical-align:-1px;"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><line x1="7" y1="2" x2="7" y2="22"></line><line x1="17" y1="2" x2="17" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line><line x1="2" y1="7" x2="7" y2="7"></line><line x1="2" y1="17" x2="7" y2="17"></line><line x1="17" y1="17" x2="22" y2="17"></line><line x1="17" y1="7" x2="22" y2="7"></line></svg>';
            } else {
                iconSvg = '<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="none" style="margin-right:4px; vertical-align:-1px;"><circle cx="12" cy="12" r="10"></circle></svg>';
            }

            row.className = rowClass;

            const finalScore = item.final_score ? Math.round(item.final_score * 100) + '%' : '0%';
            const postCount = item.count || '0';
            const isUsed = positivePrompt ? isTagInPrompt(item.tag, positivePrompt.value) : false;

            // 已使用的标签高亮显示
            if (isUsed) {
                row.style.backgroundColor = getThemeVar('--selected-bg');
                row.style.borderLeftColor = 'var(--primary-color)';
                row.style.boxShadow = 'inset 3px 0 0 0 var(--primary-color)';
            }

            row.innerHTML = `
                <div class="artist-col" style="flex: 0 0 30%; overflow: hidden;">
                    <span class="artist-name" style="font-weight: 700; color: ${textCol}; display:flex; align-items:center;">${iconSvg}${item.tag}</span>
                </div>
                <div class="artist-col" style="flex: 0 0 40%; overflow: hidden;">
                    <span class="artist-alias" style="font-size: 12px; color: var(--text-muted);">${item.cn_name || '-'}</span>
                </div>
                <div class="artist-col num-col" style="flex: 0 0 15%; justify-content: center;">
                    <span class="data-badge ${badgeClass}">${finalScore}</span>
                </div>
                <div class="artist-col num-col" style="flex: 0 0 15%; justify-content: center;">
                    <span class="data-badge" style="background: var(--hover-bg); color: var(--text-muted);">${postCount}</span>
                </div>`;

            // 悬浮显示标签释义
            row.addEventListener('mouseenter', () => {
                const tooltip = document.getElementById('tagDetailTooltip');
                const wikiEl = document.getElementById('tooltipWiki');
                if (!tooltip || !wikiEl) return;
                const tagHeader = `<span class="tooltip-tag-header">${item.tag}</span>`;
                const wikiContent = item.wiki && item.wiki.trim() !== '' ? item.wiki : '暂无详细释义';
                wikiEl.innerHTML = `${tagHeader}${wikiContent}`;
                tooltip.className = 'tag-detail-tooltip';
                if (item.category === 'General') tooltip.classList.add('border-general');
                else if (item.category === 'Character') tooltip.classList.add('border-character');
                else if (item.category === 'Copyright') tooltip.classList.add('border-copyright');
                tooltip.classList.add('show');
            });

            row.addEventListener('mousemove', (e: MouseEvent) => {
                const tooltip = document.getElementById('tagDetailTooltip');
                if (!tooltip) return;
                const padding = 20;
                let x = e.clientX + padding;
                let y = e.clientY + padding;
                if (x + 470 > window.innerWidth) x = e.clientX - 490;
                if (y + tooltip.offsetHeight > window.innerHeight) y = window.innerHeight - tooltip.offsetHeight - 10;
                tooltip.style.left = x + 'px';
                tooltip.style.top = y + 'px';
            });

            row.addEventListener('mouseleave', () => {
                const tooltip = document.getElementById('tagDetailTooltip');
                if (tooltip) tooltip.classList.remove('show');
            });

            // 点击添加/移除标签
            row.addEventListener('click', () => {
                if (!positivePrompt) return;
                const currentPrompt = positivePrompt.value;
                const currentlyUsed = isTagInPrompt(item.tag, currentPrompt);

                if (currentlyUsed) {
                    // 从提示词中移除该标签
                    const regex = new RegExp(`(^|,)\\s*${escapeRegExp(item.tag)}(?=[^a-zA-Z0-9_\\-]|$)[^,]*(,|$)`, 'gi');
                    const newPrompt = currentPrompt.replace(regex, '$1$2').replace(/,+/g, ',').replace(/^,+|,+$/g, '').trim();
                    updatePromptTextarea(newPrompt);
                    row.style.backgroundColor = '';
                    row.style.boxShadow = '';
                    const categoryColors: Record<string, string> = { 'General': getThemeVar('--cat-general-color'), 'Character': getThemeVar('--cat-character-color'), 'Copyright': getThemeVar('--cat-copyright-color') };
                    row.style.borderLeftColor = categoryColors[item.category] || '';
                } else {
                    // 在光标位置插入标签
                    insertTextAtCursorSafely(positivePrompt, item.tag);
                    row.style.backgroundColor = getThemeVar('--selected-bg');
                    row.style.boxShadow = 'inset 3px 0 0 0 var(--primary-color)';
                    row.style.borderLeftColor = 'var(--primary-color)';
                }

                // 闪烁动画
                row.classList.remove('row-flash');
                void row.offsetWidth;
                row.classList.add('row-flash');

                // 获取该标签的关联词
                fetchRelatedTags([item.tag]);
            });

            fragment.appendChild(row);
        });

        listBody.appendChild(fragment);
    }

    /**
     * 渲染关联标签列表
     */
    function renderRelatedTags(data: RelatedTag[]): void {
        const relatedBody = document.getElementById('relatedTagsBody');
        const positivePrompt = document.getElementById('positivePrompt') as HTMLTextAreaElement | null;
        if (!relatedBody) return;

        relatedBody.innerHTML = '';

        if (!data || data.length === 0) {
            relatedBody.innerHTML = '<div style="padding: 30px; text-align: center; color: var(--text-muted);">无关联标签</div>';
            return;
        }

        const fragment = document.createDocumentFragment();

        data.forEach((item: RelatedTag) => {
            const row = document.createElement('div');
            let rowClass = 'related-list-row';
            let textCol = 'var(--primary-color)';
            let iconSvg = '';

            if (item.category === 'General') {
                rowClass += ' row-cat-general';
                textCol = getThemeVar('--cat-general-color');
                iconSvg = '<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="none" style="margin-right:4px; vertical-align:-1px;"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>';
            } else if (item.category === 'Character') {
                rowClass += ' row-cat-character';
                textCol = getThemeVar('--cat-character-color');
                iconSvg = '<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="none" style="margin-right:4px; vertical-align:-1px;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>';
            } else if (item.category === 'Copyright') {
                rowClass += ' row-cat-copyright';
                textCol = getThemeVar('--cat-copyright-color');
                iconSvg = '<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="none" style="margin-right:4px; vertical-align:-1px;"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><line x1="7" y1="2" x2="7" y2="22"></line><line x1="17" y1="2" x2="17" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line><line x1="2" y1="7" x2="7" y2="7"></line><line x1="2" y1="17" x2="7" y2="17"></line><line x1="17" y1="17" x2="22" y2="17"></line><line x1="17" y1="7" x2="22" y2="7"></line></svg>';
            } else {
                iconSvg = '<svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="none" style="margin-right:4px; vertical-align:-1px;"><circle cx="12" cy="12" r="10"></circle></svg>';
            }

            row.className = rowClass;

            const isUsed = positivePrompt ? isTagInPrompt(item.tag, positivePrompt.value) : false;
            if (isUsed) {
                row.style.backgroundColor = getThemeVar('--selected-bg');
                row.style.borderLeftColor = 'var(--primary-color)';
                row.style.boxShadow = 'inset 3px 0 0 0 var(--primary-color)';
            }

            // 计算共现分数百分比
            let percentage = (item.cooc_score * 100).toFixed(1) + '%';
            if (item.cooc_score > 1) {
                percentage = parseFloat(String(item.cooc_score)).toFixed(1) + '%';
            }

            row.innerHTML = `
                <div class="related-left-col">
                    <span class="related-tag-name" style="color: ${textCol}; display:flex; align-items:center;" title="${item.tag}">${iconSvg}${item.tag}</span>
                    <span class="related-tag-cn" title="${item.cn_name || '-'}">${item.cn_name || '-'}</span>
                </div>
                <div class="related-right-col">
                    <span class="related-score-badge">${percentage}</span>
                </div>`;

            // 点击添加/移除关联标签
            row.addEventListener('click', () => {
                if (!positivePrompt) return;
                const currentPrompt = positivePrompt.value;
                const currentlyUsed = isTagInPrompt(item.tag, currentPrompt);

                if (currentlyUsed) {
                    const regex = new RegExp(`(^|,)\\s*${escapeRegExp(item.tag)}(?=[^a-zA-Z0-9_\\-]|$)[^,]*(,|$)`, 'gi');
                    const newPrompt = currentPrompt.replace(regex, '$1$2').replace(/,+/g, ',').replace(/^,+|,+$/g, '').trim();
                    updatePromptTextarea(newPrompt);
                    row.style.backgroundColor = '';
                    row.style.boxShadow = '';
                    const categoryColors: Record<string, string> = { 'General': getThemeVar('--cat-general-color'), 'Character': getThemeVar('--cat-character-color'), 'Copyright': getThemeVar('--cat-copyright-color') };
                    row.style.borderLeftColor = categoryColors[item.category] || 'transparent';
                } else {
                    insertTextAtCursorSafely(positivePrompt, item.tag);
                    row.style.backgroundColor = getThemeVar('--selected-bg');
                    row.style.boxShadow = 'inset 3px 0 0 0 var(--primary-color)';
                    row.style.borderLeftColor = 'var(--primary-color)';
                }

                row.classList.remove('row-flash');
                void row.offsetWidth;
                row.classList.add('row-flash');
            });

            fragment.appendChild(row);
        });

        relatedBody.appendChild(fragment);
    }

    /**
     * 获取关联标签
     */
    async function fetchRelatedTags(tags: string[]): Promise<void> {
        const relatedPopup = document.getElementById('relatedTagsPopup');
        const relatedBody = document.getElementById('relatedTagsBody');
        const targetSpan = document.getElementById('relatedTagsTarget');
        if (!relatedPopup || !relatedBody) return;

        // 显示加载状态
        if (relatedBody.innerHTML.trim() === '') {
            relatedBody.innerHTML = '<div style="padding: 30px; text-align: center; color: var(--text-muted);">加载中...</div>';
        } else {
            relatedBody.style.opacity = '0.4';
            relatedBody.style.pointerEvents = 'none';
            relatedBody.style.transition = 'opacity 0.2s ease';
        }

        // 显示关联词弹窗
        if (relatedPopup.style.display !== 'flex') {
            relatedPopup.style.display = 'flex';
            positionRelatedPopup();
        }

        try {
            const data = await getRelatedTags({ tags, limit: 50, show_nsfw: true });
            if (targetSpan) targetSpan.textContent = tags.join(', ');
            renderRelatedTags(data);
        } catch (e) {
            if (targetSpan) targetSpan.textContent = tags.join(', ');
            relatedBody.innerHTML = '<div style="padding: 30px; text-align: center; color: var(--danger-color);">获取关联词失败</div>';
        } finally {
            relatedBody.style.opacity = '1';
            relatedBody.style.pointerEvents = 'auto';
            positionRelatedPopup();
        }
    }

    /**
     * 通过 API 搜索标签
     * @param updateKeywords 是否更新分词关键词（true=新搜索，false=聚焦某个关键词）
     */
    async function fetchTagsData(updateKeywords: boolean = true): Promise<void> {
        const searchInput = document.getElementById('tagSearchInput') as HTMLInputElement | null;
        const listBody = document.getElementById('tagListBody');
        const resultSummary = document.getElementById('tsResultSummary');
        const relatedPopup = document.getElementById('relatedTagsPopup');
        const tokenizeResultEl = document.getElementById('tsTokenizeResult');

        if (!searchInput || !listBody) return;

        // 确定搜索查询：如果聚焦某个关键词则用它，否则用输入框内容
        const query = (activeKeyword.value && !updateKeywords) ? activeKeyword.value : searchInput.value.trim();

        if (!query && !searchInput.value.trim()) {
            listBody.innerHTML = '<div style="padding: 30px; text-align: center; color: var(--text-muted);">输入关键词开始检索...</div>';
            if (resultSummary) resultSummary.textContent = '';
            if (tokenizeResultEl) { tokenizeResultEl.innerHTML = ''; tokenizeResultEl.style.display = 'none'; }
            if (relatedPopup) relatedPopup.style.display = 'none';
            return;
        }

        // 显示加载状态
        listBody.innerHTML = '<div style="padding: 30px; text-align: center; color: var(--text-muted);"><span></span> 正在下载列表</div>';
        if (resultSummary) resultSummary.textContent = '';
        if (updateKeywords && tokenizeResultEl) tokenizeResultEl.style.display = 'flex';

        // 构建搜索请求参数
        // 注意：fallback 值必须与原版 HTML 滑块默认值一致
        // 原版 tsTopK value="20", tsLimit value="50", tsPopWeight value="0.15"
        const payload = {
            query,
            top_k: parseInt((document.getElementById('tsTopK') as HTMLInputElement)?.value || '20'),
            limit: parseInt((document.getElementById('tsLimit') as HTMLInputElement)?.value || '50'),
            popularity_weight: parseFloat((document.getElementById('tsPopWeight') as HTMLInputElement)?.value || '0.15'),
            show_nsfw: true,
            use_segmentation: !!updateKeywords, // 原版：!(!updateKeywords)，聚焦关键词时不使用分词
            target_layers: Array.from(document.querySelectorAll('.ts-layer:checked')).map((cb: Element) => (cb as HTMLInputElement).value),
            target_categories: Array.from(document.querySelectorAll('.ts-cat:checked')).map((cb: Element) => (cb as HTMLInputElement).value),
        };

        try {
            const data = await searchTags(payload);

            // 处理分词关键词显示
            if (updateKeywords && tokenizeResultEl) {
                const smartTokenize = document.getElementById('tsSmartTokenize') as HTMLInputElement | null;
                if (smartTokenize?.checked && data.keywords && data.keywords.length > 0) {
                    tokenizeResultEl.innerHTML = '';
                    data.keywords.forEach(kw => {
                        const kwBtn = document.createElement('span');
                        kwBtn.textContent = kw;
                        kwBtn.style.cssText = `padding: 2px 10px; border-radius: 4px; background: var(--hover-bg); color: var(--primary-color); cursor: pointer; border: 1px solid var(--border-color); transition: all 0.2s ease; user-select: none;`;

                        kwBtn.onmouseenter = () => { if (activeKeyword.value !== kw) kwBtn.style.background = getThemeVar('--border-color-strong'); };
                        kwBtn.onmouseleave = () => { if (activeKeyword.value !== kw) kwBtn.style.background = getThemeVar('--selected-bg'); };

                        kwBtn.onclick = () => {
                            if (activeKeyword.value === kw) {
                                // 取消聚焦
                                activeKeyword.value = null;
                                kwBtn.style.background = getThemeVar('--selected-bg');
                                kwBtn.style.color = 'var(--primary-color)';
                            } else {
                                // 聚焦该关键词
                                activeKeyword.value = kw;
                                Array.from(tokenizeResultEl.querySelectorAll('span')).forEach(btn => {
                                    if (btn.style.cursor === 'pointer') {
                                        btn.style.background = getThemeVar('--selected-bg');
                                        btn.style.color = 'var(--primary-color)';
                                    }
                                });
                                kwBtn.style.background = 'var(--primary-color)';
                                kwBtn.style.color = '#fff';
                            }
                            fetchTagsData(false);
                        };

                        tokenizeResultEl.appendChild(kwBtn);
                    });
                } else {
                    tokenizeResultEl.innerHTML = '';
                    tokenizeResultEl.style.display = 'none';
                }
            }

            // 渲染搜索结果
            renderTagList(data);

            // 自动获取第一个结果的关联词
            if (data.results && data.results.length > 0) {
                fetchRelatedTags([data.results[0].tag]);
            } else {
                if (relatedPopup) relatedPopup.style.display = 'none';
            }
        } catch (error) {
            console.error(error);
            listBody.innerHTML = '<div style="padding: 30px; text-align: center; color: var(--danger-color);">获取数据失败，请检查本地标签服务状态。</div>';
            if (updateKeywords && tokenizeResultEl) { tokenizeResultEl.innerHTML = ''; tokenizeResultEl.style.display = 'none'; }
            if (relatedPopup) relatedPopup.style.display = 'none';
        }
    }

    /**
     * 定位关联词弹窗位置（在搜索弹窗旁边）
     */
    function positionRelatedPopup(): void {
        const popup = document.getElementById('tagSearchPopup');
        const relatedPopup = document.getElementById('relatedTagsPopup');
        if (!popup || !relatedPopup) return;
        if (popup.style.display !== 'flex') return;

        const rect = popup.getBoundingClientRect();
        const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

        // 默认放在搜索弹窗右侧
        let left = rect.right + scrollLeft + 10;
        let top = rect.top + scrollTop;

        // 右侧空间不足则放到左侧
        if (left + 280 > window.innerWidth + scrollLeft) {
            left = rect.left + scrollLeft - 280 - 10;
        }

        // 左侧也不够则放到最右边
        if (left < 0) {
            left = window.innerWidth + scrollLeft - 280 - 10;
        }

        relatedPopup.style.left = left + 'px';
        relatedPopup.style.top = top + 'px';
    }

    /**
     * 初始化标签搜索弹窗
     * 绑定搜索按钮、输入框、高级设置等事件
     */
    function initTagSearchPopup(): () => void {
        const searchBtn = document.getElementById('tagSearchBtn');
        const popup = document.getElementById('tagSearchPopup');
        const relatedPopup = document.getElementById('relatedTagsPopup');
        const searchInput = document.getElementById('tagSearchInput') as HTMLInputElement | null;
        const listBody = document.getElementById('tagListBody');
        const advBtn = document.getElementById('tagAdvSettingsBtn');
        const advPanel = document.getElementById('tagAdvPanel');
        const resultSummary = document.getElementById('tsResultSummary');

        if (!searchBtn || !popup) return () => { };

        // 创建新的 AbortController，清理旧的
        if (abortController) abortController.abort();
        abortController = new AbortController();
        const { signal } = abortController;

        // 外部点击计数器（双击外部才关闭弹窗）
        let outsideClickCount = 0;
        let outsideClickTimer: ReturnType<typeof setTimeout> | null = null;

        // 搜索按钮点击：切换弹窗显示
        searchBtn.addEventListener('click', (e: Event) => {
            e.stopPropagation();
            outsideClickCount = 0;
            if (outsideClickTimer) clearTimeout(outsideClickTimer);

            const isVisible = popup.style.display === 'flex';
            if (isVisible) {
                popup.style.display = 'none';
                popup.style.visibility = 'hidden';
                if (relatedPopup) relatedPopup.style.display = 'none';
            } else {
                // 计算弹窗位置
                const btnRect = searchBtn.getBoundingClientRect();
                const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
                const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
                popup.style.visibility = 'hidden';
                popup.style.display = 'flex';
                const popupWidth = popup.offsetWidth || 680;
                let leftPos = btnRect.right + scrollLeft + 10;
                let topPos = btnRect.top + scrollTop;
                const maxLeft = window.innerWidth + scrollLeft - popupWidth - 10;
                if (leftPos > maxLeft) leftPos = maxLeft;
                if (leftPos < 10) leftPos = 10;
                popup.style.top = topPos + 'px';
                popup.style.left = leftPos + 'px';
                popup.style.visibility = 'visible';

                if (searchInput && !searchInput.value.trim()) {
                    if (listBody) listBody.innerHTML = '<div style="padding: 30px; text-align: center; color: var(--text-muted);">输入关键词开始检索...</div>';
                    if (resultSummary) resultSummary.textContent = '';
                }
                setTimeout(() => searchInput?.focus(), 10);
            }
        }, { signal });

        // 外部点击关闭弹窗（需双击）
        document.addEventListener('click', (e: Event) => {
            const isVisible = popup.style.display === 'flex';
            if (!isVisible) return;

            const isOutside = !searchBtn.contains(e.target as Node) &&
                !popup.contains(e.target as Node) &&
                (!relatedPopup || !relatedPopup.contains(e.target as Node));

            if (isOutside) {
                outsideClickCount++;
                if (outsideClickCount >= 2) {
                    popup.style.display = 'none';
                    popup.style.visibility = 'hidden';
                    if (relatedPopup) relatedPopup.style.display = 'none';
                    outsideClickCount = 0;
                    if (outsideClickTimer) clearTimeout(outsideClickTimer);
                } else {
                    if (outsideClickTimer) clearTimeout(outsideClickTimer);
                    outsideClickTimer = setTimeout(() => { outsideClickCount = 0; }, 1500);
                }
            } else {
                outsideClickCount = 0;
                if (outsideClickTimer) clearTimeout(outsideClickTimer);
            }
        }, { signal });

        // 高级设置面板切换
        if (advBtn && advPanel) {
            advBtn.addEventListener('click', () => {
                const isHidden = advPanel.style.display === 'none';
                advPanel.style.display = isHidden ? 'block' : 'none';
                advBtn.style.color = isHidden ? 'var(--primary-color)' : '';
            }, { signal });
        }

        // 滑块同步显示值
        const syncSlider = (sliderId: string, valId: string) => {
            const slider = document.getElementById(sliderId) as HTMLInputElement | null;
            const valSpan = document.getElementById(valId);
            if (slider && valSpan) {
                valSpan.textContent = slider.value;
                slider.addEventListener('input', () => { valSpan.textContent = slider.value; }, { signal });
                slider.addEventListener('change', () => { fetchTagsData(activeKeyword.value === null); }, { signal });
            }
        };
        syncSlider('tsTopK', 'tsTopKVal');
        syncSlider('tsLimit', 'tsLimitVal');
        syncSlider('tsPopWeight', 'tsPopWeightVal');

        // 搜索输入防抖
        const debouncedFetchTagsData = debounce(() => fetchTagsData(true), 300);
        let isComposing = false;

        if (searchInput) {
            searchInput.addEventListener('compositionstart', () => { isComposing = true; }, { signal });
            searchInput.addEventListener('compositionend', () => {
                isComposing = false;
                activeKeyword.value = null;
                debouncedFetchTagsData();
            }, { signal });
            searchInput.addEventListener('input', () => {
                if (!isComposing) {
                    activeKeyword.value = null;
                    debouncedFetchTagsData();
                }
            }, { signal });
        }

        // 分词开关变化
        const smartTokenize = document.getElementById('tsSmartTokenize');
        if (smartTokenize) {
            smartTokenize.addEventListener('change', () => {
                activeKeyword.value = null;
                fetchTagsData(true);
            }, { signal });
        }

        // 分类和层级筛选变化
        document.querySelectorAll('.ts-cat, .ts-layer').forEach(cb => {
            cb.addEventListener('change', () => { fetchTagsData(activeKeyword.value === null); }, { signal });
        });

        // 返回清理函数
        return () => {
            if (abortController) {
                abortController.abort();
                abortController = null;
            }
        };
    }

    return {
        activeKeyword,
        initTagSearchPopup,
        fetchTagsData,
        renderTagList,
        fetchRelatedTags,
        renderRelatedTags,
        isTagInPrompt,
        insertTextAtCursorSafely,
        positionRelatedPopup,
    };
}
