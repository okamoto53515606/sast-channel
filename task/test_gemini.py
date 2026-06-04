"""
Gemini + GitHub MCP + Brave MCP の単体テスト
Usage: cd task && uv run --with python-dotenv --with "strands-agents[gemini]" --with strands-agents-tools python3 test_gemini.py
"""
import os
import sys
from dotenv import load_dotenv
load_dotenv(dotenv_path="../.env")

from strands import Agent
from strands.models.gemini import GeminiModel
from strands.tools.mcp import MCPClient
from mcp.client.streamable_http import streamablehttp_client
from mcp.client.stdio import stdio_client, StdioServerParameters
from strands_tools import http_request, current_time

def main():
    print("=== Gemini 単体テスト ===")
    print(f"GEMINI_API_KEY: {'set' if os.environ.get('GEMINI_API_KEY') else 'MISSING'}")
    print(f"BRAVE_API_KEY:  {'set' if os.environ.get('BRAVE_API_KEY') else 'MISSING'}")
    print(f"GEMINI_MODEL_ID: {os.environ.get('GEMINI_MODEL_ID', 'gemini-3.1-pro-preview')}")
    print()

    model = GeminiModel(
        client_args={"api_key": os.environ.get("GEMINI_API_KEY")},
        model_id=os.environ.get("GEMINI_MODEL_ID", "gemini-3.1-pro-preview"),
    )

    pat = os.environ.get("GITHUB_PAT")
    github_mcp = MCPClient(
        lambda: streamablehttp_client(
            url="https://api.githubcopilot.com/mcp/",
            headers={"Authorization": f"Bearer {pat}"},
        )
    )

    brave_mcp = MCPClient(lambda: stdio_client(
        StdioServerParameters(
            command="npx",
            args=["-y", "@brave/brave-search-mcp-server"],
            env={"BRAVE_API_KEY": os.environ.get("BRAVE_API_KEY")},
        )
    ))

    # テスト1: ツールなし（モデル単体の疎通）
    print("--- テスト1: ツールなし（モデル疎通確認）---")
    agent_bare = Agent(
        name="gemini_test_bare",
        model=model,
        system_prompt="You are a helpful assistant.",
        tools=[],
    )
    result = agent_bare("日本語で「テスト成功」と一言だけ返してください。")
    print(f"結果: {result}")
    print()

    # テスト2: Brave Search のみ
    print("--- テスト2: Brave Search のみ ---")
    agent_brave = Agent(
        name="gemini_test_brave",
        model=model,
        system_prompt="You are a helpful assistant.",
        tools=[brave_mcp, current_time],
    )
    result = agent_brave("Brave Searchで『gemini-3.1-pro-preview』を検索して、モデルが存在するか確認してください。")
    print(f"結果: {str(result)[:300]}")
    print()

    # テスト3: GitHub MCP のみ
    print("--- テスト3: GitHub MCP のみ ---")
    agent_github = Agent(
        name="gemini_test_github",
        model=model,
        system_prompt="You are a helpful assistant.",
        tools=[github_mcp, http_request, current_time],
    )
    result = agent_github("GitHub MCPを使って、okamoto53515606/firebase-studio-sample1 リポジトリのREADMEを取得してください。")
    print(f"結果: {str(result)[:300]}")
    print()

    # テスト4: 子育てママ Gemini 実タスク
    print("--- テスト4: 子育てママ Gemini 実タスク ---")
    print("リポジトリ: okamoto53515606/firebase-studio-sample1 / ブランチ: sast-channel")
    from prompts.gemini_mother import GEMINI_MOTHER_PROMPT
    from datetime import datetime, timezone, timedelta

    JST = timezone(timedelta(hours=9))
    date_str = datetime.now(JST).strftime("%Y%m%d")
    author_nickname = "okamo"
    author_intro = "個人開発者"
    repo_url = "https://github.com/okamoto53515606/firebase-studio-sample1"
    review_branch = "sast-channel"
    owner = "okamoto53515606"
    repo = "firebase-studio-sample1"

    prompt = (
        GEMINI_MOTHER_PROMPT
        .replace("{review_branch}", review_branch)
        .replace("{repo_url}", repo_url)
        .replace("{owner}", owner)
        .replace("{repo}", repo)
        .replace("{date}", date_str)
        .replace("NICKNAME", author_nickname)
        + f"\n\n## タスク情報\n"
        f"- リポジトリURL: {repo_url}\n"
        f"- レビューブランチ: {review_branch}\n"
        f"- 作者ニックネーム: {author_nickname}\n"
        f"- 作者自己紹介: {author_intro}\n\n"
        f"では、上記手順に従ってレビュー・Issue起票・PR作成を実施してください。"
    )

    github_mcp4 = MCPClient(
        lambda: streamablehttp_client(
            url="https://api.githubcopilot.com/mcp/",
            headers={"Authorization": f"Bearer {pat}"},
        )
    )
    brave_mcp4 = MCPClient(lambda: stdio_client(
        StdioServerParameters(
            command="npx",
            args=["-y", "@brave/brave-search-mcp-server"],
            env={"BRAVE_API_KEY": os.environ.get("BRAVE_API_KEY")},
        )
    ))

    agent_full = Agent(
        name="子育てママ_gemini_full",
        model=model,
        system_prompt="あなたは子育てママ Geminiです。指示に従ってレビュー・Issue起票・PR作成を実施してください。",
        tools=[github_mcp4, brave_mcp4, http_request, current_time],
    )
    result = agent_full(prompt, limits={"turns": 20})
    print(f"結果: {str(result)[:500]}")
    print()

    print("=== テスト完了 ===")

if __name__ == "__main__":
    main()
