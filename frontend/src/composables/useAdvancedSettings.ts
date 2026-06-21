import { ref } from 'vue';
import { useGenerationStore } from '../stores/generation';
import { clamp, generateRandomSeed, setCustomSelectValue } from '../utils/helpers';
import type { AdvancedGenerationParams, GenerationDefaults, ParamsLimits } from '../types';

// 生成参数默认值（共享导出，供 useGeneration 等模块使用）
export const GENERATION_DEFAULTS: GenerationDefaults = {
    steps: 20,
    cfg: 5.0,
    sampler_name: 'euler',
    scheduler: 'normal',
    denoise: 1.0,
    clip_skip: -2,
};

// 参数范围限制（共享导出）
export const PARAMS_LIMITS: ParamsLimits = {
    resolution: { min: 512, max: 2048 },
    steps: { min: 4, max: 40 },
    cfg: { min: 1.0, max: 10.0 },
    denoise: { min: 0.1, max: 1.0 },
    clip_skip: { min: -4, max: 0 },
};

// 高级设置面板组合式函数
// 管理高级参数（种子、步数、CFG、采样器等）的 UI 交互与数据收集
export function useAdvancedSettings() {
    const generationStore = useGenerationStore();

    // 面板可见状态
    const isPanelOpen = ref(false);

    // 各参数的响应式引用
    const seed = ref(-1);
    const steps = ref(GENERATION_DEFAULTS.steps);
    const cfg = ref(GENERATION_DEFAULTS.cfg);
    const samplerName = ref(GENERATION_DEFAULTS.sampler_name);
    const scheduler = ref(GENERATION_DEFAULTS.scheduler);
    const denoise = ref(GENERATION_DEFAULTS.denoise);
    const clipSkip = ref(GENERATION_DEFAULTS.clip_skip);
    const negativePrompt = ref('');

    // 切换面板显示/隐藏
    function togglePanel(): void {
        isPanelOpen.value = !isPanelOpen.value;
    }

    // 关闭面板
    function closePanel(): void {
        isPanelOpen.value = false;
    }

    // 处理种子输入变化
    function onSeedInput(): void {
        generationStore.isSeedManuallySet = true;
    }

    // 切换随机/固定种子
    function toggleRandomSeed(): void {
        generationStore.isSeedManuallySet = true;
        const currentValue = parseInt(String(seed.value));
        // 如果当前是随机模式(-1)或无效值，则生成随机种子；否则切回随机模式
        if (currentValue === -1 || isNaN(currentValue)) {
            seed.value = generateRandomSeed();
        } else {
            seed.value = -1;
        }
    }

    // 步数变化时限制范围
    function onStepsChange(): void {
        steps.value = clamp(steps.value, PARAMS_LIMITS.steps.min, PARAMS_LIMITS.steps.max);
    }

    // CFG 变化时限制范围
    function onCfgChange(): void {
        cfg.value = clamp(cfg.value, PARAMS_LIMITS.cfg.min, PARAMS_LIMITS.cfg.max);
    }

    // Denoise 变化时限制范围
    function onDenoiseChange(): void {
        denoise.value = clamp(denoise.value, PARAMS_LIMITS.denoise.min, PARAMS_LIMITS.denoise.max);
    }

    // Clip Skip 变化时限制范围
    function onClipSkipChange(): void {
        clipSkip.value = clamp(clipSkip.value, PARAMS_LIMITS.clip_skip.min, PARAMS_LIMITS.clip_skip.max);
    }

    // 收集所有高级参数，用于生成请求
    function getAdvancedGenerationParams(): AdvancedGenerationParams {
        // 种子为 -1 时生成随机值
        let finalSeed = parseInt(String(seed.value));
        if (finalSeed === -1 || isNaN(finalSeed)) finalSeed = generateRandomSeed();

        return {
            seed: finalSeed,
            steps: clamp(parseInt(String(steps.value)) || 20, PARAMS_LIMITS.steps.min, PARAMS_LIMITS.steps.max),
            cfg: clamp(parseFloat(String(cfg.value)) || 5.0, PARAMS_LIMITS.cfg.min, PARAMS_LIMITS.cfg.max),
            sampler_name: samplerName.value || 'euler',
            scheduler: scheduler.value || 'normal',
            denoise: clamp(parseFloat(String(denoise.value)) || 1.0, PARAMS_LIMITS.denoise.min, PARAMS_LIMITS.denoise.max),
            clip_skip: clamp(parseInt(String(clipSkip.value)) ?? -2, PARAMS_LIMITS.clip_skip.min, PARAMS_LIMITS.clip_skip.max),
            negative_prompt: negativePrompt.value || '',
        };
    }

    // 从参数对象恢复 UI 状态（如切换模型时应用模型默认参数）
    function updateUIFromParams(params: Record<string, any> | null | undefined): void {
        if (!params) return;

        // 负面提示词
        if (params.negative_prompt !== undefined) {
            negativePrompt.value = params.negative_prompt;
        }

        // 采样器和调度器 - 使用 setCustomSelectValue 同步自定义下拉框
        setCustomSelectValue('samplerSelect', params.sampler || 'euler');
        samplerName.value = params.sampler || 'euler';
        setCustomSelectValue('schedulerSelect', params.scheduler || 'normal');
        scheduler.value = params.scheduler || 'normal';

        // 步数
        const pSteps = params.steps || 20;
        steps.value = pSteps;

        // CFG
        const pCfg = params.cfg || 5.0;
        cfg.value = pCfg;

        // Denoise
        if (params.denoise !== undefined) {
            denoise.value = params.denoise;
        }

        // Clip Skip
        if (params.clip_skip !== undefined) {
            clipSkip.value = params.clip_skip;
        } else {
            clipSkip.value = -2;
        }
    }

    return {
        // 状态
        isPanelOpen,
        seed,
        steps,
        cfg,
        samplerName,
        scheduler,
        denoise,
        clipSkip,
        negativePrompt,
        // 常量
        GENERATION_DEFAULTS,
        PARAMS_LIMITS,
        // 方法
        togglePanel,
        closePanel,
        onSeedInput,
        toggleRandomSeed,
        onStepsChange,
        onCfgChange,
        onDenoiseChange,
        onClipSkipChange,
        getAdvancedGenerationParams,
        updateUIFromParams,
    };
}
