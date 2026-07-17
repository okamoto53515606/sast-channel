"""
SASTちゃんねる — メインエントリーポイント

Phase 1: まとめ役クロード — リポジトリ現状サマリー（GitHub MCP のみ）
Phase 2: 直列レビュー    — エンジニア クロード → 税理士 GPT → 子育てママ Gemini
          各キャラ: 独立 git clone → Issue 起票 → 修正ブランチ作成 → PR 作成
Phase 3: まとめ役クロード — PRレビュー・マージ判定 + BBS風レポート生成
"""
import logging
import os
import sys
from datetime import datetime, timezone, timedelta
from urllib.parse import urlparse

from dotenv import load_dotenv
from strands import Agent
from strands.models.anthropic import AnthropicModel
from strands.models.openai import OpenAIModel
from strands.models.gemini import GeminiModel
from strands.models.litellm import LiteLLMModel
from strands.tools.mcp import MCPClient
from mcp.client.streamable_http import streamablehttp_client
from mcp.client.stdio import stdio_client, StdioServerParameters
from strands_tools import shell, editor, file_read, file_write, http_request, current_time

from prompts import (
    CLAUDE_ENGINEER_PROMPT,
    GPT_TAX_ADVISOR_PROMPT,
    GEMINI_MOTHER_PROMPT,
    SUMMARIZER_PHASE1_PROMPT,
    SUMMARIZER_PHASE3_PROMPT,
)

# ─────────────────────────────────────────────
# ログ設定
# ─────────────────────────────────────────────
logging.basicConfig(
    format="%(levelname)s | %(name)s | %(message)s",
    handlers=[logging.StreamHandler()],
)
logger = logging.getLogger(__name__)

JST = timezone(timedelta(hours=9))


def log(msg: str) -> None:
    print(msg, flush=True)


# ─────────────────────────────────────────────
# 環境変数ヘルパー
# ─────────────────────────────────────────────
def get_env(key: str, default: str = "") -> str:
    return os.environ.get(key, default)


# ─────────────────────────────────────────────
# モデル生成
# ─────────────────────────────────────────────
def create_claude_model() -> AnthropicModel:
    return AnthropicModel(
        client_args={"api_key": get_env("CLAUDE_API_KEY")},
        model_id=get_env("CLAUDE_MODEL_ID", "claude-sonnet-5"),
        max_tokens=16384,
    )


def create_openai_model() -> OpenAIModel:
    return OpenAIModel(
        client_args={"api_key": get_env("OPENAI_API_KEY")},
        model_id=get_env("OPEN_AI_MODEL_ID", "gpt-5.6-terra"),
    )


def create_gemini_model() -> GeminiModel:
    return GeminiModel(
        client_args={"api_key": get_env("GEMINI_API_KEY")},
        model_id=get_env("GEMINI_MODEL_ID", "gemini-3.5-flash"),
    )


def is_savings_mode() -> bool:
    """DEEPSEEK_API_KEY と DEEPSEEK_MODEL_ID が両方とも有効な値の場合、節約モードと判定する。"""
    key = get_env("DEEPSEEK_API_KEY")
    model = get_env("DEEPSEEK_MODEL_ID")
    return bool(key) and bool(model)


def create_deepseek_model() -> LiteLLMModel:
    """DeepSeek V4 Pro モデルを LiteLLM 経由で生成。
    APIキーは環境変数 DEEPSEEK_API_KEY を LiteLLM が自動読み取りするため、
    コンストラクタには渡さない（api_key は strands の LiteLLMModel では無効なパラメータ）。
    モデルIDには LiteLLM 用のプロバイダープレフィックス "deepseek/" を付与する。
    """
    model_id = get_env("DEEPSEEK_MODEL_ID")
    # LiteLLM はプロバイダー識別のため "deepseek/" プレフィックスが必要
    if not model_id.startswith("deepseek/"):
        model_id = f"deepseek/{model_id}"
    return LiteLLMModel(
        model_id=model_id,
        params={"max_tokens": 4096},
    )


# ─────────────────────────────────────────────
# MCP クライアント生成
# ─────────────────────────────────────────────
def create_github_mcp() -> MCPClient:
    """GitHub MCP（Streamable HTTP）"""
    pat = get_env("GITHUB_PAT")
    return MCPClient(
        lambda: streamablehttp_client(
            url="https://api.githubcopilot.com/mcp/",
            headers={"Authorization": f"Bearer {pat}"},
        )
    )


def create_brave_mcp() -> MCPClient:
    """Brave Search MCP（stdio / npx）"""
    return MCPClient(lambda: stdio_client(
        StdioServerParameters(
            command="npx",
            args=["-y", "@brave/brave-search-mcp-server"],
            env={"BRAVE_API_KEY": get_env("BRAVE_API_KEY")},
        )
    ))


