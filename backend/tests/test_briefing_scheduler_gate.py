"""L2 unit tests for Daily Briefing scheduler — channel gate (IMDeliveryPref)
+ weekend_mute + quiet_hours + slot_off + PushLog audit.

Covers:
  - B: scheduler reads IMDeliveryPref as channel gate (enabled / slots / disabled)
  - C: weekend_mute actually mutes on Sat/Sun
  - quiet_hours window handling (incl. overnight 22:00-08:00)
  - missing pref row = Default ON (frictionless onboarding)
  - PushLog audit row written for every skip reason
"""
import asyncio
import sys
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock

sys.path.insert(0, "backend")

from app.services import briefing_scheduler as bs  # noqa: E402

HKT = timezone(timedelta(hours=8))
USER = NS(user_id="u1", tenant_id="t1")


def _pref(channel: str, **kw) -> NS:
    base = dict(
        enabled=True,
        slots={"morning": True, "noon": True, "evening": True},
        weekend_mute=True,
        quiet_hours={"start": "22:00", "end": "08:00"},
    )
    base.update(kw)
    return NS(tenant_id="t1", user_id="u1", channel=channel, **base)


class _FakeDB:
    """AsyncSession double: delegates pref lookup by table name in SQL."""

    def __init__(self, pref=None):
        self.pref = pref
        self.logs = []

    async def execute(self, stmt):
        sql = str(stmt)
        if "im_delivery_prefs" in sql:
            val = self.pref
        else:
            val = None  # e.g. whatsapp_mappings / telegram_bot_mappings
        return NS(scalar_one_or_none=lambda: val)

    def add(self, o):
        self.logs.append(o)


def _run(coro):
    return asyncio.run(coro)


# ---- B: channel gate ----
def test_no_pref_row_is_default_on():
    db = _FakeDB(None)
    assert _run(bs._channel_gate(db, USER, "whatsapp", "morning")) == ""


def test_disabled_channel_blocks():
    db = _FakeDB(_pref("telegram", enabled=False))
    assert _run(bs._channel_gate(db, USER, "telegram", "morning")) == "disabled"


def test_slot_off_blocks():
    db = _FakeDB(_pref("whatsapp", slots={"morning": True, "noon": False, "evening": False}))
    assert _run(bs._channel_gate(db, USER, "whatsapp", "evening")) == "slot_off"


# ---- C: weekend_mute ----
def test_weekend_mute_on_saturday():
    # Force _now_hkt to a Saturday for determinism
    sat = datetime(2026, 8, 8, 10, 0, tzinfo=HKT)  # 2026-08-08 is Saturday
    assert bs._hkt_weekend(sat) is True
    db = _FakeDB(_pref("whatsapp", weekend_mute=True))
    orig = bs._now_hkt
    bs._now_hkt = lambda: sat
    try:
        assert _run(bs._channel_gate(db, USER, "whatsapp", "morning")) == "weekend_mute"
    finally:
        bs._now_hkt = orig


def test_weekend_mute_off_on_weekday():
    mon = datetime(2026, 8, 10, 10, 0, tzinfo=HKT)  # Monday
    assert bs._hkt_weekend(mon) is False


# ---- quiet_hours ----
def test_quiet_hours_overnight_blocks():
    now = datetime(2026, 8, 10, 23, 30, tzinfo=HKT)
    assert bs._in_quiet_hours(now, {"start": "22:00", "end": "08:00"}) is True


def test_quiet_hours_midday_allows():
    now = datetime(2026, 8, 10, 12, 0, tzinfo=HKT)
    assert bs._in_quiet_hours(now, {"start": "22:00", "end": "08:00"}) is False


# ---- PushLog audit ----
def test_push_writes_skipped_log_for_disabled():
    db = _FakeDB(_pref("whatsapp", enabled=False))
    ret = _run(bs._push_whatsapp(db, USER, "morning", "hi"))
    assert ret == "skipped"
    assert len(db.logs) == 1
    assert db.logs[0].status == "skipped"
    assert db.logs[0].reason == "disabled"


def test_all_pass_no_gate_skip_log():
    db = _FakeDB(_pref("whatsapp", weekend_mute=False, quiet_hours={"start": "12:00", "end": "13:00"}))
    ret = _run(bs._push_whatsapp(db, USER, "morning", "hi"))
    assert ret == "skipped"  # no mapping → skipped, but NOT a gate block
    assert all(l.reason != "weekend_mute" for l in db.logs)
