"""The computers' pack (docs/agent-type-packs.md, step 4): Wysebee Agent for Mac, for Windows and
for Linux — one link kind, ``osx``, held in ``mac_link`` — what Wysebee Assistant's toolbox and
the link module ask of it. The contract is docs/protocol/computer.md.

**Its tools** (apps/cloud/agent_chat/): the agent's programs (``local_…``, mac.py), its skills'
scripts (``skill_run_script``) when one of them declares scripts, its folders (``folder_…``),
and what the person gave it of Run any program (``run_program``), Screen control
(``screen_…``; not on Linux), Developer access and the Android toolkit (``dev_…``, ``adb_…``,
pc_dev.py) and, on a Mac, the iPhone toolkit (``xcode_…``, ios_dev.py) — in that computer's
words, only while the links table holds it as this agent's.

**Its poll** carries more than calls: it says which of the agent's programs and skills the
computer has allowed and the folders it offers (kept on the link; the folders written into the
agent's settings as ``mac_folders``, which only the link writes), and is answered the agent's
programs and skills — and woken when they change. It downloads the agent's skills' files with
its own secret.
"""

from typing import Any

from apps.cloud import agent_types, browser_links as links, user_tools
from apps.cloud.agent_chat import ios_dev, mac, pc_dev, tools
from apps.cloud.agent_chat.tools import Output
from apps.cloud.agent_packs import AgentPack, LinkContext, Setting, ToolContext

# Its device's app, by what it is called.
APP = {mac.MAC: "Wysebee Agent for Mac", "Windows PC": "Wysebee Agent for Windows", mac.LINUX: "Wysebee Agent for Linux"}


