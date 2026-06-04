"""
Gemini + GitHub MCP + Brave MCP の単体テスト
Usage: cd task && python test_gemini.py
"""
import os
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

    print("=== テスト完了 ===")

if __name__ == "__main__":
    main()
