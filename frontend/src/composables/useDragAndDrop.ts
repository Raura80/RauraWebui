import { useGenerationStore } from '../stores/generation';
import { uploadImage } from '../services/api';

/**
 * 图片拖拽与图生图 composable
 * 处理图片拖放、img2img 侧边栏显示/隐藏、图片上传等逻辑
 */
export function useDragAndDrop() {
    const generationStore = useGenerationStore();

    /**
     * 阻止浏览器默认的拖放行为（如打开文件）
     */
    function preventDefaults(e: Event): void {
        e.preventDefault();
        e.stopPropagation();
    }

    /**
     * 处理拖放文件（当前提示"功能暂不开启"）
     */
    function handleDrop(e: DragEvent): void {
        preventDefaults(e);
        // 当前版本暂不开放拖拽图生图功能
    }

    /**
     * 显示图生图侧边栏 UI
     */
    function showImg2ImgUI(): void {
        const imgDeleteBtn = document.getElementById('imgDeleteBtn');
        if (imgDeleteBtn) imgDeleteBtn.style.display = 'block';

        const sidebar = document.getElementById('img2imgSidebar');
        if (sidebar) {
            sidebar.style.display = 'flex';
            // 延迟添加 show 类以触发过渡动画
            setTimeout(() => sidebar.classList.add('show'), 10);
        }

        // 自动开启 tagger 开关
        const taggerSwitch = document.getElementById('taggerSwitch') as HTMLInputElement | null;
        if (taggerSwitch) {
            taggerSwitch.checked = true;
            taggerSwitch.parentElement?.classList.add('active');
            taggerSwitch.dispatchEvent(new Event('change'));
        }
    }

    /**
     * 清除图生图状态，重置所有相关 UI 和数据
     */
    function clearInputImage(e?: Event): void {
        if (e) e.stopPropagation();

        // 重置 store 中的图生图状态
        generationStore.isImg2ImgMode = false;
        generationStore.currentInputImageFile = null;
        generationStore.currentInputImageName = null;
        generationStore.lastUploadedFile = null;

        // 重置 denoise 滑块
        const denoiseSlider = document.getElementById('denoiseSlider') as HTMLInputElement | null;
        const denoiseNumber = document.getElementById('denoiseNumber') as HTMLInputElement | null;
        if (denoiseSlider && denoiseNumber) {
            denoiseSlider.value = '1.0';
            denoiseNumber.value = '1.0';
        }

        // 隐藏删除按钮
        const imgDeleteBtn = document.getElementById('imgDeleteBtn');
        if (imgDeleteBtn) imgDeleteBtn.style.display = 'none';

        // 隐藏侧边栏（带过渡动画）
        const sidebar = document.getElementById('img2imgSidebar');
        if (sidebar) {
            sidebar.classList.remove('show');
            setTimeout(() => { sidebar.style.display = 'none'; }, 300);
        }

        // 隐藏源图缩略图
        const sourceThumbContainer = document.getElementById('sourceThumbContainer');
        if (sourceThumbContainer) sourceThumbContainer.classList.remove('show');

        // 重置结果区域
        const resultImage = document.getElementById('resultImage') as HTMLElement | null;
        if (resultImage) {
            resultImage.style.display = 'none';
            resultImage.dataset.isCompleted = 'false';
        }
        const resultPlaceholder = document.getElementById('resultPlaceholder');
        if (resultPlaceholder) resultPlaceholder.style.display = 'block';
        const resultArea = document.getElementById('resultArea');
        if (resultArea) resultArea.classList.remove('has-image');

        // 关闭 tagger 和 pose 开关
        const taggerSwitch = document.getElementById('taggerSwitch') as HTMLInputElement | null;
        if (taggerSwitch) taggerSwitch.checked = false;
        const poseSwitch = document.getElementById('poseSwitch') as HTMLInputElement | null;
        if (poseSwitch) poseSwitch.checked = false;
    }

    /**
     * 上传图片到服务器
     * 如果文件未变化（与上次上传的相同），直接返回缓存的文件名
     * @returns 上传后的服务器文件名，失败返回 null
     */
    async function uploadInputImage(): Promise<string | null> {
        const currentFile = generationStore.currentInputImageFile;
        if (!currentFile) return null;

        // 检查是否与上次上传的文件相同（通过 name/size/lastModified 判断）
        const lastFile = generationStore.lastUploadedFile;
        if (
            lastFile &&
            generationStore.currentInputImageName &&
            currentFile.name === lastFile.name &&
            currentFile.size === lastFile.size &&
            currentFile.lastModified === lastFile.lastModified
        ) {
            return generationStore.currentInputImageName;
        }

        try {
            const data = await uploadImage(currentFile);
            // 缓存已上传的文件信息，避免重复上传
            generationStore.lastUploadedFile = currentFile;
            return data.filename;
        } catch (error) {
            console.error('图片上传错误:', error);
            generationStore.lastUploadedFile = null;
            return null;
        }
    }

    /**
     * 初始化拖放事件，绑定到结果展示区域
     * @param resultAreaEl 结果展示区域的 DOM 元素
     */
    function initDragAndDrop(resultAreaEl: HTMLElement): () => void {
        const cleanupFns: (() => void)[] = [];

        // 绑定拖放相关事件，阻止浏览器默认行为
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            const handler = (e: Event) => preventDefaults(e);
            resultAreaEl.addEventListener(eventName, handler, false);
            cleanupFns.push(() => resultAreaEl.removeEventListener(eventName, handler, false));
        });

        // 处理文件拖放
        const dropHandler = (e: DragEvent) => {
            preventDefaults(e);
            // 当前版本暂不开放拖拽图生图功能
        };
        resultAreaEl.addEventListener('drop', dropHandler, false);
        cleanupFns.push(() => resultAreaEl.removeEventListener('drop', dropHandler, false));

        // 绑定删除按钮
        const imgDeleteBtn = document.getElementById('imgDeleteBtn');
        if (imgDeleteBtn) {
            imgDeleteBtn.addEventListener('click', clearInputImage);
            cleanupFns.push(() => imgDeleteBtn.removeEventListener('click', clearInputImage));
        }

        // 返回清理函数
        return () => cleanupFns.forEach(fn => fn());
    }

    return {
        initDragAndDrop,
        handleDrop,
        showImg2ImgUI,
        clearInputImage,
        uploadInputImage,
    };
}
