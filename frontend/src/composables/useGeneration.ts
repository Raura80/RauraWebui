import { ref, computed, onUnmounted, readonly } from 'vue';
import { useGenerationStore } from '../stores/generation';
import { useModelsStore } from '../stores/models';
import { useTagsStore } from '../stores/tags';
import { useUserStore } from '../stores/user';
import { STORAGE_KEY_PREFIX } from '../utils/constants';
import { generate, cancelTask, getQuota, getViewImage, uploadImage } from '../services/api';
import type { GenerateRequest, QueueResponse, AdvancedGenerationParams, HistoryItem } from '../types';
import { generateRandomSeed, clamp, removeChineseCharacters, escapeRegExp } from '../utils/helpers';
import { finalizePromptForComfyUI } from '../utils/prompt';
import { useLoraConfig } from './useLoraConfig';
import { useImageCache } from './useImageCache';
import { GENERATION_DEFAULTS, PARAMS_LIMITS } from './useAdvancedSettings';

// ======================== 配置常量 ========================

// 提示词清洗开关
const REMOVE_CHINESE_CHARACTERS = true;

// 按钮文案
const BTN_TEXT_RUN = '运行';

export function useGeneration(showToastFn?: (msg: string, type: 'success' | 'error' | 'warning') => void) {
    const generationStore = useGenerationStore();
    const modelsStore = useModelsStore();
    const tagsStore = useTagsStore();
    const userStore = useUserStore();
    const loraConfig = useLoraConfig();
    const imageCache = useImageCache();

    // ======================== 响应式状态 ========================

    // 按钮状态
    const buttonText = ref(BTN_TEXT_RUN);
    const buttonClass = ref('generate-btn-compact');
    const buttonDisabled = ref(false);
    // 进度条宽度（CSS 变量 --progress-width）
    const progressWidth = ref('0%');

    // 冷却定时器
    let cooldownTimer: ReturnType<typeof setInterval> | null = null;

    // Toast 消息（供组件消费）
    const toastMessage = ref<{ message: string; type: 'success' | 'error' | 'warning' } | null>(null);

    // 图片加载完成回调（用于图生图缩略图等）
    const onImageLoaded = ref<((img: HTMLImageElement) => void) | null>(null);

    // 是否已收到当前任务的进度数据（区分"已提交但未开始"和"正在执行"）
    let hasReceivedProgress = false;

    // ======================== 计算属性 ========================

    // 是否可以取消
    const canCancel = computed(() => {
        return (generationStore.isGenerating || buttonClass.value.includes('queued'))
            && !generationStore.isTaskCompleted
            && !buttonClass.value.includes('completed');
    });

    // ======================== 冷却逻辑 ========================

    /**
     * 检查全局冷却状态
     * 返回 true 表示可以生成，false 表示冷却中
     */
    function checkGlobalCooldown(): boolean {
        if (generationStore.cooldownSeconds > 0) {
            return false;
        }

        const cooldownEndTime = localStorage.getItem(`${STORAGE_KEY_PREFIX}cooldown_end_time`);

        if (cooldownEndTime) {
            // 计算距离结束时间还有多少秒
            const remainingSeconds = Math.ceil(
                (parseInt(cooldownEndTime) - Date.now()) / 1000
            );

            if (remainingSeconds > 0) {
                buttonDisabled.value = true;
                buttonText.value = `请等待 ${remainingSeconds} 秒`;
                buttonClass.value = 'generate-btn-compact queue';
                startCooldownFrom(remainingSeconds);
                return false;
            }
        }

        // 不在冷却中，且不在生成/完成状态，恢复按钮
        if (!generationStore.isGenerating && !generationStore.isTaskCompleted) {
            buttonDisabled.value = false;
            buttonText.value = BTN_TEXT_RUN;
            buttonClass.value = 'generate-btn-compact';
        }
        return true;
    }

    /**
     * 从指定秒数开始冷却倒计时
     * 如果已在冷却中则不会重置（避免显示时间被重置）
     */
    function startCooldownFrom(seconds: number): void {
        // 如果已经在冷却中，不要重启定时器
        if (generationStore.cooldownSeconds > 0 && seconds > 0) {
            return;
        }

        generationStore.cooldownSeconds = seconds;

        if (generationStore.cooldownSeconds <= 0) {
            buttonDisabled.value = false;
            buttonText.value = BTN_TEXT_RUN;
            buttonClass.value = 'generate-btn-compact';
            generationStore.isGenerating = false;
            return;
        }

        buttonDisabled.value = true;
        cooldownTimer = setInterval(() => {
            generationStore.cooldownSeconds--;
            if (generationStore.cooldownSeconds > 0) {
                buttonText.value = `请等待 ${generationStore.cooldownSeconds} 秒`;
                buttonClass.value = 'generate-btn-compact queue';
            } else {
                // 冷却结束
                if (cooldownTimer) {
                    clearInterval(cooldownTimer);
                    cooldownTimer = null;
                }
                buttonDisabled.value = false;
                buttonText.value = BTN_TEXT_RUN;
                buttonClass.value = 'generate-btn-compact';
                generationStore.isGenerating = false;
            }
        }, 1000);
    }

    /**
     * 启动冷却（将结束时间持久化到 localStorage，刷新页面可恢复）
     */
    function startCooldown(seconds: number): void {
        const endTime = Date.now() + seconds * 1000;
        localStorage.setItem(`${STORAGE_KEY_PREFIX}cooldown_end_time`, endTime.toString());
        startCooldownFrom(seconds);
    }

    // ======================== 收集生成参数 ========================

    /**
     * 收集高级生成参数（替代原 script.js 中的 getAdvancedGenerationParams）
     * 参数来源：组件通过 v-model 绑定的值传入
     */
    function getAdvancedGenerationParams(
        options: {
            seed: number;
            steps: number;
            cfg: number;
            samplerName: string;
            scheduler: string;
            denoise: number;
            clipSkip: number;
            negativePrompt: string;
        }
    ): AdvancedGenerationParams {
        let finalSeed = options.seed;
        if (finalSeed === -1 || isNaN(finalSeed)) finalSeed = generateRandomSeed();

        const stepsVal = clamp(options.steps || GENERATION_DEFAULTS.steps, PARAMS_LIMITS.steps.min, PARAMS_LIMITS.steps.max);
        const cfgVal = clamp(options.cfg || GENERATION_DEFAULTS.cfg, PARAMS_LIMITS.cfg.min, PARAMS_LIMITS.cfg.max);
        const denoiseVal = clamp(options.denoise || GENERATION_DEFAULTS.denoise, PARAMS_LIMITS.denoise.min, PARAMS_LIMITS.denoise.max);
        const clipSkipVal = clamp(options.clipSkip ?? GENERATION_DEFAULTS.clip_skip, PARAMS_LIMITS.clip_skip.min, PARAMS_LIMITS.clip_skip.max);

        return {
            seed: finalSeed,
            steps: stepsVal,
            cfg: cfgVal,
            sampler_name: options.samplerName || GENERATION_DEFAULTS.sampler_name,
            scheduler: options.scheduler || GENERATION_DEFAULTS.scheduler,
            denoise: denoiseVal,
            clip_skip: clipSkipVal,
            negative_prompt: options.negativePrompt || '',
        };
    }

    // ======================== 核心生成逻辑 ========================

    /**
     * 主生成流程
     * @param positivePrompt 正向提示词
     * @param advancedOptions 高级参数选项
     * @param resolution 当前分辨率 { width, height }
     * @param isWsReady WebSocket 是否就绪
     * @param initWsFn 初始化 WebSocket 的函数
     */
    async function generateImage(
        positivePrompt: string,
        advancedOptions: {
            seed: number;
            steps: number;
            cfg: number;
            samplerName: string;
            scheduler: string;
            denoise: number;
            clipSkip: number;
            negativePrompt: string;
        },
        resolution: { width: number; height: number },
        isWsReadyFn: () => boolean,
        initWsFn: () => void,
    ): Promise<void> {
        if (generationStore.isGenerating) return;
        if (!checkGlobalCooldown()) return;

        // 立即标记为生成中，防止快速双击重复提交
        generationStore.isGenerating = true;
        generationStore.isCancelling = false;
        hasReceivedProgress = false; // 重置进度标记

        // 种子处理：如果 seed > 0 且不是手动设置的，重置为 -1（随机）
        // 使用局部变量，避免修改传入的参数对象
        let finalSeed = advancedOptions.seed;
        if (finalSeed > 0 && !generationStore.isSeedManuallySet) {
            finalSeed = -1;
        }

        // 注意：不重置 isTaskCompleted！原版逻辑中 isCompleted 标记不会在新生成时重置，
        // 这样 handleBinaryPreview 才能正确判断：如果主图区域已有完成的图片，
        // 新的二进制帧应显示在浮动预览窗口，而不是替换主图
        buttonDisabled.value = true;
        buttonText.value = '正在生成';
        buttonClass.value = 'generate-btn-compact progress';

        // 图生图模式：先上传图片
        if (generationStore.isImg2ImgMode && generationStore.currentInputImageFile) {
            buttonDisabled.value = true;
            buttonText.value = '正在生成';
            buttonClass.value = 'generate-btn-compact progress';
            progressWidth.value = '0%';

            try {
                const uploadResult = await uploadImage(generationStore.currentInputImageFile);
                generationStore.currentInputImageName = uploadResult.filename;
            } catch {
                resetButton();
                return;
            }
        }

        // 验证提示词
        const trimmedPrompt = positivePrompt.trim();
        if (!trimmedPrompt && !generationStore.isImg2ImgMode) {
            showToast('请输入提示词', 'error');
            resetButton();
            return;
        }

        // 收集 LoRA 列表
        const loraList = loraConfig.collectLoraSettings();

        // 获取模型信息
        const selectedModelFilename = modelsStore.selectedModelFilename;
        const modelParams = modelsStore.selectedModelParams;

        // 模型是否支持中文
        const isChineseSupportedModel = modelParams.supports_chinese === true;

        // 处理提示词：移除中文（如果模型不支持中文）
        let processedPrompt = trimmedPrompt;
        if (REMOVE_CHINESE_CHARACTERS && !isChineseSupportedModel) {
            processedPrompt = removeChineseCharacters(processedPrompt);
        }

        // 添加模型自带的正向提示词后缀
        const positiveSuffix = modelParams.positive_prompt || '';
        if (positiveSuffix) {
            const delimiter = (processedPrompt.endsWith(',') || processedPrompt.endsWith('，')) ? ' ' : ', ';
            processedPrompt = processedPrompt + delimiter + positiveSuffix;
        }

        // 最终清洗提示词为 ComfyUI 格式
        processedPrompt = finalizePromptForComfyUI(processedPrompt, isChineseSupportedModel);

        // 画师使用追踪
        if (tagsStore.artistsData.length > 0) {
            const promptLower = processedPrompt.toLowerCase();
            tagsStore.artistsData.forEach(a => {
                if (promptLower.includes(a.name.toLowerCase())) {
                    const regex = new RegExp(
                        `(^|,)\\s*${escapeRegExp(a.name)}(?=[^a-zA-Z0-9_\\-]|$)[^,]*(,|$)`,
                        'i'
                    );
                    if (regex.test(processedPrompt)) {
                        tagsStore.recordTagUsage(a.name.toLowerCase());
                    }
                }
            });
            // recordTagUsage 内部已调用 saveTagUsageFrequency
        }

        // 保存当前分类的提示词到 localStorage
        const styleCategory = modelsStore.currentStyleCategory;
        if (styleCategory === 'anime') {
            localStorage.setItem(`${STORAGE_KEY_PREFIX}anime_prompt`, trimmedPrompt);
        } else {
            localStorage.setItem(`${STORAGE_KEY_PREFIX}realistic_prompt`, trimmedPrompt);
        }

        // 验证分辨率
        if (
            resolution.width < PARAMS_LIMITS.resolution.min ||
            resolution.width > PARAMS_LIMITS.resolution.max ||
            resolution.height < PARAMS_LIMITS.resolution.min ||
            resolution.height > PARAMS_LIMITS.resolution.max
        ) {
            showToast('分辨率异常', 'error');
            resetButton();
            return;
        }

        // 获取高级参数（使用处理后的种子值）
        const advancedParams = getAdvancedGenerationParams({ ...advancedOptions, seed: finalSeed });

        try {
            // 检查 WebSocket 连接
            if (!isWsReadyFn()) {
                initWsFn();
                await new Promise(resolve => setTimeout(resolve, 300));
                // 300ms 后再次检查，如果仍然未连接则抛出错误
                if (!isWsReadyFn()) {
                    throw new Error('WebSocket 连接失败，请刷新页面重试');
                }
            }

            buttonDisabled.value = true;
            buttonClass.value = 'generate-btn-compact progress';
            progressWidth.value = '0%';
            generationStore.clearActivePromptIds();
            // 重置 outputFilename 确保 watch 能正确触发，但不重置 isTaskCompleted
            // （原版逻辑：isCompleted 不在新生成时重置，以便 handleBinaryPreview 判断
            //  主图区域是否已有完成的图片，决定二进制帧显示在浮动预览还是主图区域）
            generationStore.outputFilename = null;

            // 保存当前分类的提示词到 localStorage

            // 生成前检查额度
            if (!userStore.clientId) {
                showToast('用户身份未初始化，请刷新页面', 'error');
                return;
            }
            try {
                const quotaData = await getQuota(userStore.clientId, selectedModelFilename);
                const modelCost = quotaData.model_cost || 1;
                const maxPossible = Math.floor(quotaData.quota / modelCost);
                if (maxPossible <= 0) {
                    showToast(`额度不足，当前点数: ${quotaData.quota}，需要: ${modelCost}`, 'error');
                    resetButton();
                    fetchUserQuota();
                    return;
                }
            } catch (e) {
                showToast('额度检查失败，可能余额不足', 'warning');
            }

            // 构建任务 ID
            const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

            // 构建请求载荷
            const payload: GenerateRequest = {
                custom_task_id: taskId,
                client_id: userStore.clientId,
                comfyui_session_id: userStore.comfyuiSessionId,  // 独立的 ComfyUI 会话 ID
                prompt: processedPrompt,
                negative_prompt: advancedParams.negative_prompt,
                ckpt_name: selectedModelFilename,
                model_name: modelsStore.selectedModelDisplayName, // 传递模型展示名，用于后端精确匹配
                clip_name: modelsStore.selectedClipName || null,
                vae_name: modelsStore.selectedVaeName || null,
                style: styleCategory,
                lora_list: loraList,
                width: resolution.width,
                height: resolution.height,
                seed: advancedParams.seed,
                steps: advancedParams.steps,
                cfg: advancedParams.cfg,
                sampler_name: advancedParams.sampler_name,
                scheduler: advancedParams.scheduler,
                denoise: advancedParams.denoise,
                input_image: generationStore.isImg2ImgMode ? generationStore.currentInputImageName : null,
                use_tagger: generationStore.isImg2ImgMode ? (generationStore.taggerEnabled ?? false) : false,
                use_controlnet: generationStore.isImg2ImgMode ? (generationStore.poseEnabled ?? false) : false,
                clip_skip: advancedParams.clip_skip,
            };

            // 保存当前任务状态
            generationStore.currentCustomTaskId = taskId;
            generationStore.lastSubmittedPayload = JSON.parse(JSON.stringify(payload));
            generationStore.tempCurrentGenerationParams = {
                ...payload,
                original_prompt: trimmedPrompt,
                model_display_name: modelsStore.selectedModelDisplayName,
            };

            // 提交生成请求
            try {
                await generate(payload);
            } catch (error: any) {
                if (!generationStore.isGenerating) return;
                // API 调用失败，清除任务 ID 防止残留
                generationStore.currentCustomTaskId = null;
                const errMsg = error?.message || '生成失败';
                if (error?.status === 429) {
                    // 冷却中，从后端响应中获取剩余秒数
                    const remaining = error?.data?.detail?.remaining || error?.data?.remaining;
                    if (remaining && remaining > 0) {
                        startCooldown(remaining);
                    } else {
                        showToast(errMsg, 'warning');
                    }
                } else if (error?.status === 403) {
                    showToast('额度不足，生成失败', 'warning');
                    fetchUserQuota();
                } else {
                    showToast(errMsg, 'error');
                }
                resetButton();
            }
        } catch (error: any) {
            if (error.message && error.message.includes('Task Canceled')) return;
            showToast(error.message, 'error');
            resetButton();
        }
    }

    // ======================== 按钮点击处理 ========================

    /**
     * 生成按钮点击事件处理
     */
    function handleGenerateClick(
        generateFn: () => void,
    ): void {
        // 不在生成中且不在队列中，启动新任务
        if (!generationStore.isGenerating && !buttonClass.value.includes('queued')) {
            // 执行生成
            generateFn();
        }
    }

    // ======================== 进度与队列更新 ========================

    /**
     * 更新进度条（从 WS progress 消息触发）
     */
    function updateProgress(data: { value: number; max: number }): void {
        if (!data.max || data.max === 0) return;
        const progress = Math.round((data.value / data.max) * 100);
        if (!generationStore.isTaskCompleted) {
            if (progress >= 100) return;
            hasReceivedProgress = true; // 标记已收到进度，任务确实在 ComfyUI 执行中
            buttonText.value = `${progress}%`;
            buttonClass.value = buttonClass.value
                .replace('queued', '')
                .replace('completed', '')
                .trim() + ' progress';
            buttonDisabled.value = false;
            progressWidth.value = `${progress}%`;
        }
    }

    /**
     * 更新队列状态显示（从 WS queue_update 消息触发）
     *
     * 状态优先级：
     * 1. 在后端队列 (task_queue) → 显示后端排名
     * 2. 已收到进度 (hasReceivedProgress) → 显示百分比
     * 3. 在 ComfyUI 队列中 (comfy_queue_positions) → 显示 ComfyUI 排名
     * 4. 兜底：用 ComfyUI 队列计数判断
     */
    function updateQueueStatus(data: QueueResponse): void {
        if (!data?.task_queue) return;

        const comfyPositions = data.comfy_queue_positions || {};

        // 非生成状态 → 不显示队列
        if (generationStore.isTaskCompleted || (!generationStore.isGenerating && generationStore.cooldownSeconds <= 0)) {
            buttonClass.value = buttonClass.value.replace('queued', '').trim();
            return;
        }

        if (!generationStore.isGenerating || !generationStore.currentCustomTaskId) return;

        const myId = generationStore.currentCustomTaskId;
        const queueIndex = data.task_queue.indexOf(myId);
        const isRunning = data.running_ids.includes(myId);
        const myComfyPos = comfyPositions[myId];  // 0=执行中, >0=排队位置, -1/undefined=不在队列

        // 1. 在后端队列中 → 显示后端排名（index+1）
        if (queueIndex !== -1) {
            setQueuedState(`队列中: ${queueIndex + 1}`);
            return;
        }

        // 2. 已收到进度 → ComfyUI 正在执行，确保显示进度
        if (hasReceivedProgress) {
            if (buttonClass.value.includes('queued')) {
                buttonClass.value = buttonClass.value.replace('queued', '').trim() + ' progress';
            }
            return;
        }

        // 3. ComfyUI 队列中有明确位置
        if (myComfyPos !== undefined && myComfyPos > 0) {
            // 在 ComfyUI pending 队列中，显示实际排名
            setQueuedState(`队列中: ${myComfyPos}`);
            return;
        }

        if (myComfyPos === 0) {
            // 在 ComfyUI running 队列中，但还没收到进度 → 即将开始
            setQueuedState('准备中...');
            return;
        }

        // 4. 兜底：comfy_queue_positions 中没有数据（limbo 态）
        const comfyPending = data.queue_pending_count || 0;
        const comfyRunning = data.queue_running_count || 0;

        if (isRunning && comfyPending > 0) {
            setQueuedState(`队列中: ${comfyPending}`);
        } else if (comfyRunning > 0) {
            if (buttonClass.value.includes('queued')) {
                buttonClass.value = buttonClass.value.replace('queued', '').trim() + ' progress';
                if (!buttonText.value.includes('%')) {
                    buttonText.value = '0%';
                    progressWidth.value = '0%';
                }
            }
        }
    }

    /** 设置按钮为"队列中"样式 */
    function setQueuedState(text: string): void {
        buttonClass.value = buttonClass.value
            .replace('progress', '')
            .replace('completed', '')
            .replace('queued', '')
            .trim() + ' queued';
        buttonDisabled.value = false;
        buttonText.value = text;
    }

    // ======================== 获取生成结果 ========================

    /**
     * 获取生成的图片并添加到历史记录
     */
    async function fetchResult(filename: string, promptId?: string): Promise<void> {
        if (!filename) {
            showToast('获取图片失败', 'error');
            resetButton();
            return;
        }

        try {
            const pid = promptId || generationStore.currentPromptId;
            const { blob, cooldownHeader } = await getViewImage(filename, pid ?? undefined);

            // 解析冷却时间（校验 NaN），0 表示无冷却
            let dynamicCooldown = cooldownHeader ? parseInt(cooldownHeader, 10) : 0;
            if (isNaN(dynamicCooldown) || dynamicCooldown < 0) dynamicCooldown = 0;

            const imageUrl = URL.createObjectURL(blob);

            // 加载图片获取尺寸
            const tempImg = new Image();
            // 添加超时保护，防止图片加载永远不触发 onload
            const imgTimeout = setTimeout(() => {
                tempImg.onload = null;
                URL.revokeObjectURL(imageUrl);
                showToast('图片加载超时，请重试', 'error');
                resetButton();
            }, 10000);
            tempImg.onload = function () {
                clearTimeout(imgTimeout);
                // 更新 store 状态（使用安全方法释放旧 Object URL）
                generationStore.setCurrentImageUrl(imageUrl);

                // 隐藏浮动预览窗口
                generationStore.isLivePreviewVisible = false;
                generationStore.setLivePreviewUrl(null);

                generationStore.isTaskCompleted = true;
                // 设置 hasCompletedImage = true（对应原版 resultImage.dataset.isCompleted = 'true'）
                // 这个标记不会被 1.5 秒超时重置，用于 handleBinaryPreview 判断路由
                generationStore.hasCompletedImage = true;
                buttonText.value = '生成完成';
                buttonClass.value = 'generate-btn-compact completed';
                buttonDisabled.value = true;

                // 刷新额度
                fetchUserQuota();

                // 0.5 秒后进入冷却（使用后端返回的动态冷却时间）
                setTimeout(() => {
                    generationStore.isTaskCompleted = false;
                    generationStore.isGenerating = false;
                    if (dynamicCooldown > 0) {
                        startCooldown(dynamicCooldown);
                    } else {
                        resetButton();
                    }
                }, 500);

                // 添加到历史记录（存入 IndexedDB，不再使用 localStorage）
                const imageData: HistoryItem = {
                    url: imageUrl,
                    filename: filename,
                    timestamp: Date.now(),
                    generation_params: generationStore.tempCurrentGenerationParams,
                    prompt: generationStore.tempCurrentGenerationParams?.original_prompt || generationStore.tempCurrentGenerationParams?.prompt || '',
                    style: modelsStore.currentStyleCategory,
                    width: tempImg.naturalWidth,
                    height: tempImg.naturalHeight,
                };
                // 将图片 blob 和元数据存入 IndexedDB
                imageCache.saveHistoryItem(
                    {
                        filename: imageData.filename,
                        timestamp: imageData.timestamp,
                        generation_params: imageData.generation_params,
                        prompt: imageData.prompt,
                        style: imageData.style,
                        width: imageData.width,
                        height: imageData.height,
                    },
                    blob,
                ).then(async () => {
                    // 存储成功后刷新内存中的历史列表
                    const metaList = await imageCache.loadAllHistory();
                    generationStore.imageHistory = metaList;
                    generationStore.currentHistoryIndex = 0;
                }).catch(err => {
                    console.warn('保存历史记录到 IndexedDB 失败:', err);
                });

                // 触发图片加载回调
                if (onImageLoaded.value) {
                    onImageLoaded.value(tempImg);
                }
            };
            tempImg.src = imageUrl;
        } catch (error) {
            showToast('获取图片失败', 'error');
            resetButton();
        }
    }

    // ======================== 取消任务 ========================

    /**
     * 取消当前正在执行的任务
     */
    async function cancelCurrentTask(): Promise<void> {
        if (generationStore.isCancelling) return;
        generationStore.isCancelling = true;
        buttonDisabled.value = true;

        try {
            if (generationStore.currentCustomTaskId) {
                const data = await cancelTask({ custom_task_id: generationStore.currentCustomTaskId });
                if (data.status === 'canceled' || data.status === 'interrupted') {
                    showToast('任务已终止', 'warning');
                    generationStore.isTaskCompleted = false;
                    generationStore.isGenerating = false;
                    generationStore.clearActivePromptIds();
                    resetButton();
                } else {
                    showToast('操作失败', 'warning');
                    buttonDisabled.value = false;
                }
            }
            generationStore.isCancelling = false;
        } catch {
            showToast('终止失败', 'error');
            buttonDisabled.value = false;
            generationStore.isCancelling = false;
        }
    }

    // ======================== 重置按钮状态 ========================

    /**
     * 重置生成按钮到初始状态
     */
    function resetButton(): void {
        generationStore.currentCustomTaskId = null;
        hasReceivedProgress = false; // 重置进度标记
        buttonClass.value = buttonClass.value.replace('queued', '').trim();

        if (generationStore.cooldownSeconds <= 0 && !generationStore.isTaskCompleted) {
            buttonDisabled.value = false;
            buttonText.value = BTN_TEXT_RUN;
            buttonClass.value = 'generate-btn-compact';
        }

        generationStore.isGenerating = false;
        generationStore.isTaskCompleted = false;
    }

    // ======================== 额度查询 ========================

    /**
     * 查询用户额度并更新 store
     */
    async function fetchUserQuota(): Promise<void> {
        if (!userStore.clientId) return;
        try {
            const data = await getQuota(userStore.clientId);
            userStore.setQuota(data.quota);
        } catch (e) {
        }
    }

    // ======================== Toast 消息 ========================

    /**
     * 显示 Toast 消息（使用外部传入的 showToast 函数，或降级到本地 toastMessage）
     */
    function showToast(message: string, type: 'success' | 'error' | 'warning' = 'success'): void {
        if (showToastFn) {
            showToastFn(message, type);
        } else {
            // 降级：设置本地 toastMessage
            toastMessage.value = { message, type };
            setTimeout(() => {
                if (toastMessage.value?.message === message) {
                    toastMessage.value = null;
                }
            }, 6000);
        }
    }

    // ======================== 清理 ========================

    onUnmounted(() => {
        if (cooldownTimer) {
            clearInterval(cooldownTimer);
            cooldownTimer = null;
        }
    });

    return {
        // 按钮状态
        buttonText: readonly(buttonText),
        buttonClass: readonly(buttonClass),
        buttonDisabled: readonly(buttonDisabled),
        progressWidth: readonly(progressWidth),
        canCancel,

        // Toast 消息
        toastMessage: readonly(toastMessage),

        // 图片加载回调
        onImageLoaded,

        // 核心方法
        generateImage,
        handleGenerateClick,
        cancelCurrentTask,
        resetButton,
        fetchResult,

        // 进度与队列
        updateProgress,
        updateQueueStatus,

        // 冷却
        checkGlobalCooldown,
        startCooldown,
        startCooldownFrom,

        // 额度
        fetchUserQuota,

        // Toast
        showToast,

        // 常量（供组件使用）
        GENERATION_DEFAULTS,
        PARAMS_LIMITS,
        BTN_TEXT_RUN,
    };
}
