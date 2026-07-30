"""03:00 Daily Summary cron — creates a new AI session with today's tasks + meetings.
Runs directly against PG, no auth needed.
"""
import asyncio, asyncpg, os, sys
from datetime import datetime, timezone

DB_DSN = os.environ.get(
    "NEXUS_DATABASE_URL",
    "postgresql://gg_fighter:F5xbTAzODUVEU4KDDIP@127.0.0.1:5432/nexus_crm"
)
TENANT_ID = "00000000-0000-0000-0000-000000000001"
USER_ID = "f4f97d5f-d595-4c0b-8752-47ebfbaf314d"

async def main():
    conn = await asyncpg.connect(DB_DSN)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    tid = TENANT_ID

    # ── Fetch tasks due today ──
    tasks = await conn.fetch(
        """SELECT title, priority, status FROM nexus_crm.tasks
           WHERE tenant_id=$1 AND due_date=CURRENT_DATE
           ORDER BY CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END""",
        tid
    )

    # ── Fetch touchpoints (meetings) today ──
    tps = await conn.fetch(
        """SELECT tp.title, tp.type, c.name AS contact_name
           FROM nexus_crm.touchpoints tp
           LEFT JOIN nexus_crm.contacts c ON c.id = tp.contact_id
           WHERE tp.tenant_id=$1 AND tp.date::date=CURRENT_DATE
           ORDER BY tp.date""",
        tid
    )

    # ── Build summary ──
    lines = [f"📋 今日摘要 · {today}", ""]

    lines.append("📌 Daily Tasks")
    if tasks:
        for r in tasks:
            lines.append(f"  [{r['priority'] or 'P3'}] {r['title']} ({r['status']})")
    else:
        lines.append("  (今日無任務)")
    lines.append("")

    lines.append("📅 Daily Meetings")
    if tps:
        for r in tps:
            cname = f" ({r['contact_name']})" if r['contact_name'] else ""
            lines.append(f"  [{r['type']}] {r['title']}{cname}")
    else:
        lines.append("  (今日無會議)")
    lines.append("")

    lines.append("💡 AI generated summary — 03:00 daily auto-report")
    summary = "\n".join(lines)

    # ── Create session ──
    session_id = await conn.fetchval(
        """INSERT INTO nexus_ai.sessions (tenant_id, workspace_id, team_id, user_id, plan_type, status, title, created_at)
           VALUES ($1, NULL, NULL, $2, 'chat', 'active', $3, NOW())
           RETURNING id""",
        tid, USER_ID, f"Daily Summary · {today}"
    )

    # ── Insert assistant message ──
    await conn.execute(
        """INSERT INTO nexus_ai.messages (session_id, role, content, tool_calls, token_count, created_at)
           VALUES ($1, 'assistant', $2, '{}'::jsonb, 0, NOW())""",
        session_id, summary
    )

    print(f"SESSION_ID:{session_id}")
    print(summary)

    await conn.close()

asyncio.run(main())
