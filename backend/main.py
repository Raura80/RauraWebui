import os
import io
import time
import json
import hmac
import math
import hashlib
import base64
import logging
import asyncio
import random
import uuid
import aiohttp

from datetime import datetime, timezone, timedelta
from collections import deque
from dataclasses import dataclass, field
from typing import Optional, Set, Dict, List, Any
from pathlib import Path

from dotenv import load_dotenv

from PIL import Image
from pydantic import BaseModel, Field
from fastapi import (
    FastAPI,
    WebSocket,
    HTTPException,
    Response,
    Request,
    Form,
    Depends,
    Header,
    Query,
)
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.concurrency import run_in_threadpool
from fastapi.staticfiles import StaticFiles

from database import db, _BEIJING_TZ, beijing_now
from dashboard_events import DashboardEventBus


def utc_to_beijing(iso_str: str) -> str:
    """将前端发送的时间字符串转为北京时间字符串（不含时区后缀）
    - 带 Z 后缀：视为 UTC 时间，转换为北京时间
    - 带 ±HH:MM 偏移：转换为北京时间
    - 无时区信息：视为北京时间，直接使用
    """
    if not iso_str:
        return None
    # 带 Z 后缀：UTC 时间，转换为北京时间
    if iso_str.endswith("Z"):
        dt = datetime.fromisoformat(iso_str[:-1] + "+00:00")
        return dt.astimezone(_BEIJING_TZ).strftime("%Y-%m-%dT%H:%M:%S")
    # 带时区偏移（如 +08:00 或 -05:00）：转换为北京时间
    # 从第10个字符后查找 + 或 -，避免误匹配日期部分的分隔符
    time_part = iso_str[10:] if len(iso_str) > 10 else ""
    if "+" in time_part or (time_part and "-" in time_part):
        dt = datetime.fromisoformat(iso_str)
        if dt.tzinfo is not None:
            return dt.astimezone(_BEIJING_TZ).strftime("%Y-%m-%dT%H:%M:%S")
    # 无时区信息：已是北京时间，直接使用
    return iso_str


# 加载 .env 环境变量
load_dotenv()

# ================= 配置区 =================
COMFYUI_URL = os.getenv("COMFYUI_URL", "http://127.0.0.1:8188")
TAG_API_URL = os.getenv("TAG_API_URL", "http://127.0.0.1:8001/search")
SERVER_PORT = int(os.getenv("SERVER_PORT", "8899"))
SERVER_HOST = os.getenv("SERVER_HOST", "0.0.0.0")

# CORS 允许的来源（逗号分隔，部署时必须通过 .env 配置具体域名）
# 默认为空，本地开发需在 .env 中配置 http://localhost:5173 等地址
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "").split(",")
CORS_ORIGINS = [o.strip() for o in CORS_ORIGINS if o.strip()]

# 管理接口 API Key（必须配置，否则管理接口拒绝所有请求）
ADMIN_API_KEY = os.getenv("ADMIN_API_KEY", "")

# 用户令牌签名密钥（用于签发 HttpOnly Cookie，生产环境必须配置）
USER_TOKEN_SECRET = os.getenv("USER_TOKEN_SECRET", "")
if not USER_TOKEN_SECRET:
    raise SystemExit("FATAL: USER_TOKEN_SECRET 未配置，请在 .env 中设置随机密钥后重启")


# ================= 用户令牌工具函数 =================
def sign_token(payload: dict) -> str:
    """HMAC-SHA256 签名令牌"""
    payload_json = json.dumps(payload, sort_keys=True)
    signature = hmac.new(
        USER_TOKEN_SECRET.encode(), payload_json.encode(), hashlib.sha256
    ).hexdigest()
    return base64.urlsafe_b64encode(f"{payload_json}|{signature}".encode()).decode()


def verify_token(token: str) -> dict | None:
    """验证签名令牌，返回 payload 或 None"""
    try:
        decoded = base64.urlsafe_b64decode(token.encode()).decode()
        payload_json, signature = decoded.rsplit("|", 1)
        expected_sig = hmac.new(
            USER_TOKEN_SECRET.encode(), payload_json.encode(), hashlib.sha256
        ).hexdigest()
        if hmac.compare_digest(signature, expected_sig):
            return json.loads(payload_json)
    except Exception as e:
        pass
    return None


def compute_binding_hash(ip: str, user_agent: str) -> str:
    """计算 IP+UA 绑定哈希"""
    return hashlib.sha256(
        f"{ip}|{user_agent}|{USER_TOKEN_SECRET}".encode()
    ).hexdigest()[:32]


# 兑换码接口频率限制
REDEEM_RATE_LIMIT = int(os.getenv("REDEEM_RATE_LIMIT", "10"))  # 每分钟最大请求数
REDEEM_RATE_WINDOW = int(os.getenv("REDEEM_RATE_WINDOW", "60"))  # 窗口期（秒）

# 前端静态文件目录（环境变量为空时使用默认值）
FRONTEND_DIR = os.getenv(
    "FRONTEND_DIR",
    "",
) or os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))

# Cookie 安全配置（生产环境启用 HTTPS 时设为 true）
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"

# 同一模型连续执行最大次数（超过后切换模型会重新加载）
MAX_CONSECUTIVE_TASKS = int(os.getenv("MAX_CONSECUTIVE_TASKS", "4"))


# 新用户初始额度
INITIAL_QUOTA = int(os.getenv("INITIAL_QUOTA", "0"))

# 冷却算法: cooldown = min(BASE + queue_length * MULTIPLIER, MAX) * LOCAL_RATIO
COOLDOWN_BASE = int(os.getenv("COOLDOWN_BASE", "4"))
COOLDOWN_QUEUE_MULTIPLIER = int(os.getenv("COOLDOWN_QUEUE_MULTIPLIER", "2"))
COOLDOWN_MAX = int(os.getenv("COOLDOWN_MAX", "20"))
# 本地 IP 冷却倍率（0 = 无冷却，1 = 与远程相同，0.5 = 远程的一半）
COOLDOWN_LOCAL_RATIO = float(os.getenv("COOLDOWN_LOCAL_RATIO", "0"))

# WebP 压缩质量（1-100）
WEBP_QUALITY = int(os.getenv("WEBP_QUALITY", "95"))

# 生图尺寸范围
IMAGE_MIN_SIZE = int(os.getenv("IMAGE_MIN_SIZE", "512"))
IMAGE_MAX_SIZE = int(os.getenv("IMAGE_MAX_SIZE", "2048"))

# 每日赠礼配置
DAILY_GIFT_ENABLED = os.getenv("DAILY_GIFT_ENABLED", "true").lower() == "true"
DAILY_GIFT_TIME = os.getenv(
    "DAILY_GIFT_TIME", "6:00"
)  # 生成时间（北京时间，支持 HH:MM 格式，如 14:20）
# 解析为小时和分钟
_gift_time_parts = DAILY_GIFT_TIME.split(":")
DAILY_GIFT_HOUR = int(_gift_time_parts[0])
DAILY_GIFT_MINUTE = int(_gift_time_parts[1]) if len(_gift_time_parts) > 1 else 0
DAILY_GIFT_QUOTA = int(os.getenv("DAILY_GIFT_QUOTA", "99"))  # 兑换码额度
DAILY_GIFT_MAX_QUOTA = int(os.getenv("DAILY_GIFT_MAX_QUOTA", "99"))  # 每日赠礼额度上限
DAILY_GIFT_VALID_HOURS = int(os.getenv("DAILY_GIFT_VALID_HOURS", "23"))  # 有效期小时
DAILY_GIFT_VALID_MINUTES = int(
    os.getenv("DAILY_GIFT_VALID_MINUTES", "59")
)  # 有效期分钟


# ================= 认证与限流 =================
async def verify_admin(x_api_key: str = Header(None, alias="X-API-Key")):
    """管理接口 API Key 认证
    ADMIN_API_KEY 不可为空，为空拒绝所有请求"""
    if not ADMIN_API_KEY:
        raise HTTPException(status_code=401, detail="ADMIN_API_KEY not configured")
    if not x_api_key or not hmac.compare_digest(x_api_key, ADMIN_API_KEY):
        raise HTTPException(status_code=401, detail="Unauthorized")
    return True


# 兑换码接口 IP 频率限制器
redeem_attempts: Dict[str, List[float]] = {}

# 兑换连续失败锁定
redeem_failures: Dict[str, List[float]] = {}
REDEEM_LOCKOUT_THRESHOLD = 5  # 连续失败次数
REDEEM_LOCKOUT_DURATION = 600  # 锁定时间（秒）10分钟


async def check_redeem_rate(request: Request):
    """检查兑换码接口请求频率"""
    client_ip = request.client.host
    now = time.time()
    attempts = redeem_attempts.get(client_ip, [])
    # 清理过期记录
    redeem_attempts[client_ip] = [t for t in attempts if now - t < REDEEM_RATE_WINDOW]
    if len(redeem_attempts[client_ip]) >= REDEEM_RATE_LIMIT:
        raise HTTPException(status_code=429, detail="请求过于频繁，请稍后再试")
    redeem_attempts[client_ip].append(now)


async def check_redeem_lockout(request: Request):
    """检查兑换码连续失败锁定"""
    # 从请求体中提取 client_id 需要在路由中处理
    # 这里只做 IP 维度的检查
    client_ip = request.client.host
    now = time.time()
    failures = redeem_failures.get(client_ip, [])
    # 清理过期记录
    redeem_failures[client_ip] = [
        t for t in failures if now - t < REDEEM_LOCKOUT_DURATION
    ]
    if len(redeem_failures[client_ip]) >= REDEEM_LOCKOUT_THRESHOLD:
        raise HTTPException(status_code=429, detail="兑换失败次数过多，请10分钟后再试")


# ================= 数据模型 =================
class TagSearchRequest(BaseModel):
    query: str = ""
    top_k: int = 20
    limit: int = 50
    popularity_weight: float = 0.15
    use_segmentation: bool = True
    target_layers: List[str] = ["英文", "中文核心词", "中文扩展词", "释义"]
    target_categories: List[str] = ["General", "Character", "Copyright"]


class RelatedRequest(BaseModel):
    tags: List[str]
    limit: int = 50
    show_nsfw: bool = True


class LoraItem(BaseModel):
    name: str
    strength: float = Field(..., ge=0.01, le=2.0)


class GenerateRequest(BaseModel):
    prompt: str
    style: str
    ckpt_name: str
    model_name: str = ""  # 模型展示名，用于精确匹配模型
    clip_name: Optional[str] = None
    vae_name: Optional[str] = None
    width: int = Field(..., ge=IMAGE_MIN_SIZE, le=IMAGE_MAX_SIZE)
    height: int = Field(..., ge=IMAGE_MIN_SIZE, le=IMAGE_MAX_SIZE)
    steps: int = Field(20, ge=4, le=40)
    lora_list: list[LoraItem] = []
    client_id: str
    comfyui_session_id: Optional[str] = None  # ComfyUI 会话 ID，每个窗口独立
    seed: int = -1
    cfg: float = Field(5.0, ge=1.0, le=10.0)
    sampler_name: str = "euler"
    scheduler: str = "normal"
    denoise: float = Field(1.0, ge=0.1, le=1.0)
    negative_prompt: str = ""
    clip_skip: int = Field(-2, ge=-4, le=0)
    custom_task_id: str


