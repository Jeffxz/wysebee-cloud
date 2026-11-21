"""The phone's pack (docs/agent-type-packs.md, step 3): Wysebee Agent for Android, paired as an
``android`` link held in ``android_link`` — what Wysebee Assistant's toolbox and the link module
ask of it. The tools themselves are apps/cloud/agent_chat/android.py; the contract is
docs/protocol/android.md.
"""

from typing import Any

from apps.cloud import agent_types, browser_links as links
from apps.cloud.agent_chat import android
from apps.cloud.agent_chat.tools import Output
from apps.cloud.agent_packs import AgentPack, ToolContext


class AndroidPack(AgentPack):
    key = agent_types.ANDROID
    kind = "android"
    link_field = "android_link"
    tool_prefix = "android_"
    read_only = android.READ_ONLY
    # Its tools only while the links table holds the phone as this agent's.
    needs_paired = True
    tool_kinds = ("android",)
    who = (
        "Only an agent made by pairing Wysebee Agent for Android can have {tool}: install Wysebee Agent on the "
        "phone, type a name for the new agent in it, and type the code it shows in Wysebee, under Devices."
    )
    # The link's sentences, said of a phone.
    words = {
        links.UNPAIRED: "This phone is not paired with Wysebee any more.",
        links.OFFLINE: "The phone is not reachable: Wysebee Agent is not running on it, or it is off or offline.",
        links.NOT_REACHED: "The phone could not be reached: it did not take this in time. Is it on and online, with Wysebee Agent's accessibility service on?",
        links.TIMED_OUT: "The phone did not finish this within {seconds:.0f} seconds, so it was stopped.",
        links.NO_ANSWER: "Wysebee Agent for Android refused this, without saying why.",
        links.NOT_AN_OP: "'op' is not one of the phone's operations.",
    }

    async def tools(self, ctx: ToolContext) -> list[dict[str, Any]]:
        return android.tools_for(ctx.config)

    async def run(self, ctx: ToolContext, name: str, arguments: dict[str, Any]) -> Output:
        return await android.call(ctx.run_op, name, arguments)

    def describe(self, ctx: ToolContext) -> str | None:
        if ctx.run_op is None:
            return None
        where = f"phone ({ctx.link.browser})" if ctx.link is not None and ctx.link.browser else "phone"
        return (
            f"Its android_ tools operate the person's {where} through Wysebee Agent for Android, only in the apps the person "
            "allowed there: the phone has to be on and online. An android_snapshot shows the screen as it is now."
        )
