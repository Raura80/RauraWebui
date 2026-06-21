import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export const useGenerationStore = defineStore('generation', () => {
    // 生成任务状态
    const isGenerating = ref(false);
    const isTaskCompleted = ref(false);
    const isCancelling = ref(false);
    const currentPromptId = ref<string | null>(null);
    const currentCustomTaskId = ref<string | null>(null);
    const outputFilename = ref<string | null>(null);
    const cooldownSeconds = ref(0);
    const activePromptIds = ref(new Set<string>());

    // 图片与历史
    const currentImageUrl = ref<string | null>(null);
    const currentHistoryIndex = ref(-1);
    const imageHistory = ref<Array<any>>([]);
    const lastSubmittedPayload = ref<Record<string, any> | null>(null);

    // 临时生成参数
    const tempCurrentGenerationParams = ref<Record<string, any>>({});

    // 图生图状态
    const isImg2ImgMode = ref(false);
    const currentInputImageFile = ref<File | null>(null);
    const currentInputImageName = ref<string | null>(null);
    const lastUploadedFile = ref<File | null>(null);

    // 种子手动设置标记
    const isSeedManuallySet = ref(false);

    // Tagger / ControlNet 开关（图生图模式下使用）
    const taggerEnabled = ref(true);
    const poseEnabled = ref(false);

    // 浮动预览状态（生成完成后，后续二进制帧显示为可拖拽的浮动预览）
    const livePreviewUrl = ref<string | null>(null);
    const isLivePreviewVisible = ref(false);
    const livePreviewWidth = ref(0);
    const livePreviewHeight = ref(0);
    // 浮动预览初始位置（视口坐标）
    const livePreviewLeft = ref<string>('');
    const livePreviewTop = ref<string>('');

    // 主图区域是否有已完成的图片（对应原版 resultImage.dataset.isCompleted）
    // 这个标记在 fetchResult 完成时设为 true，不会被 1.5 秒超时重置
    // 用于 handleBinaryPreview 判断：如果主图区域已有完成的图片，新的二进制帧显示在浮动预览窗口
    const hasCompletedImage = ref(false);

    // 计算属性
    const isButtonDisabled = computed(() => isGenerating.value && !isTaskCompleted.value);

    // Actions
    function setGenerating(value: boolean) {
        isGenerating.value = value;
    }

    function setTaskCompleted(value: boolean) {
        isTaskCompleted.value = value;
    }

    function addActivePromptId(id: string) {
        activePromptIds.value.add(id);
    }

    function removeActivePromptId(id: string) {
        activePromptIds.value.delete(id);
    }

    function clearActivePromptIds() {
        activePromptIds.value.clear();
    }

    function resetGenerationState() {
        // 释放浮动预览的 Object URL（预览 URL 不走缓存，需手动释放）
        revokeLivePreviewUrl();
        // 重置所有生成相关状态
        // 注意：currentImageUrl 的 blob URL 由 blobUrlCache 管理，此处不 revoke
        currentCustomTaskId.value = null;
        currentPromptId.value = null;
        outputFilename.value = null;
        isGenerating.value = false;
        isTaskCompleted.value = false;
        isCancelling.value = false;
        cooldownSeconds.value = 0;
        currentImageUrl.value = null;
        livePreviewUrl.value = null;
        isLivePreviewVisible.value = false;
        hasCompletedImage.value = false;
        activePromptIds.value.clear();
    }

    // 安全设置图片 URL
    // 注意：blob URL 的生命周期由 useImageCache 的 blobUrlCache 统一管理，
    // 此处不再自行 revoke，避免释放缓存中仍在使用的 URL
    function setCurrentImageUrl(url: string | null) {
        currentImageUrl.value = url;
    }

    // 安全设置预览 URL（先释放旧的 Object URL）
    function setLivePreviewUrl(url: string | null) {
        revokeLivePreviewUrl();
        livePreviewUrl.value = url;
    }

    function revokeLivePreviewUrl() {
        if (livePreviewUrl.value && livePreviewUrl.value.startsWith('blob:')) {
            URL.revokeObjectURL(livePreviewUrl.value);
        }
    }

    return {
        isGenerating,
        isTaskCompleted,
        isCancelling,
        currentPromptId,
        currentCustomTaskId,
        outputFilename,
        cooldownSeconds,
        activePromptIds,
        currentImageUrl,
        currentHistoryIndex,
        imageHistory,
        lastSubmittedPayload,
        tempCurrentGenerationParams,
        isImg2ImgMode,
        currentInputImageFile,
        currentInputImageName,
        lastUploadedFile,
        isSeedManuallySet,
        taggerEnabled,
        poseEnabled,
        livePreviewUrl,
        isLivePreviewVisible,
        livePreviewWidth,
        livePreviewHeight,
        livePreviewLeft,
        livePreviewTop,
        hasCompletedImage,
        isButtonDisabled,
        setGenerating,
        setTaskCompleted,
        addActivePromptId,
        removeActivePromptId,
        clearActivePromptIds,
        resetGenerationState,
        setCurrentImageUrl,
        setLivePreviewUrl,
        revokeLivePreviewUrl,
    };
});
