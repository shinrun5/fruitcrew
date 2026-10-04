"""
General CP-SAT scheduling engine.

This is the productionised, data-driven version of scheduler_real.py: instead of a
hard-coded roster it takes a JSON payload (see solve()'s docstring / the FastAPI
schemas in service.py) and returns assignments + a list of coverage gaps.

The one-off personal rules from the prototype (Rey Sat-xor-Sun, Owen night-only,
Mysha cap, ...) are intentionally dropped here -- they have no home in the DB yet.
What stays is the general structure: per-store/day demand windows with a headcount,
a senior minimum, an opener requirement, and a "may NEW-tier people fill this" flag.
"""

from ortools.sat.python import cp_model

TIER = {"NEW": 0, "REGULAR": 1, "SENIOR": 2, "MANAGER": 3}
DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]

# default grace: how many minutes after a slot's start availability may begin and still
# count. Per-requirement `graceMinutes` overrides this (night shifts allow a late arrival).
GRACE_MIN = 0

# objective weights
W_SHORT = 1000   # an unfilled head / senior / opener requirement
W_OVER = 30      # staffing a slot beyond its headcount
W_SPREAD = 8     # gap between the busiest and least-busy employee
W_CROSS = 50     # sending someone to a store that isn't their primary (yields to any shortage)
W_CONTINUITY = 15  # BONUS for one person covering adjacent slots (a full day > a split)
# Under a person's weekly target, per hour: 2. Kept below W_OVER / 12h so even
# a 12-hour shift's worth of target can't pay for staffing a slot past its
# headcount -- targets steer who gets the work, they never create extra work.
# The objective is scaled by OBJ_SCALE so this can be counted in whole minutes
# (2/hour * 30 / 60 min = 1 per minute short).
OBJ_SCALE = 30
W_UNDER_PER_MIN = 1


