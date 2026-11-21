"""Scheduled tasks, run by Wysebee Cloud (2026-11-15, the person's call): a reminder or a
periodic piece of work set up from the person's AI app through Wysebee Assistant.

There is no model in the cloud, so a task does two things when it comes due: it runs its
**steps** — fixed agent tool calls (``[{agent_id, tool, arguments}]``, at most :data:`STEPS_MAX`;
the AI app names the agent by its @handle, kept by id so a rename keeps the step),
each as ``call_agent_tool`` would run it, counted as a credit — and it posts its **plan** with
what each step returned as a notification on the person's Activity page
(apps/cloud/notifications.py), from the first step's agent. Each run is recorded with the
task's runs (``user_task_runs``, its first step's ``agent_id``), where the website's Run tab
reads it.

**When**: a task is a :class:`~apps.cloud.models.UserTask` (apps/cloud/tasks.py; its
``config`` holds ``prompt`` — the plan — ``steps`` and ``trigger``). Whenever one is saved,
from the website or the AI app, its next due time is worked out here into
``task_schedules`` (migration 0057; deleted with the task). A trigger is ``{type: "manual"}``, ``{type: "once", at}`` (an instant), or
``{type: "recurring", repeat: "minutes" | "hours", every}`` or ``{…, repeat: "daily" |
"weekly", time: "HH:MM", days?: [1-7, Monday first], tz}`` — ``tz`` an IANA zone, UTC when
none. Every ``task_tick_seconds`` each replica claims the due ones (``FOR UPDATE SKIP
LOCKED``, so a task runs once), runs them and sets when each is next due; a run whose replica
died is claimed again after ``task_run_stale_seconds``.

**Wysebee Assistant's tools** (apps/cloud/agent_mcp.py): ``list_tasks`` (free),
``save_task``, ``delete_task`` and ``run_task`` (due now: it runs within a tick).

- ``GET /task-schedules`` — ``{schedules: {task_id: next_run_at}}``, for the website.
"""

import asyncio
import json
import logging
import re
import uuid
from datetime import UTC, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import delete, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from apps.cloud.db import raise_if_cancelled
from apps.cloud import notifications, tool_calls
from apps.cloud.auth import User, current_user
from apps.cloud.models import TaskSchedule, UserTask, UserTaskRun

logger = logging.getLogger("wysebee.cloud.tasks")

router = APIRouter(prefix="/v1", tags=["Tasks"])

STEPS_MAX = 10
NAME_MAX = 200
PLAN_MAX = 50_000
# How many due tasks a replica claims at a time.
BATCH = 20
# What a step's result keeps in the notification and the run.
STEP_TEXT_MAX = 2_000
TIME_RE = r"^([01]\d|2[0-3]):([0-5]\d)$"


def _now() -> datetime:
    return datetime.now(UTC)


# --- triggers -----------------------------------------------------------------------------


