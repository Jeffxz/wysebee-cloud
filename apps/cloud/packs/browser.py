"""The browser's pack (docs/agent-type-packs.md, step 2): the Wysebee Agent browser extension,
paired as a ``browser`` link held in ``browser_link`` — what Wysebee Assistant's toolbox asks of
it. The tools themselves, their catalog and runner are apps/cloud/agent_chat/browser.py; the
contract is docs/protocol/browser-extension.md.
"""

from typing import Any

from apps.cloud import agent_types
from apps.cloud.agent_chat import browser
from apps.cloud.agent_chat.tools import Output
from apps.cloud.agent_packs import AgentPack, Setting, ToolContext


class BrowserPack(AgentPack):
    key = agent_types.CHROME
    kind = "browser"
    link_field = browser.LINK_FIELD
    tool_prefix = "browser_"
    read_only = browser.READ_ONLY
    # A new agent made by pairing one drives it.
    new_config = {browser.ACCESS_FIELD: True}
    settings = (
        Setting(browser.ACCESS_FIELD, "Browser access"),
        Setting(browser.DEVTOOLS_FIELD, "Web development tools", "devtools"),
    )
    tool_kinds = ("browser", "devtools", "gmail", "calendar", "travel", "news", "website")
    tool_labels = {"gmail": "Open Gmail", "calendar": "Open Calendar", "travel": "Travel", "news": "News", "website": "Website"}
    who = (
        "Only an agent made by pairing the Wysebee Agent browser extension can have {tool}: install the "
        "extension in Chrome or Edge, type a name for the new agent in it, and type the code it shows in "
        "Wysebee, under Devices."
    )

    def link_of(self, config: dict[str, Any]) -> str:
        """The browser the agent drives: none with Browser access off."""
        return browser.link_of(config)

    async def tools(self, ctx: ToolContext) -> list[dict[str, Any]]:
        return browser.tools_for(ctx.config)

    async def run(self, ctx: ToolContext, name: str, arguments: dict[str, Any]) -> Output:
        return await browser.call(ctx.run_op, name, arguments)

    def describe(self, ctx: ToolContext) -> str | None:
        name = ctx.link.browser if ctx.link is not None else None
        if not name and ctx.run_op is None:
            return None
        where = f"browser ({name})" if name else "browser"
        return (
            f"Its browser tools drive the person's own {where}, signed in to their sites, through the Wysebee Agent "
            "extension: that browser has to be open, and the extension may ask the person before acting."
        )

    def offline_reason(self, link: Any, agent: str, connected: bool) -> str | None:
        """Such an agent lives in its browser (2026-11-13, the person's call): online while the
        extension polls and is not paused, offline otherwise."""
        where = link.browser or "its browser"
        if link.paused:
            return f"@{agent} is offline: it lives in {where}, where it was paused in the Wysebee Agent extension. Switch it back on there."
        if not connected:
            return f"@{agent} is offline: it lives in {where}, which is closed or has the Wysebee Agent extension off. Open that browser."
        return None
