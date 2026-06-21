<template>
    <!-- 高级设置按钮（放在模块标题区域） -->
    <button id="advancedSettingsBtn" class="advanced-settings-btn" ref="settingsBtnRef"
        :title="isPanelOpen ? '收起高级参数' : '展开高级参数'" @click="adv.togglePanel()">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 16a6 6 0 1 1 6-6 6 6 0 0 1-6 6z">
            </path>
            <path d="M12 8v4l3 3"></path>
        </svg>
        高级设置
    </button>

    <!-- 高级设置面板（原版 CSS 用 visibility:hidden + .show 类控制显隐，不用 v-show） -->
    <div id="advancedSettingsPanel" class="advanced-settings-panel" ref="panelRef" :class="{ show: isPanelOpen }">
        <div class="panel-arrow"></div>
        <div class="adv-section">
            <label class="adv-label">
                <svg class="ui-icon" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2"
                    fill="none">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="8" y1="12" x2="16" y2="12"></line>
                </svg>
                负面提示词
            </label>
            <textarea id="negativePromptInput" class="form-control adv-textarea"
                v-model="adv.negativePrompt.value"></textarea>
        </div>
        <div class="adv-divider"></div>
        <div class="adv-section">
            <!-- 种子 -->
            <div class="adv-row">
                <span class="adv-row-label" title="控制出图的确定性">
                    <svg class="ui-icon" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor"
                        stroke-width="2" fill="none">
                        <path d="M12 22c0-8 6-12 6-12s-4 1-6 5c-2-4-6-5-6-5s6 4 6 12z"></path>
                    </svg>
                    种子
                </span>
                <div class="adv-row-control seed-control">
                    <button class="icon-btn-refresh" id="randomSeedBtn" title="刷新种子" @click="adv.toggleRandomSeed">
                        <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2"
                            fill="none">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                            <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"></circle>
                            <circle cx="15.5" cy="15.5" r="1.5" fill="currentColor"></circle>
                        </svg>
                    </button>
                    <input type="number" id="seedInput" class="form-control compact-input"
                        v-model.number="adv.seed.value" placeholder="-1" @input="adv.onSeedInput">
                </div>
            </div>

            <!-- Clip Skip -->
            <div class="adv-row">
                <span class="adv-row-label" title="跳过Clip层数">
                    <svg class="ui-icon" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor"
                        stroke-width="2" fill="none">
                        <circle cx="6" cy="6" r="3"></circle>
                        <circle cx="6" cy="18" r="3"></circle>
                        <line x1="20" y1="4" x2="8.12" y2="15.88"></line>
                        <line x1="14.47" y1="14.48" x2="20" y2="20"></line>
                        <line x1="8.12" y1="8.12" x2="12" y2="12"></line>
                    </svg>
                    Clip Skip
                </span>
                <div class="adv-row-control">
                    <input type="number" id="clipSkipInput" class="form-control compact-input"
                        v-model.number="adv.clipSkip.value" max="0" min="-4" @change="adv.onClipSkipChange">
                </div>
            </div>

            <!-- 采样器 -->
            <div class="adv-row">
                <span class="adv-row-label" title="明显影响出图质量">
                    <svg class="ui-icon" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor"
                        stroke-width="2" fill="none">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                        <line x1="3" y1="9" x2="21" y2="9"></line>
                        <line x1="9" y1="21" x2="9" y2="9"></line>
                    </svg>
                    采样器
                </span>
                <div class="adv-row-control">
                    <div class="custom-select adv-custom-select" id="samplerSelectWrapper"
                        :class="{ open: samplerOpen }" ref="samplerSelectRef">
                        <div class="custom-select-trigger" @click="samplerOpen = !samplerOpen">
                            <span class="selected-text">{{ adv.samplerName.value }}</span>
                            <div class="custom-arrow"></div>
                        </div>
                        <div class="custom-options" v-show="samplerOpen">
                            <div class="custom-option" v-for="s in samplerOptions" :key="s.value"
                                :class="{ selected: s.value === adv.samplerName.value }" :data-value="s.value"
                                :title="s.title" @click="onSelectSampler(s.value)">
                                {{ s.value }}
                            </div>
                        </div>
                        <input type="hidden" id="samplerSelect" :value="adv.samplerName.value">
                    </div>
                </div>
            </div>

            <!-- 调度器 -->
            <div class="adv-row">
                <span class="adv-row-label" title="影响出图质量">
                    <svg class="ui-icon" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor"
                        stroke-width="2" fill="none">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                        <line x1="16" y1="2" x2="16" y2="6"></line>
                        <line x1="8" y1="2" x2="8" y2="6"></line>
                        <line x1="3" y1="10" x2="21" y2="10"></line>
                    </svg>
                    调度器
                </span>
                <div class="adv-row-control">
                    <div class="custom-select adv-custom-select" id="schedulerSelectWrapper"
                        :class="{ open: schedulerOpen }" ref="schedulerSelectRef">
                        <div class="custom-select-trigger" @click="schedulerOpen = !schedulerOpen">
                            <span class="selected-text">{{ adv.scheduler.value }}</span>
                            <div class="custom-arrow"></div>
                        </div>
                        <div class="custom-options" v-show="schedulerOpen">
                            <div class="custom-option" v-for="s in schedulerOptions" :key="s.value"
                                :class="{ selected: s.value === adv.scheduler.value }" :data-value="s.value"
                                :title="s.title" @click="onSelectScheduler(s.value)">
                                {{ s.value }}
                            </div>
                        </div>
                        <input type="hidden" id="schedulerSelect" :value="adv.scheduler.value">
                    </div>
                </div>
            </div>

            <!-- 步数 -->
            <div class="adv-row">
                <span class="adv-row-label" title="生成的步数，越多耗时越长">
                    <svg class="ui-icon" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor"
                        stroke-width="2" fill="none">
                        <path d="M3 21h6v-6h6v-6h6v-6"></path>
                    </svg>
                    步数
                </span>
                <div class="adv-row-control slider-row">
                    <input type="range" id="stepsSlider" class="adv-slider" min="4" max="40" step="1"
                        v-model.number="adv.steps.value" @input="adv.onStepsChange">
                    <input type="number" id="stepsNumber" class="compact-number" min="4" max="40"
                        v-model.number="adv.steps.value" @change="adv.onStepsChange">
                </div>
            </div>

            <!-- CFG -->
            <div class="adv-row">
                <span class="adv-row-label" title="提示词相关性，越高越听话，太高会崩坏">
                    <svg class="ui-icon" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor"
                        stroke-width="2" fill="none">
                        <circle cx="12" cy="12" r="10"></circle>
                        <circle cx="12" cy="12" r="6"></circle>
                        <circle cx="12" cy="12" r="2"></circle>
                    </svg>
                    CFG
                </span>
                <div class="adv-row-control slider-row">
                    <input type="range" id="cfgSlider" class="adv-slider" min="1" max="10" step="0.1"
                        v-model.number="adv.cfg.value" @input="adv.onCfgChange">
                    <input type="number" id="cfgNumber" class="compact-number" min="1" max="10" step="0.1"
                        v-model.number="adv.cfg.value" @change="adv.onCfgChange">
                </div>
            </div>

            <!-- 降噪 -->
            <div class="adv-row">
                <span class="adv-row-label" title="">
                    <svg class="ui-icon" viewBox="0 0 24 24" width="14" height="14" stroke="currentColor"
                        stroke-width="2" fill="none">
                        <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
                    </svg>
                    降噪
                </span>
                <div class="adv-row-control slider-row">
                    <input type="range" id="denoiseSlider" class="adv-slider" min="0.01" max="1.00" step="0.01"
                        v-model.number="adv.denoise.value" @input="adv.onDenoiseChange">
                    <input type="number" id="denoiseNumber" class="compact-number" min="0.01" max="1.00" step="0.01"
                        v-model.number="adv.denoise.value" @change="adv.onDenoiseChange">
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, inject } from 'vue';
import { useAdvancedSettings } from '../../composables/useAdvancedSettings';

