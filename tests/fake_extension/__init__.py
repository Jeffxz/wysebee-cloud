"""An extension for the tests (tests/test_extensions.py): a policy that refuses what a person's
``user_id`` says it should, a Billing page, and one table of its own, migrated apart."""

from pathlib import Path

from fastapi import APIRouter

from apps.cloud.extensions import API, Extension, Policy, Refusal

router = APIRouter()


@router.get("/v1/plan")
async def plan() -> dict:
    return {"allowed": True}


class Refusing(Policy):
    """Refuses a person whose id contains the step's name: ``no-use``, ``no-pair``, ``no-call``."""

    async def may_use(self, session, user_id):
        return Refusal(402, "no_plan", "Choose a plan.", {"billing_url": "/billing"}) if "no-use" in user_id else None

    async def may_pair(self, session, user_id):
        return Refusal(402, "device_limit", "Too many devices.") if "no-pair" in user_id else None

    async def may_call(self, session, user_id, link_id, now):
        return Refusal(402, "relay_limit", f"No more calls to {link_id}.") if "no-call" in user_id else None


def register(settings) -> Extension:
    return Extension(
        "tests.fake_extension", API, policy=Refusing(), routers=[router],
        migrations=Path(__file__).parent / "migrations", web_features={"billing": True},
    )
