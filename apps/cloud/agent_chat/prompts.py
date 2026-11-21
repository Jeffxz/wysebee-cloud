"""How an agent is named to the person's AI app (apps/cloud/agent_mcp.py). The prompts that
told a model who an agent was went with the cloud's own model (2026-11-14, the person's call:
no chat and no AI model in Wysebee Cloud)."""

WYSEBEE = "wysebee"


def is_browser_agent(config: dict) -> bool:
    """Made by pairing the Wysebee Agent browser extension, and still paired."""
    link = config.get("browser_link")
    return isinstance(link, str) and bool(link.strip())


def label_of(name: str, config: dict) -> str:
    label = config.get("label")
    return label.strip() if isinstance(label, str) and label.strip() else name
