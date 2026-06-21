import { ref } from 'vue';
import { useModelsStore } from '../stores/models';
import { useGenerationStore } from '../stores/generation';
import { getModels } from '../services/api';
import type { ModelInfo } from '../types';

// 模型选项数据（用于下拉框渲染）
export interface ModelOption {
    filename: string;    // 模型文件名（作为唯一标识）
    displayName: string; // 显示名称
    category: string;    // 所属分类 key
    clip: string;        // clip 名称
    vae: string;         // vae 名称
    quotaCost: number;   // 模型点数消耗
    params: Record<string, any>; // 模型参数
}

// 模型选择组合式函数
// 管理模型列表的获取、选择和切换逻辑
export function useModelSelect() {
    const modelsStore = useModelsStore();
    const generationStore = useGenerationStore();

    // 模型选项列表（扁平化后的，用于渲染下拉框）
    const modelOptions = ref<ModelOption[]>([]);

    // 模型分组标签映射（category key -> label）
    const groupLabels = ref<Record<string, string>>({});

    // 加载状态
    const isLoading = ref(false);
    const loadError = ref<string | null>(null);

    // 从 API 获取模型数据并构建选项列表
    async function initModelSelection(): Promise<void> {
        isLoading.value = true;
        loadError.value = null;
        try {
            const data = await getModels();
            modelsStore.modelsConfig = data;

            // 扁平化模型数据为选项列表
            const options: ModelOption[] = [];
            for (const [key, groupData] of Object.entries(data)) {
                groupLabels.value[key] = groupData.label;
                for (const [name, modelData] of Object.entries(groupData.models)) {
                    let filename: string;
                    let params: Record<string, any> = {};
                    let clipName = '';
                    let vaeName = '';

                    if (typeof modelData === 'string') {
                        // 简单格式：模型名 -> 文件名
                        filename = modelData;
                    } else {
                        // 完整格式
                        filename = (modelData as ModelInfo).filename;
                        params = (modelData as ModelInfo).params || {};
                        clipName = (modelData as ModelInfo).clip || '';
                        vaeName = (modelData as ModelInfo).vae || '';
                    }

                    const quotaCost = typeof modelData !== 'string' ? ((modelData as ModelInfo).quota_cost ?? 1) : 1;

                    options.push({
                        filename,
                        displayName: name,
                        category: key,
                        clip: clipName,
                        vae: vaeName,
                        quotaCost,
                        params,
                    });
                }
            }
            modelOptions.value = options;

            // 默认选中第一个模型
            if (options.length > 0) {
                selectOption(options[0], false);
            }
        } catch (error) {
            console.error('模型列表加载失败:', error);
            loadError.value = '模型配置加载失败';
        } finally {
            isLoading.value = false;
        }
    }

    // 选择一个模型选项
    // triggerCallback: 是否触发模型变更回调（初始化时为 false）
    function selectOption(option: ModelOption, triggerCallback = true): void {
        // 图生图模式下检查模型是否支持
        if (generationStore.isImg2ImgMode && option.params.supports_img2img === false) {
            console.warn('该模型不支持图生图');
            return;
        }

        // 更新 store 中的选中状态
        modelsStore.selectedModelFilename = option.filename;
        modelsStore.selectedModelDisplayName = option.displayName;
        modelsStore.currentStyleCategory = option.category;
        modelsStore.selectedModelParams = option.params;
        modelsStore.selectedClipName = option.clip;
        modelsStore.selectedVaeName = option.vae;
        modelsStore.selectedModelQuotaCost = option.quotaCost;

        if (triggerCallback) {
            handleModelChangeLogic(option);

            // 提示支持中文的模型
            if (option.params.supports_chinese === true) {
                console.info('此模型可识别汉字输入！');
            }
        }
    }

    // 模型变更后的逻辑处理：更新参数、过滤不兼容的 LoRA
    function handleModelChangeLogic(option?: ModelOption): void {
        const currentOption = option || modelOptions.value.find(
            o => o.filename === modelsStore.selectedModelFilename
        );
        if (!currentOption) return;

        const modelParams = currentOption.params;

        // 通知高级设置更新 UI（需要通过事件或直接调用）
        // 这里返回 modelParams 供外部使用
        // 清除不兼容的 LoRA 行
        const supportedLoras: string[] = modelParams.supported_loras || [];
        if (supportedLoras.length > 0) {
            // 过滤掉不在 supported_loras 列表中的 LoRA 行
            modelsStore.loraRows = modelsStore.loraRows.filter(row =>
                supportedLoras.includes(row.displayName)
            );
        }
    }

    return {
        // 状态
        modelOptions,
        groupLabels,
        isLoading,
        loadError,
        // 方法
        initModelSelection,
        selectOption,
        handleModelChangeLogic,
    };
}
