"""Scheduled tasks run by Wysebee Cloud (apps/cloud/task_runner.py): triggers, the schedule kept
from every save, the run (steps, a notification, a run row, the next due time) and Wysebee
Assistant's task tools — the database parts skipped without WYSEBEE_TEST_DATABASE_URL."""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from apps.cloud import task_runner
from apps.cloud.agent_chat import toolbox as cloud_tools
from apps.cloud.agent_chat.tools import Output
from apps.cloud.models import TaskSchedule, UserTask
from tests.cloud_agent_fixtures import _agent, _agents, client, me  # noqa: F401 — fixtures
from tests.conftest import needs_db
from tests.test_agent_mcp import PLAIN, _call, _signed, fake_verifier  # noqa: F401 — fixtures
from tests.test_cloud_agent_mac import _skill

T0 = datetime(2026, 11, 16, 14, 30, tzinfo=UTC)  # a Monday


# --- no database ----------------------------------------------------------------------------


def test_a_trigger_says_when_it_next_fires():
    nxt = task_runner.next_after
    assert nxt({"type": "manual"}, T0) is None
    assert nxt(None, T0) is None
    assert nxt({"type": "once", "at": "2026-11-16T15:00:00Z"}, T0) == datetime(2026, 11, 16, 15, tzinfo=UTC)
    assert nxt({"type": "once", "at": "2026-11-16T10:00:00"}, T0) is None  # no offset: UTC, gone by
    assert nxt({"type": "once", "at": "soon"}, T0) is None
    assert nxt({"type": "once", "at": 3}, T0) is None
    assert nxt({"type": "recurring", "repeat": "minutes", "every": 10}, T0) == T0 + timedelta(minutes=10)
    assert nxt({"type": "recurring", "repeat": "hours", "every": 2}, T0) == T0 + timedelta(hours=2)
    for every in (0, True, "2", None):
        assert nxt({"type": "recurring", "repeat": "hours", "every": every}, T0) is None
    # Daily at 09:00 Toronto (14:00 UTC): today's has gone by, so tomorrow's.
    daily = {"type": "recurring", "repeat": "daily", "time": "09:00", "tz": "America/Toronto"}
    assert nxt(daily, T0) == datetime(2026, 11, 17, 14, tzinfo=UTC)
    assert nxt({**daily, "time": "10:00"}, T0) == datetime(2026, 11, 16, 15, tzinfo=UTC)
    # No zone, or one that is no zone: UTC.
    assert nxt({**daily, "tz": None}, T0) == datetime(2026, 11, 17, 9, tzinfo=UTC)
    assert nxt({**daily, "tz": "Nowhere/Land"}, T0) == datetime(2026, 11, 17, 9, tzinfo=UTC)
    # Weekly: the next of its days (Friday = 5).
    assert nxt({**daily, "repeat": "weekly", "days": [5]}, T0) == datetime(2026, 11, 20, 14, tzinfo=UTC)
    assert nxt({**daily, "repeat": "weekly", "days": []}, T0) is None
    for bad in ({**daily, "time": "9am"}, {**daily, "time": None}, {"type": "recurring", "repeat": "yearly"}, {"type": "sometimes"}):
        assert nxt(bad, T0) is None


def test_a_trigger_from_the_ai_app_is_checked():
    clean = task_runner.clean_trigger
    assert clean(None, T0) == clean({}, T0) == clean({"type": "manual"}, T0) == {"type": "manual"}
    assert clean("daily", T0) == "'schedule' must be an object."
    assert clean({"type": "once", "at": "2026-11-16T10:00:00-05:00"}, T0) == {"type": "once", "at": "2026-11-16T15:00:00+00:00"}
    assert clean({"type": "once", "at": "later"}, T0).startswith("A timer needs 'at'")
    assert clean({"type": "once", "at": "2026-11-16T09:00:00Z"}, T0) == "The timer's time has already passed: choose a later one."
    assert clean({"type": "weird"}, T0) == "'type' is manual, once or recurring."
    assert clean({"type": "recurring", "repeat": "minutes", "every": 5}, T0) == {"type": "recurring", "repeat": "minutes", "every": 5}
    assert clean({"type": "recurring", "repeat": "minutes", "every": 4}, T0) == "Repeat every 5 to 1440 minutes."
    assert clean({"type": "recurring", "repeat": "hours", "every": True}, T0) == "Repeat every 1 to 168 hours."
    daily = {"type": "recurring", "repeat": "daily", "time": "07:30"}
    assert clean(daily, T0) == {**daily, "tz": "UTC"}
    assert clean({**daily, "tz": "Asia/Tokyo"}, T0) == {**daily, "tz": "Asia/Tokyo"}
    assert clean({**daily, "tz": "Mars/Base"}, T0).startswith("Unknown time zone 'Mars/Base'")
    assert clean({**daily, "time": "25:00"}, T0) == "Give 'time' as HH:MM, 24-hour."
    weekly = {**daily, "repeat": "weekly"}
    assert clean({**weekly, "days": [5, 1, 1, 9, True, "2"]}, T0) == {**weekly, "tz": "UTC", "days": [1, 5]}
    assert clean({**weekly, "days": "mon"}, T0) == "Give 'days' for a weekly task: 1 (Monday) to 7 (Sunday)."
    assert clean({"type": "recurring", "repeat": "yearly"}, T0) == "'repeat' is minutes, hours, daily or weekly."