def _zone(name: Any) -> ZoneInfo:
    try:
        return ZoneInfo(name) if isinstance(name, str) and name else ZoneInfo("UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def _instant(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        at = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return at if at.tzinfo else at.replace(tzinfo=UTC)


def next_after(trigger: Any, after: datetime) -> datetime | None:
    """When ``trigger`` next fires after ``after``; None for manual, a timer gone by, or one
    that cannot be read."""
    if not isinstance(trigger, dict):
        return None
    kind, repeat = trigger.get("type"), trigger.get("repeat")
    if kind == "once":
        at = _instant(trigger.get("at"))
        return at if at is not None and at > after else None
    if kind != "recurring":
        return None
    if repeat in ("minutes", "hours"):
        every = trigger.get("every")
        if not isinstance(every, int) or isinstance(every, bool) or every < 1:
            return None
        return after + (timedelta(minutes=every) if repeat == "minutes" else timedelta(hours=every))
    if repeat not in ("daily", "weekly"):
        return None
    when = trigger.get("time")
    if not isinstance(when, str):
        return None
    m = re.match(TIME_RE, when)
    if not m:
        return None
    days = set(trigger.get("days") or []) if repeat == "weekly" else set(range(1, 8))
    zone = _zone(trigger.get("tz"))
    local = after.astimezone(zone)
    for ahead in range(8):
        day = local.date() + timedelta(days=ahead)
        if day.isoweekday() not in days:
            continue
        at = datetime.combine(day, time(int(m[1]), int(m[2])), tzinfo=zone)
        if at > after:
            return at.astimezone(UTC)
    return None


def clean_trigger(raw: Any, now: datetime) -> dict[str, Any] | str:
    """A trigger the AI app sent, checked as the website checks one (and with its zone);
    else why not."""
    if raw is None or raw == {} or (isinstance(raw, dict) and raw.get("type") in (None, "manual")):
        return {"type": "manual"}
    if not isinstance(raw, dict):
        return "'schedule' must be an object."
    if raw.get("type") == "once":
        at = _instant(raw.get("at"))
        if at is None:
            return "A timer needs 'at': an ISO date and time with its offset, e.g. 2026-11-15T09:00:00-05:00."
        if at <= now:
            return "The timer's time has already passed: choose a later one."
        return {"type": "once", "at": at.astimezone(UTC).isoformat()}
    if raw.get("type") != "recurring":
        return "'type' is manual, once or recurring."
    repeat = raw.get("repeat")
    if repeat in ("minutes", "hours"):
        every = raw.get("every")
        lo, hi = (5, 1440) if repeat == "minutes" else (1, 168)
        if not isinstance(every, int) or isinstance(every, bool) or not lo <= every <= hi:
            return f"Repeat every {lo} to {hi} {repeat}."
        return {"type": "recurring", "repeat": repeat, "every": every}
    if repeat in ("daily", "weekly"):
        when = raw.get("time")
        if not isinstance(when, str) or not re.match(TIME_RE, when):
            return "Give 'time' as HH:MM, 24-hour."
        tz = raw.get("tz") or "UTC"
        try:
            ZoneInfo(tz)
        except (ZoneInfoNotFoundError, ValueError, TypeError):
            return f"Unknown time zone {tz!r}: give an IANA name such as America/Toronto."
        out: dict[str, Any] = {"type": "recurring", "repeat": repeat, "time": when, "tz": tz}
        if repeat == "weekly":
            days = raw.get("days")
            picked = sorted({d for d in days if isinstance(d, int) and not isinstance(d, bool) and 1 <= d <= 7}) if isinstance(days, list) else []
            if not picked:
                return "Give 'days' for a weekly task: 1 (Monday) to 7 (Sunday)."
            out["days"] = picked
        return out
    return "'repeat' is minutes, hours, daily or weekly."


def describe(trigger: Any) -> str:
    """A trigger in words, for the AI app."""
    if not isinstance(trigger, dict) or trigger.get("type") not in ("once", "recurring"):
        return "manual (only when run)"
    if trigger["type"] == "once":
        return f"once, at {trigger.get('at')}"
    repeat = trigger.get("repeat")
    if repeat in ("minutes", "hours"):
        return f"every {trigger.get('every')} {repeat}"
    zone = trigger.get("tz") or "UTC"
    if repeat == "weekly":
        return f"weekly on days {trigger.get('days')} (1 = Monday) at {trigger.get('time')} {zone}"
    return f"daily at {trigger.get('time')} {zone}"


# --- the schedule ---------------------------------------------------------------------------


async def sync(session: AsyncSession, user_id: str, task_id: str, config: dict[str, Any]) -> None:
    """The task was saved: when it is next due, from its trigger (in the caller's transaction)."""
    due = next_after(config.get("trigger"), _now())
    if due is None:
        await forget(session, user_id, task_id)
        return
    await session.execute(
        insert(TaskSchedule).values(user_id=user_id, task_id=task_id, next_run_at=due)
        .on_conflict_do_update(index_elements=[TaskSchedule.user_id, TaskSchedule.task_id], set_={"next_run_at": due})
    )


async def forget(session: AsyncSession, user_id: str, task_id: str) -> None:
    await session.execute(delete(TaskSchedule).where(TaskSchedule.user_id == user_id, TaskSchedule.task_id == task_id))


@router.get("/task-schedules")
async def schedules(request: Request, user: User = Depends(current_user)) -> dict[str, Any]:
    async with request.app.state.db.sessionmaker() as session:
        rows = (await session.scalars(select(TaskSchedule).where(TaskSchedule.user_id == user.sub))).all()
    return {"schedules": {r.task_id: r.next_run_at.isoformat() for r in rows}}


# --- running --------------------------------------------------------------------------------


async def _step(state: Any, user_id: str, step: dict[str, Any]) -> tuple[str, bool, str]:
    """One step: the agent's tool, run as ``call_agent_tool`` runs it. Its text, whether it
    failed, and the agent's handle now."""
    from apps.cloud import agents
    from apps.cloud.agent_chat import toolbox as cloud_tools

    tool = step.get("tool")
    async with state.db.sessionmaker() as session:
        found = await agents.by_id(session, user_id, step.get("agent_id") if isinstance(step.get("agent_id"), str) else None)
        if found is None:
            return "The person has no such agent any more.", True, "(deleted agent)"
        agent = found.name
        box = await cloud_tools.toolbox(state, session, user_id, found)
    if tool not in box.offered:
        return f"@{agent} has no tool named {tool} now.", True, agent
    arguments = step.get("arguments") if isinstance(step.get("arguments"), dict) else {}
    try:
        out = await asyncio.wait_for(box.run({"id": None, "name": tool, "arguments": arguments}), timeout=state.settings.mcp_call_wait_seconds)
    except TimeoutError:
        return "It did not finish in time.", True, agent
    except Exception:  # noqa: BLE001 — a step that broke is reported, and the run goes on
        logger.exception("task_step_failed")
        return "The tool failed in Wysebee Cloud.", True, agent
    if not out.is_error:
        await tool_calls.count_one(state, user_id)
    text = out.text.strip()
    pictures = len(out.images) + len(out.shown)
    if pictures:
        text += f"\n\n[{pictures} picture{'s' if pictures > 1 else ''}, not kept]"
    return text, out.is_error, agent


def _excerpt(text: str) -> str:
    return text if len(text) <= STEP_TEXT_MAX else text[: STEP_TEXT_MAX - 1] + "…"


async def run_task(state: Any, user_id: str, task_id: str, how: str = "schedule") -> None:
    """Run one task now: its steps, a notification and a run; then when it is next due."""
    started = _now()
    from apps.cloud import tasks

    async with state.db.sessionmaker() as session:
        row = await tasks.of(session, user_id, task_id)
        if row is None:
            # Deleted since it was claimed: its schedule went with it.
            return
        name, config = row.name, dict(row.config or {})
        # Refused by the deployment's policy (apps/cloud/extensions.py): the run says why and does nothing.
        refusal = await state.policy.may_use(session, user_id)
    steps = [s for s in config.get("steps") or [] if isinstance(s, dict)][:STEPS_MAX]
    lines: list[str] = []
    plan = config.get("prompt")
    if isinstance(plan, str) and plan.strip():
        lines.append(plan.strip())
    failed = refusal is not None
    if refusal is not None:
        lines.append(refusal.detail)
    for step in steps if refusal is None else []:
        text, is_error, handle = await _step(state, user_id, step)
        failed = failed or is_error
        lines.append(f"**@{handle} · {step.get('tool')}**{' — failed' if is_error else ''}\n\n{_excerpt(text) or '(nothing)'}")
    body = "\n\n".join(lines)
    from apps.cloud import agents

    async with state.db.sessionmaker() as session:
        first = await agents.by_id(session, user_id, steps[0].get("agent_id") if steps and isinstance(steps[0].get("agent_id"), str) else None)
        agent = first.agent_id if first is not None else None
        await notifications.send(session, user_id, name[: notifications.TITLE_MAX], body[: notifications.BODY_MAX], agent)
    finished = _now()
    async with state.db.sessionmaker() as session:
        session.add(UserTaskRun(
            user_id=user_id, run_id=uuid.uuid4().hex, task_id=task_id, status="failed" if failed else "succeeded",
            trigger=how, agent_id=agent, started_at=started.isoformat(),
            finished_at=finished.isoformat(), output=body, error="A step failed." if failed else None,
        ))
        due = next_after(config.get("trigger"), finished)
        if due is None:
            await forget(session, user_id, task_id)
        else:
            schedule = await session.get(TaskSchedule, (user_id, task_id))
            if schedule is not None:
                schedule.next_run_at, schedule.running_since = due, None
        await session.commit()
    logger.info("task_ran steps=%d failed=%s", len(steps), failed)


async def run_due(state: Any) -> int:
    """Claim the tasks due now and run them; how many."""
    now = _now()
    stale = now - timedelta(seconds=state.settings.task_run_stale_seconds)
    async with state.db.sessionmaker() as session:
        due = (await session.scalars(
            select(TaskSchedule)
            .where(TaskSchedule.next_run_at <= now, or_(TaskSchedule.running_since.is_(None), TaskSchedule.running_since < stale))
            .order_by(TaskSchedule.next_run_at).limit(BATCH).with_for_update(skip_locked=True)
        )).all()
        claimed = [(r.user_id, r.task_id) for r in due]
        for r in due:
            r.running_since = now
        await session.commit()
    for user_id, task_id in claimed:
        try:
            await run_task(state, user_id, task_id)
        except Exception:  # noqa: BLE001 — one task's failure never stops the others
            logger.exception("task_run_failed")
            async with state.db.sessionmaker() as session:
                schedule = await session.get(TaskSchedule, (user_id, task_id))
                if schedule is not None:
                    # Tried again a little later, not at once.
                    schedule.next_run_at, schedule.running_since = _now() + timedelta(minutes=5), None
                await session.commit()
    return len(claimed)


async def scheduler(state: Any) -> None:
    """Run due tasks every ``task_tick_seconds``, for the life of the app. Never raises."""
    while True:
        # A tick first: an app starting and stopping at once (a test, a rolling deploy) never
        # stops it halfway through a claim.
        await asyncio.sleep(state.settings.task_tick_seconds)
        try:
            await run_due(state)
        except Exception as exc:  # noqa: BLE001 — a database outage just skips a tick
            raise_if_cancelled(exc)
            logger.warning("task tick skipped: %s", exc)


# --- Wysebee Assistant's tools -------------------------------------------------------------


STEP_SCHEMA = {
    "type": "object",
    "properties": {
        "agent": {"type": "string", "description": "The agent's @handle (without the @)."},
        "tool": {"type": "string", "description": "One of its tools, as list_agent_tools gives it."},
        "arguments": {"type": "object", "description": "The tool's arguments, matching its input schema."},
    },
    "required": ["agent", "tool"],
}
SCHEDULE_SCHEMA = {
    "type": "object",
    "description": (
        "When it runs. {type: 'manual'} (only with run_task); {type: 'once', at: ISO date-time with offset}; "
        "{type: 'recurring', repeat: 'minutes' (every 5-1440) | 'hours' (every 1-168), every}; or "
        "{type: 'recurring', repeat: 'daily' | 'weekly', time: 'HH:MM', tz: IANA zone (the person's), days: [1-7, Monday = 1] for weekly}."
    ),
}
TOOLS: list[dict[str, Any]] = [
    {
        "name": "list_tasks",
        "title": "List scheduled tasks",
        "description": "The person's Wysebee tasks: each one's id, name, schedule, when it is next due, its plan and its steps.",
        "inputSchema": {"type": "object", "properties": {}},
        "annotations": {"readOnlyHint": True},
    },
    {
        "name": "save_task",
        "title": "Set up a reminder or scheduled task",
        "description": (
            "Create a task (no 'id') or change one (its 'id': only what you send changes). Use it when the person asks for a "
            "reminder or for something done on a schedule. Wysebee Cloud runs it when due — it has no AI model, so a run "
            "does exactly this: runs each step (an agent's tool, as call_agent_tool would) in order, then sends the person a "
            "notification on their Activity page with the plan and what each step returned. A reminder is just a plan and "
            "a schedule, with no steps. Ask the person's time zone for daily or weekly ones if you do not know it."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "id": {"type": "string", "description": "The task to change, as list_tasks gives it; leave out to create one."},
                "name": {"type": "string", "description": f"Its name, also the notification's title (at most {NAME_MAX} characters)."},
                "plan": {"type": "string", "description": "What the notification says (Markdown): the reminder, or what the steps are for."},
                "schedule": SCHEDULE_SCHEMA,
                "steps": {"type": "array", "items": STEP_SCHEMA, "description": f"At most {STEPS_MAX} agent tool calls, run in order."},
            },
        },
        # Changing a task overwrites what it was; its steps run agent tools when due.
        "annotations": {"destructiveHint": True},
    },
    {
        "name": "delete_task",
        "title": "Delete a task",
        "description": "Delete one of the person's tasks, by its id: it no longer runs.",
        "inputSchema": {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]},
        "annotations": {"destructiveHint": True},
    },
    {
        "name": "run_task",
        "title": "Run a task now",
        "description": "Run one of the person's tasks now, by its id, whatever its schedule: its result shows on Activity within half a minute.",
        "inputSchema": {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]},
        # Its steps are agent tools, which can act in the person's browser or on their Mac.
        "annotations": {"destructiveHint": True, "openWorldHint": True},
    },
]
TOOL_NAMES = {t["name"] for t in TOOLS}
FREE = {"list_tasks"}


