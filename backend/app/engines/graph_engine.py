"""Symbiosis graph: directed industry graph per cluster, closed loops and multi-hop chains."""
from itertools import islice

import networkx as nx

EDGE_MIN_SCORE = 50
MAX_CYCLES_SCANNED = 50000


def build_graph(matches: list[dict], industries: dict[int, dict], cluster: str | None = None) -> nx.DiGraph:
    """Edge A->B carries the best-scoring match from A to B (score >= 50)."""
    g = nx.DiGraph()
    members = {i: d for i, d in industries.items() if cluster is None or d["cluster"] == cluster}
    for i, d in members.items():
        g.add_node(i, **{k: d[k] for k in ("name", "type", "lat", "lon", "cluster")})
    for m in matches:
        a, b = m["src_id"], m["dst_id"]
        if a not in members or b not in members or m["score"] < EDGE_MIN_SCORE:
            continue
        if g.has_edge(a, b) and g[a][b]["score"] >= m["score"]:
            continue
        g.add_edge(a, b, match_id=m.get("id"), material=m["waste_name"], buyer_material=m["material"],
                   tonnes=m["tradable_tonnes"], saving=m["net_saving_per_year"], co2=m["co2_saved_per_year"],
                   score=m["score"], hidden_source=bool(members[a].get("hidden")), hidden_target=bool(members[b].get("hidden")))
    return g


def to_json(g: nx.DiGraph) -> dict:
    return {
        "nodes": [{"id": n, **d} for n, d in g.nodes(data=True)],
        "links": [{"source": a, "target": b, **d} for a, b, d in g.edges(data=True)],
    }


def _edge(g, a, b) -> dict:
    d = g[a][b]
    return {"source": a, "target": b, "source_name": g.nodes[a]["name"], "target_name": g.nodes[b]["name"], **d}


def find_loops(g: nx.DiGraph, limit: int = 20) -> list[dict]:
    seen, sigs, loops = set(), set(), []
    for cyc in islice(nx.simple_cycles(g, length_bound=5), MAX_CYCLES_SCANNED):
        if len(cyc) < 2:
            continue
        key = frozenset(cyc)
        if key in seen:
            continue
        seen.add(key)
        edges = [_edge(g, cyc[i], cyc[(i + 1) % len(cyc)]) for i in range(len(cyc))]
        types = [g.nodes[n]["type"] for n in cyc]
        if len(set(types)) < len(types):
            continue  # skip loops that revisit the same industry type - not a real eco-park blueprint
        sig = (frozenset(types), frozenset(e["material"] for e in edges))
        if sig in sigs:
            continue
        sigs.add(sig)
        loops.append({
            "members": [{"id": n, "name": g.nodes[n]["name"], "type": g.nodes[n]["type"]} for n in cyc],
            "edges": edges, "length": len(cyc),
            "total_saving": round(sum(e["saving"] for e in edges)),
            "total_co2": round(sum(e["co2"] for e in edges), 1),
            "total_tonnes": round(sum(e["tonnes"] for e in edges), 1),
            "materials": sorted({e["material"] for e in edges}),
        })
    # favour eco-park style loops (3+ members, several distinct materials) then value
    loops.sort(key=lambda l: (l["length"] >= 3, l["total_saving"]), reverse=True)
    return loops[:limit]


def find_chains(g: nx.DiGraph, limit: int = 20) -> list[dict]:
    chains = []
    for p in g.nodes:
        for a in g.predecessors(p):
            for b in g.successors(p):
                if a == b or g.has_edge(a, b):
                    continue
                e1, e2 = _edge(g, a, p), _edge(g, p, b)
                if e1["material"] == e2["material"]:
                    continue  # processor must transform the material
                chains.append({
                    "members": [{"id": n, "name": g.nodes[n]["name"], "type": g.nodes[n]["type"]} for n in (a, p, b)],
                    "edges": [e1, e2], "length": 2,
                    "total_saving": round(e1["saving"] + e2["saving"]),
                    "total_co2": round(e1["co2"] + e2["co2"], 1),
                    "materials": [e1["material"], e2["material"]],
                })
    chains.sort(key=lambda c: c["total_saving"], reverse=True)
    return chains[:limit]