class ComputerPack(AgentPack):
    key = agent_types.OSX
    also_keys = (agent_types.WINDOWS, agent_types.LINUX)
    kind = links.OSX
    link_field = "mac_link"
    tool_prefix = mac.PREFIX
    more_prefixes = ("folder_", "screen_", "dev_", "adb_", ios_dev.PREFIX)
    tool_names = frozenset({mac.ANY_TOOL, mac.SCRIPT_TOOL})
    read_only = mac.READ_ONLY | pc_dev.READ_ONLY | ios_dev.READ_ONLY
    needs_paired = True
    runs_skill_scripts = True
    wakes_on = frozenset({"agent"})
    serves_skill_files = True
    cloud_only_fields = frozenset({links.FOLDERS_FIELD})
    # Run any program, Screen control, Developer access and the Android toolkit: a Windows PC's
    # agent (2026-11-16, migrations 0069-0071) or a Mac's (2026-11-17, 0072); the iPhone toolkit a
    # Mac's alone; a Linux machine's no screen — offered as each type's row lists them.
    settings = (
        Setting(mac.ANY_FIELD, "Run any program", "any_program"),
        Setting(mac.SCREEN_FIELD, "Screen control", "screen"),
        Setting(pc_dev.DEV_FIELD, "Developer access", "developer"),
        Setting(pc_dev.ANDROID_FIELD, "Android Development Toolkit", "android_toolkit"),
        Setting(ios_dev.IOS_FIELD, "iPhone Development Toolkit", "ios_toolkit"),
    )
    tool_kinds = ("local", "folder", "sqlite", "skill_scripts", "any_program", "screen", "developer", "android_toolkit", "ios_toolkit")
    tool_labels = {"local": "Run local program"}
    who = (
        "Only an agent made by pairing Wysebee Agent for Mac can have {tool}: install Wysebee Agent on the "
        "Mac, type a name for the new agent in it, and type the code it shows in Wysebee, under Devices."
    )
    # A type's own words, where its kind's would name another device: a Windows PC's link is held
    # as a Mac's.
    who_by_key = {
        agent_types.WINDOWS: (
            "Only an agent made by pairing Wysebee Agent for Windows can have {tool}: install Wysebee Agent on the "
            "Windows PC, type a name for the new agent in it, and type the code it shows in Wysebee, under Devices."
        ),
        agent_types.LINUX: (
            "Only an agent made by pairing Wysebee Agent for Linux can have {tool}: install Wysebee Agent on the "
            "Linux machine, run `wysebee-agent pair` there with a name for the new agent, and type the code it shows in "
            "Wysebee, under Devices."
        ),
    }
    # Several types' words at once, where a tool is listed by each of them.
    who_together = {
        frozenset({agent_types.OSX, agent_types.WINDOWS}): (
            "Only an agent made by pairing Wysebee Agent for Mac or for Windows can have {tool}: install Wysebee Agent "
            "on the Mac or Windows PC, type a name for the new agent in it, and type the code it shows in Wysebee, under Devices."
        ),
        # 2026-11-18: a Linux machine's agent has these too, but no screen.
        frozenset({agent_types.OSX, agent_types.WINDOWS, agent_types.LINUX}): (
            "Only an agent made by pairing Wysebee Agent for Mac, Windows or Linux can have {tool}: install Wysebee Agent "
            "on the computer, give it a name for the new agent there, and type the code it shows in Wysebee, under Devices."
        ),
    }
    # The link's sentences, said of a Mac (or the Windows PC, or the Linux machine: the same app).
    words = {
        links.UNPAIRED: "This Mac is not paired with Wysebee any more.",
        links.OFFLINE: "Wysebee Agent is not running on the Mac, or the Mac is asleep or offline.",
        links.NOT_REACHED: "The Mac could not be reached: it did not take this in time. Is it awake and online, with Wysebee Agent running?",
        links.TIMED_OUT: "The Mac did not finish this within {seconds:.0f} seconds, so it was stopped.",
        links.NO_ANSWER: "Wysebee Agent for Mac refused this, without saying why.",
        links.NOT_AN_OP: "'op' is not one of the Mac's operations: it runs the agent's local programs, skill scripts and folder tools only.",
    }

    def device_name(self, config: dict[str, Any]) -> str:
        return mac.device_of(config)

    # --- the agent's tools -----------------------------------------------------------------

    async def tools(self, ctx: ToolContext) -> list[dict[str, Any]]:
        config, device = ctx.config, mac.device_of(ctx.config)
        defs = mac.program_tools(user_tools.programs(ctx.tools), device)
        # skills.rs `tools_for`: `skill_run_script` only when one of them declares scripts.
        if await tools.declares_scripts(ctx.state.skill_file_store, ctx.user_id, ctx.skills):
            defs.append(mac.script_tool([s.name for s in ctx.skills], device))
        defs += mac.folder_tools(config, device)
        # Run any program, Screen control, Developer access and the Android toolkit: a Windows
        # PC's, a Linux machine's (no screen) or a Mac's agent, in that computer's words.
        if config.get(mac.ANY_FIELD) is True:
            defs.append(mac.any_program_tool(device))
        # A Linux machine's agent has no screen (its type lists neither the ops nor the tool).
        if device != mac.LINUX and config.get(mac.SCREEN_FIELD) is True:
            defs += mac.screen_tools(device)
        if config.get(pc_dev.DEV_FIELD) is True:
            defs += pc_dev.dev_tools(device)
        if config.get(pc_dev.ANDROID_FIELD) is True:
            defs += pc_dev.android_tools(device)
        # The iPhone toolkit (2026-11-17): a Mac's agent only (tool kind ios_toolkit).
        if device == mac.MAC and config.get(ios_dev.IOS_FIELD) is True:
            defs += ios_dev.ios_tools()
        return defs

    async def run(self, ctx: ToolContext, name: str, arguments: dict[str, Any]) -> Output:
        """The agent's own computer, through Wysebee Agent there (never here, never a shell)."""
        run = ctx.run_op
        if name in mac.FOLDER_TOOLS:
            out, picture = await mac.call_folder(run, ctx.config, name, arguments)
            if picture is not None:
                out.shown = [picture]
            return out
        if name == mac.SCRIPT_TOOL:
            return await mac.run_script(run, [s.name for s in ctx.skills], arguments)
        if name == mac.ANY_TOOL:
            return await mac.run_any(run, arguments)
        if name in mac.SCREEN_TOOLS:
            return await mac.call_screen(run, name, arguments)
        if name in pc_dev.DEV_TOOLS:
            return await pc_dev.call_dev(run, name, arguments)
        if name in pc_dev.ANDROID_TOOLS:
            return await pc_dev.call_android(run, name, arguments)
        if name in ios_dev.IOS_TOOLS:
            return await ios_dev.call_ios(run, name, arguments)
        program = mac.find_program(user_tools.programs(ctx.tools), name)
        if program is None:
            return Output(f"'{name}' is not one of your tools.", True)
        return await mac.call_program(run, program, arguments)

    def describe(self, ctx: ToolContext) -> str | None:
        device = mac.device_of(ctx.config)
        where = f"{device} ({ctx.link.browser})" if ctx.link is not None and ctx.link.browser else device
        app = APP.get(device, APP[mac.MAC])
        return f"Its programs, skill scripts and folder tools run on the person's {where} through {app}, which decides what runs: the {device} has to be awake and online."

    # --- the link, beyond calls ------------------------------------------------------------

    def read_poll(self, status: dict[str, Any]) -> dict[str, Any]:
        return {
            "approved": links._approved(status.get("approved")),
            "approved_skills": links._approved(status.get("approved_skills"), links.MAX_SKILLS, links.MAX_SKILL_NAME),
            "folders": links._folders(status.get("folders")),
        }

    async def apply_poll(self, ctx: LinkContext, said: dict[str, Any]) -> None:
        link = ctx.link
        if said["approved"] is not None and said["approved"] != link.approved:
            link.approved = said["approved"]
        if said["approved_skills"] is not None and said["approved_skills"] != link.approved_skills:
            link.approved_skills = said["approved_skills"]
        if said["folders"] is not None and said["folders"] != link.folders:
            # Changed: kept on the link, and written into the agent's settings once.
            link.folders = said["folders"]
            await links._write_folders(ctx.session, ctx.state.settings, link.user_id, ctx.agent)

    async def poll_extra(self, ctx: LinkContext) -> dict[str, Any]:
        return {
            "programs": await links._programs(ctx.session, ctx.link.user_id, ctx.link.agent_id),
            "skills": await links._skills(ctx.session, ctx.link.user_id, ctx.link.agent_id),
        }

    def link_view(self, link: Any) -> dict[str, Any]:
        return {"approved": list(link.approved or []), "approved_skills": list(link.approved_skills or []), "folders": list(link.folders or [])}

    def held_settings(self, link: Any) -> dict[str, Any]:
        return {links.FOLDERS_FIELD: list(link.folders or [])}
