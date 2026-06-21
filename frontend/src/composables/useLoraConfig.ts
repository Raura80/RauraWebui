import { ref } from 'vue';
import { useModelsStore } from '../stores/models';
import { getLoras } from '../services/api';
import { escapeRegExp } from '../utils/helpers';

// LoRA 行数据（与 store 中的结构一致，这里用于 composable 内部类型）
interface LoraRowData {
    id: string;
    filename: string;
    displayName: string;
    strength: number;
    triggerWord: string;
    quotaCost: number;
}

// LoRA 配置组合式函数
// 管理 LoRA 列表加载、行增删、参数收集和触发词更新
export function useLoraConfig() {
    const modelsStore = useModelsStore();

    // 加载状态
    const isLoading = ref(false);
    const loadError = ref<string | null>(null);

    // 从 API 获取 LoRA 配置数据
    async function initLoraConfig(): Promise<void> {
        isLoading.value = true;
        loadError.value = null;
        try {
            const data = await getLoras();
            modelsStore.loraConfig = data;

            // 清空现有行
            clearLoraRows();

            // 默认添加第一个支持的 LoRA
            const modelParams = modelsStore.selectedModelParams;
            const supportedLoras: string[] = modelParams?.supported_loras || [];
            if (supportedLoras.length > 0) {
                addLoraRow(supportedLoras[0], 0.8);
            }
        } catch (error) {
            console.error('LoRA 配置加载失败:', error);
            loadError.value = 'LoRA 配置加载失败';
            modelsStore.loraConfig = null;
        } finally {
            isLoading.value = false;
        }
    }

    // 添加一行 LoRA
    // defaultKey: 默认选中的 LoRA 名称；defaultStrength: 默认强度；isRestoring: 是否为恢复操作（不自动插入触发词）
    // 返回新添加行的触发词（供调用方插入提示词）
    function addLoraRow(defaultKey: string | null = null, defaultStrength = 0.8, isRestoring = false): string | null {
        const loraConfig = modelsStore.loraConfig;
        if (!loraConfig) return null;

        // 获取当前模型支持的 LoRA 列表
        const modelParams = modelsStore.selectedModelParams;
        const supportedLoras: string[] = modelParams?.supported_loras || [];

        if (modelParams?.supports_lora === false || supportedLoras.length === 0) {
            console.info('没有可用的 LoRA');
            return null;
        }

        // 收集已使用的 LoRA filename
        const usedFilenames = new Set(modelsStore.loraRows.map(row => row.filename));

        // 如果没有指定默认 key 且已用完所有 LoRA，则提示
        if (!defaultKey && usedFilenames.size >= supportedLoras.length) {
            console.info('没有更多 LoRA 可添加');
            return null;
        }

        // 确定初始选中的 LoRA
        let initialName = '';
        let initialFilename = '';
        let initialTrigger = '';
        let initialQuotaCost = 0;

        for (const name of supportedLoras) {
            const modelData = loraConfig[name];
            if (!modelData) continue;

            const filename = typeof modelData === 'string' ? modelData : modelData.filename;
            const triggerWord = typeof modelData === 'string' ? '' : (modelData.trigger || '');
            const quotaCost = typeof modelData === 'string' ? 0 : (modelData.quota_cost ?? 0);

            if (defaultKey && name === defaultKey) {
                initialName = name;
                initialFilename = filename;
                initialTrigger = triggerWord;
                initialQuotaCost = quotaCost;
                break;
            } else if (!defaultKey && !initialFilename && !usedFilenames.has(filename)) {
                initialName = name;
                initialFilename = filename;
                initialTrigger = triggerWord;
                initialQuotaCost = quotaCost;
            }
        }

        // 如果没找到可用的默认选项，取第一个
        if (!initialFilename && supportedLoras.length > 0) {
            const firstName = supportedLoras[0];
            const firstData = loraConfig[firstName];
            if (firstData) {
                initialName = firstName;
                initialFilename = typeof firstData === 'string' ? firstData : firstData.filename;
                initialTrigger = typeof firstData === 'string' ? '' : (firstData.trigger || '');
                initialQuotaCost = typeof firstData === 'string' ? 0 : (firstData.quota_cost ?? 0);
            }
        }

        // 创建新行
        const newRow: LoraRowData = {
            id: `lora-row-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            filename: initialFilename,
            displayName: initialName,
            strength: defaultStrength,
            triggerWord: initialTrigger,
            quotaCost: initialQuotaCost,
        };

        modelsStore.loraRows.push(newRow);

        // 非恢复模式下，返回触发词供调用方插入提示词
        if (!isRestoring && initialTrigger) {
            return initialTrigger;
        }
        return null;
    }

    // 收集所有 LoRA 设置为请求数组
    function collectLoraSettings(): Array<{ name: string; strength: number }> {
        return modelsStore.loraRows
            .filter(row => row.filename)
            .map(row => ({
                name: row.filename,
                strength: parseFloat(String(row.strength)) || 0.8,
            }));
    }

    // 清除所有 LoRA 行
    function clearLoraRows(): void {
        modelsStore.loraRows = [];
    }

    /**
     * 从历史记录恢复 LoRA 列表（校验每个 LoRA 是否在当前 loraConfig 中存在）
     * 供 useHistory.restoreParameters 调用，替代内联的恢复逻辑
     */
    function restoreLoraFromHistory(loraList: Array<{ name: string; strength: number }>): void {
        const loraConfigData = modelsStore.loraConfig || {};
        const validLoras: LoraRowData[] = [];

        for (const lora of loraList) {
            const loraFilename = lora.name.replace(/\\\\/g, '\\');
            for (const [name, info] of Object.entries(loraConfigData)) {
                if (info.filename === loraFilename) {
                    validLoras.push({
                        id: `lora-row-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
                        filename: loraFilename,
                        displayName: name,
                        strength: lora.strength,
                        triggerWord: info.trigger || '',
                        quotaCost: info.quota_cost ?? 0,
                    });
                    break;
                }
            }
        }

        modelsStore.loraRows = validLoras;
    }

    // 更新提示词中的 LoRA 触发词
    // oldTrigger: 旧的触发词（将被移除）；newTrigger: 新的触发词（将被添加）
    function updatePromptWithTrigger(
        oldTrigger: string,
        newTrigger: string,
        currentPrompt: string
    ): string {
        let result = currentPrompt;
        let isModified = false;

        // 移除旧触发词
        if (oldTrigger) {
            const triggers = oldTrigger.split(',').map(t => t.trim()).filter(t => t);
            triggers.forEach(t => {
                const regex = new RegExp(`(^|,)\\s*${escapeRegExp(t)}\\s*(,|$)`, 'g');
                if (regex.test(result)) {
                    result = result.replace(regex, '$1$2');
                    isModified = true;
                }
            });
            // 清理多余逗号
            result = result.replace(/,+/g, ',').replace(/^,+|,+$/g, '').trim();
        }

        // 添加新触发词
        if (newTrigger) {
            const triggers = newTrigger.split(',').map(t => t.trim()).filter(t => t);
            const tagsToAdd: string[] = [];
            triggers.forEach(t => {
                const checkRegex = new RegExp(`(^|,)\\s*${escapeRegExp(t)}\\s*(,|$)`);
                if (!checkRegex.test(result)) tagsToAdd.push(t);
            });
            if (tagsToAdd.length > 0) {
                if (result && !result.endsWith(',')) result += ', ';
                result += tagsToAdd.join(', ') + ', ';
                isModified = true;
            }
        }

        return isModified ? result : currentPrompt;
    }

    // 删除指定 LoRA 行（按 id），返回被删除行的触发词
    function removeLoraRow(rowId: string): string | null {
        const row = modelsStore.loraRows.find(r => r.id === rowId);
        const triggerWord = row?.triggerWord || null;
        modelsStore.loraRows = modelsStore.loraRows.filter(r => r.id !== rowId);
        return triggerWord;
    }

    // 更新指定 LoRA 行的强度
    function updateLoraStrength(rowId: string, strength: number): void {
        const row = modelsStore.loraRows.find(r => r.id === rowId);
        if (row) {
            row.strength = strength;
        }
    }

    // 更新指定 LoRA 行的选中项（切换 LoRA）
    function updateLoraSelection(
        rowId: string,
        filename: string,
        displayName: string,
        triggerWord: string,
        quotaCost: number = 0
    ): { oldTrigger: string; newTrigger: string } | null {
        const row = modelsStore.loraRows.find(r => r.id === rowId);
        if (!row) return null;

        const oldTrigger = row.triggerWord;
        row.filename = filename;
        row.displayName = displayName;
        row.triggerWord = triggerWord;
        row.quotaCost = quotaCost;

        return { oldTrigger, newTrigger: triggerWord };
    }

    return {
        // 状态
        isLoading,
        loadError,
        // 方法
        initLoraConfig,
        addLoraRow,
        collectLoraSettings,
        clearLoraRows,
        restoreLoraFromHistory,
        updatePromptWithTrigger,
        removeLoraRow,
        updateLoraStrength,
        updateLoraSelection,
    };
}