// 通过 inject 获取 App.vue 提供的共享实例（避免多实例状态不一致）
type AdvSettingsReturn = ReturnType<typeof useAdvancedSettings>;
const adv = inject<AdvSettingsReturn>('advSettings')!;

// inject 返回的是普通对象，其中的 ref 在模板中不会自动解包，需要用计算属性
const isPanelOpen = computed(() => adv.isPanelOpen.value);

// 面板和按钮的 DOM 引用（用于点击外部关闭）
const panelRef = ref<HTMLElement | null>(null);
const settingsBtnRef = ref<HTMLElement | null>(null);

// 采样器下拉框状态
const samplerOpen = ref(false);
const samplerSelectRef = ref<HTMLElement | null>(null);

// 调度器下拉框状态
const schedulerOpen = ref(false);
const schedulerSelectRef = ref<HTMLElement | null>(null);

// 采样器选项列表（与原始 HTML 一致）
const samplerOptions = [
    { value: 'euler', title: '速度快、可预测性高，适合快速测试和生成草图。' },
    { value: 'euler_cfg_pp', title: 'Euler 的变体，针对 CFG 进行优化，画面更加纯净。' },
    { value: 'euler_ancestral', title: '祖先采样，每步会注入随机噪声。画面更具艺术感和纹理，适合创意性风格。' },
    { value: 'euler_ancestral_cfg_pp', title: '结合了祖先采样和 CFG 优化的 Euler 版本。' },
    { value: 'heun', title: '比 Euler 更稳定平滑，但每步需计算两次，出图速度慢一倍。' },
    { value: 'heunpp2', title: 'Heun 的升级版，画面更纯净，减少伪影。' },
    { value: 'exp_heun_2_x0', title: 'Heun的指数版本，优化预测步骤。' },
    { value: 'exp_heun_2_x0_sde', title: '结合随机微分方程(SDE)的 Heun 指数版本。' },
    { value: 'dpm_2', title: 'DPM第二代，质量较高但速度较慢。' },
    { value: 'dpm_2_ancestral', title: 'DPM第二代的祖先采样版本，画面更具随机性和细节。' },
    { value: 'lms', title: '线性多步法，在高步数下表现较好，速度与 Euler 相当。' },
    { value: 'dpm_fast', title: '速度极快，适合极低步数的快速预览。' },
    { value: 'dpm_adaptive', title: '自动适应步长，能自动平衡速度和质量。' },
    { value: 'dpmpp_2s_ancestral', title: 'DPM++祖先版本，创意性强，充满变化，很适合二次元动漫风格。' },
    { value: 'dpmpp_2s_ancestral_cfg_pp', title: '结合 CFG 优化的 DPM++ 2s 祖先版本。' },
    { value: 'dpmpp_sde', title: '随机微分方程版本的 DPM++，细节好，但不收敛（每次生成有细微差别）。' },
    { value: 'dpmpp_sde_gpu', title: 'GPU加速的 DPM++ SDE，提升了生成速度。' },
    { value: 'dpmpp_2m', title: '最通用、最推荐！质量和速度的平衡点，适合绝大多数场景。' },
    { value: 'dpmpp_2m_cfg_pp', title: 'CFG 优化的 DPM++ 2M，有助于提升画面纯净度。' },
    { value: 'dpmpp_2m_sde', title: '结合 SDE 的 2M 版本，在保证稳定性的同时增加更多材质细节。' },
    { value: 'dpmpp_2m_sde_gpu', title: 'GPU优化的 2M SDE，生成效率更高。' },
    { value: 'dpmpp_2m_sde_heun', title: '结合 Heun 算法的 2M SDE 版本，兼顾细节与平滑。' },
    { value: 'dpmpp_2m_sde_heun_gpu', title: 'GPU优化的 2M SDE Heun。' },
    { value: 'dpmpp_3m_sde', title: '旗舰级采样器，细节和保真度最佳，但需较高步数(>30)，速度偏慢。' },
    { value: 'dpmpp_3m_sde_gpu', title: 'GPU优化的 3M SDE。' },
    { value: 'ddpm', title: '经典去噪扩散概率模型，稳定但过时，速度很慢。' },
    { value: 'LCM', title: '必须配合 LCM 模型/LoRA 使用，4-8步即可高速出图。' },
    { value: 'ipndm', title: '改进的伪数值方法，实验性采样器，高连贯性。' },
    { value: 'ipndm_v', title: 'ipndm的变体版本。' },
    { value: 'deis', title: '在较少步数下表现优异的快速采样器。' },
    { value: 'res_multistep', title: '多步残差方法，一种基于残差连接的求解器。' },
    { value: 'res_multistep_cfg_pp', title: 'CFG优化的多步残差。' },
    { value: 'res_multistep_ancestral', title: '加入随机噪声的祖先多步残差。' },
    { value: 'res_multistep_ancestral_cfg_pp', title: 'CFG优化的祖先多步残差。' },
    { value: 'gradient_estimation', title: '梯度估计采样器。' },
    { value: 'gradient_estimation_cfg_pp', title: 'CFG优化的梯度估计。' },
    { value: 'er_sde', title: '经验复用 SDE 采样，引入更复杂的随机微分方程。' },
    { value: 'seeds_2', title: '特殊实验性采样器。' },
    { value: 'seeds_3', title: '特殊实验性采样器。' },
    { value: 'sa_solver', title: '随机近似求解器，在特定模型下能获得很好的细节。' },
    { value: 'sa_solver_pece', title: '带预测-校正机制的 sa_solver。' },
    { value: 'ddim', title: '经典且稳定，适合需要 100% 复现结果或结合 ControlNet 的场景。' },
    { value: 'uni_pc', title: '旨在用极少的步数达到极高的质量。' },
];

