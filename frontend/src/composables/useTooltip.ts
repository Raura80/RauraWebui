import { ref, onUnmounted } from 'vue';
import { getDailyGift } from '../services/api';

/** 获取当前主题的 CSS 变量值 */
function getThemeVar(name: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * 提示气泡轮播 composable
 * 在生成按钮旁显示轮播提示信息，支持自动轮播
 * 每日赠礼兑换码作为一条消息参与轮播
 */

// 基础提示消息列表
const BASE_MESSAGES = [
    '从每日赠礼兑换码获取的生图点数额度，不能超过99点哦！但常规来源兑换码的额度没有上限。',
    '你知道吗？有些LoRA需要触发词才能生效。',
    '生成的图片质量还不错？试着使用保存为预设功能吧！',
    '已保存的预设无法删除！但你可以取相同名字来覆盖它。',
    '右上角的星星按钮可以切换主题。',
];

export function useTooltip() {
    // 当前显示的提示索引
    const currentTooltipIndex = ref(0);
    // 轮播定时器
    const tooltipInterval = ref<ReturnType<typeof setInterval> | null>(null);
    // 当前消息列表（基础消息 + 可能的每日赠礼）
    const messages = ref<string[]>([...BASE_MESSAGES]);

    /**
     * 检查气泡是否应该可见
     * 桌面端（>1200px）：根据容器宽度判断是否有足够空间显示固定宽度气泡
     * 移动端（≤1200px）：始终显示，气泡会自适应宽度
     */
    function checkTooltipVisibility(): void {
        const tooltipBubble = document.getElementById('tooltipBubble');
        const container = document.querySelector('.generate-button-container') as HTMLElement | null;
        const generateBtn = document.getElementById('generateBtn');
        if (!tooltipBubble || !container || !generateBtn) return;

        const isMobile = window.innerWidth <= 1200;

        if (isMobile) {
            // 移动端始终显示气泡，由 CSS flex 布局自适应宽度
            tooltipBubble.style.display = 'flex';
        } else {
            // 桌面端：检查是否有足够空间放固定宽度气泡
            const containerWidth = container.offsetWidth;
            const buttonWidth = generateBtn.offsetWidth;
            const tooltipWidth = 360;
            const gap = 15;
            const requiredWidth = buttonWidth + tooltipWidth + gap + 20;

            tooltipBubble.style.display = containerWidth >= requiredWidth ? 'flex' : 'none';
        }
    }

    /**
     * 更新气泡内容，带淡入淡出动画
     */
    function updateTooltipContent(): void {
        const tooltipContent = document.getElementById('tooltipContent');
        const tooltipBubble = document.getElementById('tooltipBubble');
        if (!tooltipContent || !tooltipBubble) return;

        // 先检查可见性
        checkTooltipVisibility();
        if (tooltipBubble.style.display === 'none') return;

        // 淡出 → 更新内容 → 淡入
        tooltipBubble.style.opacity = '0.7';
        setTimeout(() => {
            const msg = messages.value[currentTooltipIndex.value];
            // 每日赠礼消息使用高亮样式
            if (msg.startsWith('每日赠礼：')) {
                const code = msg.replace('每日赠礼：', '');
                tooltipContent.innerHTML = `每日赠礼： <span class="daily-gift-code">${code}</span>`;
            } else {
                tooltipContent.textContent = msg;
            }
            tooltipBubble.style.opacity = '1';
        }, 300);
    }

    /**
     * 从后端拉取当日赠礼兑换码，注入消息列表
     */
    async function fetchDailyGiftCode(): Promise<void> {
        try {
            const data = await getDailyGift();
            if (data.token_code) {
                // 插入到消息列表开头参与轮播
                const giftMsg = `每日赠礼：${data.token_code}`;
                if (!messages.value.includes(giftMsg)) {
                    messages.value = [giftMsg, ...BASE_MESSAGES];
                }
            }
        } catch {
            // 拉取失败不影响正常使用，静默忽略
        }
    }

    /**
     * 移除每日赠礼消息（兑换后调用）
     */
    function removeDailyGiftCode(): void {
        messages.value = messages.value.filter(m => !m.startsWith('每日赠礼：'));
        // 修正索引越界
        if (currentTooltipIndex.value >= messages.value.length) {
            currentTooltipIndex.value = 0;
        }
        updateTooltipContent();
    }

    /**
     * 初始化气泡提示轮播
     * 启动自动轮播定时器，绑定悬浮效果，拉取每日赠礼兑换码
     */
    function initTooltipBubble(): void {
        // 首次检查可见性并更新内容
        checkTooltipVisibility();
        updateTooltipContent();

        // 每 10 秒自动切换到下一条提示
        tooltipInterval.value = setInterval(() => {
            currentTooltipIndex.value = (currentTooltipIndex.value + 1) % messages.value.length;
            updateTooltipContent();
        }, 10000);

        // 绑定气泡交互事件（移除点击切换，方便用户选中复制兑换码）
        const tooltipBubble = document.getElementById('tooltipBubble');
        if (tooltipBubble) {
            // 悬浮效果：上移 + 加深阴影
            tooltipBubble.addEventListener('mouseenter', () => {
                tooltipBubble.style.transform = 'translateY(-2px)';
                tooltipBubble.style.boxShadow = '0 6px 20px ' + getThemeVar('--shadow-color');
            });

            // 离开恢复
            tooltipBubble.addEventListener('mouseleave', () => {
                tooltipBubble.style.transform = 'translateY(0)';
                tooltipBubble.style.boxShadow = '0 4px 15px ' + getThemeVar('--shadow-color');
            });
        }

        // 窗口大小变化时重新检查可见性
        window.addEventListener('resize', checkTooltipVisibility);

        // 拉取当日赠礼兑换码
        fetchDailyGiftCode();
    }

    /**
     * 清理定时器和事件监听
     */
    function cleanup(): void {
        if (tooltipInterval.value) {
            clearInterval(tooltipInterval.value);
            tooltipInterval.value = null;
        }
        window.removeEventListener('resize', checkTooltipVisibility);
    }

    // 组件卸载时自动清理
    onUnmounted(cleanup);

    return {
        currentTooltipIndex,
        messages,
        initTooltipBubble,
        removeDailyGiftCode,
        fetchDailyGiftCode,
        checkTooltipVisibility,
        updateTooltipContent,
        cleanup,
    };
}
