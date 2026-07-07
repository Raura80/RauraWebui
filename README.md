# Raura WebUI

基于 ComfyUI 的 AI 动漫图像生成 Web 应用，提供从标签辅助、模型配置到一键出图的完整创作体验。

---
### 体验地址 https://raura.top/

## 页面预览

<img width="1306" height="894" alt="image" src="https://github.com/user-attachments/assets/fd88d262-6860-4fd7-b8af-9b6a51e9cb04" />

<img width="1678" height="1177" alt="image" src="https://github.com/user-attachments/assets/4a724937-8b3a-42da-8822-71eb9e302a42" />



## 功能亮点

### 智能标签系统

- **Danbooru 词库**：内置数万条标签数据，支持中英文、拼音模糊搜索
- **实时联想**：输入时弹出候选标签列表，支持键盘导航和快速选择
- **画师搜索**：独立的画师数据库，支持别名匹配，选中后自动注入提示词
- **关联词推荐**：基于共现分析推荐与当前标签高度相关的组合标签
- **使用频率排序**：记录用户历史使用频率，常用标签优先展示

### 模型与 LoRA 管理

- **多风格模型**：按动漫 / 写实等风格分类管理 Checkpoint，一键切换
- **LoRA 配置**：支持多 LoRA 叠加，各自独立的权重滑块，自动注入/移除触发词
- **参数联动**：切换模型时自动加载该模型推荐的采样器、调度器、CFG 等参数

### 一键预设

- **完整快照**：预设保存提示词、模型、LoRA、分辨率、所有高级参数，一键还原完整创作状态
- **公共预设**：管理员可发布公共预设供所有用户使用

### 实时生成体验

- **WebSocket 双通道**：状态通道监听 ComfyUI 队列与进度，消息通道接收任务生命周期事件
- **实时进度**：生成过程中显示精确的采样进度百分比与队列排名
- **任务取消**：支持取消排队中或正在执行的任务
- **快捷键**：`Ctrl+Enter` 快速生成、`←/→` 浏览历史、`Shift+Space` 全屏查看

### 额度与兑换系统

- **客户端身份**：基于浏览器指纹自动生成匿名客户端 ID，无需注册
- **额度管理**：每次生成消耗额度，不同模型可配置不同消耗权重
- **兑换码**：支持兑换码充值额度，含每日赠礼机制

### 管理仪表盘

- **事件驱动推送**：基于 WebSocket 的增量推送架构，状态变化即时同步，告别轮询
- **单文件部署**：仪表盘为独立 HTML 文件，API Key 鉴权保护管理接口

### 界面设计

- **Glassmorphism 风格**：模块卡片 + 光影背景，视觉层次分明
- **明暗主题**：支持亮色 / 暗色一键切换，偏好持久化
- **全响应式**：桌面端双栏工作区，移动端自适应紧凑布局
- **Hero 着陆页**：展示全屏引导页

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Vue 3 + TypeScript + Pinia + Vite |
| 后端 | Python FastAPI + aiohttp + SQLite |
| 生图引擎 | ComfyUI |
| 通信 | WebSocket（双通道：状态 + 消息） |
| 包管理 | 前端 npm，后端 uv |

---

## 快速开始

### 环境要求

- **Node.js** >= 18
- **Python** >= 3.12
- **ComfyUI**


### 前端启动

```bash
cd frontend
npm install
# 启动开发环境
npm run dev
# 编译
npm run build
```

## 后端启动

```bash
uv sync
uv run main.py
```


## 环境变量

参考 `backend/.env.example`：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `COMFYUI_URL` | ComfyUI 服务地址 | `http://127.0.0.1:8188` |
| `SERVER_PORT` | 后端服务端口 | `9988` |
| `SERVER_HOST` | 监听地址 | `127.0.0.1` |
| `CORS_ORIGINS` | 允许的跨域来源 | 空 |
| `ADMIN_API_KEY` | 管理接口密钥 | - |
| `FRONTEND_DIR` | 前端构建产物路径 | `../frontend/dist` |

---

## 运行
进入前端页面
http://127.0.0.1:9988
进入监控页面
http://127.0.0.1:9988/dashboard?api_key=your_api_key


