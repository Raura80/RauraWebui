// ComfyUI 格式标准化清洗 - 原样迁移
export function finalizePromptForComfyUI(prompt: string, keepChinese = false): string {
    if (!prompt || typeof prompt !== 'string') return '';
    let result = prompt;
    result = result.replace(/，/g, ',').replace(/。/g, '.');
    result = result.replace(/（/g, '(').replace(/）/g, ')');
    result = result.replace(/【/g, '[').replace(/】/g, ']');
    result = result.replace(/《/g, '<').replace(/》/g, '>');
    result = result.replace(/[\n\r]+/g, ',');
    result = result.replace(/[\t\v\f]+/g, ' ');
    result = result.replace(/_/g, ' ');
    if (!keepChinese) {
        result = result.replace(/[^a-zA-Z0-9,\.:;?!'"\(\)\[\]\{\}<>\-+=%\$#@\|\/\\&^\s~`]/g, '');
    }
    // 保留最后一次出现的标签（而非第一次），更符合用户预期
    const unique = [...new Set(result.split(',').reverse())].reverse();
    return unique.join(',');
}