class CancelRequest(BaseModel):
    custom_task_id: str


class RedeemTokenRequest(BaseModel):
    client_id: str
    token_code: str


class CreateBatchRequest(BaseModel):
    batch_code: str = Field(..., min_length=1, max_length=64)
    quota_value: int = Field(..., gt=0)
    token_count: int = Field(..., ge=1, le=1000)
    max_uses: int = Field(
        1, ge=-1, description="每个兑换码的最大可用次数，1=一次性，-1=无限"
    )
    description: Optional[str] = Field(None, max_length=256)
    expires_at: Optional[str] = Field(None, description="过期时间，ISO格式")


class UpdateBatchRequest(BaseModel):
    description: Optional[str] = Field(None, max_length=256)
    expires_at: Optional[str] = Field(None)
    status: Optional[str] = Field(None, pattern="^(active|disabled)$")


class CreateTokenRequest(BaseModel):
    quota_value: int = Field(10, gt=0)
    max_uses: int = Field(1, ge=-1, description="最大可用次数，1=一次性，-1=无限")
    description: Optional[str] = Field(None, max_length=256)
    expires_at: Optional[str] = Field(None, description="过期时间，ISO格式")
    batch_id: Optional[int] = Field(None)


class UpdateTokenRequest(BaseModel):
    status: Optional[str] = Field(None, pattern="^(active|disabled|expired)$")
    description: Optional[str] = Field(None, max_length=256)
    expires_at: Optional[str] = Field(None)
    quota_value: Optional[int] = Field(None, gt=0)
    max_uses: Optional[int] = Field(None, ge=-1)


class AddModelRequest(BaseModel):
    name: str
    ckpt_name: str
    clip_name: Optional[str] = None
    vae_name: Optional[str] = None
    category: str = "anime"
    category_label: Optional[str] = None
    quota_cost: int = Field(1, ge=1)
    supports_img2img: bool = True
    supports_controlnet: bool = True
    supports_chinese: bool = False
    tensorrt_engine: Optional[str] = None
    default_prompt: Optional[str] = None
    positive_prompt: Optional[str] = None
    negative_prompt: Optional[str] = None
    sampler: str = "euler_ancestral"
    scheduler: str = "normal"
    steps: int = Field(20, ge=1)
    cfg: float = Field(5.0, ge=1.0, le=10.0)
    denoise: float = Field(1.0, ge=0.1, le=1.0)
    clip_skip: int = Field(0, ge=-4, le=0)
    description: Optional[str] = None
    supported_lora_names: Optional[List[str]] = None


class AddLoraRequest(BaseModel):
    name: str
    filename: str
    trigger_word: Optional[str] = None
    category: Optional[str] = None


# ================= 仪表盘监控核心系统 =================
class ServerMonitor:
    """服务器状态监控单例"""

    def __init__(self):
        self.start_time = time.time()
        self.active_clients: Set[WebSocket] = set()
        # dashboard_clients 已迁移到 DashboardEventBus，此处保留兼容
        self.total_requests = 0
        self.request_stats = {
            "/api/generate": 0,
            "/api/search_tags": 0,
            "/api/view": 0,
            "/api/related": 0,
        }
        self.recent_logs = deque(maxlen=100)
        self.ip_request_counts: Dict[str, int] = {}

        # 日志文件持久化：当日日志缓冲区
        self._log_file_buffer: List[str] = []

        # 图片统计
        self.img_time_records: deque = deque(maxlen=500)
        self.img_last_time = 0.0
        self.img_max_time = 0.0
        self.pending_tasks: Dict[str, Dict[str, Any]] = {}
        self.filename_context_map: Dict[str, Dict[str, Any]] = {}

        # 标签搜索统计
        self.tag_time_records: deque = deque(maxlen=500)
        self.tag_last_time = 0.0
        self.tag_max_time = 0.0

        # 数据库统计缓存（启动时加载，定期刷新）
        self.cached_total_users = 0
        self.cached_users_today = 0
        self.cached_total_generated = 0

    def get_next_request_id(self, ip: str) -> int:
        self.ip_request_counts[ip] = self.ip_request_counts.get(ip, 0) + 1
        return self.ip_request_counts[ip]

    def log_request_stat(self, path):
        base_path = path.split("?")[0]
        if base_path in self.request_stats:
            self.total_requests += 1
            self.request_stats[base_path] += 1
            # 事件驱动：请求统计变化时推送
            if event_bus:
                asyncio.create_task(
                    event_bus.broadcast(
                        "stats_update",
                        {
                            "total_requests": self.total_requests,
                            "request_stats": self.request_stats,
                        },
                    )
                )

    def add_log(self, category, message):
        """写入仪表盘日志

        Args:
            category: 日志分类
                - "USER": 用户行为（绿色）
                - "SYSTEM": 系统事件（蓝色）
                - "ERROR": 错误事件（红色）
            message: 日志文本
        """
        timestamp = datetime.now().strftime("%H:%M:%S")

        # 根据分类设置颜色
        color_map = {
            "USER": "#2ecc71",  # 绿色 - 用户行为
            "SYSTEM": "#3498db",  # 蓝色 - 系统事件
            "ERROR": "#e74c3c",  # 红色 - 错误
        }
        color = color_map.get(category, "#ecf0f1")

        safe_message = message.replace("<", "&lt;").replace(">", "&gt;")
        log_entry = {
            "timestamp": timestamp,
            "category": category,
            "color": color,
            "message": safe_message,
        }
        self.recent_logs.append(log_entry)

        # 写入日志文件缓冲区（每条带完整日期时间戳，方便按日归档）
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self._log_file_buffer.append(f"[{now_str}] [{category}] {message}")

        # 事件驱动：新日志产生时立即推送给仪表盘
        if event_bus:
            asyncio.create_task(event_bus.broadcast("log", log_entry))

    def get_uptime_minutes(self):
        delta = time.time() - self.start_time
        total_seconds = int(delta)
        days = total_seconds // 86400
        hours = (total_seconds % 86400) // 3600
        minutes = (total_seconds % 3600) // 60
        if days > 0:
            return f"{days}天{hours}时"
        elif hours > 0:
            return f"{hours}时{minutes}分"
        else:
            return f"{minutes} 分钟"

    def start_img_task(
        self, prompt_id, client_ip, req_id, log_id=0, user_id=0, quota_used=0
    ):
        self.pending_tasks[prompt_id] = {
            "start_time": time.time(),
            "ip": client_ip,
            "req_id": req_id,
            "log_id": log_id,
            "user_id": user_id,
            "quota_used": quota_used,
        }

    def map_prompt_to_filename(self, prompt_id, filename):
        if prompt_id in self.pending_tasks:
            context = self.pending_tasks.pop(prompt_id)
            context["prompt_id"] = prompt_id  # 保留prompt_id
            self.filename_context_map[filename] = context

    def finish_img_task(self, filename: str = None, prompt_id: str = None):
        context = None
        if prompt_id and prompt_id in self.pending_tasks:
            context = self.pending_tasks.pop(prompt_id)
        elif filename and filename in self.filename_context_map:
            context = self.filename_context_map.pop(filename)

        if context:
            duration = time.time() - context["start_time"]
            self.img_last_time = duration
            if duration > self.img_max_time:
                self.img_max_time = duration
            self.img_time_records.append(duration)

            # 事件驱动：生图完成时推送统计更新和任务完成事件
            if event_bus:
                custom_task_id = context.get("custom_task_id", "")
                asyncio.create_task(
                    event_bus.broadcast(
                        "task_completed",
                        {
                            "custom_task_id": custom_task_id,
                            "duration": round(duration, 2),
                        },
                    )
                )
                asyncio.create_task(
                    event_bus.broadcast("stats_update", event_bus.build_stats_update())
                )

    def get_img_avg_time(self):
        return (
            sum(self.img_time_records) / len(self.img_time_records)
            if self.img_time_records
            else 0.0
        )

    def finish_tag_task(self, duration: float):
        self.tag_last_time = duration
        if duration > self.tag_max_time:
            self.tag_max_time = duration
        self.tag_time_records.append(duration)

        # 事件驱动：搜索完成时推送统计更新
        if event_bus:
            asyncio.create_task(
                event_bus.broadcast("stats_update", event_bus.build_stats_update())
            )

    def get_tag_avg_time(self):
        return (
            sum(self.tag_time_records) / len(self.tag_time_records)
            if self.tag_time_records
            else 0.0
        )

    async def broadcast_task_started(self, custom_task_id: str, prompt_id: str):
        if not self.active_clients:
            return
        payload = {
            "type": "task_started",
            "data": {"custom_task_id": custom_task_id, "prompt_id": prompt_id},
        }
        to_remove = set()
        for ws in self.active_clients:
            try:
                await ws.send_json(payload)
            except Exception:
                to_remove.add(ws)
        for ws in to_remove:
            self.active_clients.discard(ws)

    async def broadcast_task_failed(
        self, custom_task_id: str, error_msg: str, error_code: str = "GENERAL_ERROR"
    ):
        if not self.active_clients:
            return
        payload = {
            "type": "task_failed",
            "data": {
                "custom_task_id": custom_task_id,
                "error": error_msg,
                "error_code": error_code,
            },
        }
        to_remove = set()
        for ws in self.active_clients:
            try:
                await ws.send_json(payload)
            except Exception:
                to_remove.add(ws)
        for ws in to_remove:
            self.active_clients.discard(ws)


monitor = ServerMonitor()

# ================= 日志配置 =================
logging.getLogger("uvicorn.access").disabled = True
logger = logging.getLogger("app")