# ─────────────────────────────────────────────
# リポジトリ情報の解析
# ─────────────────────────────────────────────
def parse_repo_url(repo_url: str) -> tuple[str, str]:
    """https://github.com/owner/repo → (owner, repo)"""
    parsed = urlparse(repo_url.rstrip("/"))
    parts = parsed.path.strip("/").split("/")
    if len(parts) < 2:
        raise ValueError(f"Invalid GitHub URL: {repo_url}")
    owner = parts[0]
    repo = parts[1].removesuffix(".git")
    return owner, repo


# ─────────────────────────────────────────────
# プロンプト生成（変数を埋め込む）
# ─────────────────────────────────────────────
def build_phase1_prompt(
    repo_url: str,
    review_branch: str,
    author_nickname: str,
    author_intro: str,
) -> str:
    base = SUMMARIZER_PHASE1_PROMPT.replace("{review_branch}", review_branch)
    return (
        f"{base}\n\n"
        f"## 対象リポジトリ情報\n"
        f"- リポジトリURL: {repo_url}\n"
        f"- レビューブランチ: {review_branch}\n"
        f"- 作者ニックネーム: {author_nickname}\n"
        f"- 作者自己紹介: {author_intro}\n\n"
        f"では、上記手順に従ってPhase 1 引き継ぎサマリーを作成してください。"
    )


