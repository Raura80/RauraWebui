import { ref, computed } from 'vue';
import { useGenerationStore } from '../stores/generation';
import { useModelsStore } from '../stores/models';
import { useUserStore } from '../stores/user';
import { useImageCache, type HistoryMeta } from './useImageCache';
import { useLoraConfig } from './useLoraConfig';
import type { HistoryItem } from '../types';

/**
 * 历史记录管理 composable
 * 管理图片生成历史的增删查改、行内导航、全屏弹窗导航、参数恢复
 *
 * 数据存储：IndexedDB（useImageCache）
 * - history_meta: 元数据（filename, timestamp, generation_params, ...）
 * - history_images: 图片 blob
 *
 * 内存状态：generationStore.imageHistory 存储 HistoryMeta[]
 * 图片 URL 按需从 IndexedDB 加载，生成 blob: URL
 */

// 参数恢复回调类型（由 App.vue 注入，用于操作 advSettings、promptInputRef、ratioSliderRef）
export interface RestoreCallbacks {
    setPrompt: (text: string) => void;
    setNegativePrompt: (text: string) => void;
    setSeed: (value: number) => void;
    updateAdvancedParams: (params: Record<string, any>) => void;
    setResolution: (width: number, height: number) => void;
}

export function useHistory() {
    const generationStore = useGenerationStore();
    const modelsStore = useModelsStore();
    const userStore = useUserStore();
    const imageCache = useImageCache();
    const loraConfig = useLoraConfig();

    // 参数恢复回调（由 App.vue 通过 setRestoreCallbacks 注入）
    let restoreCallbacks: RestoreCallbacks | null = null;

    /** 设置参数恢复回调（App.vue 初始化时调用） */
    function setRestoreCallbacks(callbacks: RestoreCallbacks): void {
        restoreCallbacks = callbacks;
    }

    // 全屏弹窗状态
    const isModalVisible = ref(false);
    const modalImageUrl = ref('');

    // 行内导航按钮状态
    const canNavigatePrev = computed(() => generationStore.currentHistoryIndex > 0);
    const canNavigateNext = computed(() =>
        generationStore.imageHistory.length - 1 > generationStore.currentHistoryIndex
    );

    /**
     * 从 IndexedDB 加载历史记录元数据
     * 自动清理过期记录
     */
    async function loadHistory(): Promise<void> {
        try {
            const metaList = await imageCache.loadAllHistory();
            generationStore.imageHistory = metaList;
        } catch (error) {
            console.error('加载历史记录失败:', error);
            generationStore.imageHistory = [];
        }
    }

    /**
     * 添加新历史记录到 IndexedDB
     * @param imageData 包含 url(blob:), filename, 元数据等
     * @param blob 图片的 Blob 对象（用于存入 IndexedDB）
     */
    async function addToHistory(imageData: HistoryItem, blob: Blob): Promise<void> {
        // 构建元数据（不含 url，url 是临时的 blob: URL）
        const meta: HistoryMeta = {
            filename: imageData.filename,
            timestamp: imageData.timestamp,
            generation_params: imageData.generation_params,
            prompt: imageData.prompt,
            style: imageData.style,
            width: imageData.width,
            height: imageData.height,
        };

        // 存入 IndexedDB（自动清理过期和超限）
        await imageCache.saveHistoryItem(meta, blob);

        // 更新内存中的列表（重新加载以保持排序和截断一致）
        await loadHistory();
    }

    /** 获取历史记录列表（用于渲染） */
    function renderHistory(): HistoryMeta[] {
        return generationStore.imageHistory as HistoryMeta[];
    }

    /**
     * 根据 filename 获取图片 URL（供组件异步加载）
     * 优先从 IndexedDB 读取 blob，生成 blob: URL
     * 回退到 /api/view?filename=xxx
     */
    async function getImageUrl(filename: string): Promise<string> {
        return imageCache.getImageUrl(filename);
    }

    /**
     * 删除指定索引的历史记录
     * 自动调整 currentHistoryIndex
     */
    async function deleteHistoryItem(index: number): Promise<void> {
        const item = generationStore.imageHistory[index] as HistoryMeta;
        if (!item) return;

        // 从 IndexedDB 删除
        await imageCache.deleteHistoryItem(item.filename);

        // 从内存列表删除
        generationStore.imageHistory.splice(index, 1);

        if (index === generationStore.currentHistoryIndex) {
            // 删除的是当前显示的记录
            if (generationStore.currentHistoryIndex >= generationStore.imageHistory.length) {
                generationStore.currentHistoryIndex = generationStore.imageHistory.length - 1;
            }
            if (generationStore.currentHistoryIndex >= 0) {
                await displayHistoryImage(generationStore.imageHistory[generationStore.currentHistoryIndex] as HistoryMeta);
            } else {
                generationStore.setCurrentImageUrl(null);
                generationStore.currentHistoryIndex = -1;
            }
        } else if (index < generationStore.currentHistoryIndex) {
            generationStore.currentHistoryIndex--;
        }
    }

    /**
     * 行内导航（不循环，边界停止）
     * direction=-1 → 更新的方向，direction=+1 → 更旧的方向
     */
    async function navigateInlineHistory(direction: number): Promise<void> {
        if (generationStore.imageHistory.length <= 1) return;
        const newIndex = generationStore.currentHistoryIndex + direction;
        if (newIndex < 0 || newIndex >= generationStore.imageHistory.length) return;
        generationStore.currentHistoryIndex = newIndex;
        const item = generationStore.imageHistory[newIndex] as HistoryMeta;
        if (item) await displayHistoryImage(item, newIndex);
    }

    /** 更新行内导航按钮的可用状态 */
    function updateInlineNavigation(): { canPrev: boolean; canNext: boolean; visible: boolean } {
        const hasImage = !!generationStore.currentImageUrl;
        const visible = generationStore.imageHistory.length > 0 && hasImage;
        return {
            canPrev: canNavigatePrev.value,
            canNext: canNavigateNext.value,
            visible,
        };
    }

    /**
     * 全屏弹窗导航（循环），同时恢复参数
     */
    async function navigateModalHistory(direction: number): Promise<void> {
        if (generationStore.imageHistory.length === 0) return;
        let newIndex = generationStore.currentHistoryIndex + direction;
        if (newIndex < 0) newIndex = generationStore.imageHistory.length - 1;
        else if (newIndex >= generationStore.imageHistory.length) newIndex = 0;
        generationStore.currentHistoryIndex = newIndex;
        const item = generationStore.imageHistory[newIndex] as HistoryMeta;
        if (item) {
            modalImageUrl.value = await imageCache.getImageUrl(item.filename);
            // 恢复该历史记录的生成参数
            restoreParameters(item);
        }
    }

    /** 打开全屏弹窗，同时恢复参数 */
    async function showImageModal(imageUrl: string): Promise<void> {
        modalImageUrl.value = imageUrl;
        isModalVisible.value = true;
        document.body.style.overflow = 'hidden';
        // 定位当前图片在历史中的索引
        // 优先使用 currentHistoryIndex（已指向当前显示的图片）
        // 回退：通过 API URL 中的 filename 参数精确匹配
        let idx = generationStore.currentHistoryIndex;
        if (idx < 0 || idx >= generationStore.imageHistory.length) {
            idx = generationStore.imageHistory.findIndex(
                (item: HistoryMeta) => item.filename && imageUrl.includes(`filename=${encodeURIComponent(item.filename)}`)
            );
        }
        generationStore.currentHistoryIndex = idx !== -1 ? idx : 0;
        // 恢复该历史记录的生成参数
        if (idx !== -1) {
            const item = generationStore.imageHistory[idx] as HistoryMeta;
            if (item) restoreParameters(item);
        }
    }

    /** 关闭全屏弹窗 */
    function closeImageModal(): void {
        isModalVisible.value = false;
        document.body.style.overflow = '';
    }

    /**
     * 从历史记录恢复所有生成参数（带健壮性校验）
     * 如果历史记录中的模型/采样器/LoRA 在当前环境中不存在，则跳过该项不回溯
     */
    function restoreParameters(historyItem: HistoryMeta): void {
        if (!historyItem || !historyItem.generation_params) return;
        if (!restoreCallbacks) {
            console.warn('restoreParameters: 回调未设置，无法恢复参数');
            return;
        }

        const params = historyItem.generation_params;

        // 1. 恢复提示词
        const promptToRestore = params.original_prompt || params.prompt;
        if (promptToRestore) {
            restoreCallbacks.setPrompt(promptToRestore);
        }

        // 2. 恢复模型（校验模型是否存在于当前配置中）
        if (params.ckpt_name || params.model_display_name) {
            modelsStore.selectModelByName(params.model_display_name, params.ckpt_name);
            // 模型未找到时不回溯，保持当前模型
        }

        // 3. 恢复高级参数（采样器/调度器会校验是否存在于下拉选项中）
        const samplerVal = params.sampler_name || params.sampler;
        const schedulerVal = params.scheduler;

        // 校验采样器是否存在于当前下拉选项中
        let samplerExists = false;
        if (samplerVal) {
            const samplerOptions = document.querySelectorAll('#samplerSelect ~ .custom-options .custom-option');
            samplerExists = Array.from(samplerOptions).some(opt => (opt as HTMLElement).dataset.value === samplerVal);
        }

        // 校验调度器是否存在于当前下拉选项中
        let schedulerExists = false;
        if (schedulerVal) {
            const schedulerOptions = document.querySelectorAll('#schedulerSelect ~ .custom-options .custom-option');
            schedulerExists = Array.from(schedulerOptions).some(opt => (opt as HTMLElement).dataset.value === schedulerVal);
        }

        restoreCallbacks.updateAdvancedParams({
            steps: params.steps,
            cfg: params.cfg,
            sampler: samplerExists ? samplerVal : undefined,
            scheduler: schedulerExists ? schedulerVal : undefined,
            denoise: params.denoise,
            clip_skip: params.clip_skip,
            negative_prompt: params.negative_prompt,
        });

        // 4. 种子重置为随机（不回溯历史种子，避免生成相同图片）
        restoreCallbacks.setSeed(-1);

        // 5. 恢复 LoRA 列表（校验每个 LoRA 是否在当前 loraConfig 中存在）
        if (params.lora_list && params.lora_list.length > 0) {
            loraConfig.restoreLoraFromHistory(params.lora_list);
        } else {
            modelsStore.loraRows = [];
        }

        // 6. 恢复分辨率
        if (params.width && params.height) {
            restoreCallbacks.setResolution(params.width, params.height);
        }
    }

    /** 显示历史图片到主视图并恢复参数（从 IndexedDB 异步加载） */
    async function displayHistoryImage(item: HistoryMeta, index?: number): Promise<void> {
        if (!item) return;
        const url = await imageCache.getImageUrl(item.filename);
        generationStore.setCurrentImageUrl(url);
        if (index !== undefined) {
            generationStore.currentHistoryIndex = index;
        } else {
            const idx = generationStore.imageHistory.findIndex(
                (h: HistoryMeta) => h.filename === item.filename
            );
            if (idx !== -1) {
                generationStore.currentHistoryIndex = idx;
            }
        }
        // 恢复该历史记录的生成参数
        restoreParameters(item);
    }

    /** 清空所有历史记录 */
    async function clearHistory(): Promise<void> {
        // 释放当前显示的 Object URL
        generationStore.setCurrentImageUrl(null);
        generationStore.imageHistory = [];
        generationStore.currentHistoryIndex = -1;
        // 清空 IndexedDB
        await imageCache.clearAll();
        // 清理残留的 localStorage（旧版本可能存过）
        const oldKey = `${userStore.STORAGE_KEY_PREFIX}image_history`;
        localStorage.removeItem(oldKey);
    }

    return {
        isModalVisible,
        modalImageUrl,
        canNavigatePrev,
        canNavigateNext,
        setRestoreCallbacks,
        loadHistory,
        addToHistory,
        renderHistory,
        getImageUrl,
        deleteHistoryItem,
        navigateInlineHistory,
        updateInlineNavigation,
        navigateModalHistory,
        showImageModal,
        closeImageModal,
        restoreParameters,
        displayHistoryImage,
        clearHistory,
    };
}