def build_unified_workflow(req, tensorrt_engine: str = None):
    seed = req.seed if req.seed != -1 else random.randint(1, 1000000000000)

    is_sd3_lumina = bool(req.clip_name or req.vae_name)

    workflow = {}
    node_counter = 500

    if is_sd3_lumina:
        # ================= 1. 专业模型 =================
        curr_clip = req.clip_name if req.clip_name else "qwen_3_4b.safetensors"
        curr_vae = req.vae_name if req.vae_name else "ae.safetensors"

        workflow["39"] = {
            "inputs": {"clip_name": curr_clip, "type": "lumina2", "device": "default"},
            "class_type": "CLIPLoader",
        }
        workflow["40"] = {"inputs": {"vae_name": curr_vae}, "class_type": "VAELoader"}
        workflow["41"] = {
            "inputs": {"width": req.width, "height": req.height, "batch_size": 1},
            "class_type": "EmptySD3LatentImage",
        }
        workflow["45"] = {
            "inputs": {"text": req.prompt, "clip": ["39", 0]},
            "class_type": "CLIPTextEncode",
        }
        workflow["46"] = {
            "inputs": {"unet_name": req.ckpt_name, "weight_dtype": "default"},
            "class_type": "UNETLoader",
        }
        workflow["72"] = {
            "inputs": {"text": req.negative_prompt, "clip": ["39", 0]},
            "class_type": "CLIPTextEncode",
        }

        last_model_node = "46"

        # 动态挂载 LoRA
        if req.lora_list:
            for lora in req.lora_list:
                node_id = str(node_counter)
                workflow[node_id] = {
                    "inputs": {
                        "lora_name": lora.name,
                        "strength_model": lora.strength,
                        "model": [last_model_node, 0],
                    },
                    "class_type": "LoraLoaderModelOnly",
                }
                last_model_node = node_id
                node_counter += 1

        workflow["68"] = {
            "inputs": {
                "add_noise": "enable",
                "noise_seed": seed,
                "steps": req.steps,
                "cfg": req.cfg,
                "sampler_name": req.sampler_name,
                "scheduler": req.scheduler,
                "start_at_step": 0,
                "end_at_step": 10000,
                "return_with_leftover_noise": "disable",
                "model": [last_model_node, 0],
                "positive": ["45", 0],
                "negative": ["72", 0],
                "latent_image": ["41", 0],
            },
            "class_type": "KSamplerAdvanced",
        }
        workflow["65"] = {
            "inputs": {"samples": ["68", 0], "vae": ["40", 0]},
            "class_type": "VAEDecode",
        }
        workflow["69"] = {
            "inputs": {"filename_prefix": req.style, "images": ["65", 0]},
            "class_type": "SaveImage",
        }

    else:
        # ================= 2. 标准模型=================
        ckpt_to_use = req.ckpt_name
        workflow["4"] = {
            "inputs": {"ckpt_name": ckpt_to_use},
            "class_type": "CheckpointLoaderSimple",
        }
        workflow["10"] = {
            "inputs": {"stop_at_clip_layer": req.clip_skip, "clip": ["4", 1]},
            "class_type": "CLIPSetLastLayer",
        }
        workflow["7"] = {
            "inputs": {"text": req.negative_prompt, "clip": ["10", 0]},
            "class_type": "CLIPTextEncode",
        }
        workflow["45"] = {
            "inputs": {"text": req.prompt, "clip": ["10", 0]},
            "class_type": "CLIPTextEncode",
        }
        workflow["8"] = {
            "inputs": {"samples": ["68", 0], "vae": ["4", 2]},
            "class_type": "VAEDecode",
        }
        workflow["21"] = {
            "inputs": {"width": req.width, "height": req.height, "batch_size": 1},
            "class_type": "EmptyLatentImage",
        }
        workflow["33"] = {
            "inputs": {"filename_prefix": req.style, "images": ["8", 0]},
            "class_type": "SaveImage",
        }

        # TensorRT 快速模式判断（依据模型自身的 tensorrt_engine 字段）
        if tensorrt_engine:
            workflow["119"] = {
                "inputs": {
                    "unet_name": tensorrt_engine,
                    "model_type": "sdxl_base",
                },
                "class_type": "TensorRTLoader",
            }
            last_model_node = "119"
        else:
            last_model_node = "4"

        # 动态挂载 LoRA（快速模式模型的 lora_list 为空，无需额外判断）
        if req.lora_list:
            for lora in req.lora_list:
                node_id = str(node_counter)
                workflow[node_id] = {
                    "inputs": {
                        "lora_name": lora.name,
                        "strength_model": lora.strength,
                        "model": [last_model_node, 0],
                    },
                    "class_type": "LoraLoaderModelOnly",
                }
                last_model_node = node_id
                node_counter += 1

        positive_input = ["45", 0]

        # 统一使用高级 K 采样器
        workflow["68"] = {
            "inputs": {
                "add_noise": "enable",
                "noise_seed": seed,
                "steps": req.steps,
                "cfg": req.cfg,
                "sampler_name": req.sampler_name,
                "scheduler": req.scheduler,
                "start_at_step": 0,
                "end_at_step": 10000,
                "return_with_leftover_noise": "disable",
                "model": [last_model_node, 0],
                "positive": positive_input,
                "negative": ["7", 0],
                "latent_image": ["21", 0],
            },
            "class_type": "KSamplerAdvanced",
        }

    return workflow, seed


# ================= 调度器核心代码 =================
@dataclass
class Task:
    req_id: int
    payload: dict
    client_id: str
    ckpt_name: str
    custom_task_id: str
    ip: str = "Unknown"
    future: asyncio.Future = field(default_factory=asyncio.Future)
    create_time: float = field(default_factory=time.time)
    prompt_preview: str = ""  # 提示词首句
    model_name: str = ""  # 模型展示名
    db_model_name: str = ""  # 数据库中的模型name（用于精确计数）
    log_id: int = 0  # 生图日志ID
    user_id: int = 0  # 用户ID（用于失败时返还点数）
    quota_used: int = 0  # 本次消耗点数（用于失败时返还）
    lora_list: list = field(default_factory=list)  # LoRA列表（用于完成时计数）
    tensorrt_engine: str = ""  # TensorRT 引擎文件名（用于快速模式）


