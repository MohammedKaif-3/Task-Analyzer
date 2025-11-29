"""Task scoring utilities.

Contains utilities for:
- normalizing dates,
- computing urgency and effort scores,
- detecting circular dependencies,
- calculating a combined priority score for tasks.

All changes are quality-only (typing, robustness, readability) and do NOT change algorithmic behavior.
"""

from datetime import date, datetime
from typing import List, Dict, Any, Iterable, Sequence


def _ensure_date(d: Any) -> date:
    """Normalize an input to a `datetime.date`.

    Accepts:
      - date instance -> returned unchanged
      - ISO-like date string, optionally with time (e.g. '2025-11-30' or '2025-11-30T12:00:00')
      - raises ValueError for invalid inputs
    """
    if isinstance(d, date):
        return d
    if isinstance(d, str):
        # Try full ISO first, then fallback to date portion
        try:
            return datetime.fromisoformat(d).date()
        except Exception:
            try:
                parts = d.split("T", 1)[0]
                return datetime.fromisoformat(parts).date()
            except Exception:
                raise ValueError(f"Invalid date string: {d!r}")
    raise ValueError(f"Invalid date type: {type(d)}")


def calculate_urgency(due_date: date) -> float:
    """Return an urgency value (0-10 scale-ish) based on days until due date.

    Higher values mean more urgent:
      - overdue: 10.0
      - due today: 9.0
      - due in <=3 days: 7.0
      - due in <=7 days: 5.0
      - otherwise: 3.0
    """
    today = date.today()
    days_left = (due_date - today).days

    if days_left < 0:
        return 10.0
    if days_left == 0:
        return 9.0
    if days_left <= 3:
        return 7.0
    if days_left <= 7:
        return 5.0
    return 3.0


def calculate_effort_score(hours: float) -> float:
    """Effort score that favors quick wins.

    Uses the original formula: 10.0 / (hours + 1.0)
    """
    # guard numeric input
    try:
        h = float(hours)
    except Exception:
        h = 0.0
    return 10.0 / (h + 1.0)


def detect_circular_dependencies(tasks: Sequence[Dict[str, Any]]) -> List[List[int]]:
    """Detect cycles in the dependency graph.

    Args:
        tasks: sequence of task dictionaries. Each task should provide an 'id' and optionally
               a 'dependencies' iterable (list/tuple) containing IDs (int or str).

    Returns:
        A list of cycles. Each cycle is represented as a list of node ids showing the cycle path
        (e.g. [1] for self-dependency, or [1, 2, 3, 1] for a 3-node cycle).
    """
    # Build adjacency map: id -> list of dependency ids (integers), deduped
    graph: Dict[int, List[int]] = {}
    for idx, t in enumerate(tasks):
        try:
            tid = int(t.get("id") or (idx + 1))
        except Exception:
            # skip invalid ids (shouldn't happen if preprocessing is correct)
            continue

        deps_raw = t.get("dependencies") or []
        seen_deps = []
        for d in deps_raw:
            try:
                di = int(d)
            except Exception:
                continue
            if di not in seen_deps:
                seen_deps.append(di)
        graph[tid] = seen_deps

    visited = set()            # permanently visited nodes
    stack: List[int] = []      # current DFS stack
    cycles: List[List[int]] = []
    seen_cycles: set = set()   # canonical tuple of cycle used to dedupe

    def dfs(node: int) -> None:
        """Depth-first search that records cycles into `cycles` list."""
        if node in stack:
            # found a back-edge -> cycle
            idx_in_stack = stack.index(node)
            cycle = stack[idx_in_stack:] + [node]
            # canonicalize cycle by rotating to smallest value (for dedupe)
            if len(cycle) > 1:
                min_idx = min(range(len(cycle) - 1), key=lambda i: cycle[i])
                ordered = cycle[min_idx:-1] + cycle[:min_idx] + [cycle[min_idx]]
            else:
                ordered = cycle
            tup = tuple(ordered)
            if tup not in seen_cycles:
                seen_cycles.add(tup)
                cycles.append(ordered)
            return
        if node in visited:
            return

        visited.add(node)
        stack.append(node)
        for neighbour in graph.get(node, []):
            dfs(neighbour)
        stack.pop()

    for n in list(graph.keys()):
        if n not in visited:
            dfs(n)

    return cycles


def calculate_priority(task: Dict[str, Any],
                       all_tasks: Sequence[Dict[str, Any]],
                       weights: Dict[str, float]) -> float:
    """Calculate a composite priority score for a task.

    The scoring formula is unchanged from the original:
      score = w_u * urgency + w_i * importance + w_e * effort + w_d * dependency_count

    Args:
        task: dictionary with keys 'due_date', optional 'estimated_hours', 'importance', 'dependencies'
        all_tasks: list of all tasks (reserved for relative calculations; currently unused)
        weights: dict with keys 'urgency', 'importance', 'effort', 'dependency' (floats)

    Returns:
        Rounded float score (3 decimals)
    """
    due = _ensure_date(task["due_date"])
    urgency = calculate_urgency(due)
    importance = float(task.get("importance", 1))
    effort_score = calculate_effort_score(float(task.get("estimated_hours", 0)))
    dependency_count = len(task.get("dependencies") or [])

    score = (
        weights.get("urgency", 0.4) * urgency
        + weights.get("importance", 0.4) * importance
        + weights.get("effort", 0.15) * effort_score
        + weights.get("dependency", 0.05) * dependency_count
    )
    return round(score, 3)


# -----------------------
# Quick manual test helper (run directly for ad-hoc checks)
# -----------------------
if __name__ == "__main__": 
    sample = [
        {"id": 1, "due_date": "2025-11-27", "estimated_hours": 2, "importance": 8, "dependencies": [2]},
        {"id": 2, "due_date": "2025-11-25", "estimated_hours": 5, "importance": 6, "dependencies": [3]},
        {"id": 3, "due_date": "2025-11-23", "estimated_hours": 1, "importance": 5, "dependencies": [1]}
    ]
    print("Detected cycles:", detect_circular_dependencies(sample))
    w = {"urgency": 0.4, "importance": 0.4, "effort": 0.15, "dependency": 0.05}
    for t in sample:
        print("Task", t["id"], "score:", calculate_priority(t, sample, w))