def build_character_prompt(
    template: str,
    repo_url: str,
    review_branch: str,
    author_nickname: str,
    author_intro: str,
    github_pat: str,
    date_str: str,
) -> str:
    owner, repo = parse_repo_url(repo_url)
    return (
        template
        .replace("{review_branch}", review_branch)
        .replace("{repo_url}", repo_url)
        .replace("{github_pat}", github_pat)
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


def build_phase3_prompt(
    summarizer_prompt: str,
    phase1_summary: str,
    repo_url: str,
    review_branch: str,
    author_nickname: str,
    author_intro: str,
    datetime_str: str,
) -> str:
    base = (
        summarizer_prompt
        .replace("{review_branch}", review_branch)
        .replace("{repo_url}", repo_url)
        .replace("{author_nickname}", author_nickname)
        .replace("{author_intro}", author_intro)
        .replace("{datetime}", datetime_str)
    )
    return (
        f"{base}\n\n"
        f"## Phase 1 引き継ぎサマリー（参考情報）\n{phase1_summary}\n\n"
        f"## タスク情報\n"
        f"- リポジトリURL: {repo_url}\n"
        f"- レビューブランチ: {review_branch}\n"
        f"- 作者ニックネーム: {author_nickname}\n"
        f"- 作者自己紹介: {author_intro}\n"
        f"- 日時: {datetime_str}\n\n"
        f"では、上記手順に従ってPRレビュー・マージ判定・レポート生成を実施してください。"
    )


# ─────────────────────────────────────────────
# Phase 1: まとめ役クロード — コンテキスト収集
# ─────────────────────────────────────────────
def run_phase1(
    repo_url: str,
    review_branch: str,
    author_nickname: str,
    author_intro: str,
) -> str:
    log("━" * 50)
    log("【Phase 1】 準備とコンテキストの最新化")
    log("━" * 50)
    log("[まとめ役クロード] リポジトリ現状を確認中...")

    github_mcp = create_github_mcp()

    summarizer = Agent(
        name="claude_summarizer_phase1",
        model=create_claude_model(),
        system_prompt="あなたはSASTちゃんねるのまとめ役クロードです。指示に従ってリポジトリの現状をサマリーしてください。",
        tools=[github_mcp, http_request, current_time],
    )

    prompt = build_phase1_prompt(repo_url, review_branch, author_nickname, author_intro)
    result = summarizer(prompt)
    summary = str(result)

    log("[まとめ役クロード] Phase 2 引き継ぎ情報を作成完了")
    log("")
    return summary


# ─────────────────────────────────────────────
# Phase 2: 各キャラクターのレビュー（直列）
# ─────────────────────────────────────────────
def run_character_review(
    name: str,
    model,
    prompt_template: str,
    repo_url: str,
    review_branch: str,
    author_nickname: str,
    author_intro: str,
    github_pat: str,
    date_str: str,
    extra_tools: list | None = None,
    limits: dict | None = None,
) -> None:
    log(f"[{name}] レビュー開始...")

    github_mcp = create_github_mcp()
    brave_mcp = create_brave_mcp()

    base_tools = [github_mcp, brave_mcp, http_request, current_time]
    tools = base_tools + (extra_tools or [])

    agent = Agent(
        name=name.replace(" ", "_").lower(),
        model=model,
        system_prompt=f"あなたは{name}です。指示に従ってレビュー・Issue起票・修正ブランチ作成・PR作成を実施してください。",
        tools=tools,
    )

    prompt = build_character_prompt(
        prompt_template,
        repo_url,
        review_branch,
        author_nickname,
        author_intro,
        github_pat,
        date_str,
    )

    result = agent(prompt, limits=limits) if limits else agent(prompt)
    log(f"[{name}] 完了")
    log(str(result)[:500] + "..." if len(str(result)) > 500 else str(result))
    log("")


def run_phase2(
    repo_url: str,
    review_branch: str,
    author_nickname: str,
    author_intro: str,
    github_pat: str,
    date_str: str,
) -> None:
    log("━" * 50)
    log("【Phase 2】 個別レビューとパッチ作成（直列）")
    log("━" * 50)

    _savings = is_savings_mode()
    if _savings:
        log("💰 節約モード: エンジニア クロード → DeepSeek V4 Pro に切り替え")

    characters = [
        # shell/editor 系を渡す（Anthropic/OpenAI は対応済み）
        ("エンジニア クロード",
         create_deepseek_model() if _savings else create_claude_model(),
         CLAUDE_ENGINEER_PROMPT,
         [shell, editor, file_read, file_write]),
        ("税理士 GPT",          create_openai_model(),  GPT_TAX_ADVISOR_PROMPT,
         [shell, editor, file_read, file_write]),
        # Gemini は Function Calling のスキーマ制約により shell/editor 非対応
        # → GitHub MCP 経由のみでレビュー（Issue 起票 + PR コメントのみ）
        ("子育てママ Gemini",   create_gemini_model(),  GEMINI_MOTHER_PROMPT,
         []),
    ]

    for name, model, template, extra_tools in characters:
        # Gemini は無限ループ防止のため turns 上限を設定
        limits = {"turns": 20} if "Gemini" in name else None
        run_character_review(
            name=name,
            model=model,
            prompt_template=template,
            repo_url=repo_url,
            review_branch=review_branch,
            author_nickname=author_nickname,
            author_intro=author_intro,
            github_pat=github_pat,
            date_str=date_str,
            extra_tools=extra_tools,
            limits=limits,
        )


# ─────────────────────────────────────────────
# Phase 3: まとめ役クロード — PRレビュー＆レポート
# ─────────────────────────────────────────────
def run_phase3(
    phase1_summary: str,
    repo_url: str,
    review_branch: str,
    author_nickname: str,
    author_intro: str,
    datetime_str: str,
) -> None:
    log("━" * 50)
    log("【Phase 3】 総括評価とレポート生成")
    log("━" * 50)
    log("[まとめ役クロード] PRレビュー・マージ判定・レポート生成中...")

    github_mcp = create_github_mcp()

    summarizer = Agent(
        name="claude_summarizer_phase3",
        model=create_claude_model(),
        system_prompt="あなたはSASTちゃんねるのまとめ役クロードです。指示に従ってPRレビュー・マージ判定・レポート生成を実施してください。",
        tools=[github_mcp, http_request, current_time],
    )

    prompt = build_phase3_prompt(
        SUMMARIZER_PHASE3_PROMPT,
        phase1_summary,
        repo_url,
        review_branch,
        author_nickname,
        author_intro,
        datetime_str,
    )

    result = summarizer(prompt)
    log("[まとめ役クロード] レポート生成完了")
    log(str(result)[:500] + "..." if len(str(result)) > 500 else str(result))
    log("")


# ─────────────────────────────────────────────
# メインエントリーポイント
# ─────────────────────────────────────────────
def main() -> None:
    load_dotenv()

    repo_url      = get_env("REPO_URL", "https://github.com/example/repo")
    review_branch = get_env("REVIEW_BRANCH", "sast-channel")
    nickname      = get_env("AUTHOR_NICKNAME", "作者")
    author_intro  = get_env("AUTHOR_INTRO", "(未設定)")
    github_pat    = get_env("GITHUB_PAT")

    now = datetime.now(JST)
    date_str     = now.strftime("%Y-%m-%d")
    datetime_str = now.strftime("%Y-%m-%d_%H-%M")

    log("=" * 60)
    log("SASTちゃんねる タスク起動")
    log("=" * 60)
    log(f"対象リポジトリ : {repo_url}")
    log(f"レビューブランチ: {review_branch}")
    log(f"作者ニックネーム: {nickname}")
    log(f"作者情報       : {author_intro}")
    if is_savings_mode():
        log("節約モード       : 💰 ON（エンジニアのみ DeepSeek V4 Pro）")
    else:
        log("節約モード       : OFF（全キャラ通常モデル）")
    log("")

    if not github_pat:
        log("ERROR: GITHUB_PAT が設定されていません")
        sys.exit(1)

    # Phase 1
    phase1_summary = run_phase1(repo_url, review_branch, nickname, author_intro)

    # Phase 2
    run_phase2(repo_url, review_branch, nickname, author_intro, github_pat, date_str)

    # Phase 3
    run_phase3(phase1_summary, repo_url, review_branch, nickname, author_intro, datetime_str)

    log("=" * 60)
    log("SASTちゃんねる タスク完了")
    log("=" * 60)


if __name__ == "__main__":
    main()