def _to_min(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def solve(payload: dict) -> dict:
    """
    payload = {
      "solveSeconds": 5.0,
      "employees": [
        {"id": 1, "name": "J-", "hourLimit": 40, "maxShifts": 6,
         "stores": [{"storeId": 1, "tier": "REGULAR", "canOpen": false}]}
      ],
      "availability": [
        {"employeeId": 1, "day": "MONDAY", "start": "16:30", "end": "23:30"}
      ],
      "requirements": [
        {"id": 10, "storeId": 1, "day": "MONDAY", "start": "11:30", "end": "17:00",
         "head": 1, "seniorMin": 0, "needOpen": true, "allowNew": false}
      ]
    }
    """
    solve_seconds = float(payload.get("solveSeconds", 5.0))
    employees = payload["employees"]
    availability = payload.get("availability", [])
    requirements = payload["requirements"]

    # (empId, storeId) -> {"tier", "canOpen"}
    emp_store: dict[tuple[int, int], dict] = {}
    for e in employees:
        for s in e.get("stores", []):
            emp_store[(e["id"], s["storeId"])] = {
                "tier": s.get("tier", "REGULAR"),
                "canOpen": bool(s.get("canOpen", False)),
                "primary": bool(s.get("primary", True)),
            }

    # (empId, day) -> list[(startMin, endMin)]
    avail: dict[tuple[int, str], list[tuple[int, int]]] = {}
    for a in availability:
        avail.setdefault((a["employeeId"], a["day"]), []).append(
            (_to_min(a["start"]), _to_min(a["end"]))
        )

    def covers(emp_id: int, day: str, lo: int, hi: int, grace: int) -> bool:
        for a, b in avail.get((emp_id, day), []):
            if a <= lo + grace and b >= hi:
                return True
        return False

    reqs = []
    for r in requirements:
        reqs.append({
            "id": r["id"],
            "storeId": r["storeId"],
            "day": r["day"],
            "lo": _to_min(r["start"]),
            "hi": _to_min(r["end"]),
            "head": int(r.get("head", 1)),
            "seniorMin": int(r.get("seniorMin", 0)),
            "needOpen": bool(r.get("needOpen", False)),
            "allowNew": bool(r.get("allowNew", True)),
            "pairNew": bool(r.get("pairNew", False)),
            "grace": int(r.get("graceMinutes", GRACE_MIN)),
            "noBackToBack": bool(r.get("noBackToBack", False)),
        })

    model = cp_model.CpModel()
    x: dict[tuple[int, int], cp_model.IntVar] = {}   # (empId, reqId) -> BoolVar
    elig_by_req: dict[int, list[int]] = {}

    for r in reqs:
        elig: list[int] = []
        for e in employees:
            es = emp_store.get((e["id"], r["storeId"]))
            if not es:
                continue
            if es["tier"] == "NEW" and not r["allowNew"]:
                continue
            if not covers(e["id"], r["day"], r["lo"], r["hi"], r["grace"]):
                continue
            x[(e["id"], r["id"])] = model.NewBoolVar(f"x_{e['id']}_{r['id']}")
            elig.append(e["id"])
        elig_by_req[r["id"]] = elig

    # assignments that send someone to a non-primary store (soft-discouraged)
    cross_store = [
        x[(eid, r["id"])]
        for r in reqs
        for eid in elig_by_req[r["id"]]
        if not emp_store[(eid, r["storeId"])]["primary"]
    ]

    # continuity: reward the same person covering back-to-back slots at a store/day
    # (one long shift reads cleaner than a morning + a night handed to two people)
    reqs_by_store_day: dict[tuple[int, str], list[dict]] = {}
    for r in reqs:
        reqs_by_store_day.setdefault((r["storeId"], r["day"]), []).append(r)
    continuity: list[cp_model.IntVar] = []
    for slots in reqs_by_store_day.values():
        slots.sort(key=lambda r: r["lo"])
        if any(r["noBackToBack"] for r in slots):
            # "no back-to-back" day: each person takes at most one of the day's
            # windows here -- a hard rule, so too few people means a gap rather
            # than someone covering two (and no continuity bonus to chase)
            for e in employees:
                mine = [x[(e["id"], r["id"])] for r in slots if (e["id"], r["id"]) in x]
                if len(mine) > 1:
                    model.Add(sum(mine) <= 1)
            continue
        for a, b in zip(slots, slots[1:]):
            if a["hi"] != b["lo"]:
                continue  # not adjacent
            for eid in elig_by_req[a["id"]]:
                if eid not in elig_by_req[b["id"]]:
                    continue
                both = model.NewBoolVar(f"cont_{eid}_{a['id']}_{b['id']}")
                model.Add(both <= x[(eid, a["id"])])
                model.Add(both <= x[(eid, b["id"])])
                model.Add(both >= x[(eid, a["id"])] + x[(eid, b["id"])] - 1)
                continuity.append(both)

    shortages: list[cp_model.IntVar] = []
    overs: list[cp_model.IntVar] = []
    gaps_meta: list[tuple[int, str, cp_model.IntVar]] = []

    for r in reqs:
        rid = r["id"]
        present = [x[(eid, rid)] for eid in elig_by_req[rid]]

        s = model.NewIntVar(0, r["head"], f"short_{rid}_head")
        model.Add(sum(present) + s >= r["head"])
        shortages.append(s)
        gaps_meta.append((rid, "head", s))

        if present:
            ov = model.NewIntVar(0, len(present), f"over_{rid}")
            model.Add(sum(present) - ov <= r["head"])
            overs.append(ov)

        if r["seniorMin"]:
            srp = [x[(eid, rid)] for eid in elig_by_req[rid]
                   if TIER[emp_store[(eid, r["storeId"])]["tier"]] >= TIER["SENIOR"]]
            ss = model.NewIntVar(0, r["seniorMin"], f"short_{rid}_sr")
            model.Add(sum(srp) + ss >= r["seniorMin"])
            shortages.append(ss)
            gaps_meta.append((rid, "senior", ss))

        if r["needOpen"]:
            opp = [x[(eid, rid)] for eid in elig_by_req[rid]
                   if emp_store[(eid, r["storeId"])]["canOpen"]]
            oo = model.NewIntVar(0, 1, f"short_{rid}_open")
            model.Add(sum(opp) + oo >= 1)
            shortages.append(oo)
            gaps_meta.append((rid, "open", oo))

        # a NEW worker is never solo on this window: if any NEW is assigned,
        # at least one REGULAR-or-above must be on the same window. Hard, but
        # never makes the solve infeasible -- the solver can just not assign
        # the NEW person (NEW fills are optional, gated by allowNew).
        if r["pairNew"]:
            new_p = [x[(eid, rid)] for eid in elig_by_req[rid]
                     if emp_store[(eid, r["storeId"])]["tier"] == "NEW"]
            exp_p = [x[(eid, rid)] for eid in elig_by_req[rid]
                     if TIER[emp_store[(eid, r["storeId"])]["tier"]] >= TIER["REGULAR"]]
            if new_p:
                any_new = model.NewBoolVar(f"anynew_{rid}")
                model.AddMaxEquality(any_new, new_p)
                model.Add(sum(exp_p) >= any_new)

    # one place at a time: an employee can't hold two requirements whose windows
    # overlap on the same day (covers cross-store double-booking too).
    for i in range(len(reqs)):
        for j in range(i + 1, len(reqs)):
            a, b = reqs[i], reqs[j]
            if a["day"] != b["day"]:
                continue
            if max(a["lo"], b["lo"]) < min(a["hi"], b["hi"]):
                for e in employees:
                    va = x.get((e["id"], a["id"]))
                    vb = x.get((e["id"], b["id"]))
                    if va is not None and vb is not None:
                        model.Add(va + vb <= 1)

    dur = {r["id"]: r["hi"] - r["lo"] for r in reqs}
    req_day = {r["id"]: r["day"] for r in reqs}

    shift_counts: list[cp_model.IntVar] = []
    unders: list[cp_model.IntVar] = []  # minutes each person is short of their target
    for e in employees:
        mine = [(rid, v) for (eid, rid), v in x.items() if eid == e["id"]]
        if not mine:
            sc = model.NewIntVar(0, 0, f"count_{e['id']}")
            shift_counts.append(sc)
            continue

        hour_limit = e.get("hourLimit")
        if hour_limit:
            model.Add(sum(dur[rid] * v for rid, v in mine) <= int(hour_limit) * 60)

        target = e.get("targetHours")
        if target:
            u = model.NewIntVar(0, int(target) * 60, f"under_{e['id']}")
            model.Add(u >= int(target) * 60 - sum(dur[rid] * v for rid, v in mine))
            unders.append(u)

        worked = {}
        for d in DAYS:
            dv = [v for rid, v in mine if req_day[rid] == d]
            w = model.NewBoolVar(f"worked_{e['id']}_{d}")
            if dv:
                model.AddMaxEquality(w, dv)
            else:
                model.Add(w == 0)
            worked[d] = w

        # "one of these days only": at most one day per either/or group
        for group in e.get("eitherOr", []) or []:
            in_group = [worked[d] for d in group if d in worked]
            if len(in_group) > 1:
                model.Add(sum(in_group) <= 1)

        # "no back-to-back days": no two adjacent days in the Mon..Sun week
        if e.get("noConsecutive"):
            for a, b in zip(DAYS, DAYS[1:]):
                model.Add(worked[a] + worked[b] <= 1)

        # "whole days only": for each store/day, either every requirement window
        # that day goes to this person or none do -- never a partial/split day.
        # If they're not even eligible (availability/tier) for every window a
        # day has, they can't cover the whole thing, so they get none of it.
        if e.get("fullDayOnly"):
            for slots in reqs_by_store_day.values():
                group_vars = []
                all_eligible = True
                for r in slots:
                    v = x.get((e["id"], r["id"]))
                    if v is None:
                        all_eligible = False
                    else:
                        group_vars.append(v)
                if not group_vars:
                    continue
                if not all_eligible:
                    for v in group_vars:
                        model.Add(v == 0)
                else:
                    for a, b in zip(group_vars, group_vars[1:]):
                        model.Add(a == b)

        sc = model.NewIntVar(0, len(DAYS), f"count_{e['id']}")
        model.Add(sc == sum(worked.values()))
        max_shifts = e.get("maxShifts")
        if max_shifts:
            model.Add(sc <= int(max_shifts))
        shift_counts.append(sc)

    spread = model.NewIntVar(0, len(DAYS), "spread")
    if shift_counts:
        mx = model.NewIntVar(0, len(DAYS), "mx")
        mn = model.NewIntVar(0, len(DAYS), "mn")
        model.AddMaxEquality(mx, shift_counts)
        model.AddMinEquality(mn, shift_counts)
        model.Add(spread == mx - mn)
    else:
        model.Add(spread == 0)

    model.Minimize(
        OBJ_SCALE * (
            W_SHORT * sum(shortages)
            + W_OVER * sum(overs)
            + W_SPREAD * spread
            + W_CROSS * sum(cross_store)
            - W_CONTINUITY * sum(continuity)
        )
        + W_UNDER_PER_MIN * sum(unders)
    )

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = solve_seconds
    status = solver.Solve(model)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return {
            "feasible": False,
            "optimal": False,
            "objective": None,
            "assignments": [],
            "gaps": [],
            "stats": {},
        }

    assignments = [
        {"requirementId": rid, "employeeId": eid}
        for (eid, rid), v in x.items()
        if solver.Value(v) == 1
    ]

    gaps = []
    for rid, kind, var in gaps_meta:
        short_by = int(solver.Value(var))
        if short_by:
            gaps.append({"requirementId": rid, "kind": kind, "shortBy": short_by})

    stats = {
        "shiftsPerEmployee": {
            str(e["id"]): int(solver.Value(sc))
            for e, sc in zip(employees, shift_counts)
        },
        "spread": int(solver.Value(spread)),
        "unfilled": int(sum(solver.Value(s) for s in shortages)),
    }

    return {
        "feasible": True,
        "optimal": status == cp_model.OPTIMAL,
        "objective": solver.ObjectiveValue(),
        "assignments": assignments,
        "gaps": gaps,
        "stats": stats,
    }
