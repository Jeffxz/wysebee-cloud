# AI apps propose, the person approves

The person's call, 2026-11-17. It applies to everything an AI app (Claude, ChatGPT, …) can do
through **Wysebee Assistant** (`/assistant/mcp`, `apps/cloud/agent_mcp.py`).

## The rule

> An AI app may **read**, **run** what the person has already approved, and **propose**
> changes. It never **changes** what an agent can do. A proposal does nothing until the person
> reviews it in Wysebee and accepts it.

What an agent can do — its tools, its skills' files, its database queries, its switches — is
the person's decision, made in Wysebee's own pages. An AI app can draft that decision for them,
never make it.

**Why:** an agent's tools run on the person's computer, in their browser and on their
databases. An AI app follows whatever text it is given — a web page, an email, a document — so
whatever it can change on its own, a prompt injection can change too. Keeping the person between
"written by an AI" and "used by an agent" means a hostile page can at most leave a proposal the
person sees and discards.

## What this means for each thing an AI app can touch

| What | What an AI app can do | Where the person approves |
| --- | --- | --- |
| **Workspace pages** | Write into the page open in the editor (`write_document`, `replace_in_document`, …) | The editor: nothing is saved until they click **Save** (`apps/cloud/workspace_assistant.py`) |
| **A document's rich page** (HTML) | Write it for the document open in the editor (`write_page`): kept at once, one per document, in the workspace's hidden `.pages` folder (`apps/cloud/workspace_pages.py`) | Nothing to approve — it is a view of the person's own document, not something an agent can do — but it is **shown sandboxed**: an iframe with no origin of its own and a policy allowing only its inline styles and scripts, no network, so it can neither reach Wysebee nor send what it shows anywhere |
| **A skill's open file** (usually `SKILL.md`) | Write into the editor, as for a page | The Skills editor's **Save** |
| **A skill's other files and folders** | Propose them (`write_skill_file`, `add_skill_folder`) | The skill's page, **Changes proposed by your AI app**: View / **Apply** / Discard (`apps/cloud/skill_changes.py`) |
| **A new skill** | Make one (`create_skill`) | It is given to **no agent**: it does nothing until the person gives it to one, on the agent's Skills tab |
| **Giving a skill to an agent** | Ask for one of the person's skills on an agent, with a reason (`propose_skill`) | **Proposed by your AI app** on the agent's Tools tab: the skill, why, and a link to its files; **Give** or **Decline** (`apps/cloud/skill_changes.py`, migration 0076). Giving it on the agent's Skills tab answers the request too |
| **An agent's Instruction** (the notes every AI app reads with `list_agent_tools`) | Propose a new version, whole, with a reason (`propose_instruction`), kept in the agent's `instruction_proposal` | **Proposed by your AI app**: the reason, and the Instruction now beside the proposed one; **Review** puts it on the agent's Instruction tab to edit, then **Save**; or **Discard**. AI apps read the agent's own until then |
| **SQL Query tools** | Draft one (`draft_sql_tool`), or propose a new version of one (`propose_sql_tool_change`); read a connection's tables and check a statement, never running it (`describe_database`, `check_sql_tool`) | The agent's Tools tab, **Proposed by your AI app**: a draft's **Review** → **Create tool**; a change's **Review** → **Apply change** or **Discard change**, with what it changes and the SQL now shown (`apps/cloud/tool_drafts.py`). A draft is never offered to the agent; a tool with a change runs as it was until applied |
| **Running an agent's tools** | Run the tools the person gave the agent (`call_agent_read_tool`, `call_agent_tool`) | Already approved when given. A SQL tool runs the person's saved statement: the AI app gives typed values, always bound, never SQL |
| **Database connections** | List them by name — never their address, user or secret | Made only by the person, on the agent's General tab. An AI app never handles a password |
| **Site links** (Gmail, Calendar, Travel, News, Website) | Draft one for a browser agent (`draft_site_link`) | **Proposed by your AI app**: the address and what it is for, **Create** or **Discard** |
| **Programs** on a Mac or Windows PC | Draft one for that computer's agent (`draft_program`) | **Proposed by your AI app**: the command line as it would run, **Create** or **Discard**. A draft is never sent to the computer, and once created Wysebee Agent there asks the person again before it runs |
| **Switches** (Browser access, Web development tools, Run any program, Screen control, Developer access, Android and iPhone toolkits) | Ask for one with a reason (`request_switch`), kept in the agent's `switch_requests` | **Proposed by your AI app**: the reason and a warning of what it allows; **Turn on** or **Decline**, then the settings' **Save** |
| **Changes to site links and programs** | Nothing | The agent's Tools tab |
| **Scheduled tasks** | Save, run and delete them (`save_task`, …) | A task only calls tools the person already gave the agents; it adds no capability |

## For whoever adds a Wysebee Assistant tool

Before adding a tool to `/assistant/mcp`, place it in one of these:

1. **Reads** — `readOnlyHint: true`, changes nothing anywhere. Prefer names and metadata
   over data; never return a secret, an address or credentials.
2. **Runs what was approved** — calls only what the person already gave an agent, as it was
   given (a SQL tool's saved statement with bound values, a program the Mac allowed).
3. **Proposes** — keeps a draft (`config.draft`), a pending change (`config.pending`) or a
   request (`switch_requests`, `skill_requests`, `instruction_proposal`) that **nothing uses** (`user_tools.of_agent` leaves drafts out
   of everything that runs), tells the person
   (a notification on Activity), and is accepted only by a request from the person's own
   Wysebee page. No Assistant tool may accept, apply or turn on what it proposed.

If a tool fits none of these — it would change what an agent can do, or touch a secret — it
does not belong in Wysebee Assistant. Make it a page the person uses, or a proposal.

## Known gap

The Wysebee Agent **browser extension** drives the person's own browser. An AI app driving it
can click **Create tool** or **Apply** on Wysebee's own pages, which skips this rule: those
pages trust whoever clicks. Until the extension refuses (or always asks) on Wysebee's own
pages, keep Wysebee off the extension's trusted sites, so it asks the person before acting
there.
