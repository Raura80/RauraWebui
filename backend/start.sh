#!/bin/bash
# 云端部署启动脚本
# 使用方法：chmod +x start.sh && ./start.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# 检查 uv 是否安装
if ! command -v uv &> /dev/null; then
    echo "uv 未安装，正在安装..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
fi

# 安装依赖（如果尚未安装）
if [ ! -d ".venv" ]; then
    echo "首次运行，正在安装依赖..."
    uv sync
fi

# 启动后端服务
echo "启动后端服务..."
uv run python main.py
