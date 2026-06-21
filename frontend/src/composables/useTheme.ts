import { ref } from 'vue';

/** 可用主题列表：日间(light) / 夜间(dark) */
const COLOR_THEMES = ['light', 'dark'] as const;
type ThemeName = typeof COLOR_THEMES[number];

/**
 * 主题切换 composable
 * 管理日间 / 夜间 两种主题的切换与持久化
 * 默认日间主题，首次访问时检测系统暗色偏好
 */
export function useTheme() {
    // 当前主题索引，默认 0（日间）
    const currentThemeIndex = ref<number>(0);

    /**
     * 获取当前主题的显示名称
     */
    function getCurrentThemeName(): string {
        return COLOR_THEMES[currentThemeIndex.value] === 'dark' ? '夜间' : '日间';
    }

    /**
     * 切换主题
     * 在 light ↔ dark 之间循环切换，并持久化到 localStorage
     */
    function switchTheme(): void {
        const nextIndex = (currentThemeIndex.value + 1) % COLOR_THEMES.length;
        currentThemeIndex.value = nextIndex;

        // 更新 body 的 CSS 类
        const body = document.body;
        body.classList.remove('theme-dark');
        if (COLOR_THEMES[currentThemeIndex.value] === 'dark') {
            body.classList.add('theme-dark');
        }

        // 持久化当前主题
        localStorage.setItem('colorTheme', COLOR_THEMES[currentThemeIndex.value]);
    }

    /**
     * 初始化主题
     * 从 localStorage 恢复上次选择的主题
     * 首次访问时检测系统暗色偏好
     */
    function initTheme(): void {
        const savedTheme = localStorage.getItem('colorTheme');

        if (savedTheme && COLOR_THEMES.includes(savedTheme as ThemeName)) {
            // 从 localStorage 恢复
            currentThemeIndex.value = COLOR_THEMES.indexOf(savedTheme as ThemeName);
        } else {
            // 首次访问：检测系统暗色偏好
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            currentThemeIndex.value = prefersDark ? 1 : 0;
            localStorage.setItem('colorTheme', COLOR_THEMES[currentThemeIndex.value]);
        }

        // 应用主题到 body
        const body = document.body;
        body.classList.remove('theme-dark');
        if (COLOR_THEMES[currentThemeIndex.value] === 'dark') {
            body.classList.add('theme-dark');
        }
    }

    return {
        currentThemeIndex,
        COLOR_THEMES,
        getCurrentThemeName,
        switchTheme,
        initTheme,
    };
}
