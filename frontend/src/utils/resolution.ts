import type { Resolution } from '../types';

// 基准像素数 - 内部使用
const PIXELS = 1024 * 1280;

// 分辨率计算算法 - 核心资产，原样迁移
export function calculateSmoothResolution(sliderValue: number): Resolution {
    const TOTAL_PIXELS = PIXELS;
    const MIN_RATIO = 0.5, MAX_RATIO = 2.0, ALIGNMENT = 32;
    const minLog = Math.log(MIN_RATIO), maxLog = Math.log(MAX_RATIO);
    const t = sliderValue / 200;
    const currentLog = minLog + (maxLog - minLog) * t;
    const targetRatio = Math.exp(currentLog);
    let rawWidth = Math.sqrt(TOTAL_PIXELS * targetRatio);
    let rawHeight = Math.sqrt(TOTAL_PIXELS / targetRatio);
    let width = Math.round(rawWidth / ALIGNMENT) * ALIGNMENT;
    let height = Math.round(rawHeight / ALIGNMENT) * ALIGNMENT;
    const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
    const commonDivisor = gcd(width, height);
    const wRatio = width / commonDivisor, hRatio = height / commonDivisor;
    let ratioText = wRatio > 20 || hRatio > 20 ? `${(width / height).toFixed(2)}:1` : `${wRatio}:${hRatio}`;
    return { width, height, ratioText };
}

// 更新预览框尺寸
export function updatePreviewBox(previewBox: HTMLElement, width: number, height: number): void {
    const maxSize = 240;
    const targetArea = 150 * 150;
    const currentArea = width * height;
    const scaleFactor = Math.sqrt(targetArea / currentArea);
    let previewWidth = width * scaleFactor, previewHeight = height * scaleFactor;
    if (previewWidth > maxSize) { const reduce = maxSize / previewWidth; previewWidth *= reduce; previewHeight *= reduce; }
    if (previewHeight > maxSize) { const reduce = maxSize / previewHeight; previewWidth *= reduce; previewHeight *= reduce; }
    previewBox.style.width = Math.round(previewWidth) + 'px';
    previewBox.style.height = Math.round(previewHeight) + 'px';
}

// 从目标分辨率反推滑块值（用于预设/历史恢复）
// 遍历所有滑块值找到精确匹配，因为分辨率就是从滑块生成的，一定能找到
export function calculateSliderValueFromResolution(width: number, height: number): number {
    for (let v = 0; v <= 200; v++) {
        const res = calculateSmoothResolution(v);
        if (res.width === width && res.height === height) {
            return v;
        }
    }
    // 找不到精确匹配时，回退到比例反推
    const MIN_RATIO = 0.5, MAX_RATIO = 2.0;
    const minLog = Math.log(MIN_RATIO), maxLog = Math.log(MAX_RATIO);
    const ratio = width / height;
    const currentLog = Math.log(ratio);
    const t = (currentLog - minLog) / (maxLog - minLog);
    return Math.round(t * 200);
}