def test_a_trigger_in_words():
    d = task_runner.describe
    assert d(None) == d({"type": "manual"}) == "manual (only when run)"
    assert d({"type": "once", "at": "X"}) == "once, at X"
    assert d({"type": "recurring", "repeat": "hours", "every": 2}) == "every 2 hours"
    assert d({"type": "recurring", "repeat": "daily", "time": "09:00"}) == "daily at 09:00 UTC"
    assert d({"type": "recurring", "repeat": "weekly", "time": "09:00", "tz": "Asia/Tokyo", "days": [1]}) == "weekly on days [1] (1 = Monday) at 09:00 Asia/Tokyo"


def test_the_scheduler_ticks_and_skips_a_tick_that_fails(monkeypatch):
    calls = []

    async def due(state):
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("database down")
        if len(calls) == 3:
            raise asyncio.CancelledError

    monkeypatch.setattr(task_runner, "run_due", due)
    state = SimpleNamespace(settings=SimpleNamespace(task_tick_seconds=0))
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(task_runner.scheduler(state))
    assert len(calls) == 3


# --- with a database ----------------------------------------------------------------------


def _tid(me: dict[str, str], key: str) -> str:
    """The id of the person's task the test calls ``key``."""
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"{me['X-Test-User']}/{key}"))


def _task(client: TestClient, me: dict[str, str], key: str, name: str, config: dict) -> str:  # noqa: F811
    """Make or change a task with exactly this config (its steps by agent id), saved as
    apps/cloud/tasks.py saves one; its id."""
    from apps.cloud import tasks

    sub, task_id = me["X-Test-User"], _tid(me, key)

    async def go() -> None:
        async with client.app.state.db.sessionmaker() as session:
            row = await session.get(UserTask, task_id)
            if row is None:
                row = UserTask(task_id=task_id, user_id=sub, name=name, config={}, created_by=sub, updated_by=sub)
                session.add(row)
            await tasks.save(session, sub, row, name=name, config=config)
            await session.commit()

    client.portal.call(go)
    return task_id


def _schedules(client: TestClient, me: dict[str, str]) -> dict:  # noqa: F811
    return client.get("/api/v1/task-schedules", headers=me).json()["schedules"]


def _due_now(client: TestClient, me: dict[str, str], task_id: str, running_since: datetime | None = None) -> None:  # noqa: F811
    async def go() -> None:
        async with client.app.state.db.sessionmaker() as session:
            row = await session.get(TaskSchedule, (me["X-Test-User"], task_id))
            if row is None:
                session.add(TaskSchedule(user_id=me["X-Test-User"], task_id=task_id, next_run_at=datetime.now(UTC) - timedelta(seconds=1), running_since=running_since))
            else:
                row.next_run_at, row.running_since = datetime.now(UTC) - timedelta(seconds=1), running_since
            await session.commit()

    client.portal.call(go)


def _run_due(client: TestClient) -> int:  # noqa: F811
    return client.portal.call(task_runner.run_due, client.app.state)


def _notes(client: TestClient, me: dict[str, str]) -> list[dict]:  # noqa: F811
    return client.get("/api/v1/notifications", headers=me).json()["notifications"]


def _runs(client: TestClient, me: dict[str, str], task_id: str) -> list[dict]:  # noqa: F811
    return client.get(f"/api/v1/data/task_runs?task_id={task_id}", headers=me).json()["rows"]


