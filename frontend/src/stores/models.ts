import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { ModelGroup } from '../types';

export const useModelsStore = defineStore('models', () => {
  // 模型配置数据 (从 API 获取)
  const modelsConfig = ref<Record<string, ModelGroup> | null>(null);

  // LoRA 配置数据 (从 API 获取)
  const loraConfig = ref<Record<string, { filename: string; trigger?: string; quota_cost?: number }> | null>(null);

  // 当前选中的模型分类
  const currentStyleCategory = ref('anime');

  // 当前选中的模型文件名
  const selectedModelFilename = ref('');

  // 当前选中的模型显示名称
  const selectedModelDisplayName = ref('');

  // 当前选中的模型参数
  const selectedModelParams = ref<Record<string, any>>({});

  // 当前选中的 clip 名称
  const selectedClipName = ref('');

  // 当前选中的 vae 名称
  const selectedVaeName = ref('');

  // 当前选中模型的点数消耗
  const selectedModelQuotaCost = ref(1);

  // LoRA 行数据
  const loraRows = ref<Array<{
    id: string;
    filename: string;
    displayName: string;
    strength: number;
    triggerWord: string;
    quotaCost: number;
  }>>([]);

  /**
   * 统一的模型选择方法：按 displayName 或 ckptName 查找并更新 store
   * @returns 是否找到并选中了模型
   */
  function selectModelByName(displayName?: string, ckptName?: string): boolean {
    const config = modelsConfig.value;
    if (!config) return false;

    // 优先按 displayName 匹配
    if (displayName) {
      for (const [category, group] of Object.entries(config)) {
        if (group.models && displayName in group.models) {
          const modelData = group.models[displayName];
          applyModelSelection(category, displayName, modelData);
          return true;
        }
      }
    }

    // 回退按 ckpt_name 匹配
    if (ckptName) {
      const normalizedCkpt = ckptName.replace(/\\\\/g, '\\');
      for (const [category, group] of Object.entries(config)) {
        for (const [name, modelData] of Object.entries(group.models)) {
          const filename = typeof modelData === 'string' ? modelData : modelData.filename;
          if (filename === normalizedCkpt) {
            applyModelSelection(category, name, modelData);
            return true;
          }
        }
      }
    }
    return false;
  }

  /** 内部方法：将模型数据应用到 store */
  function applyModelSelection(category: string, name: string, modelData: any): void {
    const filename = typeof modelData === 'string' ? modelData : modelData.filename;
    selectedModelFilename.value = filename;
    selectedModelDisplayName.value = name;
    currentStyleCategory.value = category;
    if (typeof modelData !== 'string') {
      selectedModelParams.value = modelData.params || {};
      selectedClipName.value = modelData.clip || '';
      selectedVaeName.value = modelData.vae || '';
      selectedModelQuotaCost.value = modelData.quota_cost ?? 1;
    }
  }

  return {
    modelsConfig,
    loraConfig,
    currentStyleCategory,
    selectedModelFilename,
    selectedModelDisplayName,
    selectedModelParams,
    selectedClipName,
    selectedVaeName,
    selectedModelQuotaCost,
    loraRows,
    selectModelByName,
  };
});