class SmartScheduler:
    def __init__(self):
        self.queue: List[Task] = []
        self.current_vram_model: str = None
        # 最大并发任务数（超过后不再从队列取新任务）
        self.max_consecutive: int = MAX_CONSECUTIVE_TASKS
        self.lock = asyncio.Lock()
        self.active_tasks: Dict[str, Dict[str, Any]] = {}
        self.task_snapshots: List[Dict[str, Any]] = []

    async def check_task_completion(self):
        if not self.active_tasks:
            return
        try:
            session = app.state.http_session
            completed_prompts = []
            for prompt_id in list(self.active_tasks.keys()):
                async with session.get(f"{COMFYUI_URL}/history/{prompt_id}") as resp:
                    if resp.status == 200:
                        hist_data = await resp.json()
                        if prompt_id in hist_data:
                            self._extract_filename_from_history(
                                hist_data[prompt_id], prompt_id
                            )
                            completed_prompts.append(prompt_id)

            for prompt_id in completed_prompts:
                self.mark_completed(prompt_id)

            # Also check if ComfyUI queue is empty, as a fallback to clear stuck tasks
            if self.active_tasks:
                async with session.get(f"{COMFYUI_URL}/queue") as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        if not data.get("queue_running", []) and not data.get(
                            "queue_pending", []
                        ):
                            # ComfyUI queue is empty, but we still have active tasks? They are stuck!
                            for prompt_id, task_info in list(self.active_tasks.items()):
                                if time.time() - task_info.get("start_time", 0) > 15:
                                    self.mark_completed(prompt_id)
        except Exception as e:
            pass

    def _extract_filename_from_history(self, history_item, prompt_id):
        try:
            outputs = history_item.get("outputs", {})
            for node_id, content in outputs.items():
                if "images" in content:
                    for img in content["images"]:
                        if img.get("type") == "output" and img.get("filename"):
                            monitor.map_prompt_to_filename(
                                prompt_id, img.get("filename")
                            )
        except Exception as e:
            pass

    async def watchdog_loop(self):
        while True:
            await asyncio.sleep(3)
            await self.check_task_completion()

    async def cancel_task(self, custom_task_id: str, client_id: str = None) -> str:
        async with self.lock:
            for i, task in enumerate(self.queue):
                if task.custom_task_id == custom_task_id:
                    if client_id and task.client_id != client_id:
                        return "unauthorized"
                    removed_task = self.queue.pop(i)
                    if not removed_task.future.done():
                        removed_task.future.cancel()
                    if removed_task.log_id:
                        asyncio.create_task(
                            db.update_generation_log(
                                removed_task.log_id,
                                "cancelled",
                                error_message="用户取消任务",
                            )
                        )
                    # 队列中的任务尚未占用 GPU 资源，取消时返还点数
                    if removed_task.user_id and removed_task.quota_used:
                        asyncio.create_task(
                            db.update_user_quota(
                                removed_task.user_id, removed_task.quota_used
                            )
                        )
                    self._update_task_snapshots()
                    # 队列变化 → 统一走 event_bus 广播
                    if event_bus:
                        asyncio.create_task(event_bus.broadcast_queue_update())
                    return "canceled"

            for prompt_id, task_info in list(self.active_tasks.items()):
                if task_info.get("custom_task_id") == custom_task_id:
                    if client_id and task_info.get("client_id") != client_id:
                        return "unauthorized"
                    log_id = task_info.get("log_id")
                    if log_id:
                        asyncio.create_task(
                            db.update_generation_log(
                                log_id, "cancelled", error_message="用户取消任务"
                            )
                        )
                    # 用户主动取消，不返还点数（任务已占用计算资源）
                    # 从 active_tasks 中移除，释放槽位
                    del self.active_tasks[prompt_id]
                    self._update_task_snapshots()
                    # 同时从 ComfyUI 队列中删除 + 中断执行
                    asyncio.create_task(self._cancel_comfyui_task(prompt_id))
                    asyncio.create_task(
                        monitor.broadcast_task_failed(
                            custom_task_id, "任务已被用户手动终止", "USER_CANCELED"
                        )
                    )
                    # 事件驱动：任务取消时推送
                    if event_bus:
                        asyncio.create_task(
                            event_bus.broadcast(
                                "task_failed",
                                {
                                    "custom_task_id": custom_task_id,
                                    "error": "任务已被用户手动终止",
                                },
                            )
                        )
                        asyncio.create_task(event_bus.broadcast_queue_update())
                    # 启动下一个排队任务
                    asyncio.create_task(self.process_next())
                    return "interrupted"
        return "not_found"

    async def _cancel_comfyui_task(self, prompt_id: str):
        """从 ComfyUI 队列中删除指定任务 + 中断正在执行的任务

        ComfyUI 提供两个接口：
        - POST /queue {"delete": [prompt_id]}: 从 pending 队列中删除（不影响 running）
        - POST /interrupt {"prompt_id": ...}: 中断正在执行的任务（定向中断）
        两个都调用，确保无论任务在 pending 还是 running 都能被取消。
        """
        session = app.state.http_session
        try:
            # 1. 从 ComfyUI pending 队列中删除
            async with session.post(
                f"{COMFYUI_URL}/queue",
                json={"delete": [prompt_id]},
            ) as resp:
                if resp.status != 200:
                    monitor.add_log(
                        "ERROR", f"ComfyUI 队列删除失败 | status: {resp.status}"
                    )
        except Exception as e:
            monitor.add_log("ERROR", f"ComfyUI 队列删除请求失败 | {e}")

        try:
            # 2. 定向中断正在执行的任务（带 prompt_id，避免误杀其他任务）
            async with session.post(
                f"{COMFYUI_URL}/interrupt",
                json={"prompt_id": prompt_id},
            ) as resp:
                if resp.status != 200:
                    monitor.add_log(
                        "ERROR", f"ComfyUI 中断失败 | status: {resp.status}"
                    )
        except Exception as e:
            monitor.add_log("ERROR", f"ComfyUI 中断请求失败 | {e}")

    async def add_task(self, task: Task):
        async with self.lock:
            self.queue.append(task)
            self._update_task_snapshots()
            monitor.add_log(
                "SYSTEM",
                f"任务入队 | 队列长度: {len(self.queue)} | 用户 {task.user_id}",
            )
        # 队列变化 → 统一走 event_bus 广播
        if event_bus:
            asyncio.create_task(event_bus.broadcast_queue_update())
        asyncio.create_task(self.process_next())

    def _update_task_snapshots(self):
        self.task_snapshots = []
        for t in self.queue:
            self.task_snapshots.append(
                {
                    "custom_task_id": t.custom_task_id,
                    "ip": t.ip,
                    "user_id": t.user_id,
                    "model": t.model_name or t.ckpt_name,
                    "create_time": t.create_time,
                    "prompt_preview": t.prompt_preview[:50],
                }
            )

    @property
    def current_task_info(self):
        """返回当前运行任务的序列化安全信息（排除 future 等不可 JSON 序列化的字段）"""
        if self.active_tasks:
            info = next(iter(self.active_tasks.values()))
            # 过滤掉不可序列化的字段
            return {k: v for k, v in info.items() if k != "future"}
        return {}

    @property
    def is_processing(self):
        return len(self.active_tasks) > 0

    async def process_next(self):
        async with self.lock:
            if not self.queue:
                return

            if len(self.active_tasks) >= self.max_consecutive:
                return

            selected_index = -1
            if self.active_tasks:
                for i, t in enumerate(self.queue):
                    t_model_id = "FAST_MODE_TRT" if t.tensorrt_engine else t.ckpt_name
                    if t_model_id == self.current_vram_model:
                        selected_index = i
                        break

                if selected_index == -1:
                    return
            else:
                selected_index = 0

            task = self.queue.pop(selected_index)
            task_model_id = "FAST_MODE_TRT" if task.tensorrt_engine else task.ckpt_name
            self.current_vram_model = task_model_id

            task_info = {
                "custom_task_id": task.custom_task_id,
                "client_id": task.client_id,
                "prompt_preview": task.prompt_preview[:50],
                "model": task.model_name or task.ckpt_name,
                "start_time": time.time(),
                "ip": task.ip,
                "req_id": task.req_id,
                "log_id": task.log_id,
                "ckpt_name": task.ckpt_name,
                "db_model_name": task.db_model_name,
                "user_id": task.user_id,
                "quota_used": task.quota_used,
                "lora_list": task.lora_list,
                "future": task.future,
            }
            self._update_task_snapshots()
            # 队列变化 → 统一走 event_bus 广播
            if event_bus:
                asyncio.create_task(event_bus.broadcast_queue_update())

        try:
            session = app.state.http_session
            async with session.post(f"{COMFYUI_URL}/prompt", json=task.payload) as resp:
                if resp.status != 200:
                    text = await resp.text()
                    monitor.add_log("ERROR", f"ComfyUI 拒绝任务 | {text}")
                    if task.log_id:
                        await db.update_generation_log(
                            task.log_id,
                            "failed",
                            error_message=f"ComfyUI Error: {text}",
                        )
                    if task.user_id and task.quota_used:
                        await db.update_user_quota(task.user_id, task.quota_used)
                    if not task.future.done():
                        task.future.set_exception(Exception(f"ComfyUI Error: {text}"))
                    asyncio.create_task(
                        monitor.broadcast_task_failed(
                            task.custom_task_id, f"ComfyUI Error: {text}"
                        )
                    )
                    # 事件驱动：任务失败时推送
                    if event_bus:
                        asyncio.create_task(
                            event_bus.broadcast(
                                "task_failed",
                                {
                                    "custom_task_id": task.custom_task_id,
                                    "error": f"ComfyUI Error: {text}",
                                },
                            )
                        )
                        asyncio.create_task(event_bus.broadcast_queue_update())
                    asyncio.create_task(self.process_next())
                else:
                    data = await resp.json()
                    prompt_id = data["prompt_id"]
                    if not task.future.done():
                        task.future.set_result(prompt_id)

                    async with self.lock:
                        self.active_tasks[prompt_id] = task_info

                    monitor.start_img_task(
                        prompt_id,
                        task.ip,
                        task.req_id,
                        task.log_id,
                        task.user_id,
                        task.quota_used,
                    )
                    monitor.add_log(
                        "SYSTEM",
                        f"任务开始执行 | 用户 {task.user_id} | 模型: {task.model_name or task.ckpt_name}",
                    )
                    asyncio.create_task(
                        monitor.broadcast_task_started(task.custom_task_id, prompt_id)
                    )
                    # 事件驱动：任务开始时推送（排除不可序列化的 future 字段）
                    if event_bus:
                        safe_task_info = {
                            k: v for k, v in task_info.items() if k != "future"
                        }
                        asyncio.create_task(
                            event_bus.broadcast("task_started", safe_task_info)
                        )
                        asyncio.create_task(event_bus.broadcast_queue_update())

                    asyncio.create_task(self.process_next())

        except Exception as e:
            if task.log_id:
                await db.update_generation_log(
                    task.log_id, "failed", error_message=str(e)
                )
            if task.user_id and task.quota_used:
                await db.update_user_quota(task.user_id, task.quota_used)
            if not task.future.done():
                task.future.set_exception(e)
            asyncio.create_task(
                monitor.broadcast_task_failed(task.custom_task_id, str(e))
            )
            # 事件驱动：任务异常时推送
            if event_bus:
                asyncio.create_task(
                    event_bus.broadcast(
                        "task_failed",
                        {
                            "custom_task_id": task.custom_task_id,
                            "error": str(e),
                        },
                    )
                )
                asyncio.create_task(event_bus.broadcast_queue_update())
            asyncio.create_task(self.process_next())

    def mark_completed(self, prompt_id: str):
        task_info = self.active_tasks.pop(prompt_id, None)
        if not task_info:
            return

        log_id = task_info.get("log_id")
        start_time = task_info.get("start_time")

        filename = None
        for fn, ctx in list(monitor.filename_context_map.items()):
            if ctx.get("prompt_id") == prompt_id:
                filename = fn
                monitor.filename_context_map.pop(fn)
                break

        ckpt_name = task_info.get("ckpt_name")
        db_model_name = task_info.get("db_model_name")
        user_id = task_info.get("user_id")
        if db_model_name:
            asyncio.create_task(db.increment_model_calls(db_model_name))
        elif ckpt_name:
            # 兜底：按 ckpt_name 计数，但仅当唯一对应一个模型时才执行
            asyncio.create_task(db.increment_model_calls_by_ckpt_safe(ckpt_name))

        # 生图完成时增加 LoRA 调用计数
        lora_list = task_info.get("lora_list", [])
        if lora_list:
            for lora in lora_list:
                lora_name = lora.get("name") if isinstance(lora, dict) else lora.name
                if lora_name:
                    asyncio.create_task(db.increment_lora_calls(lora_name))
        if user_id:
            asyncio.create_task(db.increment_user_generated(user_id))

        if log_id and start_time:
            duration = time.time() - start_time
            asyncio.create_task(
                db.update_generation_log(
                    log_id, "completed", filename=filename, duration=duration
                )
            )

            # 生图完成日志
            user_id = task_info.get("user_id", "?")
            monitor.add_log("USER", f"用户 {user_id} 生图完成 | 耗时 {duration:.1f}s")

            # 更新生图耗时统计并推送仪表盘
            monitor.img_last_time = duration
            if duration > monitor.img_max_time:
                monitor.img_max_time = duration
            monitor.img_time_records.append(duration)

            if event_bus:
                asyncio.create_task(
                    event_bus.broadcast(
                        "task_completed",
                        {
                            "custom_task_id": task_info.get("custom_task_id", ""),
                            "duration": round(duration, 2),
                        },
                    )
                )
                asyncio.create_task(
                    event_bus.broadcast("stats_update", event_bus.build_stats_update())
                )

        # 确保不会被超时清理逻辑错误返还点数
        if prompt_id in monitor.pending_tasks:
            monitor.pending_tasks.pop(prompt_id, None)

        # 事件驱动：任务从 active_tasks 移除时，推送队列更新
        # （current_task_info 会自动变为空，仪表盘需要知道）
        if event_bus:
            asyncio.create_task(event_bus.broadcast_queue_update())

        asyncio.create_task(self.process_next())

    async def calculate_dynamic_cooldown(self, client_ip: str = None) -> int:
        """根据队列长度计算动态冷却时间

        公式: min(BASE + queue_length * MULTIPLIER, MAX)
        本地 IP 再乘以 LOCAL_RATIO（0 = 无冷却）
        """
        async with self.lock:
            queue_len = len(self.queue)
            cooldown = min(
                COOLDOWN_BASE + queue_len * COOLDOWN_QUEUE_MULTIPLIER, COOLDOWN_MAX
            )
            if client_ip and client_ip in ["127.0.0.1", "localhost", "::1"]:
                cooldown = cooldown * COOLDOWN_LOCAL_RATIO
            return max(0, math.ceil(cooldown))


scheduler = SmartScheduler()

# 仪表盘事件总线（在 lifespan 中初始化，模块加载时为 None）
event_bus: DashboardEventBus | None = None


# ================= 定期清理超时 pending_tasks =================
async def cleanup_stale_prompts():
    """清理长时间未完成的生成任务，释放内存，返还点数"""
    while True:
        await asyncio.sleep(300)  # 每5分钟检查
        now = time.time()
        stale_ids = [
            pid
            for pid, ctx in monitor.pending_tasks.items()
            if now - ctx["start_time"] > 600  # 10分钟超时
        ]
        for pid in stale_ids:
            ctx = monitor.pending_tasks.pop(pid)
            monitor.add_log("ERROR", f"任务超时清理 | prompt_id: {pid}")
            # 更新日志状态为失败，返还点数
            log_id = ctx.get("log_id", 0)
            user_id = ctx.get("user_id", 0)
            quota_used = ctx.get("quota_used", 0)
            if log_id:
                await db.update_generation_log(
                    log_id, "failed", error_message="任务超时，系统自动清理"
                )
            if user_id and quota_used:
                await db.update_user_quota(user_id, quota_used)

        # 定期清理 IP 请求计数（防止内存泄漏，但不清空以保持 req_id 连续性）
        if len(monitor.ip_request_counts) > 10000:
            # 保留计数较大的一半（近期活跃的 IP）
            sorted_ips = sorted(
                monitor.ip_request_counts.items(), key=lambda x: x[1], reverse=True
            )
            monitor.ip_request_counts = dict(sorted_ips[:5000])

        # 清理兑换码限流字典中过期的 IP 记录
        now = time.time()
        stale_ips = [
            ip
            for ip, attempts in redeem_attempts.items()
            if not attempts or now - attempts[-1] > REDEEM_RATE_WINDOW
        ]
        for ip in stale_ips:
            del redeem_attempts[ip]

        # 清理 last_generate_time 中超过 1 小时未活跃的记录（防止内存泄漏）
        stale_clients = [cid for cid, t in last_generate_time.items() if now - t > 3600]
        for cid in stale_clients:
            del last_generate_time[cid]