@needs_db
def test_a_save_from_any_client_keeps_when_it_is_due_and_a_delete_forgets_it(client: TestClient, me: dict[str, str]):  # noqa: F811
    t1 = _task(client, me, "t1", "Stretch", {"trigger": {"type": "recurring", "repeat": "hours", "every": 1}})
    _task(client, me, "t2", "Manual", {"trigger": {"type": "manual"}})
    due = _schedules(client, me)
    assert list(due) == [t1]
    assert datetime.fromisoformat(due[t1]) > datetime.now(UTC) + timedelta(minutes=59)
    # Made manual: no longer scheduled. Scheduled again, run, then deleted: its schedule and
    # its runs go with it.
    _task(client, me, "t1", "Stretch", {"trigger": {"type": "manual"}})
    assert _schedules(client, me) == {}
    _task(client, me, "t1", "Stretch", {"trigger": {"type": "recurring", "repeat": "hours", "every": 1}})
    client.portal.call(task_runner.run_task, client.app.state, me["X-Test-User"], t1, "manual")
    assert len(_runs(client, me, t1)) == 1
    assert client.delete(f"/api/v1/tasks/{t1}", headers=me).status_code == 204
    assert _schedules(client, me) == {} and _runs(client, me, t1) == []


@needs_db
def test_a_due_reminder_is_posted_to_activity_and_recorded_then_done(client: TestClient, me: dict[str, str], monkeypatch):  # noqa: F811
    at = (datetime.now(UTC) + timedelta(hours=1)).isoformat()
    milk = _task(client, me, "milk", "Buy milk", {"prompt": "Go **buy milk**.", "trigger": {"type": "once", "at": at}})
    assert list(_schedules(client, me)) == [milk]
    _due_now(client, me, milk)
    assert _run_due(client) == 1
    note = _notes(client, me)[0]
    assert (note["title"], note["body"], note["agent"]) == ("Buy milk", "Go **buy milk**.", None)
    run = _runs(client, me, milk)[0]
    assert (run["status"], run["trigger"], run["output"], run["error"]) == ("succeeded", "schedule", "Go **buy milk**.", None)
    # Run before its time (run_task): the timer still stands.
    assert datetime.fromisoformat(_schedules(client, me)[milk]) == datetime.fromisoformat(at)
    # Run at its time: a timer runs once, so it is no longer scheduled.
    later = datetime.now(UTC) + timedelta(hours=2)
    monkeypatch.setattr(task_runner, "_now", lambda: later)
    client.portal.call(task_runner.run_task, client.app.state, me["X-Test-User"], milk)
    monkeypatch.undo()
    assert _schedules(client, me) == {}
    # Nothing due: nothing run.
    assert _run_due(client) == 0


@needs_db
def test_a_tasks_steps_run_as_agent_tools_and_what_they_return_is_posted(client: TestClient, me: dict[str, str], monkeypatch):  # noqa: F811
    _skill(client, me, "plain", PLAIN)
    wysebee = _agent(client, me, "wysebee", {"label": "Wysebee", "skills": ["plain"]})
    # A step's agent is kept by id: one deleted since says so.
    gone = _agent(client, me, "gone", {"label": "Gone"})
    assert client.delete(f"/api/v1/agents/{gone}", headers=me).status_code == 204
    steps = [
        {"agent_id": wysebee, "tool": "load_skill", "arguments": {"name": "plain"}},
        {"agent_id": wysebee, "tool": "gone_tool"},
        {"agent_id": gone, "tool": "x"},
        {"agent_id": 3, "tool": "x"},
        {"agent_id": wysebee, "tool": "load_skill", "arguments": "not an object"},
    ]
    daily = _task(client, me, "daily", "Morning check", {"prompt": "Every morning.", "steps": steps, "trigger": {"type": "recurring", "repeat": "hours", "every": 1}})
    _due_now(client, me, daily)
    before = client.get("/api/v1/tool-calls", headers=me).json()["count"]
    assert _run_due(client) == 1
    note = _notes(client, me)[0]
    assert note["agent"] == "wysebee" and note["body"].startswith("Every morning.\n\n**@wysebee · load_skill**\n\n")
    assert "**@wysebee · gone_tool** — failed\n\n@wysebee has no tool named gone_tool now." in note["body"]
    assert note["body"].count("@(deleted agent) · x** — failed\n\nThe person has no such agent any more.") == 2
    run = _runs(client, me, daily)[0]
    assert (run["status"], run["agent_id"], run["error"]) == ("failed", wysebee, "A step failed.")
    # Each step answered is a credit: the last named no skill, so it failed and costs nothing.
    assert client.get("/api/v1/tool-calls", headers=me).json()["count"] == before + 1
    # Due again in an hour.
    assert datetime.fromisoformat(_schedules(client, me)[daily]) > datetime.now(UTC) + timedelta(minutes=59)

    # A step that returns pictures, one that never finishes, one that breaks; a long answer is cut.
    class Box:
        offered = {"shot", "slow", "broken", "long"}

        async def run(self, call):
            if call["name"] == "slow":
                await asyncio.sleep(5)
            if call["name"] == "broken":
                raise RuntimeError("boom")
            if call["name"] == "long":
                return Output("y" * 3000)
            return Output("Captured.", images=[{"media_type": "image/png", "data": "AA"}], shown=[{"media_type": "image/png", "data": "BB"}])

    async def box(*_args, **_kwargs):
        return Box()

    monkeypatch.setattr(cloud_tools, "toolbox", box)
    monkeypatch.setattr(client.app.state.settings, "mcp_call_wait_seconds", 0.05)
    shots = [{"agent_id": wysebee, "tool": t} for t in ("shot", "slow", "broken", "long")]
    shot_task = _task(client, me, "shots", "Shots", {"steps": shots, "trigger": {"type": "manual"}})
    client.portal.call(task_runner.run_task, client.app.state, me["X-Test-User"], shot_task, "manual")
    body = _notes(client, me)[0]["body"]
    assert "Captured.\n\n[2 pictures, not kept]" in body
    assert "**@wysebee · slow** — failed\n\nIt did not finish in time." in body
    assert "**@wysebee · broken** — failed\n\nThe tool failed in Wysebee Cloud." in body
    assert ("y" * 1999 + "…") in body and "y" * 2001 not in body
    assert _runs(client, me, shot_task)[0]["trigger"] == "manual"


