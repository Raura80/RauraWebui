import { ref } from 'vue';
import { useTagsStore } from '../stores/tags';
import { debounce, escapeRegExp, autoResizeTextarea } from '../utils/helpers';
import { getArtistMatchScore } from '../utils/scoring';
import { useTextHistory } from './useTextHistory';
import type { ArtistItem } from '../types';

/** 获取当前主题的 CSS 变量值 */
function getThemeVar(name: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * 画师搜索面板 composable
 * 提供画师搜索、排序、星级评分、插入/移除画师名等功能
 */

// 排序评分计算常量
const USAGE_A = 10;
const USAGE_K = 10;
const USAGE_P = 1.5;

// 带扩展信息的画师行数据类型
interface ArtistRowData extends ArtistItem {
    usage: number;
    stars: number;
    matchScore: number;
    isUsed: boolean;
    defaultSortScore: number;
}

export function useArtistSearch() {
    const tagsStore = useTagsStore();
    const textHistoryManager = useTextHistory();

    // 当前排序字段和方向
    const currentSort = ref<string>('default');
    const sortAsc = ref(false);

    // AbortController 统一管理事件监听器
    let abortController: AbortController | null = null;

    /**
     * 在光标位置插入画师名
     * 自动处理逗号分隔符
     * 移动端不聚焦输入框，避免弹出键盘
     */
    function insertArtistAtCursor(textArea: HTMLTextAreaElement, text: string): void {
        const isMobile = window.innerWidth <= 768;
        if (!isMobile) {
            textArea.focus();
        }
        const currentVal = textArea.value;
        const cursorPos = isMobile ? currentVal.length : textArea.selectionStart;
        let prefix = '';
        // 如果光标前不是逗号/空格/换行，需要添加逗号分隔
        if (cursorPos > 0 && currentVal[cursorPos - 1] !== ',' && currentVal[cursorPos - 1] !== ' ' && currentVal[cursorPos - 1] !== '\n') {
            prefix = ', ';
        }
        const start = isMobile ? currentVal.length : textArea.selectionStart;
        const end = isMobile ? currentVal.length : textArea.selectionEnd;
        textArea.setRangeText(prefix + text + ', ', start, end, 'end');
        textArea.dispatchEvent(new Event('input'));
    }

    /**
     * 渲染画师列表
     * 包含搜索过滤、评分排序、星级评分、插入/移除等交互
     */
    function renderArtistList(filterText: string = ''): void {
        const searchVal = filterText.trim();
        const positivePrompt = document.getElementById('positivePrompt') as HTMLTextAreaElement | null;
        const listBody = document.getElementById('artistListBody');
        const searchInput = document.getElementById('artistSearchInput') as HTMLInputElement | null;
        if (!listBody) return;

        const promptText = positivePrompt ? positivePrompt.value : '';
        const promptTextLower = promptText.toLowerCase();

        // 遍历画师数据，计算评分和排序
        const processedData: ArtistRowData[] = [];
        for (const a of tagsStore.artistsData) {
            const matchScore = getArtistMatchScore(a, searchVal);
            // 搜索时过滤低匹配度结果
            if (searchVal && matchScore <= 30) continue;

            // 检查画师是否已在提示词中
            let isUsed = false;
            if (promptText && promptTextLower.includes(a.name.toLowerCase())) {
                const regex = new RegExp(`(^|,)\\s*${escapeRegExp(a.name)}(?=[^a-zA-Z0-9_\\-]|$)[^,]*(,|$)`, 'i');
                isUsed = regex.test(promptText);
            }

            const usage = tagsStore.tagUsageFrequency[a.name.toLowerCase()] || 0;
            const stars = tagsStore.artistStars[a.name] || 0;
            const post_count = a.post_count || 0;

            // 计算默认排序分数（综合匹配度、星级、使用频率、作品数）
            let defaultSortScore = 0;
            if (matchScore > 0 || !searchVal) {
                const starBonus = stars * 2;
                let usageBonus = 0;
                if (usage > 0) usageBonus = USAGE_A * Math.log10(1 + Math.pow(usage / USAGE_K, USAGE_P));
                const postBonus = Math.log10(Math.max(1, post_count)) * 1.5;
                defaultSortScore = matchScore + starBonus + usageBonus + postBonus;
            }

            processedData.push({
                ...a,
                usage,
                stars,
                matchScore,
                isUsed,
                defaultSortScore,
            });
        }

        // 排序逻辑
        processedData.sort((a, b) => {
            // 已使用的画师排在最前面
            if (a.isUsed !== b.isUsed) return a.isUsed ? -1 : 1;

            if (currentSort.value === 'default') {
                const diff = b.defaultSortScore - a.defaultSortScore;
                if (Math.abs(diff) > 0.001) return diff;
                return a.name.localeCompare(b.name);
            } else {
                let valA = 0, valB = 0;
                switch (currentSort.value) {
                    case 'post': valA = a.post_count || 0; valB = b.post_count || 0; break;
                    case 'usage': valA = a.usage; valB = b.usage; break;
                    case 'stars': valA = a.stars; valB = b.stars; break;
                }
                if (valA !== valB) return sortAsc.value ? (valA - valB) : (valB - valA);
                return a.name.localeCompare(b.name);
            }
        });

        // 渲染列表（限制最多 150 条）
        listBody.innerHTML = '';
        const fragment = document.createDocumentFragment();
        const renderData = processedData.slice(0, 150);

        renderData.forEach(a => {
            const row = document.createElement('div');
            row.className = 'artist-list-row';

            // 已使用的画师高亮
            if (a.isUsed) {
                row.style.backgroundColor = getThemeVar('--selected-bg');
                row.style.boxShadow = 'inset 3px 0 0 0 var(--primary-color)';
            }

            const aliases = a.other_names && a.other_names.length > 0 ? a.other_names.join(', ') : '-';

            // 星级评分 HTML
            let starsHtml = '';
            for (let i = 1; i <= 5; i++) {
                starsHtml += `<span class="star ${i <= a.stars ? 'filled' : ''}" data-val="${i}">⭐</span>`;
            }

            row.innerHTML = `
                <div class="artist-col" style="flex: 0 0 25%; overflow: hidden;">
                    <span class="artist-name" style="font-weight: 700; color: var(--primary-color); user-select: text;" title="${a.name}">${a.name}</span>
                </div>
                <div class="artist-col" style="flex: 0 0 30%; overflow: hidden;">
                    <span class="artist-alias" style="font-size: 12px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; user-select: text;" title="${aliases}">${aliases}</span>
                </div>
                <div class="artist-col num-col" style="flex: 0 0 15%; justify-content: center;">
                    <span class="data-badge">${a.post_count || 0}</span>
                </div>
                <div class="artist-col num-col" style="flex: 0 0 10%; justify-content: center;">
                    <span class="data-badge usage-badge">${a.usage}</span>
                </div>
                <div class="artist-col star-col star-rating" data-name="${a.name}" style="flex: 0 0 20%; justify-content: center;">
                    ${starsHtml}
                </div>`;

            // 记录鼠标按下位置，用于区分点击和拖拽
            let startX = 0, startY = 0;
            row.addEventListener('mousedown', (e: MouseEvent) => { startX = e.clientX; startY = e.clientY; });

            // 点击行：添加/移除画师
            row.addEventListener('click', (e: MouseEvent) => {
                const target = e.target as HTMLElement;
                // 点击星星不触发行点击
                if (target.classList.contains('star')) return;
                // 区分点击和拖拽
                if (Math.abs(e.clientX - startX) > 5 || Math.abs(e.clientY - startY) > 5) return;

                const textArea = document.getElementById('positivePrompt') as HTMLTextAreaElement | null;
                if (!textArea) return;

                const currentPrompt = textArea.value;

                if (a.isUsed) {
                    // 从提示词中移除画师名
                    const regex = new RegExp(`(^|,)\\s*${escapeRegExp(a.name)}(?=[^a-zA-Z0-9_\\-]|$)[^,]*(,|$)`, 'gi');
                    let newPrompt = currentPrompt.replace(regex, '$1$2').replace(/,+/g, ',').replace(/^,+|,+$/g, '').trim();
                    if (newPrompt !== currentPrompt) {
                        textHistoryManager.pushState(currentPrompt, textArea.selectionStart);
                        textArea.value = newPrompt;
                        textHistoryManager.pushState(newPrompt, newPrompt.length);
                        autoResizeTextarea(textArea);
                    }
                } else {
                    // 在光标位置插入画师名
                    insertArtistAtCursor(textArea, a.name);
                }

                // 闪烁动画后刷新列表
                row.classList.add('row-flash');
                setTimeout(() => {
                    row.classList.remove('row-flash');
                    if (searchInput) renderArtistList(searchInput.value);
                }, 150);
            });

            // 星级评分点击
            const starElements = row.querySelectorAll('.star');
            starElements.forEach(star => {
                star.addEventListener('click', (e: Event) => {
                    e.stopPropagation();
                    const val = parseInt((star as HTMLElement).dataset.val || '0');
                    const currentStars = tagsStore.artistStars[a.name] || 0;
                    // 再次点击相同星级则取消
                    const newStars = currentStars === val ? 0 : val;
                    tagsStore.setArtistStar(a.name, newStars);
                    // 更新星星显示
                    starElements.forEach(s => {
                        s.classList.toggle('filled', parseInt((s as HTMLElement).dataset.val || '0') <= newStars);
                    });
                });
            });

            fragment.appendChild(row);
        });

        if (renderData.length === 0) {
            listBody.innerHTML = '<div style="padding: 30px; text-align: center; color: var(--text-muted);">未找到该画师</div>';
        } else {
            listBody.appendChild(fragment);
        }
    }

    /**
     * 初始化画师搜索面板
     * 绑定搜索按钮、输入框、列头排序等事件
     */
    function initArtistSearch(): () => void {
        const searchBtn = document.getElementById('searchArtistBtn');
        const popup = document.getElementById('artistSearchPopup');
        const searchInput = document.getElementById('artistSearchInput') as HTMLInputElement | null;
        const listBody = document.getElementById('artistListBody');
        const headers = document.querySelectorAll('.artist-col');
        const positivePrompt = document.getElementById('positivePrompt') as HTMLTextAreaElement | null;

        if (!searchBtn || !popup) return () => { };

        // 创建新的 AbortController，清理旧的
        if (abortController) abortController.abort();
        abortController = new AbortController();
        const { signal } = abortController;

        // 搜索按钮点击：切换弹窗显示
        searchBtn.addEventListener('click', (e: Event) => {
            e.stopPropagation();
            const isVisible = popup.style.display === 'flex';

            if (isVisible) {
                popup.style.display = 'none';
                popup.style.visibility = 'hidden';
            } else {
                // 计算弹窗位置
                const btnRect = searchBtn.getBoundingClientRect();
                const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
                const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

                if (listBody && listBody.innerHTML === '') {
                    listBody.innerHTML = '<div style="padding: 30px; text-align: center; color: var(--text-muted);">加载中...</div>';
                }

                popup.style.visibility = 'hidden';
                popup.style.display = 'flex';
                const popupWidth = popup.offsetWidth || 650;
                let leftPos = btnRect.left + scrollLeft + (btnRect.width / 2) - (popupWidth / 2);
                if (leftPos < 10) leftPos = 10;
                const maxLeft = window.innerWidth - popupWidth - 10;
                if (leftPos > maxLeft) leftPos = maxLeft;
                popup.style.top = (btnRect.bottom + scrollTop + 10) + 'px';
                popup.style.left = leftPos + 'px';
                popup.style.visibility = 'visible';

                setTimeout(() => {
                    if (searchInput) renderArtistList(searchInput.value);
                    searchInput?.focus();
                }, 10);
            }
        }, { signal });

        // 点击外部关闭弹窗
        document.addEventListener('click', (e: Event) => {
            if (!searchBtn.contains(e.target as Node) && !popup.contains(e.target as Node)) {
                popup.style.display = 'none';
                popup.style.visibility = 'hidden';
            }
        }, { signal });

        // 搜索输入防抖
        if (searchInput) {
            searchInput.addEventListener('input', debounce((e: Event) => {
                renderArtistList((e.target as HTMLInputElement).value);
            }, 150), { signal });
        }

        // 提示词变化时刷新列表（如果弹窗可见）
        if (positivePrompt) {
            positivePrompt.addEventListener('input', debounce(() => {
                if (popup.style.display === 'flex' || popup.style.visibility === 'visible') {
                    if (searchInput) renderArtistList(searchInput.value);
                }
            }, 200), { signal });
        }

        // 列头排序点击
        headers.forEach(header => {
            const el = header as HTMLElement;
            if (!el.dataset.sort) return;
            el.addEventListener('click', () => {
                const sortKey = el.dataset.sort!;
                if (currentSort.value === sortKey) {
                    sortAsc.value = !sortAsc.value;
                } else {
                    currentSort.value = sortKey;
                    sortAsc.value = false;
                }
                headers.forEach(h => { (h as HTMLElement).style.color = ''; });
                el.style.color = 'var(--primary-color)';
                if (searchInput) renderArtistList(searchInput.value);
            }, { signal });
        });

        // 默认排序列高亮
        const defaultHeader = document.querySelector('.artist-col[data-sort="stars"]');
        if (defaultHeader) (defaultHeader as HTMLElement).style.color = 'var(--primary-color)';

        // 返回清理函数
        return () => {
            if (abortController) {
                abortController.abort();
                abortController = null;
            }
        };
    }

    return {
        currentSort,
        sortAsc,
        initArtistSearch,
        renderArtistList,
        insertArtistAtCursor,
    };
}
