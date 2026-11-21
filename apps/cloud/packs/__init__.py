"""The built-in agent type packs (apps/cloud/agent_packs.py, docs/agent-type-packs.md): the
kinds of device this repository serves, registered before any an extension brings.

- :mod:`apps.cloud.packs.browser` — the Wysebee Agent browser extension (step 2);
- :mod:`apps.cloud.packs.android` — Wysebee Agent for Android (step 3);
- :mod:`apps.cloud.packs.computer` — Wysebee Agent for Mac, Windows and Linux (step 4).
"""

from apps.cloud.agent_packs import AgentPack
from apps.cloud.packs.android import AndroidPack
from apps.cloud.packs.browser import BrowserPack
from apps.cloud.packs.computer import ComputerPack


def built_in() -> list[AgentPack]:
    """A fresh set of the built-in packs, in the order their tools are offered."""
    return [BrowserPack(), AndroidPack(), ComputerPack()]
