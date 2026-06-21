import { ref } from 'vue';
import { useUserStore } from '../stores/user';
import { getPresets as apiGetPresets, savePreset as apiSavePreset, getPresetImage as apiGetPresetImage } from '../services/api';
import { initSharedDB } from './useSharedDB';

/** IndexedDB 配置 */
const IDB_STORE_NAME = 'preset_images';

/**
 * 预设系统 composable
 * 管理预设的加载、保存、图片缓存（IndexedDB）
 */
export function usePresets() {
    const userStore = useUserStore();

    // 预设加载状态
    const isLoadingPresets = ref(false);

    /**
     * 初始化 IndexedDB（使用共享实例）
     */
    function initIndexedDB(): Promise<IDBDatabase> {
        return initSharedDB();
    }

    /**
     * 初始化预设按钮 - 从数据库加载预设
     */
    async function initPresetButton(): Promise<void> {
        await refreshPresets();
    }

    /**
     * 从 API 刷新预设列表，更新 store
     */
    async function refreshPresets(): Promise<void> {
        if (!userStore.clientId) return;
        isLoadingPresets.value = true;
        try {
            const data = await apiGetPresets(userStore.clientId);
            userStore.setDbPresets(data.presets);
        } catch (e) {
            console.error('获取数据库预设失败:', e);
        } finally {
            isLoadingPresets.value = false;
        }
    }

    /**
     * 保存预设到 API
     * @param name 预设名称
     * @param prompt 提示词内容
     * @param params 生成参数
     * @param imageBase64 可选的缩略图 base64
     */
    async function savePreset(
        name: string,
        prompt: string,
        params: Record<string, any>,
        imageBase64?: string
    ): Promise<{ success: boolean; uuid: string; action: string } | null> {
        if (!userStore.clientId) return null;

        const formData = new FormData();
        formData.append('name', name);
        formData.append('prompt', prompt);
        formData.append('params', JSON.stringify(params));
        formData.append('client_id', userStore.clientId);

        // 如果有图片，压缩后附加
        if (imageBase64) {
            formData.append('image_base64', imageBase64);
        }

        try {
            const result = await apiSavePreset(formData);

            // 保存成功后，立即将图片缓存到 IndexedDB
            if (imageBase64 && result.uuid) {
                savePresetImageToLocal(result.uuid, imageBase64);
            }

            // 刷新预设列表
            await refreshPresets();

            return result;
        } catch (e) {
            console.error('保存预设失败:', e);
            return null;
        }
    }

    /**
     * 压缩图片为 base64
     * 最大尺寸 512px，输出 webp 格式，质量 0.8
     */
    function compressImageToBase64(blob: Blob): Promise<string> {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let { width, height } = img;
                const maxSize = 512;
                // 等比缩放
                if (width > maxSize || height > maxSize) {
                    if (width > height) {
                        height = Math.round((height * maxSize) / width);
                        width = maxSize;
                    } else {
                        width = Math.round((width * maxSize) / height);
                        height = maxSize;
                    }
                }
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    URL.revokeObjectURL(img.src);
                    reject(new Error('Canvas 2D 上下文获取失败'));
                    return;
                }
                ctx.drawImage(img, 0, 0, width, height);
                const dataUrl = canvas.toDataURL('image/webp', 0.8);
                URL.revokeObjectURL(img.src);
                // 返回纯 base64 部分（去掉 data:image/webp;base64, 前缀）
                resolve(dataUrl.split(',')[1]);
            };
            img.onerror = () => {
                URL.revokeObjectURL(img.src);
                reject(new Error('图片处理失败'));
            };
            img.src = URL.createObjectURL(blob);
        });
    }

    /**
     * 从 IndexedDB 缓存获取预设图片
     */
    async function getPresetImageFromLocal(uuid: string): Promise<string | null> {
        try {
            const db = await initIndexedDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(IDB_STORE_NAME, 'readonly');
                const store = tx.objectStore(IDB_STORE_NAME);
                const request = store.get(uuid);
                request.onsuccess = () => resolve(request.result ? request.result.image_base64 : null);
                request.onerror = () => reject(request.error);
            });
        } catch (e) {
            console.warn('读取本地预设图片失败', e);
            return null;
        }
    }

    /**
     * 保存预设图片到 IndexedDB 缓存
     */
    async function savePresetImageToLocal(uuid: string, imageBase64: string): Promise<void> {
        if (!imageBase64) return;
        try {
            const db = await initIndexedDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
                const store = tx.objectStore(IDB_STORE_NAME);
                store.put({ uuid, image_base64: imageBase64 });
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
        } catch (e) {
            console.warn('保存预设图片到本地失败', e);
        }
    }

    /**
     * 获取预设图片（优先本地缓存，回退到 API）
     */
    async function getPresetImage(uuid: string): Promise<string | null> {
        // 先查 IndexedDB 本地缓存
        let base64 = await getPresetImageFromLocal(uuid);
        if (base64) return base64;

        // 缓存未命中，从 API 获取
        try {
            const data = await apiGetPresetImage(uuid);
            base64 = data.image_base64;
            if (base64) {
                // 保存到本地缓存
                savePresetImageToLocal(uuid, base64);
            }
            return base64;
        } catch (e) {
            console.warn('获取预设图片失败', e);
            return null;
        }
    }

    return {
        isLoadingPresets,
        initPresetButton,
        refreshPresets,
        savePreset,
        compressImageToBase64,
        getPresetImageFromLocal,
        savePresetImageToLocal,
        getPresetImage,
    };
}
