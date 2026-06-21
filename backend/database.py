import os
import json
import uuid
import sqlite3
import asyncio
import logging
import threading
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List, Tuple
from dotenv import load_dotenv

# 加载 .env 环境变量（database.py 在 main.py 的 load_dotenv 之前被导入，
# 必须自己加载才能读到配置）
load_dotenv()

logger = logging.getLogger(__name__)

# 北京时间时区 UTC+8
_BEIJING_TZ = timezone(timedelta(hours=8))


def beijing_now() -> str:
    """返回北京时间的 ISO 格式字符串（不含时区后缀），用于数据库存储"""
    return datetime.now(_BEIJING_TZ).strftime("%Y-%m-%dT%H:%M:%S")


# 数据库文件路径（可通过环境变量配置）
DB_PATH = os.getenv("DB_PATH", "") or os.path.join(os.path.dirname(__file__), "app.db")

# 新用户初始额度
INITIAL_QUOTA = int(os.getenv("INITIAL_QUOTA", "0"))

# 确保数据库目录存在
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

# 初始化SQL语句
INIT_SQL = """
-- 用户表
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id VARCHAR(64) UNIQUE NOT NULL,
    fingerprint VARCHAR(64),                        -- FingerprintJS 浏览器指纹
    binding_hash VARCHAR(64) UNIQUE,                -- IP+UA 绑定哈希（辅助识别）
    quota INTEGER DEFAULT 0,
    total_generated INTEGER DEFAULT 0,
    total_searches INTEGER DEFAULT 0,
    last_request_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 模型表（完整模型信息，含路径、参数、额度消耗等）
CREATE TABLE IF NOT EXISTS models (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(256) UNIQUE NOT NULL,           -- 模型展示名（如 Ill_WAI）
    ckpt_name VARCHAR(256) NOT NULL,              -- checkpoint文件路径
    clip_name VARCHAR(256),                       -- clip文件名（可选）
    vae_name VARCHAR(256),                        -- vae文件名（可选）
    category VARCHAR(64) NOT NULL DEFAULT 'anime', -- 分类（anime/realistic）
    category_label VARCHAR(128),                   -- 分类展示名（如 动漫画风模型）
    quota_cost INTEGER NOT NULL DEFAULT 1,         -- 点数消耗
    total_calls INTEGER NOT NULL DEFAULT 0,        -- 累计调用次数
    supports_img2img INTEGER NOT NULL DEFAULT 1,   -- 是否支持图生图
    supports_controlnet INTEGER NOT NULL DEFAULT 1, -- 是否支持ControlNet
    supports_chinese INTEGER NOT NULL DEFAULT 0,   -- 是否支持中文提示词
    tensorrt_engine VARCHAR(256),                -- 对应的 TensorRT 引擎文件名（非空=支持快速模式）
    default_prompt TEXT,                           -- 默认提示词
    positive_prompt TEXT,                          -- 正向提示词模板
    negative_prompt TEXT,                          -- 反向提示词模板
    sampler VARCHAR(64) DEFAULT 'euler_ancestral', -- 默认采样器
    scheduler VARCHAR(64) DEFAULT 'normal',        -- 默认调度器
    steps INTEGER DEFAULT 20,                      -- 默认步数
    cfg REAL DEFAULT 5.0,                          -- 默认CFG
    denoise REAL DEFAULT 1.0,                      -- 默认去噪强度
    clip_skip INTEGER DEFAULT 0,                   -- CLIP skip（负数表示从末尾跳过）
    description TEXT,                              -- 模型描述
    supported_lora_names TEXT,                     -- 支持的LoRA名称列表（逗号分隔，用于自动填充关联表）
    is_active INTEGER NOT NULL DEFAULT 1,          -- 是否启用
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- LoRA表
CREATE TABLE IF NOT EXISTS loras (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(256) UNIQUE NOT NULL,            -- LoRA展示名（如 风格_奶糖）
    filename VARCHAR(256) NOT NULL,                -- LoRA文件路径
    trigger_word TEXT,                             -- 触发词
    category VARCHAR(64),                          -- 分类（风格/角色/服饰等）
    quota_cost INTEGER NOT NULL DEFAULT 0,         -- 点数消耗
    total_calls INTEGER NOT NULL DEFAULT 0,        -- 累计调用次数
    is_active INTEGER NOT NULL DEFAULT 1,          -- 是否启用
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 模型-LoRA关联表（多对多）
CREATE TABLE IF NOT EXISTS model_lora_relations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model_id INTEGER NOT NULL,
    lora_id INTEGER NOT NULL,
    model_name VARCHAR(256) NOT NULL,              -- 模型名称（冗余字段，便于直接查看）
    lora_name VARCHAR(256) NOT NULL,               -- LoRA名称（冗余字段，便于直接查看）
    FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE,
    FOREIGN KEY (lora_id) REFERENCES loras(id) ON DELETE CASCADE,
    UNIQUE(model_id, lora_id)
);

-- Token兑换码表
CREATE TABLE IF NOT EXISTS tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER,                              -- 关联批次ID
    token_code VARCHAR(64) UNIQUE NOT NULL,       -- 兑换码
    quota_value INTEGER NOT NULL DEFAULT 10,       -- 每次兑换获得的点数
    max_uses INTEGER NOT NULL DEFAULT 1,           -- 最大可用次数（1=一次性，>1=多次，-1=无限）
    remaining_uses INTEGER NOT NULL DEFAULT 1,     -- 剩余可用次数（最小为0，max_uses=-1时不使用此字段）
    status VARCHAR(20) NOT NULL DEFAULT 'active',  -- 状态：active/disabled/expired
    description VARCHAR(256),                      -- 描述（如"春节活动福利"）
    expires_at TIMESTAMP NULL,                     -- 过期时间（NULL=永不过期）
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Token批次表
CREATE TABLE IF NOT EXISTS token_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_code VARCHAR(64) UNIQUE NOT NULL,
    quota_value INTEGER NOT NULL,
    token_count INTEGER NOT NULL,
    max_uses INTEGER NOT NULL DEFAULT 1,
    description VARCHAR(256),
    expires_at TIMESTAMP NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 管理操作审计日志表
CREATE TABLE IF NOT EXISTS admin_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action VARCHAR(64) NOT NULL,
    target_type VARCHAR(32),
    target_id INTEGER,
    detail TEXT,
    operator_ip VARCHAR(45),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Token兑换记录表（每次兑换一行，记录谁在什么时候用了哪个码）
CREATE TABLE IF NOT EXISTS token_redemptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_id INTEGER NOT NULL,                     -- 关联tokens表
    user_id INTEGER NOT NULL,                      -- 关联users表
    quota_granted INTEGER NOT NULL,                -- 本次兑换获得的点数
    redeemed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(token_id, user_id),                     -- 同一用户不能重复兑换同一个码
    FOREIGN KEY (token_id) REFERENCES tokens(id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 预设表
CREATE TABLE IF NOT EXISTS presets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid VARCHAR(36) UNIQUE NOT NULL,
    user_id INTEGER NOT NULL,
    name VARCHAR(128) NOT NULL,
    prompt TEXT NOT NULL,
    params TEXT,
    image_base64 TEXT,
    is_public INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 生图记录表
CREATE TABLE IF NOT EXISTS generation_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    prompt TEXT NOT NULL,
    negative_prompt TEXT,
    ckpt_name VARCHAR(256) NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    steps INTEGER NOT NULL,
    cfg REAL NOT NULL,
    seed INTEGER NOT NULL,
    sampler_name VARCHAR(64) NOT NULL,
    scheduler VARCHAR(64) NOT NULL,
    lora_list TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    error_message TEXT,
    filename VARCHAR(256),
    duration REAL,
    client_ip VARCHAR(45),
    quota_used INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 搜索日志表（记录每次搜索的耗时）
CREATE TABLE IF NOT EXISTS search_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    duration REAL NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_users_client_id ON users(client_id);
CREATE INDEX IF NOT EXISTS idx_tokens_token_code ON tokens(token_code);
CREATE INDEX IF NOT EXISTS idx_tokens_status ON tokens(status);
CREATE INDEX IF NOT EXISTS idx_token_redemptions_token_id ON token_redemptions(token_id);
CREATE INDEX IF NOT EXISTS idx_token_redemptions_user_id ON token_redemptions(user_id);
CREATE INDEX IF NOT EXISTS idx_presets_user_id ON presets(user_id);
CREATE INDEX IF NOT EXISTS idx_generation_logs_user_id ON generation_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_models_name ON models(name);
CREATE INDEX IF NOT EXISTS idx_models_ckpt_name ON models(ckpt_name);
CREATE INDEX IF NOT EXISTS idx_models_category ON models(category);
CREATE INDEX IF NOT EXISTS idx_loras_name ON loras(name);
CREATE INDEX IF NOT EXISTS idx_model_lora_relations_model ON model_lora_relations(model_id);
CREATE INDEX IF NOT EXISTS idx_model_lora_relations_lora ON model_lora_relations(lora_id);
CREATE INDEX IF NOT EXISTS idx_generation_logs_created_at ON generation_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_presets_user_name ON presets(user_id, name);

"""


