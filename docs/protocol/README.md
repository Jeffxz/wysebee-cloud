# The agent link protocols

The contracts between Wysebee's device agents and Wysebee Cloud (`apps/cloud/browser_links.py`,
which serves them, and `apps/cloud/agent_chat/`, which runs an agent's tools over them).

| Protocol | Agents | Repositories |
|---|---|---|
| [browser-extension.md](browser-extension.md) | Wysebee Chrome Agent: the base link, read first | `wysebee-agent-browser-extension` |
| [computer.md](computer.md) | Wysebee Agent for Mac, Windows and Linux: one contract, with each platform's differences | `wysebee-agent-osx`, `wysebee-agent-win`, `wysebee-agent-linux` |
| [android.md](android.md) | Wysebee Agent for Android | `wysebee-agent-android` |

**A change to a protocol is a change in Wysebee Cloud and in every agent that speaks it**:
change the document here first, in the same pull request as the server's side, then each agent.
A field a device does not know is ignored, and a server that does not know a field a device sends
ignores it, so an agent may ship before or after the server — say which in the change.

(Until 2026-11-21 these were kept elsewhere, and before that each was its agent's own
`docs/protocol.md`.) How a new kind of device is added to
the server (an agent type pack, no core change): [../agent-type-packs.md](../agent-type-packs.md), "Adding a kind of device".
