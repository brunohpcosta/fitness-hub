#!/usr/bin/env python3
"""
Build test fixtures from the LOCAL D1 copy.

Real data, not invented data — the point is to render against the shapes that
actually come back, including the awkward ones: days with no weigh-in, months
where the scale barely recorded, targets that fall back to the general block.
A fixture that is too tidy tests nothing.

Writes JSON to stdout.
"""
import glob
import json
import os
import sqlite3
import sys

# Located relative to this file, not to $HOME. The hardcoded ~/Documents path
# resolved only on one machine; anywhere else the suite reported "no database"
# when the database was sitting right there.
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
STATE = os.path.join(
    REPO, "fitness-hub-api", ".wrangler", "state", "v3", "d1", "miniflare-D1DatabaseObject"
)
matches = [p for p in glob.glob(os.path.join(STATE, "*.sqlite")) if "metadata" not in p]
if not matches:
    sys.exit(f"No local D1 database found under {STATE}. Run `npx wrangler d1 migrations apply "
             f"fitness-hub-db --local` first.")

con = sqlite3.connect(f"file:{matches[0]}?mode=ro", uri=True)
con.row_factory = sqlite3.Row
q = lambda s, *a: [dict(r) for r in con.execute(s, a).fetchall()]

TODAY = q("SELECT MAX(local_date) d FROM v_daily")[0]["d"]

plan = q("SELECT * FROM plan_sessions WHERE deleted_at IS NULL ORDER BY local_date")
ex = q("SELECT * FROM plan_exercises WHERE deleted_at IS NULL ORDER BY local_date, ord")
by_date = {}
for e in ex:
    by_date.setdefault(e["local_date"], []).append(e)

for p in plan:
    p["exercises"] = by_date.get(p["local_date"], [])
    p["day_type"] = "rest" if p["is_rest"] else "training"
    t = q("""SELECT * FROM nutrition_targets
              WHERE ? >= effective_from AND (effective_to IS NULL OR ? <= effective_to)
              ORDER BY day_type LIMIT 1""", p["local_date"], p["local_date"])
    p["targets"] = t[0] if t else None

goals = q("SELECT * FROM goals WHERE active = 1 ORDER BY sort_order")
for g in goals:
    # Mirrors what /api/goals computes, including the tracked-only state.
    g["current_value"] = None if g["target_value"] is None else 12.3
    g["progress_pct"] = None if g["target_value"] is None else 61.0
    g["state"] = "tracked_only" if g["target_value"] is None else "ok"
    g["sample"], g["sample_unit"], g["confidence"] = 7, "days", None

# The settings the Worker exposes on /api/today, read from the database rather
# than typed out here.
#
# This list was previously a hardcoded stub with three keys in it. When the
# body-fat calibration was added the Worker started returning four more, the
# stub was not updated, and the fixture went on describing a world that no
# longer existed — so normLean() had no conversion factor and the test that
# exists specifically to prove lean is derived from converted fat was failing
# for a reason that had nothing to do with lean mass.
#
# Keep this in step with the `settings:` block in fitness-hub-api/src/index.js.
# test/render-assert.js checks that it is.
EXPOSED_SETTINGS = [
    "maintenance_kcal_estimate",
    "maintenance_basis",
    "goal_weight_kg",
    "taper_starts",
    "targets_review_due",
    "bf_zepp_to_withings_factor",
    "bf_calibration_anchor_zepp",
    "bf_calibration_ci_points",
    "body_fat_reference_device",
]
all_settings = {r["key"]: r["value"] for r in q("SELECT key, value FROM settings")}
settings = {k: all_settings.get(k) for k in EXPOSED_SETTINGS}

today_row = q("SELECT * FROM v_daily WHERE local_date <= ? ORDER BY local_date DESC LIMIT 1", TODAY)
targets = q("SELECT * FROM nutrition_targets WHERE day_type='training' ORDER BY effective_from DESC LIMIT 1")
intake = q("SELECT * FROM v_daily_intake ORDER BY local_date DESC LIMIT 1")

print(json.dumps({
    "today": {
        "ok": True, "date": TODAY, "is_today": True,
        "plan": plan[0] if plan else None,
        "day_type": "training",
        "actual": today_row[0] if today_row else None,
        "targets": dict(targets[0], fell_back=0) if targets else None,
        "intake": intake[0] if intake else None,
        "body_composition": q("""SELECT metric, device, rolling_avg, readings, confidence
                                 FROM v_body_composition ORDER BY local_date DESC LIMIT 4"""),
        "race": {"date": "2026-08-22", "label": "Solo 42.195 km", "distance_km": 42.195,
                 "target_minutes": 240, "fuel_g_per_hour": 65, "gel_carbs_g": 23.5, "days_to": 10},
        "freshness": {"status": "ok", "hours_since": 2, "last_sync": "2026-08-12 09:41:54"},
        "settings": settings,
    },
    "plan": plan,
    "runs": q("SELECT * FROM v_run_readiness WHERE local_date >= '2026-05-01' ORDER BY local_date DESC"),
    "days": q("SELECT * FROM v_daily WHERE local_date >= '2026-02-01' ORDER BY local_date DESC"),
    "goals": goals,
    "spike": {"longest_km": 23.02, "longest_date": "2026-08-01", "window_opens": "2026-07-23",
              "race_km": 42.195, "increase_pct": 83.3},
}, default=str))
