"""
仪表盘事件总线 —— 事件驱动的增量推送

替代原来 3 秒全量轮询的 WebSocket 推送方式，
改为在状态变化时立即推送增量消息，实现仪表盘即时更新。
"""

import time
import asyncio
import logging
from typing import Set, Dict
from fastapi import WebSocket

logger = logging.getLogger(__name__)


class DashboardEventBus:
    """仪表盘事件总线：管理连接、广播增量消息、缓存队列状态"""

    def __init__(self, monitor, scheduler, comfyui_url: str):
        self.clients: Set[WebSocket] = set()
        self.monitor = monitor
        self.scheduler = scheduler
        self._comfyui_url = comfyui_url

        # ComfyUI 队列缓存（2 秒过期，避免频繁请求）
        self._comfy_queue_cache: Dict[str, int] = {
            "queue_running": 0,
            "queue_pending": 0,
        }
        self._comfy_cache_time: float = 0  # 上次缓存时间
        self._comfy_cache_ttl: float = (
            1.0  # 缓存有效期（秒），队列轮询间隔2秒，缓存1秒确保每次轮询能刷新
        )

    # ================= 连接管理 =================

    async def register(self, websocket: WebSocket):
        """注册新客户端，并立即发送完整初始状态"""
        self.clients.add(websocket)
        try:
            await self._send_init(websocket)
        except Exception as e:
            logger.debug(f"发送初始状态失败: {e}")
            self.clients.discard(websocket)

    async def unregister(self, websocket: WebSocket):
        """移除客户端"""
        self.clients.discard(websocket)

    # ================= 广播 =================

    async def broadcast(self, event_type: str, data: dict):
        """向所有客户端广播增量消息（仪表盘 + 普通用户统一通道）"""
        if not self.clients:
            return

        payload = {"type": event_type, "data": data}
        failed = set()
        for ws in self.clients:
            try:
                await ws.send_json(payload)
            except Exception:
                failed.add(ws)

        if failed:
            self.clients -= failed

    # ================= ComfyUI 队列查询（带缓存） =================

    async def _fetch_comfy_queue(self) -> Dict[str, int]:
        """获取 ComfyUI 队列状态，1 秒内复用缓存

        同时存储 prompt_id 列表，用于计算每个任务在 ComfyUI 队列中的实际位置
        """
        now = time.time()
        if now - self._comfy_cache_time < self._comfy_cache_ttl:
            return self._comfy_queue_cache

        try:
            import aiohttp

            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{self._comfyui_url}/queue", timeout=aiohttp.ClientTimeout(total=5)
                ) as resp:
                    if resp.status == 200:
                        comfy_queue = await resp.json()
                        # ComfyUI /queue 返回格式：
                        # queue_running: [[number, prompt_id, ...], ...]
                        # queue_pending: [[number, prompt_id, ...], ...]
                        running_list = comfy_queue.get("queue_running", [])
                        pending_list = comfy_queue.get("queue_pending", [])
                        self._comfy_queue_cache = {
                            "queue_running": len(running_list),
                            "queue_pending": len(pending_list),
                            "running_prompt_ids": [
                                item[1] for item in running_list if len(item) > 1
                            ],
                            "pending_prompt_ids": [
                                item[1] for item in pending_list if len(item) > 1
                            ],
                        }
                        self._comfy_cache_time = now
        except Exception as e:
            logger.debug(f"获取 ComfyUI 队列状态失败: {e}")

        return self._comfy_queue_cache

    # ================= 初始状态 =================

    async def _send_init(self, websocket: WebSocket):
        """连接建立后发送完整初始状态快照"""
        monitor = self.monitor
        scheduler = self.scheduler

        # 获取 ComfyUI 队列状态
        comfy_queue = await self._fetch_comfy_queue()

        # 构建统一队列数据（与 build_queue_update 结构一致）
        task_queue = [t.custom_task_id for t in scheduler.queue]
        running_ids = [
            info["custom_task_id"] for info in scheduler.active_tasks.values()
        ]

        stats = {
            "uptime": monitor.get_uptime_minutes(),
            "online": len(monitor.active_clients),
            "total_requests": monitor.total_requests,
            "img_avg": round(monitor.get_img_avg_time(), 2),
            "img_last": round(monitor.img_last_time, 2),
            "img_max": round(monitor.img_max_time, 2),
            "tag_avg": round(monitor.get_tag_avg_time(), 3),
            "tag_last": round(monitor.tag_last_time, 3),
            "tag_max": round(monitor.tag_max_time, 3),
            "request_stats": monitor.request_stats,
            "task_queue": task_queue,
            "running_ids": running_ids,
            "queue_running_count": comfy_queue["queue_running"],
            "queue_pending_count": comfy_queue["queue_pending"],
            "img_times": list(monitor.img_time_records)[-100:],
            "tag_times": list(monitor.tag_time_records)[-100:],
            "current_task": scheduler.current_task_info,
            "task_list": scheduler.task_snapshots,
            "total_users": monitor.cached_total_users,
            "users_today": monitor.cached_users_today,
            "total_generated": monitor.cached_total_generated,
            "logs": list(monitor.recent_logs),
        }

        await websocket.send_json({"type": "init", "data": stats})

    # ================= 心跳循环 =================

    async def heartbeat_loop(self):
        """每 15 秒发送心跳，同时刷新 ComfyUI 队列缓存"""
        while True:
            await asyncio.sleep(15)
            if self.clients:
                # 刷新 ComfyUI 队列缓存
                comfy_queue = await self._fetch_comfy_queue()
                await self.broadcast(
                    "heartbeat",
                    {
                        "uptime": self.monitor.get_uptime_minutes(),
                        "online": len(self.monitor.active_clients),
                        "queue_running": comfy_queue["queue_running"],
                        "queue_pending": comfy_queue["queue_pending"],
                    },
                )

    # ================= 队列轮询 =================

    async def queue_poll_loop(self):
        """当有任务在 ComfyUI 排队时，每 2 秒轮询并广播队列更新

        解决问题：ComfyUI 内部队列变化（外部批量任务完成）不会触发后端事件，
        导致前端 queue_pending_count 不更新，按钮卡在旧数字。
        """
        last_pending = 0
        last_running = 0
        while True:
            await asyncio.sleep(2)
            # 只在有活跃任务时轮询
            has_active = bool(self.scheduler.active_tasks) or bool(self.scheduler.queue)
            if not has_active or not self.clients:
                last_pending = 0
                last_running = 0
                continue

            comfy_queue = await self._fetch_comfy_queue()
            current_pending = comfy_queue["queue_pending"]
            current_running = comfy_queue["queue_running"]

            # ComfyUI 队列计数变化时才广播（避免无意义推送）
            if current_pending != last_pending or current_running != last_running:
                await self.broadcast_queue_update()
                last_pending = current_pending
                last_running = current_running

    # ================= 便捷方法：构建各类事件数据 =================

    def build_stats_update(self) -> dict:
        """构建统计数据更新事件"""
        monitor = self.monitor
        return {
            "total_requests": monitor.total_requests,
            "request_stats": monitor.request_stats,
            "img_avg": round(monitor.get_img_avg_time(), 2),
            "img_last": round(monitor.img_last_time, 2),
            "img_max": round(monitor.img_max_time, 2),
            "tag_avg": round(monitor.get_tag_avg_time(), 3),
            "tag_last": round(monitor.tag_last_time, 3),
            "tag_max": round(monitor.tag_max_time, 3),
            "online": len(monitor.active_clients),
            "total_users": monitor.cached_total_users,
            "users_today": monitor.cached_users_today,
            "uptime": monitor.get_uptime_minutes(),
            "total_generated": monitor.cached_total_generated,
            "img_times": list(monitor.img_time_records)[-100:],
            "tag_times": list(monitor.tag_time_records)[-100:],
        }

    def build_queue_update(self) -> dict:
        """构建队列更新事件 —— 统一数据源

        task_queue: 排队中的任务 ID 列表（有序，index+1 即排名）
        running_ids: 正在 ComfyUI 执行的任务 ID 列表
        comfy_queue_positions: 每个已提交任务在 ComfyUI 队列中的实际位置
            格式: {custom_task_id: position}，position 从1开始
            - 在 pending 队列中: indexOf + 1
            - 在 running 队列中: 0（表示正在执行）
            - 不在队列中: -1
        queue_running_count / queue_pending_count: ComfyUI 队列计数
        """
        task_queue = [t.custom_task_id for t in self.scheduler.queue]
        running_ids = [
            info["custom_task_id"] for info in self.scheduler.active_tasks.values()
        ]

        # 计算每个已提交任务在 ComfyUI 队列中的实际位置
        comfy_queue_positions = {}
        pending_prompt_ids = self._comfy_queue_cache.get("pending_prompt_ids", [])
        running_prompt_ids = self._comfy_queue_cache.get("running_prompt_ids", [])

        for prompt_id, info in self.scheduler.active_tasks.items():
            custom_id = info.get("custom_task_id")
            if not custom_id:
                continue
            if prompt_id in running_prompt_ids:
                comfy_queue_positions[custom_id] = 0  # 正在执行
            elif prompt_id in pending_prompt_ids:
                comfy_queue_positions[custom_id] = (
                    pending_prompt_ids.index(prompt_id) + 1
                )  # 排队位置
            else:
                comfy_queue_positions[custom_id] = -1  # 不在 ComfyUI 队列中

        return {
            "task_queue": task_queue,
            "running_ids": running_ids,
            "comfy_queue_positions": comfy_queue_positions,
            "queue_running_count": self._comfy_queue_cache["queue_running"],
            "queue_pending_count": self._comfy_queue_cache["queue_pending"],
            "task_list": self.scheduler.task_snapshots,
            "current_task": self.scheduler.current_task_info,
        }

    async def build_queue_update_fresh(self) -> dict:
        """构建队列更新事件（先刷新 ComfyUI 缓存，确保数据准确）"""
        await self._fetch_comfy_queue()
        return self.build_queue_update()

    async def broadcast_queue_update(self):
        """刷新缓存后广播队列更新（推荐使用此方法替代手动 build + broadcast）"""
        data = await self.build_queue_update_fresh()
        await self.broadcast("queue_update", data)
