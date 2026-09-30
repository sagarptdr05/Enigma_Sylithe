"""Supply allocation LP (OR-Tools GLOP): maximise savings + carbon value under supply/demand limits."""
from collections import defaultdict

from ortools.linear_solver import pywraplp


def optimize(matches: list[dict], carbon_price: float = 0.0) -> dict:
    solver = pywraplp.Solver.CreateSolver("GLOP")
    if solver is None or not matches:
        return {"status": "empty", "allocations": [], "total_saving_per_year": 0, "total_co2_per_year": 0,
                "total_tonnes_per_year": 0}
    x, by_ws, by_dm = {}, defaultdict(list), defaultdict(list)
    supply, demand = {}, {}
    for i, m in enumerate(matches):
        x[i] = solver.NumVar(0, solver.infinity(), f"x{i}")
        by_ws[m["waste_stream_id"]].append(i)
        by_dm[m["demand_id"]].append(i)
        supply[m["waste_stream_id"]] = m["supply"]
        demand[m["demand_id"]] = m["demand"]
    for ws, idx in by_ws.items():
        solver.Add(sum(x[i] for i in idx) <= supply[ws])
    for dm, idx in by_dm.items():
        solver.Add(sum(x[i] for i in idx) <= demand[dm])
    value = {i: m["saving_per_tonne"] + carbon_price * m["co2_per_tonne"] for i, m in enumerate(matches)}
    solver.Maximize(sum(x[i] * value[i] for i in x))
    status = solver.Solve()
    if status not in (pywraplp.Solver.OPTIMAL, pywraplp.Solver.FEASIBLE):
        return {"status": "infeasible", "allocations": [], "total_saving_per_year": 0, "total_co2_per_year": 0,
                "total_tonnes_per_year": 0}
    allocs = []
    for i, m in enumerate(matches):
        t = x[i].solution_value()
        if t < 1e-6:
            continue
        allocs.append({
            "match_id": m.get("id"), "waste_stream_id": m["waste_stream_id"], "demand_id": m["demand_id"],
            "src_id": m["src_id"], "dst_id": m["dst_id"], "waste_name": m["waste_name"], "material": m["material"],
            "monthly_tonnes": round(t, 1), "saving_per_year": round(t * 12 * value[i]),
            "co2_per_year": round(t * 12 * m["co2_per_tonne"], 1), "score": m["score"],
        })
    allocs.sort(key=lambda a: a["saving_per_year"], reverse=True)
    return {
        "status": "optimal", "allocations": allocs,
        "total_saving_per_year": round(sum(a["saving_per_year"] for a in allocs)),
        "total_co2_per_year": round(sum(a["co2_per_year"] for a in allocs), 1),
        "total_tonnes_per_year": round(sum(a["monthly_tonnes"] for a in allocs) * 12, 1),
    }
