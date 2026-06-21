import FingerprintJS from '@fingerprintjs/fingerprintjs';
import { useUserStore } from '../stores/user';
import { initAuth } from '../services/api';

// 客户端身份标识组合式函数
// 使用 FingerprintJS 生成浏览器指纹，配合服务端 Cookie 令牌鉴权
export function useClientIdentity() {
    const userStore = useUserStore();

    // 初始化 clientId：始终通过服务端获取，确保前后端一致
    async function initClientId(): Promise<string> {
        // 1. 获取浏览器指纹
        const fingerprint = await getFingerprint();

        // 缓存 fingerprint 到 sessionStorage，供后续请求头使用
        // （无痕模式下 Cookie 不可用，需要通过请求头传递 fingerprint 来补全用户信息）
        sessionStorage.setItem('fp', fingerprint);

        // 2. 调用服务端 init 接口，仅传入 fingerprint
        //    服务端通过 fingerprint 查找已有用户或创建新用户，不再接受客户端提供的 client_id
        const data = await initAuth(fingerprint);

        // 4. 用服务端返回的 client_id 初始化（确保前后端一致）
        userStore.initClientId(data.client_id);
        return data.client_id;
    }

    // 获取 FingerprintJS 浏览器指纹（同浏览器稳定不变）
    async function getFingerprint(): Promise<string> {
        const fp = await FingerprintJS.load();
        const result = await fp.get();
        return result.visitorId;
    }

    return { initClientId };
}
