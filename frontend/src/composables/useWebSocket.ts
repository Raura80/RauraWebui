import { ref, onUnmounted, readonly } from 'vue';
import { WebSocketManager, createStatusWebSocket, createDashboardWebSocket } from '../services/websocket';
import type { WSMessage, QueueResponse } from '../types';
import { useGenerationStore } from '../stores/generation';
import { useUserStore } from '../stores/user';

export function useWebSocket() {
    const generationStore = useGenerationStore();
    const userStore = useUserStore();

    let statusWs: WebSocketManager | null = null;
    let dashboardWs: WebSocketManager | null = null;

    // 状态通道是否已连接
    const isStatusConnected = ref(false);
    // 仪表盘通道是否已连接
    const isDashboardConnected = ref(false);

    // 队列状态数据（供外部组件消费）
    const queueData = ref<QueueResponse | null>(null);
    // 进度数据（供外部组件消费）
    const progressData = ref<{ value: number; max: number } | null>(null);
    // 任务失败消息（供外部组件消费）
    const taskFailedMessage = ref<string | null>(null);

    // 初始化 ComfyUI 状态通道（同时初始化后端仪表盘通道）
    function initStatusWs() {
        if (!userStore.clientId) return;
        // 如果已有连接则先断开
        if (statusWs) {
            statusWs.disconnect();
        }

        // 使用独立的 comfyuiSessionId 连接 ComfyUI，避免同用户多窗口 WS 消息路由冲突
        statusWs = createStatusWebSocket(userStore.comfyuiSessionId);

        statusWs.onMessage((data: WSMessage) => {
            handleStatusMessage(data);
        });

        statusWs.onBinary((buffer: ArrayBuffer) => {
            handleBinaryPreview(buffer);
        });

        // 连接实际建立后才设为 true
        statusWs.onOpen(() => {
            isStatusConnected.value = true;
        });

        statusWs.onClose(() => {
            isStatusConnected.value = false;
        });

        statusWs.connect();

        // 同时初始化后端仪表盘通道（接收 task_started/task_failed/queue_update）
        initDashboardWs();
    }

    // 初始化仪表盘通道（接收 task_started/task_failed/queue_update）
    function initDashboardWs() {
        if (dashboardWs) {
            dashboardWs.disconnect();
        }

        dashboardWs = createDashboardWebSocket();

        dashboardWs.onMessage((data: WSMessage) => {
            if (data.type === 'queue_update') {
                queueData.value = data.data;
            } else if (data.type === 'task_started') {
                // 任务开始执行（原版：从后端状态 WS /api/ws/status 接收）
                if (data.data?.custom_task_id === generationStore.currentCustomTaskId) {
                    generationStore.addActivePromptId(data.data.prompt_id);
                    generationStore.currentPromptId = data.data.prompt_id;
                }
            } else if (data.type === 'task_failed') {
                // 任务失败（原版：从后端状态 WS /api/ws/status 接收）
                if (data.data?.custom_task_id === generationStore.currentCustomTaskId) {
                    if (data.data.error_code !== 'USER_CANCELED') {
                        const errorMsg = data.data.error
                            ? `任务失败: ${data.data.error}`
                            : '任务失败';
                        taskFailedMessage.value = errorMsg;
                    }
                }
            }
        });

        // 连接实际建立后才设为 true
        dashboardWs.onOpen(() => {
            isDashboardConnected.value = true;
        });

        dashboardWs.onClose(() => {
            isDashboardConnected.value = false;
        });

        dashboardWs.connect();
    }

    // 处理状态消息 - 分发到对应的状态/事件
    function handleStatusMessage(data: WSMessage) {
        if (data.type === 'status') {
            // 队列状态更新 - 暂不处理
        } else if (data.type === 'progress') {
            // 进度更新 - 存储到 progressData 供组件消费
            progressData.value = {
                value: data.data.value,
                max: data.data.max,
            };
        } else if (data.type === 'executed') {
            // 任务执行完成
            if (data.data.output && data.data.output.images && data.data.output.images.length > 0) {
                if (generationStore.activePromptIds.has(data.data.prompt_id)) {
                    generationStore.removeActivePromptId(data.data.prompt_id);
                    generationStore.outputFilename = data.data.output.images[0].filename;
                    // fetchResult 由 useGeneration 处理，这里只设置 filename
                }
            }
        } else if (data.type === 'queue_update') {
            // 队列更新（ComfyUI WS 也可能发送此消息）
            queueData.value = data.data;
        }
        // 注意：task_started/task_failed 消息从后端状态 WS (/api/ws/status) 接收，
        // 在 initDashboardWs 中处理，不在此处处理
    }

    // 处理二进制预览帧 - 根据主图区域状态决定显示位置
    // 原版逻辑：resultImage.style.display === 'block' && resultImage.dataset.isCompleted === 'true'
    // 即：主图区域已有可见的已完成图片 → 二进制帧显示在浮动预览窗口
    // 否则 → 二进制帧直接显示在主图区域
    function handleBinaryPreview(buffer: ArrayBuffer): void {
        if (buffer.byteLength < 8) return;
        const imageBytes = buffer.slice(8);
        const blob = new Blob([imageBytes], { type: 'image/jpeg' });
        const imageUrl = URL.createObjectURL(blob);

        // 判断主图区域是否已有完成的图片
        // 原版：resultImage.style.display === 'block' && resultImage.dataset.isCompleted === 'true'
        // dataset.isCompleted 在 fetchResult 完成时设为 'true'，不会被 1.5 秒超时重置
        const hasCompleted = generationStore.currentImageUrl !== null && generationStore.hasCompletedImage;
        if (hasCompleted) {
            // 主图区域已有完成的图片 → 显示为浮动预览窗口（可拖拽的缩略图）
            generationStore.setLivePreviewUrl(imageUrl);
            // 加载图片获取尺寸，调整预览容器
            const tempImg = new Image();
            tempImg.onload = function () {
                const isMobile = window.innerWidth <= 768;
                const BASE_AREA = isMobile ? 25000 : 60000;
                const MAX_SIDE = isMobile ? 200 : 400;
                const MIN_SIDE = isMobile ? 80 : 120;
                const ratio = tempImg.width / tempImg.height;
                let targetW = Math.sqrt(BASE_AREA * ratio);
                let targetH = BASE_AREA / targetW;
                if (targetW > MAX_SIDE) { targetW = MAX_SIDE; targetH = targetW / ratio; }
                if (targetH > MAX_SIDE) { targetH = MAX_SIDE; targetW = targetH * ratio; }
                if (targetW < MIN_SIDE) { targetW = MIN_SIDE; targetH = targetW / ratio; }
                generationStore.livePreviewWidth = Math.round(targetW);
                generationStore.livePreviewHeight = Math.round(targetH);
                // 设置初始位置：基于图片展示区域（.result-area）定位
                // 浮动预览出现在图片展示区域的右侧，垂直居中
                const margin = 20;
                const resultArea = document.querySelector('.result-area') as HTMLElement | null;
                const previewW = Math.round(targetW);
                const previewH = Math.round(targetH);

                if (resultArea) {
                    const rect = resultArea.getBoundingClientRect();
                    // left = 图片展示区域右边缘 + 间距，但不超出视口右边界（超出时覆盖在图片上）
                    const calcLeft = rect.right + margin;
                    const maxLeft = window.innerWidth - previewW - margin;
                    const safeLeft = Math.max(margin, Math.min(calcLeft, maxLeft));
                    // top = 图片展示区域垂直居中
                    const calcTop = rect.top + (rect.height - previewH) / 2;
                    const safeTop = Math.max(margin, Math.min(calcTop, window.innerHeight - previewH - margin));
                    generationStore.livePreviewLeft = safeLeft + 'px';
                    generationStore.livePreviewTop = safeTop + 'px';
                } else {
                    // 找不到图片展示区域时，回退到视口右侧定位
                    const calcLeft = window.innerWidth - previewW - margin;
                    generationStore.livePreviewLeft = Math.max(margin, calcLeft) + 'px';
                    const calcTop = window.innerHeight * 0.5;
                    const safeTop = Math.min(calcTop, window.innerHeight - previewH - margin);
                    generationStore.livePreviewTop = Math.max(margin, safeTop) + 'px';
                }
                generationStore.isLivePreviewVisible = true;
            };
            tempImg.src = imageUrl;
        } else {
            // 主图区域没有图片或图片未完成 → 直接显示在主图区域
            generationStore.setCurrentImageUrl(imageUrl);
        }
    }

    // 断开所有连接
    function disconnect() {
        statusWs?.disconnect();
        statusWs = null;
        dashboardWs?.disconnect();
        dashboardWs = null;
        isStatusConnected.value = false;
        isDashboardConnected.value = false;
    }

    // 检查状态通道是否可用
    function isStatusWsReady(): boolean {
        return statusWs?.isConnected ?? false;
    }

    // 组件卸载时自动断开
    onUnmounted(() => {
        disconnect();
    });

    return {
        // 连接状态
        isStatusConnected: readonly(isStatusConnected),
        isDashboardConnected: readonly(isDashboardConnected),
        // 数据
        queueData: readonly(queueData),
        progressData: readonly(progressData),
        taskFailedMessage: readonly(taskFailedMessage),
        // 方法
        initStatusWs,
        initDashboardWs,
        disconnect,
        isStatusWsReady,
        // 底层实例（供高级用法）
        statusWs,
        dashboardWs,
    };
}
