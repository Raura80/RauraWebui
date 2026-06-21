/**
 * IndexedDB 共享初始化模块
 * 统一管理 AIPresetDB 的版本和对象仓库创建
 * usePresets 和 useImageCache 共用此模块，避免版本冲突
 */

const IDB_NAME = 'AIPresetDB';
const IDB_VERSION = 2;

// 单例 Promise，确保数据库只打开一次
let idbPromise: Promise<IDBDatabase> | null = null;

/**
 * 初始化 IndexedDB（全局单例）
 * version 1: preset_images (keyPath: uuid)
 * version 2: + history_meta (keyPath: filename), history_images (keyPath: filename)
 */
export function initSharedDB(): Promise<IDBDatabase> {
    if (!idbPromise) {
        idbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(IDB_NAME, IDB_VERSION);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
            request.onupgradeneeded = (e) => {
                const db = (e.target as IDBOpenDBRequest).result;
                // version 1: 预设图片
                if (!db.objectStoreNames.contains('preset_images')) {
                    db.createObjectStore('preset_images', { keyPath: 'uuid' });
                }
                // version 2: 历史记录
                if (!db.objectStoreNames.contains('history_meta')) {
                    db.createObjectStore('history_meta', { keyPath: 'filename' });
                }
                if (!db.objectStoreNames.contains('history_images')) {
                    db.createObjectStore('history_images', { keyPath: 'filename' });
                }
            };
        });
    }
    return idbPromise;
}
