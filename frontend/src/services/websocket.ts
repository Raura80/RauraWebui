import type { WSMessage } from '../types';

type MessageHandler = (data: WSMessage) => void;
type BinaryHandler = (buffer: ArrayBuffer) => void;
type OpenHandler = () => void;
type CloseHandler = () => void;
type ErrorHandler = (error: Event) => void;

export class WebSocketManager {
  private ws: WebSocket | null = null;
  private url: string;
  private binaryType: 'arraybuffer' | 'blob' = 'arraybuffer';
  private messageHandlers: MessageHandler[] = [];
  private binaryHandlers: BinaryHandler[] = [];
  private openHandlers: OpenHandler[] = [];
  private closeHandlers: CloseHandler[] = [];
  private errorHandlers: ErrorHandler[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectDelay: number;
  private initialReconnectDelay: number;
  private maxReconnectDelay: number;
  private shouldReconnect: boolean = true;

  constructor(url: string, options?: { binaryType?: 'arraybuffer' | 'blob'; reconnectDelay?: number; maxReconnectDelay?: number }) {
    this.url = url;
    this.binaryType = options?.binaryType || 'arraybuffer';
    this.initialReconnectDelay = options?.reconnectDelay || 5000;
    this.reconnectDelay = this.initialReconnectDelay;
    this.maxReconnectDelay = options?.maxReconnectDelay || 30000;
  }

  connect(): void {
    // 如果已有连接处于 OPEN 或 CONNECTING 状态，跳过
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    // 显式关闭旧连接（防止 CLOSING 状态下创建重复连接）
    if (this.ws) {
      this.ws.onclose = null; // 阻止旧连接的 onclose 触发重连
      this.ws.close();
      this.ws = null;
    }

    this.ws = new WebSocket(this.url);
    this.ws.binaryType = this.binaryType;

    this.ws.onopen = () => {
      this.reconnectDelay = this.initialReconnectDelay; // 重置为初始重连延迟
      this.openHandlers.forEach(handler => handler());
    };

    this.ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        this.binaryHandlers.forEach(handler => handler(event.data));
      } else {
        try {
          const data = JSON.parse(event.data) as WSMessage;
          this.messageHandlers.forEach(handler => handler(data));
        } catch (e) {
          // 忽略非 JSON 消息（如 pong）
        }
      }
    };

    this.ws.onerror = (error) => {
      this.errorHandlers.forEach(handler => handler(error));
    };

    this.ws.onclose = () => {
      this.closeHandlers.forEach(handler => handler());
      if (this.shouldReconnect) {
        this.scheduleReconnect();
      }
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.connect();
      // 指数退避
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
    }, this.reconnectDelay);
  }

  // 发送心跳
  startHeartbeat(interval: number = 30000): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send('ping');
      }
    }, interval);
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // 注册消息处理器
  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.push(handler);
    return () => {
      const index = this.messageHandlers.indexOf(handler);
      if (index > -1) this.messageHandlers.splice(index, 1);
    };
  }

  // 注册二进制帧处理器
  onBinary(handler: BinaryHandler): () => void {
    this.binaryHandlers.push(handler);
    return () => {
      const index = this.binaryHandlers.indexOf(handler);
      if (index > -1) this.binaryHandlers.splice(index, 1);
    };
  }

  // 注册连接打开回调
  onOpen(handler: OpenHandler): () => void {
    this.openHandlers.push(handler);
    return () => {
      const index = this.openHandlers.indexOf(handler);
      if (index > -1) this.openHandlers.splice(index, 1);
    };
  }

  // 注册连接关闭回调
  onClose(handler: CloseHandler): () => void {
    this.closeHandlers.push(handler);
    return () => {
      const index = this.closeHandlers.indexOf(handler);
      if (index > -1) this.closeHandlers.splice(index, 1);
    };
  }

  // 注册错误回调
  onError(handler: ErrorHandler): () => void {
    this.errorHandlers.push(handler);
    return () => {
      const index = this.errorHandlers.indexOf(handler);
      if (index > -1) this.errorHandlers.splice(index, 1);
    };
  }

  // 发送消息
  send(data: string | ArrayBuffer): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  // 获取连接状态
  get readyState(): number {
    return this.ws?.readyState ?? WebSocket.CLOSED;
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  // 断开连接
  disconnect(): void {
    this.shouldReconnect = false;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null; // 防止触发重连
      this.ws.close();
      this.ws = null;
    }
  }
}

// 创建 ComfyUI 状态通道 WebSocket
export function createStatusWebSocket(clientId: string): WebSocketManager {
  const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
  const url = `${protocol}${window.location.host}/ws?clientId=${encodeURIComponent(clientId)}`;
  const manager = new WebSocketManager(url, { binaryType: 'arraybuffer' });
  return manager;
}

// 创建仪表盘 WebSocket
export function createDashboardWebSocket(): WebSocketManager {
  const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
  const url = `${protocol}${window.location.host}/api/ws/status`;
  const manager = new WebSocketManager(url);
  manager.startHeartbeat(30000);
  return manager;
}