async def _check_steps(state: Any, user_id: str, raw: Any, visible: list[str]) -> list[dict[str, Any]] | str:
    """The steps as kept — each agent by id (Wysebee's own made when it has no row) — or why
    not. ``visible``: the handles the AI app may use."""
    from apps.cloud import agents
    from apps.cloud.agent_chat import toolbox as cloud_tools

    if not isinstance(raw, list) or len(raw) > STEPS_MAX:
        return f"'steps' is a list of at most {STEPS_MAX}."
    steps: list[dict[str, Any]] = []
    for n, step in enumerate(raw, 1):
        if not isinstance(step, dict) or not isinstance(step.get("agent"), str) or not isinstance(step.get("tool"), str):
            return f"Step {n} needs 'agent' and 'tool'."
        agent = step["agent"].strip().removeprefix("@")
        if agent not in visible:
            return f"Step {n}: the person has no agent @{agent} for AI apps (list_agents names them)."
        async with state.db.sessionmaker() as session:
            found = await agents.stored(session, user_id, agent)
            assert found is not None  # it is among the agents just listed
            box = await cloud_tools.toolbox(state, session, user_id, found)
            await session.commit()
        if step["tool"] not in box.offered:
            return f"Step {n}: @{agent} has no tool named {step['tool']} (list_agent_tools lists them)."
        arguments = step.get("arguments", {})
        if not isinstance(arguments, dict):
            return f"Step {n}: 'arguments' must be an object."
        steps.append({"agent_id": found.agent_id, "tool": step["tool"], "arguments": arguments})
    return steps


