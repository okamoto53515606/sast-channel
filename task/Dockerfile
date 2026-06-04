FROM python:3.12-slim

# git（ローカルpush用）+ Node.js（npx で Brave MCP を起動）
RUN apt-get update && apt-get install -y --no-install-recommends \
        git \
        curl \
        ca-certificates \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Fargate などの非インタラクティブ環境で shell/editor/file_* ツールが
# 確認プロンプトなしに動作するよう BYPASS_TOOL_CONSENT を設定する
ENV BYPASS_TOOL_CONSENT=true

# Python 依存ライブラリをインストール
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# アプリケーションコードをコピー
COPY main.py .
COPY prompts/ prompts/

CMD ["python", "main.py"]