// 调度器选项列表（与原始 HTML 一致）
const schedulerOptions = [
    { value: 'simple', title: '极简调度，步长固定，多用于调试和极速测试环境。' },
    { value: 'sgm_uniform', title: 'SGM均匀调度，设计上与特定的模型配合，平衡降噪过程。' },
    { value: 'karras', title: '最常用！S形曲线调度，低噪声阶段保留极多细节，高质量首选。' },
    { value: 'exponential', title: '指数衰减调度，后期降噪慢，适合高步数和复杂光影内容。' },
    { value: 'ddim_uniform', title: '专为 DDIM 优化，步数分布均匀。' },
    { value: 'beta', title: '使用 Beta 分布曲线，生成平滑渐变，适合人像和柔和风格。' },
    { value: 'normal', title: '标准线性调度，噪声均匀递减，效果可预测，万金油搭配。' },
    { value: 'linear_quadratic', title: '线性二次调度，优化了部分表现。' },
    { value: 'kl_optimal', title: '基于 KL 散度优化的调度器，理论最优，但对采样器非常挑剔。' },
];

// 选择采样器
function onSelectSampler(value: string) {
    adv.samplerName.value = value;
    samplerOpen.value = false;
}

// 选择调度器
function onSelectScheduler(value: string) {
    adv.scheduler.value = value;
    schedulerOpen.value = false;
}

// 点击外部关闭下拉框和面板
function onClickOutside(e: MouseEvent) {
    if (samplerSelectRef.value && !samplerSelectRef.value.contains(e.target as Node)) {
        samplerOpen.value = false;
    }
    if (schedulerSelectRef.value && !schedulerSelectRef.value.contains(e.target as Node)) {
        schedulerOpen.value = false;
    }
    // 点击面板和按钮外部时关闭面板
    const target = e.target as Node;
    if (adv.isPanelOpen.value
        && panelRef.value && !panelRef.value.contains(target)
        && settingsBtnRef.value && !settingsBtnRef.value.contains(target)) {
        adv.closePanel();
    }
}

onMounted(() => {
    document.addEventListener('click', onClickOutside);
});

onBeforeUnmount(() => {
    document.removeEventListener('click', onClickOutside);
});

// 暴露给父组件
defineExpose({
    adv,
});
</script>