def _line(row: UserTask, due: datetime | None, names: dict[str, str]) -> str:
    """A task as list_tasks says it, each step's agent by its handle now."""
    config = row.config or {}
    out = [f"- {row.name} (id {row.task_id}): {describe(config.get('trigger'))}; next {due.isoformat() if due else 'not scheduled'}."]
    plan = config.get("prompt")
    if isinstance(plan, str) and plan.strip():
        out.append(f"  Plan: {plan.strip()[:300]}")
    for step in config.get("steps") or []:
        if isinstance(step, dict):
            handle = names.get(step.get("agent_id") or "", "(deleted agent)")
            out.append(f"  Step: @{handle} · {step.get('tool')} {json.dumps(step.get('arguments') or {})}")
    return "\n".join(out)


async def _save(request: Request, user: User, row: UserTask | None, name: str, config: dict[str, Any]) -> UserTask | str:
    from apps.cloud import tasks

    async with request.app.state.db.sessionmaker() as session:
        # Read again in this session: ``row`` was read in another, now closed.
        current = await tasks.of(session, user.sub, row.task_id) if row is not None else None
        try:
            saved = await tasks.save(session, user.sub, current, name=name, config=config, by=user.sub)
            await tasks.commit(session, name)
        except HTTPException as exc:
            return str(exc.detail)
        await session.refresh(saved)
    return saved


