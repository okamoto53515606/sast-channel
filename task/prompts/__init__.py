# prompts/__init__.py

from .claude_engineer import CLAUDE_ENGINEER_PROMPT
from .gpt_tax_advisor import GPT_TAX_ADVISOR_PROMPT
from .gemini_mother import GEMINI_MOTHER_PROMPT
from .summarizer import SUMMARIZER_PHASE1_PROMPT, SUMMARIZER_PHASE3_PROMPT

__all__ = [
    "CLAUDE_ENGINEER_PROMPT",
    "GPT_TAX_ADVISOR_PROMPT",
    "GEMINI_MOTHER_PROMPT",
    "SUMMARIZER_PHASE1_PROMPT",
    "SUMMARIZER_PHASE3_PROMPT",
]
