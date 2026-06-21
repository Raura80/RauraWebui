import CryptoJS from 'crypto-js';

// AES 解密逻辑 - 核心资产，密钥构造原样保留
export function decryptTagData(bufferData: string): any | null {
    if (!bufferData) return null;
    const p1 = String.fromCharCode(99, 111, 110, 102, 105, 103);
    const p2 = (typeof window !== "undefined" && window.document) ? "==" : "=";
    const p3 = ['t', 'r', 'u', 'e', 'f', 'a', 'l', 's', 'e'].slice(4).join('');
    const _kConfig = p1 + p2 + p3;
    try {
        const decryptedBytes = CryptoJS.AES.decrypt(bufferData, _kConfig);
        const originalText = decryptedBytes.toString(CryptoJS.enc.Utf8);
        if (!originalText) return null;
        return JSON.parse(originalText);
    } catch (e) {
        console.error("Metrics validation failed.");
        return null;
    }
}