async def call_tool(request: Request, user: User, name: str, args: dict[str, Any], agents: list[str]) -> tuple[str, bool]:
    """Run one of the task tools: its answer, and whether it is an error. ``agents``: the
    handles of the person's agents the AI app may use."""
    from apps.cloud import agents as agent_rows
    from apps.cloud import tasks

    state = request.app.state
    if name == "list_tasks":
        async with state.db.sessionmaker() as session:
            rows = await tasks.all_of(session, user.sub)
            due = await tasks.due_of(session, user.sub)
            names = {r.agent_id: r.name for r in await agent_rows.all_of(session, user.sub)}
        if not rows:
            return "The person has no tasks yet.", False
        return "The person's tasks:\n" + "\n".join(_line(r, due.get(r.task_id), names) for r in rows), False
    if name in ("delete_task", "run_task"):
        async with state.db.sessionmaker() as session:
            row = await tasks.of(session, user.sub, args.get("id"))
            if row is None:
                return "No such task: list_tasks gives their ids.", True
            if name == "run_task":
                await session.execute(
                    insert(TaskSchedule).values(user_id=user.sub, task_id=row.task_id, next_run_at=_now())
                    .on_conflict_do_update(index_elements=[TaskSchedule.user_id, TaskSchedule.task_id], set_={"next_run_at": _now()})
                )
                await session.commit()
                return f"{row.name} runs now: its result shows on the person's Activity page within half a minute.", False
            await tasks.remove(session, user.sub, row)
            await session.commit()
        return f"Deleted {row.name}.", False
    # save_task
    async with state.db.sessionmaker() as session:
        row = await tasks.of(session, user.sub, args["id"]) if "id" in args else None
    if "id" in args and row is None:
        return "No such task: list_tasks gives their ids, or leave 'id' out to create one.", True
    config = dict(row.config or {}) if row is not None else {}
    task_name = args.get("name", row.name if row is not None else None)
    if not isinstance(task_name, str) or not task_name.strip() or len(task_name.strip()) > NAME_MAX:
        return f"Give the task a 'name' of 1 to {NAME_MAX} characters.", True
    if "plan" in args:
        if not isinstance(args["plan"], str) or len(args["plan"]) > PLAN_MAX:
            return f"'plan' is text of at most {PLAN_MAX} characters.", True
        config["prompt"] = args["plan"].strip()
    if "schedule" in args or row is None:
        trigger = clean_trigger(args.get("schedule"), _now())
        if isinstance(trigger, str):
            return trigger, True
        config["trigger"] = trigger
    if "steps" in args:
        steps = await _check_steps(state, user.sub, args["steps"], agents)
        if isinstance(steps, str):
            return steps, True
        config["steps"] = steps
    saved = await _save(request, user, row, task_name.strip(), config)
    if isinstance(saved, str):
        return saved, True
    async with state.db.sessionmaker() as session:
        due = await session.scalar(select(TaskSchedule.next_run_at).where(TaskSchedule.user_id == user.sub, TaskSchedule.task_id == saved.task_id))
        names = {r.agent_id: r.name for r in await agent_rows.all_of(session, user.sub)}
    return f"{'Changed' if row is not None else 'Created'} the task:\n{_line(saved, due, names)}", False
