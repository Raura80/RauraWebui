import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { PresetItem } from '../types';
import { STORAGE_KEY_PREFIX } from '../utils/constants';

export const useUserStore = defineStore('user', () => {
  // 客户端唯一标识（服务端签发，FingerprintJS 辅助）
  const clientId = ref<string | null>(null);

  // ComfyUI 会话 ID（每个浏览器窗口/标签页独立，避免同用户多窗口 WS 消息路由冲突）
  // 格式：{clientId}_{随机后缀}，确保同一用户的不同窗口连接 ComfyUI 时使用不同的 clientId
  const comfyuiSessionId = ref<string>('');

  // 用户额度
  const quota = ref(0);

  // 总生成数
  const totalGenerated = ref(0);

  // 数据库预设
  const dbPresets = ref<Record<string, {
    prompt: string;
    params: Record<string, any> | null;
    uuid: string;
    is_public: number;
    created_at: string;
  }>>({});

  // 初始化 clientId
  function initClientId(id: string) {
    clientId.value = id;
    localStorage.setItem(STORAGE_KEY_PREFIX + 'client_id', id);
    // 同时生成 ComfyUI 会话 ID（每次页面加载都生成新的，确保每个窗口独立）
    comfyuiSessionId.value = `${id}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
  }

  // 从 localStorage 恢复 clientId
  function loadClientId(): string | null {
    const stored = localStorage.getItem(STORAGE_KEY_PREFIX + 'client_id');
    if (stored) {
      clientId.value = stored;
      // 每次页面加载都生成新的 ComfyUI 会话 ID
      comfyuiSessionId.value = `${stored}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
    }
    return stored;
  }

  // 更新额度
  function setQuota(value: number) {
    quota.value = value;
  }

  // 设置数据库预设
  function setDbPresets(presets: PresetItem[]) {
    dbPresets.value = {};
    presets.forEach(p => {
      dbPresets.value[p.name] = {
        prompt: p.prompt,
        params: (() => {
          if (!p.params) return null;
          if (typeof p.params !== 'string') return p.params;
          try { return JSON.parse(p.params); } catch { return null; }
        })(),
        uuid: p.uuid,
        is_public: p.is_public || 0,
        created_at: p.created_at,
      };
    });
  }

  return {
    clientId,
    comfyuiSessionId,
    quota,
    totalGenerated,
    dbPresets,
    STORAGE_KEY_PREFIX,
    initClientId,
    loadClientId,
    setQuota,
    setDbPresets,
  };
});