# 兑换码字符集（排除易混淆的 O/0/I/1/L）
_TOKEN_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def generate_token_code() -> str:
    """生成 XXXX-XXXX-XXXX-XXXX 格式的高强度随机兑换码"""
    import secrets

    parts = []
    for _ in range(4):
        part = "".join(secrets.choice(_TOKEN_CHARS) for _ in range(4))
        parts.append(part)
    return "-".join(parts)


class Database:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(Database, cls).__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._initialized = True
        self._lock = asyncio.Lock()
        self._redeem_lock = asyncio.Lock()
        # 线程局部存储：每个 executor 线程复用同一个连接，避免频繁创建/销毁
        self._local = threading.local()
        self._ensure_tables()

    def _get_connection(self) -> sqlite3.Connection:
        """获取当前线程的持久连接，不存在则创建"""
        conn = getattr(self._local, "conn", None)
        if conn is None:
            conn = sqlite3.connect(DB_PATH, timeout=30)
            conn.execute("PRAGMA foreign_keys = ON")
            conn.execute("PRAGMA journal_mode = WAL")  # WAL 模式提升并发读性能
            conn.row_factory = sqlite3.Row
            self._local.conn = conn
        return conn

    def _ensure_tables(self):
        """确保所有表存在"""
        conn = None
        try:
            conn = sqlite3.connect(DB_PATH, timeout=30)
            conn.execute("PRAGMA foreign_keys = ON")
            cursor = conn.cursor()
            cursor.executescript(INIT_SQL)
            conn.commit()

            # 从 models.supported_lora_names 自动同步到 model_lora_relations
            self._sync_lora_relations(conn)
        except Exception as e:
            logger.error(f"数据库初始化失败: {e}")
            raise SystemExit(f"FATAL: 数据库初始化失败 - {e}")
        finally:
            if conn:
                conn.close()

    def _sync_lora_relations(self, conn):
        """从 models.supported_lora_names 自动同步到 model_lora_relations 表"""
        try:
            cursor = conn.cursor()
            # 查询所有有 supported_lora_names 的模型
            cursor.execute(
                "SELECT id, name, supported_lora_names FROM models WHERE supported_lora_names IS NOT NULL AND supported_lora_names != ''"
            )
            models = cursor.fetchall()

            if not models:
                return

            # 查询所有 lora 的 id-name 映射
            cursor.execute("SELECT id, name FROM loras")
            lora_name_to_id = {row[1]: row[0] for row in cursor.fetchall()}

            synced = 0
            for model_id, model_name, lora_names_str in models:
                lora_names = [n.strip() for n in lora_names_str.split(",") if n.strip()]
                for lora_name in lora_names:
                    lora_id = lora_name_to_id.get(lora_name)
                    if lora_id:
                        cursor.execute(
                            "INSERT OR IGNORE INTO model_lora_relations (model_id, lora_id, model_name, lora_name) VALUES (?, ?, ?, ?)",
                            (model_id, lora_id, model_name, lora_name),
                        )
                        synced += 1

            if synced > 0:
                conn.commit()
        except Exception as e:
            logger.warning(f"同步 LoRA 关联关系失败（非致命）: {e}")

    async def _execute(
        self,
        sql: str,
        params: tuple = (),
        fetch_one: bool = False,
        fetch_all: bool = False,
        return_rowcount: bool = False,
    ):
        """异步执行SQL（使用线程局部持久连接，避免频繁创建/销毁）

        Args:
            return_rowcount: 为True时返回受影响行数(cursor.rowcount)，适用于DELETE/UPDATE；
                             为False时返回最后插入行ID(cursor.lastrowid)，适用于INSERT
        """
        async with self._lock:
            loop = asyncio.get_running_loop()

            def _run():
                conn = self._get_connection()
                cursor = conn.cursor()
                try:
                    cursor.execute(sql, params)
                    conn.commit()
                    if fetch_one:
                        result = cursor.fetchone()
                    elif fetch_all:
                        result = cursor.fetchall()
                    elif return_rowcount:
                        result = cursor.rowcount
                    else:
                        result = cursor.lastrowid
                    return result
                except Exception:
                    # 出错时回滚，避免脏数据影响后续操作
                    conn.rollback()
                    raise

            return await loop.run_in_executor(None, _run)

    # ==================== 用户管理 ====================
    async def _fill_missing_fields(
        self, user_id: int, fingerprint: str = None, binding_hash: str = None
    ):
        """补全用户缺失的 fingerprint / binding_hash（仅更新 NULL 值，不覆盖已有值）"""
        updates = []
        params = []
        conditions = []
        if fingerprint:
            updates.append("fingerprint = ?")
            params.append(fingerprint)
            conditions.append("fingerprint IS NULL")
        if binding_hash:
            updates.append("binding_hash = ?")
            params.append(binding_hash)
            conditions.append("binding_hash IS NULL")
        if updates:
            params.append(user_id)
            await self._execute(
                f"UPDATE users SET {', '.join(updates)} WHERE id = ? AND {' AND '.join(conditions)}",
                tuple(params),
            )

    async def get_user_by_fingerprint(self, fingerprint: str) -> dict | None:
        """通过浏览器指纹查找已有用户，用于 auth/init 防止 client_id 注入"""
        if not fingerprint:
            return None
        return await self._execute(
            "SELECT * FROM users WHERE fingerprint = ? LIMIT 1",
            (fingerprint,),
            fetch_one=True,
        )

    async def get_or_create_user(
        self, client_id: str, fingerprint: str = None, binding_hash: str = None
    ) -> Dict[str, Any]:
        """获取或创建用户，支持指纹和绑定哈希辅助查找，附带 preset_count 和 used_tokens 关联查询"""
        # 1. 按 client_id 查找
        user = await self._execute(
            "SELECT * FROM users WHERE client_id = ?", (client_id,), fetch_one=True
        )
        if user:
            # 补全缺失的 fingerprint / binding_hash（仅更新 NULL 值）
            if fingerprint or binding_hash:
                if user["fingerprint"] is None or user["binding_hash"] is None:
                    await self._fill_missing_fields(
                        user["id"], fingerprint, binding_hash
                    )

        # 2. client_id 找不到 → 按 fingerprint 查找（同一浏览器不同 localStorage 的情况）
        if not user and fingerprint:
            user = await self._execute(
                "SELECT * FROM users WHERE fingerprint = ?",
                (fingerprint,),
                fetch_one=True,
            )
            if user:
                # 更新 client_id 为当前值（处理 UNIQUE 冲突）
                try:
                    await self._execute(
                        "UPDATE users SET client_id = ? WHERE id = ?",
                        (client_id, user["id"]),
                    )
                except sqlite3.IntegrityError:
                    # client_id 已被其他用户占用，保持原 client_id 不变
                    pass
                except Exception as e:
                    logger.error(f"更新用户 client_id 失败: {e}")
                    raise

        # 3. fingerprint 也找不到 → 按 binding_hash 查找（同 IP+UA 的情况）
        if not user and binding_hash:
            user = await self._execute(
                "SELECT * FROM users WHERE binding_hash = ?",
                (binding_hash,),
                fetch_one=True,
            )

        # 4. 都找不到 → 创建新用户
        if not user:
            try:
                now_str = beijing_now()
                await self._execute(
                    "INSERT INTO users (client_id, fingerprint, binding_hash, quota, total_generated, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)",
                    (
                        client_id,
                        fingerprint,
                        binding_hash,
                        INITIAL_QUOTA,
                        now_str,
                        now_str,
                    ),
                )
            except sqlite3.IntegrityError:
                # 并发插入冲突，重新查询即可
                pass
            user = await self._execute(
                "SELECT * FROM users WHERE client_id = ?", (client_id,), fetch_one=True
            )
            if not user:
                # IntegrityError 由非 client_id 冲突引起，按 fingerprint 查找
                if fingerprint:
                    user = await self._execute(
                        "SELECT * FROM users WHERE fingerprint = ?",
                        (fingerprint,),
                        fetch_one=True,
                    )
                if not user:
                    raise ValueError(f"用户创建失败：client_id={client_id}")

        user_dict = dict(user)

        # 关联查询：预设数量
        preset_result = await self._execute(
            "SELECT COUNT(*) as cnt FROM presets WHERE user_id = ?",
            (user_dict["id"],),
            fetch_one=True,
        )
        user_dict["preset_count"] = preset_result["cnt"] if preset_result else 0

        # 关联查询：已使用的token数量（从兑换记录表查）
        token_result = await self._execute(
            "SELECT COUNT(DISTINCT token_id) as cnt FROM token_redemptions WHERE user_id = ?",
            (user_dict["id"],),
            fetch_one=True,
        )
        user_dict["used_tokens"] = token_result["cnt"] if token_result else 0

        return user_dict

    async def update_user_fingerprint_if_missing(
        self, client_id: str, fingerprint: str = None, binding_hash: str = None
    ):
        """补全老用户缺失的 fingerprint / binding_hash 字段（仅更新 NULL 值，不覆盖已有值）"""
        user = await self._execute(
            "SELECT id, fingerprint, binding_hash FROM users WHERE client_id = ?",
            (client_id,),
            fetch_one=True,
        )
        if not user:
            return
        if user["fingerprint"] is None or user["binding_hash"] is None:
            await self._fill_missing_fields(user["id"], fingerprint, binding_hash)

    async def update_user_quota(self, user_id: int, delta: int) -> int:
        """更新用户额度，delta为正增加，为负减少。防止额度变为负数。"""
        now_str = beijing_now()
        await self._execute(
            "UPDATE users SET quota = quota + ?, updated_at = ? WHERE id = ? AND quota + ? >= 0",
            (delta, now_str, user_id, delta),
        )

        result = await self._execute(
            "SELECT quota FROM users WHERE id = ?", (user_id,), fetch_one=True
        )
        return result["quota"] if result else 0

    async def deduct_quota_if_sufficient(
        self, user_id: int, amount: int
    ) -> Tuple[bool, int]:
        """原子性检查并扣除额度，返回(是否成功, 当前额度)
        只有当额度>=amount时才扣除，否则不扣。避免并发请求导致超额扣除。"""
        now_str = beijing_now()
        rowcount = await self._execute(
            "UPDATE users SET quota = quota - ?, last_request_at = ?, updated_at = ? WHERE id = ? AND quota >= ?",
            (amount, now_str, now_str, user_id, amount),
            return_rowcount=True,
        )
        result = await self._execute(
            "SELECT quota FROM users WHERE id = ?", (user_id,), fetch_one=True
        )
        current_quota = result["quota"] if result else 0
        return (rowcount > 0, current_quota)

    async def increment_user_generated(self, user_id: int):
        """增加用户生图计数，同时更新最后请求时间"""
        now_str = beijing_now()
        await self._execute(
            "UPDATE users SET total_generated = total_generated + 1, last_request_at = ?, updated_at = ? WHERE id = ?",
            (now_str, now_str, user_id),
        )

    # ==================== 模型管理 ====================
    async def get_model_cost(self, ckpt_name: str) -> int:
        """获取模型的点数消耗"""
        result = await self._execute(
            "SELECT quota_cost FROM models WHERE ckpt_name = ?",
            (ckpt_name,),
            fetch_one=True,
        )
        return result["quota_cost"] if result else 1

    async def get_model_by_ckpt(self, ckpt_name: str) -> Optional[Dict[str, Any]]:
        """根据ckpt_name获取模型完整信息"""
        result = await self._execute(
            "SELECT * FROM models WHERE ckpt_name = ?", (ckpt_name,), fetch_one=True
        )
        return dict(result) if result else None

    async def get_model_by_name(self, name: str) -> Optional[Dict[str, Any]]:
        """根据模型name获取模型完整信息（精确匹配）"""
        result = await self._execute(
            "SELECT * FROM models WHERE name = ?", (name,), fetch_one=True
        )
        return dict(result) if result else None

    async def get_all_models(self, category: str = None) -> List[Dict[str, Any]]:
        """获取所有启用的模型，可按分类筛选"""
        if category:
            results = await self._execute(
                "SELECT * FROM models WHERE is_active = 1 AND category = ? ORDER BY category, name",
                (category,),
                fetch_all=True,
            )
        else:
            results = await self._execute(
                "SELECT * FROM models WHERE is_active = 1 ORDER BY category, name",
                (),
                fetch_all=True,
            )
        return [dict(r) for r in results]

    async def get_models_grouped(self) -> Dict[str, Any]:
        """获取按分类分组的模型列表（兼容前端modes.json格式）"""
        models = await self.get_all_models()
        grouped = {}
        for m in models:
            cat = m["category"]
            if cat not in grouped:
                grouped[cat] = {"label": m["category_label"] or cat, "models": {}}
            model_data = {
                "filename": m["ckpt_name"],
                "quota_cost": m["quota_cost"],
                "params": {
                    "supports_img2img": bool(m["supports_img2img"]),
                    "supports_controlnet": bool(m["supports_controlnet"]),
                    "supported_loras": [],
                    "prompt": m["default_prompt"] or "",
                    "positive_prompt": m["positive_prompt"] or "",
                    "negative_prompt": m["negative_prompt"] or "",
                    "sampler": m["sampler"],
                    "scheduler": m["scheduler"],
                    "steps": m["steps"],
                    "cfg": m["cfg"],
                    "denoise": m["denoise"],
                },
            }
            if m["clip_skip"] is not None:
                model_data["params"]["clip_skip"] = m["clip_skip"]
            if m["supports_chinese"]:
                model_data["params"]["supports_chinese"] = bool(m["supports_chinese"])
            if m["tensorrt_engine"]:
                model_data["params"]["tensorrt_engine"] = m["tensorrt_engine"]
            if m["clip_name"]:
                model_data["clip"] = m["clip_name"]
            if m["vae_name"]:
                model_data["vae"] = m["vae_name"]
            grouped[cat]["models"][m["name"]] = model_data

        # 一次性查询所有 model-lora 关联，避免 N+1 查询
        all_relations = await self._execute(
            """SELECT r.model_id, l.name FROM model_lora_relations r
               JOIN loras l ON r.lora_id = l.id AND l.is_active = 1""",
            fetch_all=True,
        )
        # 按 model_id 分组
        lora_map = {}
        for rel in all_relations:
            lora_map.setdefault(rel["model_id"], []).append(rel["name"])

        # 填充supported_loras
        for m in models:
            if m["id"] in lora_map:
                grouped[m["category"]]["models"][m["name"]]["params"][
                    "supported_loras"
                ] = lora_map[m["id"]]

        return grouped

    async def increment_model_calls(self, name: str):
        """按模型name增加调用计数（精确匹配，避免同ckpt_name的不同模型计数同步）"""
        now_str = beijing_now()
        await self._execute(
            "UPDATE models SET total_calls = total_calls + 1, updated_at = ? WHERE name = ?",
            (now_str, name),
        )

    async def increment_user_searches(self, client_id: str):
        """递增用户的搜索次数"""
        now_str = beijing_now()
        await self._execute(
            "UPDATE users SET total_searches = total_searches + 1, updated_at = ? WHERE client_id = ?",
            (now_str, client_id),
        )

    async def increment_model_calls_by_ckpt(self, ckpt_name: str):
        """按ckpt_name增加调用计数（兜底，当db_model_name不可用时使用）"""
        now_str = beijing_now()
        await self._execute(
            "UPDATE models SET total_calls = total_calls + 1, updated_at = ? WHERE ckpt_name = ?",
            (now_str, ckpt_name),
        )

    async def increment_model_calls_by_ckpt_safe(self, ckpt_name: str):
        """按ckpt_name增加调用计数（安全兜底：仅当唯一对应一个模型时才执行）

        避免同 ckpt_name 的多个模型（如 Ill_WAI / Ill_WAI快速模式）计数同步增长。
        """
        # 先检查该 ckpt_name 对应多少个模型
        count_row = await self._execute(
            "SELECT COUNT(*) as cnt FROM models WHERE ckpt_name = ?",
            (ckpt_name,),
            fetch_one=True,
        )
        count = count_row["cnt"] if count_row else 0
        if count == 1:
            # 唯一对应，安全递增
            now_str = beijing_now()
            await self._execute(
                "UPDATE models SET total_calls = total_calls + 1, updated_at = ? WHERE ckpt_name = ?",
                (now_str, ckpt_name),
            )
        elif count > 1:
            logger.warning(
                f"ckpt_name '{ckpt_name}' 对应 {count} 个模型，跳过兜底计数（应通过 model_name 精确匹配）"
            )

    async def add_model(
        self,
        name: str,
        ckpt_name: str,
        clip_name: str = None,
        vae_name: str = None,
        category: str = "anime",
        category_label: str = None,
        quota_cost: int = 1,
        supports_img2img: bool = True,
        supports_controlnet: bool = True,
        supports_chinese: bool = False,
        tensorrt_engine: str = None,
        default_prompt: str = None,
        positive_prompt: str = None,
        negative_prompt: str = None,
        sampler: str = "euler_ancestral",
        scheduler: str = "normal",
        steps: int = 20,
        cfg: float = 5.0,
        denoise: float = 1.0,
        clip_skip: int = 0,
        description: str = None,
        supported_lora_names: List[str] = None,
    ) -> int:
        """添加模型，返回模型ID。同名模型则更新（INSERT ... ON CONFLICT DO UPDATE）"""
        # 将列表转为逗号分隔字符串存入 models 表
        lora_names_str = (
            ",".join(supported_lora_names) if supported_lora_names else None
        )
        now_str = beijing_now()
        model_id = await self._execute(
            """INSERT INTO models (name, ckpt_name, clip_name, vae_name, category, category_label,
               quota_cost, supports_img2img, supports_controlnet, supports_chinese, tensorrt_engine,
               default_prompt, positive_prompt, negative_prompt, sampler, scheduler,
               steps, cfg, denoise, clip_skip, description, supported_lora_names, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(name) DO UPDATE SET
                   ckpt_name=excluded.ckpt_name, clip_name=excluded.clip_name, vae_name=excluded.vae_name,
                   category=excluded.category, category_label=excluded.category_label,
                   quota_cost=excluded.quota_cost, supports_img2img=excluded.supports_img2img,
                   supports_controlnet=excluded.supports_controlnet, supports_chinese=excluded.supports_chinese,
                   tensorrt_engine=excluded.tensorrt_engine, default_prompt=excluded.default_prompt,
                   positive_prompt=excluded.positive_prompt, negative_prompt=excluded.negative_prompt,
                   sampler=excluded.sampler, scheduler=excluded.scheduler,
                   steps=excluded.steps, cfg=excluded.cfg, denoise=excluded.denoise,
                   clip_skip=excluded.clip_skip, description=excluded.description,
                   supported_lora_names=excluded.supported_lora_names,
                   updated_at=?""",
            (
                name,
                ckpt_name,
                clip_name,
                vae_name,
                category,
                category_label,
                quota_cost,
                int(supports_img2img),
                int(supports_controlnet),
                int(supports_chinese),
                tensorrt_engine,
                default_prompt,
                positive_prompt,
                negative_prompt,
                sampler,
                scheduler,
                steps,
                cfg,
                denoise,
                clip_skip,
                description,
                lora_names_str,
                now_str,
                now_str,
                now_str,  # for ON CONFLICT updated_at
            ),
        )
        # ON CONFLICT DO UPDATE 时 lastrowid 返回冲突行的 id（SQLite 3.35+）
        # 兼容旧版本：如果 lastrowid 为 0，手动查询
        if not model_id:
            result = await self._execute(
                "SELECT id FROM models WHERE name = ?", (name,), fetch_one=True
            )
            if not result:
                raise ValueError(f"模型创建失败：name={name}")
            model_id = result["id"]

        # 根据 supported_lora_names 同步关联表
        async with self._lock:
            loop = asyncio.get_running_loop()

            def _run():
                conn = self._get_connection()
                try:
                    conn.execute(
                        "DELETE FROM model_lora_relations WHERE model_id = ?",
                        (model_id,),
                    )
                    if supported_lora_names:
                        for lora_name in supported_lora_names:
                            lora_result = conn.execute(
                                "SELECT id FROM loras WHERE name = ?", (lora_name,)
                            ).fetchone()
                            if lora_result:
                                conn.execute(
                                    "INSERT INTO model_lora_relations (model_id, lora_id, model_name, lora_name) VALUES (?, ?, ?, ?)",
                                    (model_id, lora_result[0], name, lora_name),
                                )
                    conn.commit()
                except Exception:
                    conn.rollback()
                    raise

            await loop.run_in_executor(None, _run)
        return model_id

    # ==================== LoRA管理 ====================
    async def get_all_loras(self) -> List[Dict[str, Any]]:
        """获取所有启用的LoRA"""
        results = await self._execute(
            "SELECT * FROM loras WHERE is_active = 1 ORDER BY name", (), fetch_all=True
        )
        return [dict(r) for r in results]

    async def get_loras_dict(self) -> Dict[str, Any]:
        """获取LoRA字典（兼容前端lora.json格式）"""
        loras = await self.get_all_loras()
        result = {}
        for l in loras:
            result[l["name"]] = {
                "filename": l["filename"],
                "trigger": l["trigger_word"] or "",
                "quota_cost": l["quota_cost"],
            }
        return result

    async def add_lora(
        self, name: str, filename: str, trigger_word: str = None, category: str = None
    ) -> int:
        """添加LoRA，返回LoRA ID"""
        try:
            now_str = beijing_now()
            lora_id = await self._execute(
                "INSERT INTO loras (name, filename, trigger_word, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                (name, filename, trigger_word, category, now_str, now_str),
            )
        except sqlite3.IntegrityError:
            now_str = beijing_now()
            await self._execute(
                "UPDATE loras SET filename=?, trigger_word=?, category=?, updated_at=? WHERE name=?",
                (filename, trigger_word, category, now_str, name),
            )
            result = await self._execute(
                "SELECT id FROM loras WHERE name = ?", (name,), fetch_one=True
            )
            if not result:
                raise ValueError(f"LoRA 查找失败：name={name}")
            lora_id = result["id"]
        return lora_id

    async def increment_lora_calls(self, lora_name: str):
        """增加LoRA调用计数（按 name 或 filename 匹配）"""
        now_str = beijing_now()
        # 优先按 name 匹配，回退到 filename 匹配
        rowcount = await self._execute(
            "UPDATE loras SET total_calls = total_calls + 1, updated_at = ? WHERE name = ?",
            (now_str, lora_name),
            return_rowcount=True,
        )
        if not rowcount:
            await self._execute(
                "UPDATE loras SET total_calls = total_calls + 1, updated_at = ? WHERE filename = ?",
                (now_str, lora_name),
            )

    # ==================== Token管理 ====================
    async def redeem_token(
        self, token_code: str, user_id: int, daily_gift_max_quota: int = 0
    ) -> Tuple[bool, str, int]:
        """兑换token，返回 (是否成功, 提示信息, 增加的额度)
        并发安全：通过原子UPDATE + UNIQUE约束防止超扣和重复兑换
        daily_gift_max_quota: 每日赠礼额度上限，0表示不限制"""
        async with self._redeem_lock:
            # 查找token
            token = await self._execute(
                "SELECT * FROM tokens WHERE token_code = ?",
                (token_code,),
                fetch_one=True,
            )

            if not token:
                return (False, "无效的兑换码", 0)

            # 检查状态
            if token["status"] != "active":
                if token["status"] == "expired":
                    return (False, "兑换码已过期", 0)
                elif token["status"] == "disabled":
                    return (False, "兑换码已被禁用", 0)
                elif token["status"] == "exhausted":
                    return (False, "兑换码已用尽", 0)
                return (False, "兑换码不可用", 0)

            # 检查过期
            if token["expires_at"] and datetime.now(
                _BEIJING_TZ
            ) > datetime.fromisoformat(token["expires_at"]).replace(tzinfo=_BEIJING_TZ):
                await self._execute(
                    "UPDATE tokens SET status = 'expired' WHERE id = ?", (token["id"],)
                )
                return (False, "兑换码已过期", 0)

            # 检查同一用户是否已兑换过
            already = await self._execute(
                "SELECT id FROM token_redemptions WHERE token_id = ? AND user_id = ?",
                (token["id"], user_id),
                fetch_one=True,
            )
            if already:
                return (False, "您已兑换过此兑换码", 0)

            quota_value = token["quota_value"]

            # 每日赠礼额度上限判断
            if token["description"] == "每日赠礼" and daily_gift_max_quota > 0:
                user = await self._execute(
                    "SELECT quota FROM users WHERE id = ?", (user_id,), fetch_one=True
                )
                current_quota = user["quota"] if user else 0
                if current_quota >= daily_gift_max_quota:
                    return (False, "您的额度已满，无法使用每日赠礼", 0)
                # 实际增加的额度不超过上限
                quota_value = min(daily_gift_max_quota - current_quota, quota_value)

            # 判断是否无限可用
            if token["max_uses"] == -1:
                pass
            else:
                rowcount = await self._execute(
                    "UPDATE tokens SET remaining_uses = remaining_uses - 1 WHERE id = ? AND remaining_uses > 0",
                    (token["id"],),
                    return_rowcount=True,
                )
                if rowcount == 0:
                    return (False, "兑换码已用完", 0)

                updated = await self._execute(
                    "SELECT remaining_uses FROM tokens WHERE id = ?",
                    (token["id"],),
                    fetch_one=True,
                )
                if updated and updated["remaining_uses"] <= 0:
                    await self._execute(
                        "UPDATE tokens SET status = 'exhausted' WHERE id = ?",
                        (token["id"],),
                    )

            # 写兑换记录
            try:
                now_str = beijing_now()
                await self._execute(
                    "INSERT INTO token_redemptions (token_id, user_id, quota_granted, redeemed_at) VALUES (?, ?, ?, ?)",
                    (token["id"], user_id, quota_value, now_str),
                )
            except sqlite3.IntegrityError:
                # 唯一约束冲突：该用户已兑换过此兑换码
                return (False, "您已兑换过此兑换码", 0)
            except Exception as e:
                logger.error(f"写入兑换记录失败: {e}")
                return (False, "兑换失败，请稍后重试", 0)

            # 加额度
            await self.update_user_quota(user_id, quota_value)

            return (True, "兑换成功", quota_value)

    async def add_token(
        self,
        quota_value: int = 10,
        max_uses: int = 1,
        expires_at: Optional[str] = None,
        description: str = None,
        batch_id: int = None,
    ) -> Dict[str, Any]:
        """添加单个兑换码，返回完整记录"""
        token_code = generate_token_code()
        expires_str = expires_at  # 已是北京时间字符串，直接使用
        remaining = max_uses
        now_str = beijing_now()
        await self._execute(
            """INSERT INTO tokens (token_code, quota_value, max_uses, remaining_uses, batch_id, expires_at, description, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                token_code,
                quota_value,
                max_uses,
                remaining,
                batch_id,
                expires_str,
                description,
                now_str,
            ),
        )
        # 查询刚插入的记录以获取 id、created_at 等自动生成的字段
        row = await self._execute(
            """SELECT t.*, b.batch_code
               FROM tokens t LEFT JOIN token_batches b ON t.batch_id = b.id
               WHERE t.token_code = ?""",
            (token_code,),
            fetch_one=True,
        )
        return dict(row) if row else {"token_code": token_code}

    async def batch_add_tokens(
        self,
        batch_id: int,
        quota_value: int,
        token_count: int,
        max_uses: int = 1,
        expires_at: Optional[str] = None,
        description: str = None,
    ):
        """批量生成兑换码，关联批次，使用 executemany 批量插入提升性能"""
        expires_str = expires_at
        now_str = beijing_now()

        # 先在内存中生成所有兑换码数据
        rows = []
        for _ in range(token_count):
            token_code = generate_token_code()
            rows.append(
                (
                    token_code,
                    quota_value,
                    max_uses,
                    max_uses,
                    batch_id,
                    expires_str,
                    description,
                    now_str,
                )
            )

        # 一次性批量插入
        async with self._lock:
            loop = asyncio.get_running_loop()

            def _run():
                conn = self._get_connection()
                cursor = conn.cursor()
                try:
                    cursor.executemany(
                        """INSERT INTO tokens (token_code, quota_value, max_uses, remaining_uses, batch_id, expires_at, description, created_at)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                        rows,
                    )
                    conn.commit()
                except Exception:
                    conn.rollback()
                    raise

            await loop.run_in_executor(None, _run)

        return token_count

    async def generate_daily_gift_code(
        self, quota: int, valid_hours: int, valid_minutes: int
    ) -> str:
        """生成每日赠礼兑换码，返回 token_code。
        先将已有的每日赠礼兑换码标记为 expired，再生成新的。"""
        # 将已有的每日赠礼兑换码标记为 expired
        await self._execute(
            "UPDATE tokens SET status = 'expired' WHERE description = '每日赠礼' AND status = 'active'"
        )

        # 计算过期时间
        now = datetime.now(_BEIJING_TZ)
        expires_at = now + timedelta(hours=valid_hours, minutes=valid_minutes)
        expires_str = expires_at.strftime("%Y-%m-%dT%H:%M:%S")

        # 生成新兑换码
        result = await self.add_token(
            quota_value=quota,
            max_uses=-1,
            expires_at=expires_str,
            description="每日赠礼",
        )
        return result["token_code"]

    async def get_daily_gift_code(self) -> Optional[str]:
        """获取当前有效的每日赠礼兑换码，返回 token_code 或 None"""
        now_str = beijing_now()
        row = await self._execute(
            """SELECT token_code FROM tokens
               WHERE description = '每日赠礼' AND status = 'active'
               AND (expires_at IS NULL OR expires_at > ?)
               LIMIT 1""",
            (now_str,),
            fetch_one=True,
        )
        return row["token_code"] if row else None

    # 允许排序的字段映射（前端字段名 → SQL 表达式）
    TOKEN_SORT_COLUMNS = {
        "token_code": "t.token_code",
        "quota_value": "t.quota_value",
        "max_uses": "t.max_uses",
        "redeem_count": "redeem_count",
        "status": "t.status",
        "batch_code": "b.batch_code",
        "description": "t.description",
        "expires_at": "t.expires_at",
        "created_at": "t.created_at",
    }

    async def get_token_list(
        self,
        batch_id: int = None,
        status: str = None,
        keyword: str = None,
        max_uses: str = None,
        sort_levels: list = None,
        page: int = 1,
        page_size: int = 30,
    ) -> Dict[str, Any]:
        """获取兑换码列表（含兑换统计），支持筛选、搜索、多级排序和分页"""
        conditions = []
        params = []
        if batch_id is not None:
            conditions.append("t.batch_id = ?")
            params.append(batch_id)
        if status is not None:
            conditions.append("t.status = ?")
            params.append(status)
        if keyword:
            conditions.append(
                "(t.token_code LIKE ? OR t.description LIKE ? OR b.batch_code LIKE ?)"
            )
            params.extend([f"%{keyword}%", f"%{keyword}%", f"%{keyword}%"])
        if max_uses:
            if max_uses == "unlimited":
                conditions.append("t.max_uses = -1")
            else:
                conditions.append("t.max_uses = ?")
                params.append(int(max_uses))

        where_clause = (" WHERE " + " AND ".join(conditions)) if conditions else ""

        # 获取总数
        count_row = await self._execute(
            f"SELECT COUNT(*) as cnt FROM tokens t LEFT JOIN token_batches b ON t.batch_id = b.id{where_clause}",
            tuple(params),
            fetch_one=True,
        )
        total = count_row["cnt"] if count_row else 0

        # 多级排序：校验字段名，防止 SQL 注入
        if not sort_levels:
            sort_levels = [{"field": "created_at", "order": "desc"}]
        order_parts = []
        for sl in sort_levels:
            sort_expr = self.TOKEN_SORT_COLUMNS.get(sl.get("field"), None)
            if sort_expr:
                sort_dir = (
                    "DESC" if sl.get("order", "desc").lower() == "desc" else "ASC"
                )
                order_parts.append(f"{sort_expr} {sort_dir}")
        # 如果没有有效的排序字段，使用默认排序
        if not order_parts:
            order_parts.append("t.created_at DESC")
        order_clause = ", ".join(order_parts)

        # 分页查询
        offset = (page - 1) * page_size
        results = await self._execute(
            f"""SELECT t.*,
                (SELECT COUNT(*) FROM token_redemptions WHERE token_id = t.id) as redeem_count,
                b.batch_code
            FROM tokens t
            LEFT JOIN token_batches b ON t.batch_id = b.id
            {where_clause}
            ORDER BY {order_clause}
            LIMIT ? OFFSET ?""",
            tuple(params) + (page_size, offset),
            fetch_all=True,
        )

        return {
            "tokens": [dict(r) for r in results],
            "total": total,
            "page": page,
            "page_size": page_size,
        }

    async def get_token_redemptions(self, token_id: int) -> List[Dict[str, Any]]:
        """获取某个兑换码的兑换记录"""
        results = await self._execute(
            """SELECT r.*, u.client_id
               FROM token_redemptions r
               JOIN users u ON r.user_id = u.id
               WHERE r.token_id = ?
               ORDER BY r.redeemed_at DESC""",
            (token_id,),
            fetch_all=True,
        )
        return [dict(r) for r in results]

    async def add_audit_log(
        self,
        action: str,
        target_type: str = None,
        target_id: int = None,
        detail: str = None,
        operator_ip: str = None,
    ):
        """记录管理操作审计日志"""
        now_str = beijing_now()
        await self._execute(
            "INSERT INTO admin_audit_log (action, target_type, target_id, detail, operator_ip, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (action, target_type, target_id, detail, operator_ip, now_str),
        )

    async def create_batch(
        self,
        batch_code: str,
        quota_value: int,
        token_count: int,
        max_uses: int = 1,
        description: str = None,
        expires_at: Optional[str] = None,
    ) -> int:
        """创建批次记录，返回批次ID"""
        expires_str = expires_at  # 已是北京时间字符串，直接使用
        now_str = beijing_now()
        batch_id = await self._execute(
            "INSERT INTO token_batches (batch_code, quota_value, token_count, max_uses, description, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                batch_code,
                quota_value,
                token_count,
                max_uses,
                description,
                expires_str,
                now_str,
            ),
        )
        return batch_id

    async def get_batches(self) -> List[Dict[str, Any]]:
        """获取批次列表含统计"""
        results = await self._execute(
            """SELECT b.*,
                (SELECT COUNT(*) FROM tokens WHERE batch_id = b.id) as total_tokens,
                (SELECT COUNT(*) FROM tokens WHERE batch_id = b.id AND status = 'active') as active_tokens,
                (SELECT COUNT(*) FROM token_redemptions r JOIN tokens t ON r.token_id = t.id WHERE t.batch_id = b.id) as redeemed_count
            FROM token_batches b ORDER BY b.created_at DESC""",
            fetch_all=True,
        )
        return [dict(r) for r in results]

    async def update_batch(
        self,
        batch_id: int,
        description: str = None,
        expires_at: Optional[str] = None,
        status: str = None,
    ):
        """修改批次信息"""
        updates = []
        params = []
        if description is not None:
            updates.append("description = ?")
            params.append(description)
        if expires_at is not None:
            updates.append("expires_at = ?")
            params.append(
                expires_at.isoformat()
                if isinstance(expires_at, datetime)
                else expires_at
            )
        if status is not None:
            updates.append("status = ?")
            params.append(status)
        if not updates:
            return
        params.append(batch_id)
        await self._execute(
            f"UPDATE token_batches SET {', '.join(updates)} WHERE id = ?",
            tuple(params),
        )

    async def disable_batch(self, batch_id: int):
        """禁用批次及旗下所有 active 状态的兑换码"""
        await self._execute(
            "UPDATE token_batches SET status = 'disabled' WHERE id = ?",
            (batch_id,),
        )
        await self._execute(
            "UPDATE tokens SET status = 'disabled' WHERE batch_id = ? AND status = 'active'",
            (batch_id,),
        )

    async def update_token(
        self,
        token_id: int,
        status: str = None,
        description: str = None,
        expires_at: str = None,
        quota_value: int = None,
        max_uses: int = None,
    ) -> Dict[str, Any]:
        """修改单个兑换码，返回更新后的完整记录"""
        updates = []
        params = []
        if status is not None:
            updates.append("status = ?")
            params.append(status)
        if description is not None:
            updates.append("description = ?")
            params.append(description)
        if expires_at is not None:
            updates.append("expires_at = ?")
            params.append(expires_at)
        if quota_value is not None:
            updates.append("quota_value = ?")
            params.append(quota_value)
        if max_uses is not None:
            updates.append("max_uses = ?")
            params.append(max_uses)
            # 同步更新 remaining_uses（仅当新 max_uses 大于当前已用次数时）
            updates.append(
                "remaining_uses = CASE WHEN ? = -1 THEN -1 ELSE ? - (SELECT COUNT(*) FROM token_redemptions WHERE token_id = ?) END"
            )
            params.extend([max_uses, max_uses, token_id])
        if not updates:
            # 无更新，直接返回当前记录
            row = await self._execute(
                """SELECT t.*, (SELECT COUNT(*) FROM token_redemptions WHERE token_id = t.id) as redeem_count,
                          b.batch_code FROM tokens t LEFT JOIN token_batches b ON t.batch_id = b.id WHERE t.id = ?""",
                (token_id,),
                fetch_one=True,
            )
            return dict(row) if row else {}
        params.append(token_id)
        await self._execute(
            f"UPDATE tokens SET {', '.join(updates)} WHERE id = ?",
            tuple(params),
        )
        # 返回更新后的完整记录
        row = await self._execute(
            """SELECT t.*, (SELECT COUNT(*) FROM token_redemptions WHERE token_id = t.id) as redeem_count,
                      b.batch_code FROM tokens t LEFT JOIN token_batches b ON t.batch_id = b.id WHERE t.id = ?""",
            (token_id,),
            fetch_one=True,
        )
        return dict(row) if row else {}

    async def delete_token(self, token_id: int) -> bool:
        """删除兑换码（同时删除关联的兑换记录），返回是否成功"""
        async with self._lock:
            loop = asyncio.get_running_loop()

            def _run():
                conn = self._get_connection()
                try:
                    conn.execute(
                        "DELETE FROM token_redemptions WHERE token_id = ?", (token_id,)
                    )
                    conn.execute("DELETE FROM tokens WHERE id = ?", (token_id,))
                    conn.commit()
                    return conn.total_changes > 0
                except Exception:
                    conn.rollback()
                    raise

            rowcount = await loop.run_in_executor(None, _run)
        return rowcount

    async def toggle_token_status(self, token_id: int) -> str:
        """切换兑换码状态：active <-> disabled，exhausted -> active（恢复剩余次数）"""
        token = await self._execute(
            "SELECT status, max_uses, remaining_uses FROM tokens WHERE id = ?",
            (token_id,),
            fetch_one=True,
        )
        if not token:
            return None
        if token["status"] == "active":
            new_status = "disabled"
            await self._execute(
                "UPDATE tokens SET status = ? WHERE id = ?",
                (new_status, token_id),
            )
        elif token["status"] in ("disabled", "exhausted"):
            new_status = "active"
            # exhausted 恢复时同时恢复 remaining_uses
            if token["status"] == "exhausted" and token["max_uses"] > 0:
                # 根据已兑换次数计算剩余次数，而非直接重置为 max_uses
                redemption_count = token["max_uses"] - token["remaining_uses"]
                new_remaining = max(0, token["max_uses"] - redemption_count)
                await self._execute(
                    "UPDATE tokens SET status = ?, remaining_uses = ? WHERE id = ?",
                    (new_status, new_remaining, token_id),
                )
            else:
                await self._execute(
                    "UPDATE tokens SET status = ? WHERE id = ?",
                    (new_status, token_id),
                )
        else:
            # expired 等其他状态不切换
            return token["status"]
        return new_status

    async def expire_overdue_tokens(self) -> int:
        """批量将已过期的 active/exhausted token/batch 更新为 expired 状态，返回受影响的 token 数量"""
        now_str = beijing_now()
        # 扫描 status IN ('active','exhausted') AND expires_at IS NOT NULL AND expires_at < now 的记录
        result = await self._execute(
            "UPDATE tokens SET status = 'expired' WHERE status IN ('active', 'exhausted') AND expires_at IS NOT NULL AND expires_at < ?",
            (now_str,),
            return_rowcount=True,
        )
        # 同步处理 batch：如果 batch 的 expires_at 已过期且仍为 active，也标记为 expired
        await self._execute(
            "UPDATE token_batches SET status = 'expired' WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < ?",
            (now_str,),
        )
        return result or 0

    # 兑换记录允许排序的字段映射
    REDEMPTION_SORT_COLUMNS = {
        "token_code": "t.token_code",
        "client_id": "u.client_id",
        "user_id": "u.id",
        "quota_granted": "r.quota_granted",
        "remaining_uses": "t.remaining_uses",
        "status": "t.status",
        "redeemed_at": "r.redeemed_at",
    }

    async def get_all_redemptions(
        self,
        page: int = 1,
        page_size: int = 30,
        keyword: str = None,
        sort_levels: list = None,
    ) -> Dict[str, Any]:
        """获取全量兑换记录（分页+搜索+排序）"""
        conditions = []
        params = []
        if keyword:
            conditions.append("(t.token_code LIKE ? OR u.client_id LIKE ?)")
            params.extend([f"%{keyword}%", f"%{keyword}%"])

        where_clause = (" WHERE " + " AND ".join(conditions)) if conditions else ""

        # 获取总数
        count_row = await self._execute(
            f"SELECT COUNT(*) as cnt FROM token_redemptions r JOIN tokens t ON r.token_id = t.id JOIN users u ON r.user_id = u.id{where_clause}",
            tuple(params),
            fetch_one=True,
        )
        total = count_row["cnt"] if count_row else 0

        # 排序
        order_parts = []
        if sort_levels:
            for sl in sort_levels:
                field = sl.get("field", "")
                order = sl.get("order", "asc")
                col = self.REDEMPTION_SORT_COLUMNS.get(field)
                if col:
                    order_parts.append(f"{col} {'DESC' if order == 'desc' else 'ASC'}")
        if not order_parts:
            order_parts = ["r.redeemed_at DESC"]
        order_clause = " ORDER BY " + ", ".join(order_parts)

        # 分页查询
        offset = (page - 1) * page_size
        results = await self._execute(
            f"""SELECT r.id, r.token_id, r.quota_granted, r.redeemed_at,
                t.token_code, t.remaining_uses, t.max_uses, t.status,
                u.client_id, u.id as user_id
            FROM token_redemptions r
            JOIN tokens t ON r.token_id = t.id
            JOIN users u ON r.user_id = u.id
            {where_clause}
            {order_clause}
            LIMIT ? OFFSET ?""",
            tuple(params) + (page_size, offset),
            fetch_all=True,
        )

        return {
            "redemptions": [dict(r) for r in results],
            "total": total,
            "page": page,
            "page_size": page_size,
        }

    async def get_audit_logs(
        self, page: int = 1, page_size: int = 20
    ) -> Dict[str, Any]:
        """获取审计日志"""
        count_row = await self._execute(
            "SELECT COUNT(*) as cnt FROM admin_audit_log",
            fetch_one=True,
        )
        total = count_row["cnt"] if count_row else 0

        offset = (page - 1) * page_size
        results = await self._execute(
            "SELECT * FROM admin_audit_log ORDER BY created_at DESC LIMIT ? OFFSET ?",
            (page_size, offset),
            fetch_all=True,
        )

        return {
            "logs": [dict(r) for r in results],
            "total": total,
            "page": page,
            "page_size": page_size,
        }

    # ==================== 预设管理 ====================
    async def get_user_presets(self, user_id: int) -> List[Dict[str, Any]]:
        """获取用户的所有预设（包含公共预设），不含图片以节省内存
        管理员（user_id=1）可查看所有预设"""
        if user_id == 1:
            results = await self._execute(
                "SELECT id, uuid, user_id, name, prompt, params, is_public, created_at, updated_at FROM presets ORDER BY is_public DESC, id DESC",
                (),
                fetch_all=True,
            )
        else:
            results = await self._execute(
                "SELECT id, uuid, user_id, name, prompt, params, is_public, created_at, updated_at FROM presets WHERE user_id = ? OR is_public = 1 ORDER BY is_public DESC, id DESC",
                (user_id,),
                fetch_all=True,
            )
        return [dict(r) for r in results]

    async def get_preset_image(self, uuid: str) -> Optional[str]:
        """获取特定预设的图片base64"""
        result = await self._execute(
            "SELECT image_base64 FROM presets WHERE uuid = ?",
            (uuid,),
            fetch_one=True,
        )
        return result["image_base64"] if result else None

    async def add_preset(
        self,
        user_id: int,
        name: str,
        prompt: str,
        params: dict = None,
        image_base64: str = None,
    ) -> dict:
        """添加或更新预设：同名+同用户则更新，否则插入。返回 {uuid, action}
        如果与公共预设同名则拒绝更新，返回 {error: 'public_preset_conflict'}
        """
        # 检查是否与公共预设同名
        public_conflict = await self._execute(
            "SELECT uuid FROM presets WHERE name = ? AND is_public = 1",
            (name,),
            fetch_one=True,
        )
        if public_conflict:
            return {"uuid": public_conflict["uuid"], "action": "public_conflict"}

        params_json = json.dumps(params) if params else None

        # 查找是否已存在同名预设
        existing = await self._execute(
            "SELECT uuid FROM presets WHERE user_id = ? AND name = ?",
            (user_id, name),
            fetch_one=True,
        )

        if existing:
            # 同名+同用户，执行更新
            if image_base64 is not None:
                # 有新图片，更新所有字段
                now_str = beijing_now()
                await self._execute(
                    """UPDATE presets SET prompt = ?, params = ?, image_base64 = ?, updated_at = ?
                       WHERE user_id = ? AND name = ?""",
                    (prompt, params_json, image_base64, now_str, user_id, name),
                )
            else:
                # 没有新图片，只更新文本字段，保留原有图片
                now_str = beijing_now()
                await self._execute(
                    """UPDATE presets SET prompt = ?, params = ?, updated_at = ?
                       WHERE user_id = ? AND name = ?""",
                    (prompt, params_json, now_str, user_id, name),
                )
            return {"uuid": existing["uuid"], "action": "updated"}
        else:
            # 不存在，执行插入
            preset_uuid = str(uuid.uuid4())
            now_str = beijing_now()
            await self._execute(
                """INSERT INTO presets (uuid, user_id, name, prompt, params, image_base64, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    preset_uuid,
                    user_id,
                    name,
                    prompt,
                    params_json,
                    image_base64,
                    now_str,
                    now_str,
                ),
            )
            return {"uuid": preset_uuid, "action": "created"}

    # ==================== 生图日志 ====================
    async def create_generation_log(
        self,
        user_id: int,
        prompt: str,
        negative_prompt: str,
        ckpt_name: str,
        width: int,
        height: int,
        steps: int,
        cfg: float,
        seed: int,
        sampler_name: str,
        scheduler: str,
        lora_list: list = None,
        client_ip: str = None,
        quota_used: int = 0,
    ) -> int:
        """创建生图日志记录"""
        lora_json = json.dumps(lora_list) if lora_list else None

        now_str = beijing_now()
        log_id = await self._execute(
            """INSERT INTO generation_logs 
               (user_id, prompt, negative_prompt, ckpt_name, width, height, steps, cfg, seed,
                sampler_name, scheduler, lora_list, client_ip, quota_used, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                user_id,
                prompt,
                negative_prompt,
                ckpt_name,
                width,
                height,
                steps,
                cfg,
                seed,
                sampler_name,
                scheduler,
                lora_json,
                client_ip,
                quota_used,
                now_str,
            ),
        )

        return log_id

    async def update_generation_log(
        self,
        log_id: int,
        status: str,
        filename: str = None,
        duration: float = None,
        error_message: str = None,
    ):
        """更新生图日志状态，None值不会覆盖已有值。
        如果当前状态已经是 completed，则不再更新（防止竞争重复写入）。"""
        now_str = beijing_now()
        await self._execute(
            """UPDATE generation_logs 
               SET status = ?, filename = COALESCE(?, filename), duration = COALESCE(?, duration),
                   error_message = COALESCE(?, error_message), completed_at = ?
               WHERE id = ? AND status != 'completed'""",
            (status, filename, duration, error_message, now_str, log_id),
        )

    async def get_recent_img_durations(self, limit: int = 100) -> List[float]:
        """从 generation_logs 表获取最近 N 条已完成生图的耗时（秒），从旧到新排序"""
        rows = await self._execute(
            "SELECT duration FROM generation_logs WHERE status = 'completed' AND duration IS NOT NULL ORDER BY id DESC LIMIT ?",
            (limit,),
            fetch_all=True,
        )
        if not rows:
            return []
        # 查询结果是按 id DESC（最新在前），需要反转为从旧到新
        durations = [r["duration"] for r in reversed(rows)]
        return durations

    async def create_search_log(self, user_id: Optional[int], duration: float):
        """记录一次搜索日志"""
        now_str = beijing_now()
        await self._execute(
            "INSERT INTO search_logs (user_id, duration, created_at) VALUES (?, ?, ?)",
            (user_id, duration, now_str),
        )

    async def get_recent_search_durations(self, limit: int = 100) -> List[float]:
        """从 search_logs 表获取最近 N 条搜索耗时（秒），从旧到新排序"""
        rows = await self._execute(
            "SELECT duration FROM search_logs ORDER BY id DESC LIMIT ?",
            (limit,),
            fetch_all=True,
        )
        if not rows:
            return []
        # 查询结果是按 id DESC（最新在前），需要反转为从旧到新
        durations = [r["duration"] for r in reversed(rows)]
        return durations

    # ==================== 仪表盘统计 ====================
    async def get_dashboard_stats(self) -> Dict[str, Any]:
        """聚合查询仪表盘所需的统计数据"""
        # 总用户数
        total_users_row = await self._execute(
            "SELECT COUNT(*) as cnt FROM users", fetch_one=True
        )
        total_users = total_users_row["cnt"] if total_users_row else 0

        # 今日活跃用户数
        today_str = datetime.now(_BEIJING_TZ).strftime("%Y-%m-%d")
        users_today_row = await self._execute(
            "SELECT COUNT(*) as cnt FROM users WHERE last_request_at >= ?",
            (today_str,),
            fetch_one=True,
        )
        users_today = users_today_row["cnt"] if users_today_row else 0

        # 总生图数（从 generation_logs 统计，比 users.total_generated 更准确）
        total_gen_row = await self._execute(
            "SELECT COUNT(*) as cnt FROM generation_logs", fetch_one=True
        )
        total_generated = total_gen_row["cnt"] if total_gen_row else 0

        # 今日生图数
        gen_today_row = await self._execute(
            "SELECT COUNT(*) as cnt FROM generation_logs WHERE created_at >= ?",
            (today_str,),
            fetch_one=True,
        )
        generated_today = gen_today_row["cnt"] if gen_today_row else 0

        # 模型使用排行（按 total_calls 降序）
        model_rows = await self._execute(
            "SELECT name, category, quota_cost, total_calls FROM models WHERE is_active = 1 ORDER BY total_calls DESC",
            fetch_all=True,
        )
        model_usage = [dict(r) for r in model_rows] if model_rows else []

        # LoRA 使用排行（按 total_calls 降序，取前 8）
        lora_rows = await self._execute(
            "SELECT name, total_calls, category FROM loras WHERE is_active = 1 ORDER BY total_calls DESC LIMIT 8",
            fetch_all=True,
        )
        lora_top = [dict(r) for r in lora_rows] if lora_rows else []

        # 最近 100 条生图记录（关联 models 表获取模型展示名）
        recent_rows = await self._execute(
            """SELECT g.id, COALESCE((SELECT name FROM models WHERE ckpt_name = g.ckpt_name LIMIT 1), g.ckpt_name) as ckpt_name,
                      g.status, g.duration, g.created_at, g.client_ip, g.quota_used, g.user_id
               FROM generation_logs g ORDER BY g.id DESC LIMIT 100""",
            fetch_all=True,
        )
        recent_generations = [dict(r) for r in recent_rows] if recent_rows else []

        # 生图状态分布
        status_rows = await self._execute(
            "SELECT status, COUNT(*) as cnt FROM generation_logs GROUP BY status",
            fetch_all=True,
        )
        generation_status_counts = {}
        if status_rows:
            for r in status_rows:
                generation_status_counts[r["status"]] = r["cnt"]

        # 兑换码统计
        token_total_row = await self._execute(
            "SELECT COUNT(*) as cnt FROM tokens", fetch_one=True
        )
        token_active_row = await self._execute(
            "SELECT COUNT(*) as cnt FROM tokens WHERE status = 'active'", fetch_one=True
        )
        redemption_row = await self._execute(
            "SELECT COUNT(*) as cnt FROM token_redemptions", fetch_one=True
        )

        return {
            "total_users": total_users,
            "users_today": users_today,
            "total_generated": total_generated,
            "generated_today": generated_today,
            "model_usage": model_usage,
            "lora_top": lora_top,
            "recent_generations": recent_generations,
            "generation_status_counts": generation_status_counts,
            "token_stats": {
                "total_tokens": token_total_row["cnt"] if token_total_row else 0,
                "active_tokens": token_active_row["cnt"] if token_active_row else 0,
                "total_redemptions": redemption_row["cnt"] if redemption_row else 0,
            },
        }

    async def get_dashboard_users(self, limit: int = 50) -> List[Dict[str, Any]]:
        """获取用户列表（按最近活跃排序），用于仪表盘用户栏"""
        rows = await self._execute(
            """SELECT u.id, u.client_id, u.quota, u.total_generated, u.total_searches, u.last_request_at, u.created_at,
                      (SELECT COUNT(*) FROM presets WHERE user_id = u.id) as preset_count,
                      (SELECT COUNT(*) FROM token_redemptions WHERE user_id = u.id) as redeem_count,
                      COALESCE((SELECT SUM(g.quota_used) FROM generation_logs g WHERE g.user_id = u.id), 0) as total_quota_used
               FROM users u ORDER BY u.last_request_at DESC NULLS LAST LIMIT ?""",
            (limit,),
            fetch_all=True,
        )
        return [dict(r) for r in rows] if rows else []


# 全局数据库实例
db = Database()