# ================= FastAPI 生命周期与应用 =================
async def _refresh_db_stats():
    """定期刷新数据库统计缓存，并推送变化给仪表盘"""
    while True:
        try:
            stats = await db.get_dashboard_stats()
            monitor.cached_total_users = stats["total_users"]
            monitor.cached_users_today = stats["users_today"]
            monitor.cached_total_generated = stats["total_generated"]
            # 事件驱动：数据库统计刷新后推送
            if event_bus:
                asyncio.create_task(
                    event_bus.broadcast(
                        "stats_update",
                        {
                            "total_users": stats["total_users"],
                            "users_today": stats["users_today"],
                            "total_generated": stats["total_generated"],
                        },
                    )
                )
        except Exception as e:
            logger.debug(f"刷新数据库统计缓存失败: {e}")
        await asyncio.sleep(60)


async def _daily_gift_task():
    """每日定时生成赠礼兑换码"""
    if not DAILY_GIFT_ENABLED:
        return

    while True:
        # 计算到下一个 DAILY_GIFT_TIME 的等待秒数
        now = datetime.now(_BEIJING_TZ)
        target = now.replace(
            hour=DAILY_GIFT_HOUR, minute=DAILY_GIFT_MINUTE, second=0, microsecond=0
        )
        # 如果今天的生成时间已过，目标设为明天
        if now >= target:
            target += timedelta(days=1)
        wait_seconds = (target - now).total_seconds()

        await asyncio.sleep(wait_seconds)

        try:
            code = await db.generate_daily_gift_code(
                DAILY_GIFT_QUOTA, DAILY_GIFT_VALID_HOURS, DAILY_GIFT_VALID_MINUTES
            )
            monitor.add_log("SYSTEM", f"每日赠礼 | 兑换码: {code}")
        except Exception as e:
            pass


async def _daily_log_dump_task():
    """每日凌晨6点将昨日日志写入文件

    目录结构: log/YYYY-MM/YYYY-MM-DD.log
    """
    while True:
        # 计算到下一个凌晨6点的等待秒数
        now = datetime.now(_BEIJING_TZ)
        target = now.replace(hour=6, minute=0, second=0, microsecond=0)
        # 如果今天的6点已过，目标设为明天6点
        if now >= target:
            target += timedelta(days=1)
        wait_seconds = (target - now).total_seconds()

        await asyncio.sleep(wait_seconds)

        try:
            # 获取昨日日期
            yesterday = (datetime.now(_BEIJING_TZ) - timedelta(days=1)).strftime(
                "%Y-%m-%d"
            )
            year_month = yesterday[:7]  # YYYY-MM

            # 从缓冲区中筛选属于昨日的日志（按日期前缀匹配）
            yesterday_prefix = f"[{yesterday} "
            yesterday_logs = [
                line
                for line in monitor._log_file_buffer
                if line.startswith(yesterday_prefix)
            ]

            # 从缓冲区移除已归档的日志
            monitor._log_file_buffer = [
                line
                for line in monitor._log_file_buffer
                if not line.startswith(yesterday_prefix)
            ]

            if not yesterday_logs:
                continue

            # 创建目录并写入文件
            log_dir = Path("log") / year_month
            log_dir.mkdir(parents=True, exist_ok=True)
            log_file = log_dir / f"{yesterday}.log"

            with open(log_file, "w", encoding="utf-8") as f:
                f.write(f"# 日志文件 - {yesterday}\n")
                f.write(
                    f"# 生成时间: {datetime.now(_BEIJING_TZ).strftime('%Y-%m-%d %H:%M:%S')}\n\n"
                )
                for line in yesterday_logs:
                    f.write(line + "\n")

        except Exception as e:
            logger.debug(f"日志文件写入失败: {e}")


async def _expire_overdue_tokens():
    """定期扫描并更新已过期的 token/batch 状态为 expired"""
    # 启动时立即执行一次
    try:
        count = await db.expire_overdue_tokens()
    except Exception as e:
        logger.debug(f"启动时过期检查失败: {e}")
    while True:
        await asyncio.sleep(60)  # 每 60 秒扫描一次
        try:
            count = await db.expire_overdue_tokens()
        except Exception as e:
            logger.debug(f"定时过期检查失败: {e}")


async def lifespan(app: FastAPI):
    # 云端部署：Nginx 和标签搜索服务独立运行，不由此进程管理

    # 创建全局 HTTP Session（复用连接池，30 秒超时防止请求挂起）
    app.state.http_session = aiohttp.ClientSession(
        timeout=aiohttp.ClientTimeout(total=30)
    )

    # 初始化仪表盘事件总线
    global event_bus
    event_bus = DashboardEventBus(monitor, scheduler, COMFYUI_URL)

    # 启动时立即加载一次数据库统计缓存
    try:
        stats = await db.get_dashboard_stats()
        monitor.cached_total_users = stats["total_users"]
        monitor.cached_users_today = stats["users_today"]
        monitor.cached_total_generated = stats["total_generated"]
    except Exception as e:
        logger.debug(f"初始加载数据库统计失败: {e}")

    # 启动时从数据库恢复历史生图耗时数据
    try:
        img_durations = await db.get_recent_img_durations(100)
        for d in img_durations:
            monitor.img_time_records.append(d)
    except Exception as e:
        logger.debug(f"恢复历史生图耗时数据失败: {e}")

    # 启动时从数据库恢复历史搜索耗时数据
    try:
        search_durations = await db.get_recent_search_durations(100)
        for d in search_durations:
            monitor.tag_time_records.append(d)
    except Exception as e:
        logger.debug(f"恢复历史搜索耗时数据失败: {e}")

    # 创建后台任务并保存引用
    background_tasks = [
        asyncio.create_task(scheduler.watchdog_loop()),
        asyncio.create_task(system_monitor_loop()),
        asyncio.create_task(cleanup_stale_prompts()),
        asyncio.create_task(_refresh_db_stats()),
        asyncio.create_task(_expire_overdue_tokens()),
        asyncio.create_task(_daily_gift_task()),
        asyncio.create_task(_daily_log_dump_task()),
        asyncio.create_task(event_bus.heartbeat_loop()),
        asyncio.create_task(event_bus.queue_poll_loop()),
    ]

    yield

    # 取消所有后台任务
    for task in background_tasks:
        task.cancel()
    await asyncio.gather(*background_tasks, return_exceptions=True)

    # 关闭 HTTP Session
    await app.state.http_session.close()


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

# 挂载前端静态文件，使前端通过 http://127.0.0.1:8899 访问

frontend_dir = FRONTEND_DIR
# 先挂载API路由，再挂载静态文件（静态文件放最后，作为fallback）
# 注意：静态文件mount必须在所有API路由之后


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    """用户鉴权中间件：从 Cookie 解析用户身份，注入 request.state"""
    path = request.url.path
    # 跳过非 API 路径、admin 路径和 auth/init 端点
    if (
        not path.startswith("/api/")
        or path.startswith("/api/admin/")
        or path == "/api/auth/init"
    ):
        return await call_next(request)

    user_id = None
    client_id = None
    fingerprint = None
    binding_hash = None

    # 1. 尝试从 Cookie 获取用户身份
    token = request.cookies.get("user_token")
    if token:
        payload = verify_token(token)
        if payload:
            user_id = payload.get("user_id")
            client_id = payload.get("client_id")
            fingerprint = payload.get("fp")
            binding_hash = payload.get("bh")

    # client_id 仅从 Cookie 签名令牌中提取，不再回退到查询参数，防止身份冒充

    # 3. Cookie 中没有 fingerprint → 尝试从请求头获取（前端通过 X-Fingerprint 传递）
    if not fingerprint:
        fingerprint = request.headers.get("x-fingerprint")

    # 4. Cookie 中没有 binding_hash → 从当前请求实时计算
    if not binding_hash:
        client_ip = request.client.host
        user_agent = request.headers.get("user-agent", "")
        binding_hash = compute_binding_hash(client_ip, user_agent)

    # 注入到 request.state，供后续路由使用
    request.state.user_id = user_id
    request.state.client_id = client_id
    request.state.fingerprint = fingerprint
    request.state.binding_hash = binding_hash

    return await call_next(request)


@app.middleware("http")
async def monitor_requests(request: Request, call_next):
    monitor.log_request_stat(request.url.path)
    try:
        return await call_next(request)
    except Exception as e:
        raise e


# ================= 业务接口 =================
@app.post("/api/related")
async def get_related_tags(req: RelatedRequest, request: Request):
    client_ip = request.client.host
    req_id = monitor.get_next_request_id(client_ip)
    task_name = "关联词查询"
    start_time = time.time()

    payload = {"tags": req.tags, "limit": req.limit, "show_nsfw": req.show_nsfw}

    try:
        session = request.app.state.http_session
        related_api_url = TAG_API_URL.replace("/search", "/related")
        async with session.post(related_api_url, json=payload) as resp:
            raw_text = await resp.text()

            if resp.status == 200:
                data = json.loads(raw_text)
                duration = time.time() - start_time
                # 关联查询日志
                user_id = getattr(request.state, "user_id", "?")
                monitor.add_log(
                    "USER",
                    f"用户 {user_id} 关联查询 | 标签: {', '.join(req.tags)} | 耗时 {duration:.2f}s",
                )
                return data
            else:
                raise HTTPException(
                    status_code=resp.status, detail="关联词服务暂时不可用"
                )

    except Exception as e:
        raise HTTPException(status_code=500, detail="关联词服务连接失败")


@app.post("/api/search_tags")
async def search_tags_endpoint(req: TagSearchRequest, request: Request):
    client_ip = request.client.host
    req_id = monitor.get_next_request_id(client_ip)
    task_name = "搜索标签"
    start_time = time.time()

    payload = {
        "query": req.query,
        "top_k": req.top_k,
        "limit": req.limit,
        "popularity_weight": req.popularity_weight,
        "show_nsfw": True,
        "use_segmentation": req.use_segmentation,
        "target_layers": req.target_layers,
        "target_categories": req.target_categories,
    }

    try:
        session = request.app.state.http_session
        async with session.post(TAG_API_URL, json=payload) as resp:
            raw_text = await resp.text()

            if resp.status == 200:
                data = json.loads(raw_text)
                duration = time.time() - start_time
                monitor.finish_tag_task(duration)

                # 记录搜索日志到数据库
                try:
                    user_id = getattr(request.state, "user_id", None)
                    asyncio.create_task(db.create_search_log(user_id, duration))
                except Exception:
                    pass

                # 递增用户搜索计数
                try:
                    cid = getattr(request.state, "client_id", None)
                    if cid:
                        asyncio.create_task(db.increment_user_searches(cid))
                except Exception:
                    pass

                # 搜索标签日志
                user_id = getattr(request.state, "user_id", "?")
                results_count = len(data.get("results", []))
                monitor.add_log(
                    "USER",
                    f"用户 {user_id} 搜索标签 | 关键词: {req.query} | 匹配: {results_count}条 | 耗时 {duration:.2f}s",
                )
                return data
            else:
                raise HTTPException(
                    status_code=resp.status, detail="标签搜索服务暂时不可用"
                )

    except Exception as e:
        raise HTTPException(status_code=500, detail="标签搜索服务连接失败")


