// ======================== 标签与画师 ========================

// 标签项 - ta.dat 解密后
export interface TagItem {
    tag: string;
    'right tag cn': string;
    pinyin: string;
    count: number;
    is_artist?: boolean;
}

// 画师项 - ar.dat 解密后
export interface ArtistItem {
    name: string;
    other_names: string[];
    post_count: number;
}

// ======================== 分辨率 ========================

export interface Resolution {
    width: number;
    height: number;
    ratioText: string;
}

// ======================== 生成请求与响应 ========================

export interface GenerateRequest {
    custom_task_id: string;
    client_id: string;
    comfyui_session_id?: string;  // ComfyUI 会话 ID，每个窗口独立，用于 ComfyUI 消息路由
    prompt: string;
    negative_prompt: string;
    ckpt_name: string;
    model_name: string;           // 模型展示名（如 Ill_WAI快速模式），用于后端精确匹配模型
    clip_name?: string | null;
    vae_name?: string | null;
    style: string;
    lora_list: Array<{ name: string; strength: number }>;
    width: number;
    height: number;
    seed: number;
    steps: number;
    cfg: number;
    sampler_name: string;
    scheduler: string;
    denoise: number;
    input_image?: string | null;
    use_tagger?: boolean;
    use_controlnet?: boolean;
    clip_skip: number;
}

export interface GenerateResponse {
    status: 'queued';
    custom_task_id: string;
    client_id: string;
}

export interface CancelRequest { custom_task_id: string; }
export interface CancelResponse { status: 'canceled' | 'interrupted' | 'not_found_or_running'; }

// ======================== 队列 ========================

export interface QueueResponse {
    readonly task_queue: readonly string[];    // 排队中的任务 ID（有序，index+1 即排名）
    readonly running_ids: readonly string[];   // 正在 ComfyUI 执行的任务 ID
    readonly comfy_queue_positions: Readonly<Record<string, number>>; // 每个任务在 ComfyUI 队列中的位置（0=执行中, >0=排队位置, -1=不在队列）
    readonly queue_running_count: number;      // ComfyUI 运行中数量
    readonly queue_pending_count: number;      // ComfyUI 等待中数量
}

// ======================== 标签搜索 ========================

export interface TagSearchRequest {
    query: string;
    top_k: number;
    limit: number;
    popularity_weight: number;
    show_nsfw: boolean;
    use_segmentation: boolean;
    target_layers: string[];
    target_categories: string[];
}

export interface TagSearchResult {
    tag: string;
    cn_name: string;
    category: string;
    count: number;
    final_score: number;
    wiki?: string;
}

export interface TagSearchResponse {
    results: TagSearchResult[];
    keywords?: string[];
}

// ======================== 关联词 ========================

export interface RelatedRequest { tags: string[]; limit: number; show_nsfw: boolean; }
export interface RelatedTag {
    tag: string;
    cn_name: string;
    category: string;
    cooc_score: number;
}

// ======================== 模型与 LoRA ========================

export interface ModelInfo {
    filename: string;
    quota_cost?: number;
    clip?: string;
    vae?: string;
    params: Record<string, any>;
    supports_img2img?: boolean;
    supports_chinese?: boolean;
    supports_lora?: boolean;
    supported_loras?: string[];
    prompt?: string;
    positive_prompt?: string;
    negative_prompt?: string;
    sampler?: string;
    scheduler?: string;
    steps?: number;
    cfg?: number;
    denoise?: number;
    clip_skip?: number;
    description?: string;
}

export interface ModelGroup {
    label: string;
    models: Record<string, ModelInfo>;
}

export interface LoraInfo {
    filename: string;
    trigger?: string;
    quota_cost?: number;
}

// ======================== 预设 ========================

export interface PresetItem {
    uuid: string;
    name: string;
    prompt: string;
    params?: Record<string, any> | null;
    has_image: boolean;
    is_public?: number;  // 1=公共预设（所有用户可见，不可删除）
    created_at: string;
}

// ======================== 额度与兑换 ========================

export interface QuotaResponse {
    client_id: string;
    quota: number;
    total_generated: number;
    last_request_at?: string;
    preset_count: number;
    used_tokens: number;
    model_cost?: number;
}

export interface RedeemRequest { client_id: string; token_code: string; }
export interface RedeemResponse { success: boolean; message: string; quota_added?: number; new_quota?: number; detail?: { message: string }; }

// ======================== WebSocket 消息 ========================

export type WSMessage =
    | { type: 'status'; data: { status: { exec_info: { queue_remaining: number } } } }
    | { type: 'progress'; data: { value: number; max: number; prompt_id: string } }
    | { type: 'executed'; data: { prompt_id: string; output: { images: Array<{ filename: string; type: string }> } } }
    | { type: 'execution_start'; data: { prompt_id: string } }
    | { type: 'execution_error'; data: { prompt_id: string; exception_message: string } }
    | { type: 'queue_update'; data: QueueResponse }
    | { type: 'task_started'; data: { custom_task_id: string; prompt_id: string } }
    | { type: 'task_failed'; data: { custom_task_id: string; error?: string; error_code?: string } };

// ======================== 历史记录 ========================

export interface HistoryItem {
    url: string;
    filename: string;
    timestamp: number;
    generation_params: Record<string, any>;
    prompt: string;
    style: string;
    width: number;
    height: number;
}

// ======================== 高级生成参数 ========================

export interface AdvancedGenerationParams {
    seed: number;
    steps: number;
    cfg: number;
    sampler_name: string;
    scheduler: string;
    denoise: number;
    clip_skip: number;
    negative_prompt: string;
}

// ======================== 配置常量 ========================

export interface GenerationDefaults {
    steps: number;
    cfg: number;
    sampler_name: string;
    scheduler: string;
    denoise: number;
    clip_skip: number;
}

export interface ParamsLimits {
    resolution: { min: number; max: number };
    steps: { min: number; max: number };
    cfg: { min: number; max: number };
    denoise: { min: number; max: number };
    clip_skip: { min: number; max: number };
}