@needs_db
def test_a_task_gone_or_failing_is_not_run_again_at_once_and_a_dead_claim_is_taken_again(client: TestClient, me: dict[str, str], monkeypatch):  # noqa: F811
    sub = me["X-Test-User"]
    # Deleted after it was claimed (its schedule went with it): nothing run, nothing posted.
    client.portal.call(task_runner.run_task, client.app.state, sub, _tid(me, "ghost"))
    client.portal.call(task_runner.run_task, client.app.state, sub, "not an id")
    assert _schedules(client, me) == {} and _notes(client, me) == []
    # Claimed by a replica that is still running it: left alone; one that died long ago: taken.
    t = _task(client, me, "t", "T", {"trigger": {"type": "recurring", "repeat": "hours", "every": 1}})
    _due_now(client, me, t, running_since=datetime.now(UTC))
    assert _run_due(client) == 0
    _due_now(client, me, t, running_since=datetime.now(UTC) - timedelta(hours=1))

    async def broken(state, user_id, task_id, how="schedule"):
        raise RuntimeError("boom")

    monkeypatch.setattr(task_runner, "run_task", broken)
    assert _run_due(client) == 1
    # Failed: tried again in five minutes, not at once.
    due = datetime.fromisoformat(_schedules(client, me)[t])
    assert timedelta(minutes=4) < due - datetime.now(UTC) < timedelta(minutes=6)

    # Its schedule gone by the time the failure is noted: nothing to put back.
    async def broken_and_forgotten(state, user_id, task_id, how="schedule"):
        async with state.db.sessionmaker() as session:
            await task_runner.forget(session, user_id, task_id)
            await session.commit()
        raise RuntimeError("boom")

    monkeypatch.setattr(task_runner, "run_task", broken_and_forgotten)
    _due_now(client, me, t)
    assert _run_due(client) == 1
    assert _schedules(client, me) == {}
    assert sub  # the person's own rows only