@app.websocket("/ws")
async def websocket_comfyui_proxy(websocket: WebSocket):
    """代理客户端 WebSocket 到 ComfyUI（/ws?clientId=xxx）

    开发模式下 Vite 代理 /ws 到 ComfyUI，生产模式下需要后端自行转发。
    """
    client_id = websocket.query_params.get("clientId")
    if not client_id:
        await websocket.close(code=4000, reason="缺少 clientId 参数")
        return

    comfyui_ws_url = f"{COMFYUI_URL.replace('http', 'ws')}/ws?clientId={client_id}"
    session: aiohttp.ClientSession = app.state.http_session

    try:
        async with session.ws_connect(comfyui_ws_url) as comfyui_ws:
            await websocket.accept()

            # 双向转发：客户端 ↔ ComfyUI
            async def client_to_comfyui():
                try:
                    while True:
                        data = await websocket.receive()
                        if "text" in data:
                            await comfyui_ws.send_str(data["text"])
                        elif "bytes" in data:
                            await comfyui_ws.send_bytes(data["bytes"])
                        elif data.get("type") == "websocket.disconnect":
                            break
                except Exception:
                    pass

            async def comfyui_to_client():
                try:
                    async for msg in comfyui_ws:
                        if msg.type == aiohttp.WSMsgType.TEXT:
                            await websocket.send_text(msg.data)
                        elif msg.type == aiohttp.WSMsgType.BINARY:
                            await websocket.send_bytes(msg.data)
                        elif msg.type in (
                            aiohttp.WSMsgType.CLOSED,
                            aiohttp.WSMsgType.ERROR,
                        ):
                            break
                except Exception:
                    pass

            # 任一方向断开即取消另一个，避免僵尸挂起
            t_c2s = asyncio.create_task(client_to_comfyui())
            t_s2c = asyncio.create_task(comfyui_to_client())
            done, pending = await asyncio.wait(
                [t_c2s, t_s2c], return_when=asyncio.FIRST_COMPLETED
            )
            for t in pending:
                t.cancel()
            # 等待被取消的任务清理完毕，忽略 CancelledError
            await asyncio.gather(*pending, return_exceptions=True)
    except Exception as e:
        logger.debug(f"ComfyUI WebSocket 代理连接失败: {e}")
        try:
            await websocket.close(code=1011, reason="ComfyUI 连接失败")
        except Exception:
            pass


@app.websocket("/api/ws/status")
async def websocket_status_endpoint(websocket: WebSocket):
    """普通用户状态 WebSocket —— 接入 event_bus 接收 queue_update 等消息"""
    await websocket.accept()
    client_ip = websocket.client.host
    # 尝试从 Cookie 获取用户 ID
    ws_user_id = "?"
    token = websocket.cookies.get("user_token")
    if token:
        payload = verify_token(token)
        if payload:
            ws_user_id = payload.get("user_id", "?")
    monitor.active_clients.add(websocket)
    monitor.add_log("SYSTEM", f"用户 {ws_user_id} 上线")

    # 注册到 event_bus，接收 queue_update / task_started / task_failed 等广播
    if event_bus:
        await event_bus.register(websocket)

    try:
        while True:
            msg = await websocket.receive_text()
            if msg == "ping":
                await websocket.send_text("pong")
    except Exception as e:
        logger.debug(f"WebSocket 连接关闭: {e}")
    finally:
        monitor.active_clients.discard(websocket)
        if event_bus:
            await event_bus.unregister(websocket)
        monitor.add_log("SYSTEM", f"用户 {ws_user_id} 下线")


# 记录每个客户端的最后生图时间
last_generate_time: Dict[str, float] = {}


@app.post("/api/generate")
async def generate_image(req: GenerateRequest, request: Request):
    client_ip = request.client.host
    req_id = monitor.get_next_request_id(client_ip)

    # 使用 Cookie 鉴权结果（中间件已从 Cookie/query 提取），不再回退到请求体 client_id
    resolved_client_id = getattr(request.state, "client_id", None)
    if not resolved_client_id:
        raise HTTPException(status_code=401, detail="请先完成身份认证")

    # 动态冷却检查
    now = time.time()
    last_time = last_generate_time.get(resolved_client_id, 0)
    cooldown = await scheduler.calculate_dynamic_cooldown(client_ip)
    remaining = cooldown - (now - last_time)
    if remaining > 0:
        raise HTTPException(
            status_code=429,
            detail={
                "message": f"冷却中，请等待 {int(remaining)} 秒后再试",
                "remaining": int(remaining),
            },
        )

    last_generate_time[resolved_client_id] = now
    lora_display = ", ".join([l.name for l in req.lora_list]) if req.lora_list else "无"

    try:
        # 获取用户信息
        user = await db.get_or_create_user(
            resolved_client_id,
            fingerprint=getattr(request.state, "fingerprint", None),
            binding_hash=getattr(request.state, "binding_hash", None),
        )
        model_display = req.model_name or req.ckpt_name
        monitor.add_log(
            "USER",
            f"用户 {user['id']} 生图 | 风格: {req.style} | 模型: {model_display} | LoRA: {lora_display} | {req.width}x{req.height} | Steps: {req.steps} | CFG: {req.cfg} | Seed: {req.seed} | 提示词: {req.prompt}",
        )
        model_cost = await db.get_model_cost(req.ckpt_name)

        # 优先按 model_name 精确查找模型，回退到 ckpt_name 查找
        # 解决同 ckpt_name 不同模型（如 Ill_WAI / Ill_WAI快速模式）的区分问题
        model_info = None
        if req.model_name:
            model_info = await db.get_model_by_name(req.model_name)
        if not model_info:
            model_info = await db.get_model_by_ckpt(req.ckpt_name)
        tensorrt_engine_name = model_info.get("tensorrt_engine") if model_info else None

        # 构建 workflow 并获取实际使用的 seed（随机种子时由系统生成）
        workflow, actual_seed = build_unified_workflow(
            req, tensorrt_engine=tensorrt_engine_name
        )

        # 创建生图日志（无论成功失败都记录）
        log_id = await db.create_generation_log(
            user_id=user["id"],
            prompt=req.prompt,
            negative_prompt=req.negative_prompt,
            ckpt_name=req.ckpt_name,
            width=req.width,
            height=req.height,
            steps=req.steps,
            cfg=req.cfg,
            seed=actual_seed,
            sampler_name=req.sampler_name,
            scheduler=req.scheduler,
            lora_list=[{"name": l.name, "strength": l.strength} for l in req.lora_list],
            client_ip=client_ip,
            quota_used=model_cost,
        )

        # 原子性额度校验与扣除（避免并发请求超额扣除）
        success, current_quota = await db.deduct_quota_if_sufficient(
            user["id"], model_cost
        )
        if not success:
            # 额度不足，更新日志为失败状态
            await db.update_generation_log(
                log_id,
                "failed",
                error_message=f"额度不足，当前点数: {current_quota}，需要: {model_cost}",
            )
            raise HTTPException(
                status_code=403,
                detail={
                    "message": f"额度不足，当前点数: {current_quota}，需要: {model_cost}"
                },
            )

        # 使用 comfyui_session_id 作为 ComfyUI 的 client_id（每个窗口独立，避免 WS 消息路由冲突）
        # 如果前端未提供，回退到 resolved_client_id（兼容旧版前端）
        comfyui_client_id = req.comfyui_session_id or resolved_client_id

        task = Task(
            req_id=req_id,
            payload={"prompt": workflow, "client_id": comfyui_client_id},
            client_id=resolved_client_id,
            ckpt_name=req.ckpt_name,
            ip=client_ip,
            custom_task_id=req.custom_task_id,
            prompt_preview=req.prompt.strip(),
            model_name=req.model_name or f"{req.style} ({req.ckpt_name})",
            db_model_name=model_info.get("name", "") if model_info else "",
            log_id=log_id,
            user_id=user["id"],
            quota_used=model_cost,
            lora_list=[{"name": l.name, "strength": l.strength} for l in req.lora_list],
            tensorrt_engine=tensorrt_engine_name or "",
        )
        await scheduler.add_task(task)
        return {
            "status": "queued",
            "custom_task_id": req.custom_task_id,
            "client_id": resolved_client_id,
        }

    except Exception as e:
        raise e


@app.get("/api/queue")
async def get_queue():
    """返回统一队列状态（与 WS queue_update 数据结构一致）"""
    # 复用 event_bus 的 build_queue_update_fresh，保证 HTTP 和 WS 返回结构一致
    if event_bus:
        return await event_bus.build_queue_update_fresh()

    # 兜底：event_bus 未初始化时手动构建
    session = app.state.http_session
    try:
        async with session.get(f"{COMFYUI_URL}/queue") as resp:
            comfy_queue = await resp.json()
    except Exception as e:
        comfy_queue = {}

    task_queue = [t.custom_task_id for t in scheduler.queue]
    running_ids = [info["custom_task_id"] for info in scheduler.active_tasks.values()]
    return {
        "task_queue": task_queue,
        "running_ids": running_ids,
        "queue_running_count": len(comfy_queue.get("queue_running", [])),
        "queue_pending_count": len(comfy_queue.get("queue_pending", [])),
        "task_list": scheduler.task_snapshots,
        "current_task": scheduler.current_task_info,
    }


@app.post("/api/cancel_task")
async def cancel_task_endpoint(req: CancelRequest, request: Request):
    resolved_client_id = getattr(request.state, "client_id", None)
    if not resolved_client_id:
        raise HTTPException(status_code=401, detail="请先完成身份认证")
    result = await scheduler.cancel_task(req.custom_task_id, resolved_client_id)
    if result in ["canceled", "interrupted"]:
        user_id = getattr(request.state, "user_id", "?")
        monitor.add_log("USER", f"用户 {user_id} 取消任务 | {req.custom_task_id}")
        return {"status": result}
    if result == "unauthorized":
        raise HTTPException(status_code=403, detail="无权取消此任务")
    return {"status": "not_found_or_running"}


# ================= 数据库相关接口 =================
@app.get("/api/models")
async def get_models():
    """获取所有模型（按分类分组，兼容前端modes.json格式）"""
    return await db.get_models_grouped()


@app.get("/api/loras")
async def get_loras():
    """获取所有LoRA（兼容前端lora.json格式）"""
    return await db.get_loras_dict()


