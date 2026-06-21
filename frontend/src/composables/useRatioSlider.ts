import { ref, readonly } from 'vue';
import { calculateSmoothResolution, updatePreviewBox } from '../utils/resolution';

export function useRatioSlider() {
  // 当前分辨率
  const currentWidth = ref(1024);
  const currentHeight = ref(1280);
  // 当前比例文字
  const ratioText = ref('4:5');

  /**
   * 初始化滑块
   * @param initialValue 滑块初始值（0-200），默认 100
   */
  function initRatioSlider(initialValue: number = 100): void {
    updateState(initialValue);
  }

  /**
   * 根据滑块值更新分辨率状态
   * @param sliderValue 滑块当前值（0-200）
   * @param previewBox 可选的预览框 DOM 元素
   */
  function updateState(sliderValue: number, previewBox?: HTMLElement): void {
    const res = calculateSmoothResolution(sliderValue);
    currentWidth.value = res.width;
    currentHeight.value = res.height;
    ratioText.value = res.ratioText;

    // 如果提供了预览框元素，更新其尺寸
    if (previewBox) {
      updatePreviewBox(previewBox, res.width, res.height);
    }
  }

  /**
   * 获取当前分辨率
   */
  function getCurrentResolution(): { width: number; height: number } {
    return {
      width: currentWidth.value,
      height: currentHeight.value,
    };
  }

  return {
    // 状态
    currentWidth: readonly(currentWidth),
    currentHeight: readonly(currentHeight),
    ratioText: readonly(ratioText),

    // 方法
    initRatioSlider,
    updateState,
    getCurrentResolution,
  };
}