@needs_db
def test_wysebee_assistant_sets_up_lists_runs_and_deletes_tasks(client: TestClient, me: dict[str, str]):  # noqa: F811
    auth = _signed(client, me)
    call = lambda tool, args: _call(client, auth, tool, args)  # noqa: E731
    text = lambda result: result["content"][0]["text"]  # noqa: E731
    assert text(call("list_tasks", {})) == "The person has no tasks yet."
    at = (datetime.now(UTC) + timedelta(minutes=2)).isoformat()
    made = call("save_task", {"name": " Buy milk ", "plan": "Go buy milk.", "schedule": {"type": "once", "at": at}})
    assert made["isError"] is False and text(made).startswith("Created the task:\n- Buy milk (id ")
    task_id = text(made).split("(id ")[1].split(")")[0]
    assert list(_schedules(client, me)) == [task_id]
    # Changing only its steps keeps its plan and schedule.
    _skill(client, me, "plain", PLAIN)
    _agent(client, me, "wysebee", {"label": "Wysebee", "skills": ["plain"]})
    changed = call("save_task", {"id": task_id, "steps": [{"agent": "@wysebee", "tool": "load_skill", "arguments": {"name": "plain"}}]})
    assert text(changed).startswith("Changed the task:\n- Buy milk") and "Plan: Go buy milk." in text(changed)
    assert 'Step: @wysebee · load_skill {"name": "plain"}' in text(changed)
    # Kept by id: a renamed agent keeps its step, listed under its new handle; deleted, it is said so.
    helper = _agent(client, me, "helper", {"label": "Helper", "skills": ["plain"]})
    other = call("save_task", {"name": "Other", "steps": [{"agent": "helper", "tool": "load_skill", "arguments": {"name": "plain"}}]})
    assert other["isError"] is False
    assert client.put(f"/api/v1/agents/{helper}", json={"name": "aide"}, headers=me).status_code == 200
    assert "Step: @aide · load_skill" in text(call("list_tasks", {}))
    assert client.delete(f"/api/v1/agents/{helper}", headers=me).status_code == 204
    assert "Step: @(deleted agent) · load_skill" in text(call("list_tasks", {}))
    assert call("delete_task", {"id": text(other).split("(id ")[1].split(")")[0]})["isError"] is False
    # A manual one, and the list.
    assert call("save_task", {"name": "On demand"})["isError"] is False
    listed = text(call("list_tasks", {}))
    assert "- Buy milk (id " in listed and "once, at " in listed and "- On demand (id " in listed and "manual (only when run); next not scheduled." in listed
    # Run now: due at once, and run on the next tick.
    assert text(call("run_task", {"id": task_id})) == "Buy milk runs now: its result shows on the person's Activity page within half a minute."
    assert _run_due(client) == 1
    assert _notes(client, me)[0]["title"] == "Buy milk"
    # Deleted: gone from the list, and no longer due.
    assert text(call("delete_task", {"id": task_id})) == "Deleted Buy milk."
    assert "Buy milk" not in text(call("list_tasks", {}))
    for tool in ("run_task", "delete_task"):
        assert call(tool, {"id": task_id}) == {"content": [{"type": "text", "text": "No such task: list_tasks gives their ids."}], "isError": True}
    assert call("delete_task", {})["isError"] is True


@needs_db
def test_a_task_that_is_not_one_is_refused(client: TestClient, me: dict[str, str]):  # noqa: F811
    auth = _signed(client, me)
    _agent(client, me, "wysebee", {"label": "Wysebee"})
    _agent(client, me, "off", {"label": "Off"})
    client.put("/api/v1/mcp/agents/off", json={"exposed": False}, headers=me)
    for args, said in [
        ({"id": "nope", "name": "x"}, "No such task: list_tasks gives their ids, or leave 'id' out to create one."),
        ({}, "Give the task a 'name' of 1 to 200 characters."),
        ({"name": "x" * 201}, "Give the task a 'name' of 1 to 200 characters."),
        ({"name": "x", "plan": 3}, "'plan' is text of at most 50000 characters."),
        ({"name": "x", "schedule": "daily"}, "'schedule' must be an object."),
        ({"name": "x", "steps": "all"}, "'steps' is a list of at most 10."),
        ({"name": "x", "steps": [{"agent": "wysebee"}] * 11}, "'steps' is a list of at most 10."),
        ({"name": "x", "steps": [{"agent": "wysebee"}]}, "Step 1 needs 'agent' and 'tool'."),
        ({"name": "x", "steps": [{"agent": "off", "tool": "t"}]}, "Step 1: the person has no agent @off for AI apps (list_agents names them)."),
        ({"name": "x", "steps": [{"agent": "wysebee", "tool": "nothing"}]}, "Step 1: @wysebee has no tool named nothing (list_agent_tools lists them)."),
    ]:
        assert _call(client, auth, "save_task", args) == {"content": [{"type": "text", "text": said}], "isError": True}, args
    # A name another task has.
    assert _call(client, auth, "save_task", {"name": "Same"})["isError"] is False
    clash = _call(client, auth, "save_task", {"name": "Same"})
    assert clash == {"content": [{"type": "text", "text": "A task named 'Same' already exists."}], "isError": True}


@needs_db
def test_a_steps_arguments_must_be_an_object(client: TestClient, me: dict[str, str]):  # noqa: F811
    auth = _signed(client, me)
    _skill(client, me, "plain", PLAIN)
    _agent(client, me, "wysebee", {"label": "Wysebee", "skills": ["plain"]})
    bad = _call(client, auth, "save_task", {"name": "x", "steps": [{"agent": "wysebee", "tool": "load_skill", "arguments": "plain"}]})
    assert bad == {"content": [{"type": "text", "text": "Step 1: 'arguments' must be an object."}], "isError": True}