@app.get("/api/auth/init")
async def auth_init(fingerprint: str, request: Request):
    """初始化认证：验证/签发 Cookie，返回 client_id
    不接受客户端提供的 client_id，防止身份冒充"""
    client_ip = request.client.host
    user_agent = request.headers.get("user-agent", "")
    binding_hash = compute_binding_hash(client_ip, user_agent)

    # 从 Cookie 中尝试获取已有令牌
    existing_token = request.cookies.get("user_token")
    if existing_token:
        payload = verify_token(existing_token)
        if payload:
            # Cookie 有效，返回已有的 client_id
            # 补全老用户缺失的 fingerprint / binding_hash
            await db.update_user_fingerprint_if_missing(
                payload["client_id"], fingerprint=fingerprint, binding_hash=binding_hash
            )
            return {"client_id": payload["client_id"]}

    # Cookie 无效或不存在 → 通过 fingerprint 查找已有用户
    existing_user = await db.get_user_by_fingerprint(fingerprint)
    if existing_user:
        client_id = existing_user["client_id"]
    else:
        # 新用户：服务端生成 client_id
        client_id = f"client_{int(time.time() * 1000)}_{uuid.uuid4().hex[:9]}"

    user = await db.get_or_create_user(
        client_id, fingerprint=fingerprint, binding_hash=binding_hash
    )

    # 签发新 Cookie
    token_payload = {
        "user_id": user["id"],
        "client_id": user["client_id"],
        "fp": fingerprint,
        "bh": binding_hash,
        "iat": int(time.time()),
    }
    token = sign_token(token_payload)

    response = JSONResponse({"client_id": user["client_id"]})
    response.set_cookie(
        key="user_token",
        value=token,
        httponly=True,
        samesite="lax",
        secure=COOKIE_SECURE,
        max_age=86400 * 30,  # 30 天
        path="/",
    )
    return response


@app.get("/api/user/quota")
async def get_user_quota(
    request: Request, client_id: str = None, ckpt_name: str = None
):
    """获取用户额度信息，可选返回指定模型的点数消耗"""
    # 使用中间件从 Cookie 提取的 client_id
    resolved_client_id = getattr(request.state, "client_id", None)
    if not resolved_client_id:
        raise HTTPException(status_code=400, detail="client_id is required")
    user = await db.get_or_create_user(
        resolved_client_id,
        fingerprint=getattr(request.state, "fingerprint", None),
        binding_hash=getattr(request.state, "binding_hash", None),
    )
    result = {
        "client_id": user["client_id"],
        "quota": user["quota"],
        "total_generated": user["total_generated"],
        "last_request_at": user.get("last_request_at"),
        "preset_count": user.get("preset_count", 0),
        "used_tokens": user.get("used_tokens", 0),
    }
    if ckpt_name:
        result["model_cost"] = await db.get_model_cost(ckpt_name)
    return result


@app.post(
    "/api/token/redeem",
    dependencies=[Depends(check_redeem_rate), Depends(check_redeem_lockout)],
)
async def redeem_token(req: RedeemTokenRequest, request: Request):
    """兑换点数卡"""
    # 使用 Cookie 鉴权结果（中间件已从 Cookie/query 提取），不再回退到请求体 client_id
    resolved_client_id = getattr(request.state, "client_id", None)
    if not resolved_client_id:
        raise HTTPException(status_code=401, detail="请先完成身份认证")
    user = await db.get_or_create_user(
        resolved_client_id,
        fingerprint=getattr(request.state, "fingerprint", None),
        binding_hash=getattr(request.state, "binding_hash", None),
    )

    # 检查 client_id 维度的锁定
    client_id = resolved_client_id
    now = time.time()
    cid_failures = redeem_failures.get(client_id, [])
    redeem_failures[client_id] = [
        t for t in cid_failures if now - t < REDEEM_LOCKOUT_DURATION
    ]
    if len(redeem_failures[client_id]) >= REDEEM_LOCKOUT_THRESHOLD:
        raise HTTPException(status_code=429, detail="兑换失败次数过多，请10分钟后再试")

    success, message, quota_added = await db.redeem_token(
        req.token_code, user["id"], DAILY_GIFT_MAX_QUOTA
    )

    if not success:
        # 记录失败
        redeem_failures.setdefault(client_id, []).append(now)
        redeem_failures.setdefault(request.client.host, []).append(now)
        raise HTTPException(
            status_code=400, detail={"success": False, "message": message}
        )

    # 成功则清除失败记录
    redeem_failures.pop(client_id, None)
    redeem_failures.pop(request.client.host, None)

    monitor.add_log("USER", f"用户 {user['id']} 兑换 | 获得 {quota_added} 点数")

    # 兑换成功后重新查询最新额度
    updated_user = await db.get_or_create_user(
        resolved_client_id,
        fingerprint=getattr(request.state, "fingerprint", None),
        binding_hash=getattr(request.state, "binding_hash", None),
    )
    return {
        "success": True,
        "message": message,
        "quota_added": quota_added,
        "new_quota": updated_user["quota"],
    }


@app.get("/api/daily-gift")
async def get_daily_gift():
    """获取当日赠礼兑换码（无需认证，兑换码公开）"""
    token_code = await db.get_daily_gift_code()
    return {"token_code": token_code}


@app.get("/api/presets")
async def get_presets(request: Request, client_id: str = None):
    """获取用户预设列表（不含图片）"""
    # 使用中间件从 Cookie 提取的 client_id
    resolved_client_id = getattr(request.state, "client_id", None)
    if not resolved_client_id:
        raise HTTPException(status_code=400, detail="client_id is required")
    user = await db.get_or_create_user(
        resolved_client_id,
        fingerprint=getattr(request.state, "fingerprint", None),
        binding_hash=getattr(request.state, "binding_hash", None),
    )
    presets = await db.get_user_presets(user["id"])
    return {"presets": presets}


@app.get("/api/preset_image/{uuid}")
async def get_preset_image(uuid: str):
    """获取预设图片"""
    image_base64 = await db.get_preset_image(uuid)
    if not image_base64:
        raise HTTPException(status_code=404, detail="图片不存在")
    return {"image_base64": image_base64}


@app.post("/api/presets")
async def save_preset(
    request: Request,
    name: str = Form(...),
    prompt: str = Form(...),
    params: str = Form(None),
    image_base64: str = Form(None),
):
    """保存预设到数据库（同名+同用户则更新，否则插入）"""
    # 使用中间件从 Cookie 提取的 client_id
    resolved_client_id = getattr(request.state, "client_id", None)
    if not resolved_client_id:
        raise HTTPException(status_code=400, detail="client_id is required")
    client_ip = request.client.host
    user = await db.get_or_create_user(
        resolved_client_id,
        fingerprint=getattr(request.state, "fingerprint", None),
        binding_hash=getattr(request.state, "binding_hash", None),
    )

    parsed_params = None
    if params:
        try:
            parsed_params = json.loads(params)
        except Exception:
            pass

    result = await db.add_preset(
        user_id=user["id"],
        name=name,
        prompt=prompt.strip(),
        params=parsed_params,
        image_base64=image_base64,
    )

    # 公共预设同名冲突
    if result["action"] == "public_conflict":
        raise HTTPException(status_code=403, detail="该预设禁止更新")

    action_text = "更新" if result["action"] == "updated" else "保存"
    monitor.add_log("USER", f"用户 {user['id']} 保存预设 | 名称: {name}")
    return {"success": True, "uuid": result["uuid"], "action": result["action"]}


# ================= 管理接口 =================


# ----- 批次管理 -----
@app.post("/api/admin/batches", dependencies=[Depends(verify_admin)])
async def create_batch(req: CreateBatchRequest, request: Request):
    """创建批次并批量生成兑换码"""
    expires_at = None
    if req.expires_at:
        try:
            # 前端发送的是 UTC ISO 字符串，转为北京时间字符串存储
            expires_at = utc_to_beijing(req.expires_at)
        except ValueError:
            raise HTTPException(status_code=400, detail="无效的过期时间格式")

    batch_id = await db.create_batch(
        req.batch_code,
        req.quota_value,
        req.token_count,
        req.max_uses,
        req.description,
        expires_at,
    )
    count = await db.batch_add_tokens(
        batch_id,
        req.quota_value,
        req.token_count,
        req.max_uses,
        expires_at,
        req.description,
    )

    # 审计日志
    await db.add_audit_log(
        action="batch_create",
        target_type="batch",
        target_id=batch_id,
        detail=json.dumps(
            {
                "batch_code": req.batch_code,
                "token_count": count,
                "quota_value": req.quota_value,
            }
        ),
        operator_ip=request.client.host,
    )

    return {
        "success": True,
        "batch_id": batch_id,
        "batch_code": req.batch_code,
        "token_count": count,
    }


@app.get("/api/admin/batches", dependencies=[Depends(verify_admin)])
async def get_batches():
    """获取批次列表"""
    batches = await db.get_batches()
    return {"batches": batches}


@app.put("/api/admin/batches/{batch_id}", dependencies=[Depends(verify_admin)])
async def update_batch(batch_id: int, req: UpdateBatchRequest, request: Request):
    """修改批次"""
    expires_at = None
    if req.expires_at:
        try:
            expires_at = utc_to_beijing(req.expires_at)
        except ValueError:
            raise HTTPException(status_code=400, detail="无效的过期时间格式")

    await db.update_batch(batch_id, req.description, expires_at, req.status)

    await db.add_audit_log(
        action="batch_update",
        target_type="batch",
        target_id=batch_id,
        detail=req.model_dump_json(),
        operator_ip=request.client.host,
    )

    return {"success": True}


@app.post("/api/admin/batches/{batch_id}/disable", dependencies=[Depends(verify_admin)])
async def disable_batch(batch_id: int, request: Request):
    """一键禁用整个批次"""
    await db.disable_batch(batch_id)

    await db.add_audit_log(
        action="batch_disable",
        target_type="batch",
        target_id=batch_id,
        operator_ip=request.client.host,
    )

    return {"success": True}


# ----- 兑换码管理 -----
@app.get("/api/admin/tokens", dependencies=[Depends(verify_admin)])
async def get_token_list(
    batch_id: int = None,
    status: str = None,
    keyword: str = None,
    max_uses: str = None,
    sort_levels: List[str] = Query([]),
    page: int = 1,
    page_size: int = 30,
):
    """获取兑换码列表（支持筛选、搜索、多级排序和分页）"""
    # 解析排序参数，格式: "field:order"，如 "created_at:desc"
    parsed_levels = []
    for sl in sort_levels:
        parts = sl.split(":")
        if len(parts) == 2 and parts[1] in ("asc", "desc"):
            parsed_levels.append({"field": parts[0], "order": parts[1]})
    # 如果没有有效的排序参数，使用默认排序
    if not parsed_levels:
        parsed_levels = [{"field": "created_at", "order": "desc"}]

    result = await db.get_token_list(
        batch_id=batch_id,
        status=status,
        keyword=keyword,
        max_uses=max_uses,
        sort_levels=parsed_levels,
        page=page,
        page_size=page_size,
    )
    return result


