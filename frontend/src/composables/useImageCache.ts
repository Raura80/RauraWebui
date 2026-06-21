import { initSharedDB } from './useSharedDB';

/**
 * IndexedDB 对象仓库名称
 * 数据库初始化由 useSharedDB 统一管理
 */
const META_STORE = 'history_meta';     // 历史记录元数据（keyPath: filename）
const IMAGE_STORE = 'history_images';  // 历史图片 blob（keyPath: filename）

/** 历史记录最大条数 (调整为 512 条) */
const MAX_HISTORY_ITEMS = 512;

/** 历史记录过期时间（调整为 7 天） */
const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Blob URL 缓存（模块级，所有 useImageCache 实例共享）
 * 同一 filename 只创建一次 blob URL，避免重复创建导致内存泄漏
 * 仅在删除/清空历史时才 revoke
 */
const blobUrlCache = new Map<string, string>();

export function useImageCache() {

    /** 初始化 IndexedDB（使用共享实例） */
    function initDB(): Promise<IDBDatabase> {
        return initSharedDB();
    }

    /** 通用事务执行器 */
    async function withTransaction<T>(
        storeName: string,
        mode: IDBTransactionMode,
        fn: (store: IDBObjectStore) => IDBRequest<T>,
    ): Promise<T> {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, mode);
            const store = tx.objectStore(storeName);
            const request = fn(store);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    // ======================== 元数据操作 ========================

    /** 保存单条元数据 */
    async function saveMeta(meta: HistoryMeta): Promise<void> {
        await withTransaction(META_STORE, 'readwrite', store => store.put(meta));
    }

    /** 获取所有元数据（按时间降序：最新的在前） */
    async function getAllMeta(): Promise<HistoryMeta[]> {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(META_STORE, 'readonly');
            const store = tx.objectStore(META_STORE);
            const request = store.getAll();
            request.onsuccess = () => {
                const items = request.result as HistoryMeta[];
                // 按时间降序排列
                items.sort((a, b) => b.timestamp - a.timestamp);
                resolve(items);
            };
            request.onerror = () => reject(request.error);
        });
    }

    /** 删除单条元数据 */
    async function deleteMeta(filename: string): Promise<void> {
        await withTransaction(META_STORE, 'readwrite', store => store.delete(filename));
    }

    /** 清空所有元数据 */
    async function clearAllMeta(): Promise<void> {
        await withTransaction(META_STORE, 'readwrite', store => store.clear());
    }

    // ======================== 图片 blob 操作 ========================

    /** 保存图片 blob */
    async function saveImageBlob(filename: string, blob: Blob): Promise<void> {
        await withTransaction(IMAGE_STORE, 'readwrite', store => store.put({ filename, blob }));
    }

    /** 获取图片 blob */
    async function getImageBlob(filename: string): Promise<Blob | null> {
        const result = await withTransaction<{ filename: string; blob: Blob } | undefined>(
            IMAGE_STORE, 'readonly', store => store.get(filename),
        );
        return result?.blob ?? null;
    }

    /** 删除图片 blob */
    async function deleteImageBlob(filename: string): Promise<void> {
        await withTransaction(IMAGE_STORE, 'readwrite', store => store.delete(filename));
    }

    /** 清空所有图片 blob */
    async function clearAllImageBlobs(): Promise<void> {
        await withTransaction(IMAGE_STORE, 'readwrite', store => store.clear());
    }

    // ======================== 组合与维护操作 ========================

    /**
     * 统一的清理维护任务（性能优化版）
     * 合并了“清理过期”和“截断超限”，只读取一次数据库
     */
    async function maintainHistory(): Promise<void> {
        const allMeta = await getAllMeta();
        const now = Date.now();
        const toDeleteFiles = new Set<string>();

        // 1. 找出过期数据
        allMeta.forEach(m => {
            if (now - m.timestamp >= EXPIRY_MS) {
                toDeleteFiles.add(m.filename);
            }
        });

        // 2. 找出超限数据 (排除掉即将被清理的过期数据后再计算)
        const validMeta = allMeta.filter(m => !toDeleteFiles.has(m.filename));
        if (validMeta.length > MAX_HISTORY_ITEMS) {
            // allMeta 已降序，截除尾部（最旧的）
            const toRemove = validMeta.slice(MAX_HISTORY_ITEMS);
            toRemove.forEach(m => toDeleteFiles.add(m.filename));
        }

        // 3. 统一执行删除，释放空间
        if (toDeleteFiles.size > 0) {
            const deleteTasks = Array.from(toDeleteFiles).map(filename => deleteHistoryItem(filename));
            await Promise.all(deleteTasks);
        }
    }

    /**
     * 保存一条完整的历史记录（元数据 + 图片 blob）
     * 带有防克隆处理与防爆仓（QuotaExceededError）机制
     */
    async function saveHistoryItem(meta: HistoryMeta, blob: Blob): Promise<void> {
        // 剥离 Vue Proxy 响应式，转换为纯粹的普通对象
        // 优先用 structuredClone（性能更好），失败时回退到 JSON 序列化
        let cleanMeta: HistoryMeta;
        try {
            cleanMeta = structuredClone(meta);
        } catch {
            cleanMeta = JSON.parse(JSON.stringify(meta));
        }

        try {
            // 保存前先执行日常的过期清理和上限截断
            await maintainHistory();

            // 保存当前条目
            await Promise.all([
                saveMeta(cleanMeta),
                saveImageBlob(cleanMeta.filename, blob),
            ]);
        } catch (error: any) {
            // [防爆仓策略]: 512张图可能填满部分用户的浏览器配额
            if (error.name === 'QuotaExceededError' || error.message?.includes('Quota')) {
                console.warn('⚠️ 浏览器存储配额已满！正在执行紧急清理腾出空间...');

                // 紧急处理：获取所有数据，直接删掉最旧的一半记录
                const allMeta = await getAllMeta();
                const halfLength = Math.floor(allMeta.length / 2);
                if (halfLength > 0) {
                    const toRemove = allMeta.slice(halfLength);
                    await Promise.all(toRemove.map(m => deleteHistoryItem(m.filename)));

                    // 清理出空间后，再重新尝试保存一次
                    await Promise.all([
                        saveMeta(cleanMeta),
                        saveImageBlob(cleanMeta.filename, blob),
                    ]);
                } else {
                    // 如果总共就没几条但还是满了，只能放弃保存 blob
                    await saveMeta(cleanMeta);
                }
            } else {
                // 其他未知错误直接抛出
                throw error;
            }
        }
    }

    /**
     * 删除一条完整的历史记录（元数据 + 图片 blob）
     */
    async function deleteHistoryItem(filename: string): Promise<void> {
        revokeBlobUrl(filename);
        await Promise.all([
            deleteMeta(filename),
            deleteImageBlob(filename),
        ]);
    }

    /**
     * 清空所有历史记录
     */
    async function clearAll(): Promise<void> {
        revokeAllBlobUrls();
        await Promise.all([
            clearAllMeta(),
            clearAllImageBlobs(),
        ]);
    }

    /**
     * 加载所有有效历史记录（自动清理过期）
     * 返回元数据列表（不含 blob），调用方按需加载图片
     */
    async function loadAllHistory(): Promise<HistoryMeta[]> {
        await maintainHistory();
        return getAllMeta();
    }

    /**
     * 根据 filename 生成可用的图片 URL
     * 使用缓存避免重复创建 blob URL，防止内存泄漏
     */
    async function getImageUrl(filename: string): Promise<string> {
        // 命中缓存，直接返回已有的 blob URL
        if (blobUrlCache.has(filename)) {
            return blobUrlCache.get(filename)!;
        }

        const blob = await getImageBlob(filename);
        if (blob) {
            const url = URL.createObjectURL(blob);
            blobUrlCache.set(filename, url);
            return url;
        }
        // IndexedDB 中没有（可能过期或被紧急清理了），回退到线上 API 获取
        return `/api/view?filename=${encodeURIComponent(filename)}`;
    }

    /** 释放指定 filename 的 blob URL */
    function revokeBlobUrl(filename: string): void {
        const url = blobUrlCache.get(filename);
        if (url) {
            URL.revokeObjectURL(url);
            blobUrlCache.delete(filename);
        }
    }

    /** 释放所有 blob URL（清空历史时调用） */
    function revokeAllBlobUrls(): void {
        for (const url of blobUrlCache.values()) {
            URL.revokeObjectURL(url);
        }
        blobUrlCache.clear();
    }

    return {
        saveHistoryItem,
        deleteHistoryItem,
        clearAll,
        loadAllHistory,
        getImageUrl,
        getImageBlob,
        saveImageBlob,
        saveMeta,
        getAllMeta,
        revokeBlobUrl,
        revokeAllBlobUrls,
    };
}

/** 历史记录元数据类型（与 IndexedDB history_meta store 对应） */
export interface HistoryMeta {
    filename: string;
    timestamp: number;
    generation_params: Record<string, any>;
    prompt: string;
    style: string;
    width: number;
    height: number;
}