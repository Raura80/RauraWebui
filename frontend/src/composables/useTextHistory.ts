// 文本历史状态条目
interface HistoryEntry {
    text: string;
    cursorPos: number;
    timestamp: number;
}

// 文本撤销/重做管理器（内部使用）
class TextHistoryManager {
    private history: HistoryEntry[] = [];
    private currentIndex = -1;
    private maxSize: number;

    constructor(maxSize = 100) {
        this.maxSize = maxSize;
    }

    // 推入新的历史状态
    pushState(text: string, cursorPos: number): void {
        // 如果当前不在历史末尾，截断后续记录
        if (this.currentIndex < this.history.length - 1) {
            this.history = this.history.slice(0, this.currentIndex + 1);
        }
        this.history.push({ text, cursorPos, timestamp: Date.now() });
        // 超出最大容量时移除最早的记录
        if (this.history.length > this.maxSize) this.history.shift();
        this.currentIndex = this.history.length - 1;
    }

    // 撤销：回退到上一状态
    undo(): HistoryEntry | null {
        if (this.canUndo()) {
            this.currentIndex--;
            return this.history[this.currentIndex];
        }
        return null;
    }

    // 重做：前进到下一状态
    redo(): HistoryEntry | null {
        if (this.canRedo()) {
            this.currentIndex++;
            return this.history[this.currentIndex];
        }
        return null;
    }

    // 是否可以撤销
    canUndo(): boolean {
        return this.currentIndex > 0;
    }

    // 是否可以重做
    canRedo(): boolean {
        return this.currentIndex < this.history.length - 1;
    }

    // 获取当前状态
    getCurrentState(): HistoryEntry | null {
        return this.history[this.currentIndex] || null;
    }
}

// 组合式函数：创建并返回一个 TextHistoryManager 单例
let sharedInstance: TextHistoryManager | null = null;
export function useTextHistory(maxSize = 100): TextHistoryManager {
    if (!sharedInstance) {
        sharedInstance = new TextHistoryManager(maxSize);
    }
    return sharedInstance;
}