@app.post("/api/admin/tokens", dependencies=[Depends(verify_admin)])
async def create_token(req: CreateTokenRequest, request: Request):
    """新增单个兑换码"""
    expires_at = None
    if req.expires_at:
        try:
            expires_at = utc_to_beijing(req.expires_at)
        except ValueError:
            raise HTTPException(status_code=400, detail="无效的过期时间格式")

    result = await db.add_token(
        quota_value=req.quota_value,
        max_uses=req.max_uses,
        expires_at=expires_at,
        description=req.description,
        batch_id=req.batch_id,
    )

    await db.add_audit_log(
        action="token_create",
        target_type="token",
        detail=json.dumps(
            {"token_code": result["token_code"], "quota_value": req.quota_value}
        ),
        operator_ip=request.client.host,
    )

    return {"success": True, **result}


@app.put("/api/admin/tokens/{token_id}", dependencies=[Depends(verify_admin)])
async def update_token(token_id: int, req: UpdateTokenRequest, request: Request):
    """修改单个兑换码"""
    # 前端发送的 expires_at 是 UTC ISO 字符串，转为北京时间
    expires_at_beijing = None
    if req.expires_at:
        try:
            expires_at_beijing = utc_to_beijing(req.expires_at)
        except ValueError:
            raise HTTPException(status_code=400, detail="无效的过期时间格式")

    result = await db.update_token(
        token_id,
        req.status,
        req.description,
        expires_at_beijing,
        req.quota_value,
        req.max_uses,
    )

    await db.add_audit_log(
        action="token_update",
        target_type="token",
        target_id=token_id,
        detail=req.model_dump_json(),
        operator_ip=request.client.host,
    )

    return {"success": True, **result}


@app.delete("/api/admin/tokens/{token_id}", dependencies=[Depends(verify_admin)])
async def delete_token(token_id: int, request: Request):
    """删除兑换码（同时删除关联兑换记录）"""
    success = await db.delete_token(token_id)
    if not success:
        raise HTTPException(status_code=404, detail="兑换码不存在")

    await db.add_audit_log(
        action="token_delete",
        target_type="token",
        target_id=token_id,
        operator_ip=request.client.host,
    )

    return {"success": True}


@app.post("/api/admin/tokens/{token_id}/toggle", dependencies=[Depends(verify_admin)])
async def toggle_token(token_id: int, request: Request):
    """启用/禁用切换"""
    new_status = await db.toggle_token_status(token_id)
    if new_status is None:
        raise HTTPException(status_code=404, detail="兑换码不存在")

    await db.add_audit_log(
        action="token_toggle",
        target_type="token",
        target_id=token_id,
        detail=json.dumps({"new_status": new_status}),
        operator_ip=request.client.host,
    )

    return {"success": True, "new_status": new_status}


@app.get(
    "/api/admin/tokens/{token_id}/redemptions", dependencies=[Depends(verify_admin)]
)
async def get_token_redemptions(token_id: int):
    """获取某个兑换码的兑换记录"""
    redemptions = await db.get_token_redemptions(token_id)
    return {"redemptions": redemptions}


# ----- 兑换记录 & 审计日志 -----
@app.get("/api/admin/redemptions", dependencies=[Depends(verify_admin)])
async def get_all_redemptions(
    page: int = 1,
    page_size: int = 30,
    keyword: str = None,
    sort_levels: List[str] = Query(default=[]),
):
    """获取全量兑换记录（分页+搜索+排序）"""
    parsed_sort = []
    for sl in sort_levels:
        parts = sl.split(":", 1)
        if len(parts) == 2:
            parsed_sort.append({"field": parts[0], "order": parts[1]})
    result = await db.get_all_redemptions(
        page=page, page_size=page_size, keyword=keyword, sort_levels=parsed_sort or None
    )
    return result


@app.get("/api/admin/audit-log", dependencies=[Depends(verify_admin)])
async def get_audit_log(page: int = 1, page_size: int = 20):
    """获取审计日志"""
    result = await db.get_audit_logs(page=page, page_size=page_size)
    return result


@app.post("/api/admin/models", dependencies=[Depends(verify_admin)])
async def add_or_update_model(req: AddModelRequest):
    """添加或更新模型"""
    model_id = await db.add_model(
        name=req.name,
        ckpt_name=req.ckpt_name,
        clip_name=req.clip_name,
        vae_name=req.vae_name,
        category=req.category,
        category_label=req.category_label,
        quota_cost=req.quota_cost,
        supports_img2img=req.supports_img2img,
        supports_controlnet=req.supports_controlnet,
        supports_chinese=req.supports_chinese,
        tensorrt_engine=req.tensorrt_engine,
        default_prompt=req.default_prompt,
        positive_prompt=req.positive_prompt,
        negative_prompt=req.negative_prompt,
        sampler=req.sampler,
        scheduler=req.scheduler,
        steps=req.steps,
        cfg=req.cfg,
        denoise=req.denoise,
        clip_skip=req.clip_skip,
        description=req.description,
        supported_lora_names=req.supported_lora_names,
    )
    return {"success": True, "model_id": model_id}


@app.post("/api/admin/loras", dependencies=[Depends(verify_admin)])
async def add_or_update_lora(req: AddLoraRequest):
    """添加或更新LoRA"""
    lora_id = await db.add_lora(req.name, req.filename, req.trigger_word, req.category)
    return {"success": True, "lora_id": lora_id}


@app.get("/api/view")
async def view_image(filename: str, request: Request, prompt_id: str = None):
    # 验证请求者身份：必须携带有效 Cookie
    client_id = getattr(request.state, "client_id", None)
    if not client_id:
        raise HTTPException(status_code=401, detail="未授权访问")

    # 所有权校验：若内存中有该图片的上下文，比对 user_id
    current_user_id = getattr(request.state, "user_id", None)
    context = monitor.filename_context_map.get(filename)
    if context and context.get("user_id") and current_user_id:
        if context["user_id"] != current_user_id:
            raise HTTPException(status_code=403, detail="无权访问此图片")

    client_ip = request.client.host

    if prompt_id in ["undefined", "null", ""]:
        prompt_id = None

    context = monitor.filename_context_map.get(filename)
    if not context and prompt_id and prompt_id in monitor.pending_tasks:
        monitor.map_prompt_to_filename(prompt_id, filename)
        context = monitor.filename_context_map.get(filename)

    # 日志更新由 mark_completed 统一处理，此处不再重复写入

    monitor.finish_img_task(filename=filename, prompt_id=prompt_id)

    suggested_cooldown = await scheduler.calculate_dynamic_cooldown(client_ip)

    headers = {
        "X-Next-Cooldown": str(suggested_cooldown),
        "Access-Control-Expose-Headers": "X-Next-Cooldown",
    }

    session = request.app.state.http_session
    async with session.get(
        f"{COMFYUI_URL}/view", params={"filename": filename}
    ) as resp:
        if resp.status != 200:
            return Response(status_code=404)
        img_data = await resp.read()

    def convert_image():
        with Image.open(io.BytesIO(img_data)) as img:
            output_io = io.BytesIO()
            img.save(output_io, format="WEBP", quality=WEBP_QUALITY)
            output_io.seek(0)
            return output_io.getvalue()

    img_bytes = await run_in_threadpool(convert_image)

    return Response(content=img_bytes, media_type="image/webp", headers=headers)


# ================= 仪表盘 WebSocket =================
@app.websocket("/api/ws/dashboard")
async def websocket_dashboard(websocket: WebSocket):
    """仪表盘 WebSocket —— 事件驱动模式

    连接建立后，event_bus 立即发送完整初始状态（type=init），
    之后所有状态变化通过增量消息实时推送，无需轮询。
    """
    # 认证逻辑保持不变
    api_key = websocket.query_params.get("api_key")
    if (
        not ADMIN_API_KEY
        or not api_key
        or not hmac.compare_digest(api_key, ADMIN_API_KEY)
    ):
        await websocket.close(code=4001, reason="需要有效的 API Key")
        return
    await websocket.accept()

    # 注册到事件总线，自动接收初始状态
    await event_bus.register(websocket)
    try:
        # 保持连接 alive，接收客户端消息（用于心跳检测）
        while True:
            await websocket.receive_text()
    except Exception:
        pass
    finally:
        await event_bus.unregister(websocket)


# ================= 仪表盘统计接口 =================
@app.get("/api/dashboard/stats", dependencies=[Depends(verify_admin)])
async def dashboard_stats():
    """返回数据库维度的仪表盘统计数据"""
    return await db.get_dashboard_stats()


@app.get("/api/dashboard/users", dependencies=[Depends(verify_admin)])
async def dashboard_users():
    """返回用户列表数据，用于仪表盘用户栏"""
    return await db.get_dashboard_users()


# ================= 仪表盘 HTML 页面 =================
@app.get("/dashboard", response_class=HTMLResponse)
async def dashboard(request: Request):
    # 仪表盘页面需要 API Key 认证（通过 query 参数传递，方便浏览器直接访问）
    api_key = request.query_params.get("api_key") or request.headers.get("X-API-Key")
    if (
        not ADMIN_API_KEY
        or not api_key
        or not hmac.compare_digest(api_key, ADMIN_API_KEY)
    ):
        raise HTTPException(status_code=401, detail="需要有效的 API Key")
    dashboard_html = Path(__file__).parent / "dashboard.html"
    return HTMLResponse(content=dashboard_html.read_text(encoding="utf-8"))


async def system_monitor_loop():
    monitor_url = (
        f"{COMFYUI_URL.replace('http', 'ws')}/ws?clientId=server_system_monitor"
    )
    while True:
        try:
            session = app.state.http_session
            async with session.ws_connect(monitor_url) as ws:
                async for msg in ws:
                    if msg.type == aiohttp.WSMsgType.TEXT:
                        try:
                            message = json.loads(msg.data)
                            msg_type = message.get("type")
                            data = message.get("data", {})

                            if msg_type == "executing":
                                if data.get("node") is None and scheduler.is_processing:
                                    await scheduler.check_task_completion()
                            elif msg_type == "status":
                                exec_info = data.get("status", {}).get("exec_info", {})
                                if (
                                    exec_info.get("queue_remaining") == 0
                                    and scheduler.is_processing
                                ):
                                    await scheduler.check_task_completion()
                        except Exception as e:
                            logger.debug(f"处理 ComfyUI 消息失败: {e}")
        except Exception as e:
            logger.debug(f"ComfyUI 监控连接异常: {e}")
            await asyncio.sleep(3)


if __name__ == "__main__":
    import uvicorn

    # 挂载前端静态文件（必须在所有API路由注册之后）
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")

    uvicorn.run(
        app, host=SERVER_HOST, port=SERVER_PORT, log_level="critical", log_config=None
    )
