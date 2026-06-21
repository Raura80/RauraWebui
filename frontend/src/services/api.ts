import type {
  GenerateRequest, GenerateResponse,
  CancelRequest, CancelResponse,
  QueueResponse,
  TagSearchRequest, TagSearchResponse,
  RelatedRequest, RelatedTag,
  ModelGroup,
  PresetItem,
  QuotaResponse,
  RedeemRequest, RedeemResponse
} from '../types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

// 自定义 API 错误类，统一错误类型
export class ApiError extends Error {
  status: number;
  data: unknown;
  constructor(status: number, message: string, data?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

// 通用请求封装
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {};
  // FormData 不设置 Content-Type，让浏览器自动添加 boundary
  if (!(options?.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  // 每个请求都带上 fingerprint，确保无痕模式也能补全用户信息
  const fp = sessionStorage.getItem('fp');
  if (fp) headers['X-Fingerprint'] = fp;

  const response = await fetch(url, {
    ...options,
    credentials: 'include',  // 自动携带 Cookie，用于服务端令牌鉴权
    headers: {
      ...headers,
      ...options?.headers as Record<string, string>,
    },
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const errorMessage = errorData?.detail?.message || errorData?.detail || errorData?.message || '请求失败';
    throw new ApiError(response.status, errorMessage, errorData);
  }
  try {
    return await response.json();
  } catch {
    throw new ApiError(0, '响应解析失败');
  }
}

// 提交生图任务
export async function generate(req: GenerateRequest): Promise<GenerateResponse> {
  return request<GenerateResponse>(`${API_BASE_URL}/generate`, {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

// 取消任务
export async function cancelTask(req: CancelRequest): Promise<CancelResponse> {
  return request<CancelResponse>(`${API_BASE_URL}/cancel_task`, {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

// 获取队列状态
export async function getQueue(): Promise<QueueResponse> {
  return request<QueueResponse>(`${API_BASE_URL}/queue`);
}

// 搜索标签
export async function searchTags(req: TagSearchRequest): Promise<TagSearchResponse> {
  return request<TagSearchResponse>(`${API_BASE_URL}/search_tags`, {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

// 关联词查询
export async function getRelatedTags(req: RelatedRequest): Promise<RelatedTag[]> {
  return request<RelatedTag[]>(`${API_BASE_URL}/related`, {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

// 获取模型列表
export async function getModels(): Promise<Record<string, ModelGroup>> {
  return request<Record<string, ModelGroup>>(`${API_BASE_URL}/models`);
}

// 获取 LoRA 列表
export async function getLoras(): Promise<Record<string, { filename: string; trigger?: string }>> {
  return request(`${API_BASE_URL}/loras`);
}

// 初始化认证：发送浏览器指纹，获取服务端确认的 client_id（不再传递 client_id 防止身份冒充）
export async function initAuth(fingerprint: string): Promise<{ client_id: string }> {
  const params = new URLSearchParams({ fingerprint: fingerprint });
  return request<{ client_id: string }>(`${API_BASE_URL}/auth/init?${params}`);
}

// 获取用户额度
export async function getQuota(clientId: string, ckptName?: string): Promise<QuotaResponse> {
  const params = new URLSearchParams({ client_id: clientId });
  if (ckptName) params.append('ckpt_name', ckptName);
  return request<QuotaResponse>(`${API_BASE_URL}/user/quota?${params}`);
}

// 兑换点数
export async function redeemToken(req: RedeemRequest): Promise<RedeemResponse> {
  return request<RedeemResponse>(`${API_BASE_URL}/token/redeem`, {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

// 获取预设列表
export async function getPresets(clientId: string): Promise<{ presets: PresetItem[] }> {
  return request(`${API_BASE_URL}/presets?client_id=${encodeURIComponent(clientId)}`);
}

// 保存预设 (FormData)
export async function savePreset(formData: FormData): Promise<{ success: boolean; uuid: string; action: string }> {
  return request(`${API_BASE_URL}/presets`, {
    method: 'POST',
    body: formData,
  });
}

// 获取预设图片
export async function getPresetImage(uuid: string): Promise<{ image_base64: string }> {
  return request(`${API_BASE_URL}/preset_image/${uuid}`);
}

// 获取生成的图片 (返回 Blob)
export async function getViewImage(filename: string, promptId?: string): Promise<{ blob: Blob; cooldownHeader: string | null }> {
  const params = new URLSearchParams({ filename });
  if (promptId) params.append('prompt_id', promptId);
  const response = await fetch(`${API_BASE_URL}/view?${params}`, {
    credentials: 'include',
  });
  if (!response.ok) throw new Error('获取图片失败');
  const blob = await response.blob();
  const cooldownHeader = response.headers.get('X-Next-Cooldown');
  return { blob, cooldownHeader };
}

// 上传图片 (图生图)
export async function uploadImage(file: File): Promise<{ filename: string }> {
  const formData = new FormData();
  formData.append('file', file);
  return request(`${API_BASE_URL}/upload_image`, {
    method: 'POST',
    body: formData,
  });
}

// 获取反推标签 (图生图)
export async function getLatestTags(): Promise<{ tags: string }> {
  return request(`${API_BASE_URL}/get_latest_tags`);
}

// 获取每日赠礼兑换码
export async function getDailyGift(): Promise<{ token_code: string | null }> {
  return request(`${API_BASE_URL}/daily-gift`);
}
