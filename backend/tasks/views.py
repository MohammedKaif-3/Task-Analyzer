# views.py
from datetime import date, datetime
from typing import List, Dict, Any, Tuple, Optional

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

from .serializers import TaskInputSerializer
from .scoring import calculate_priority, detect_circular_dependencies

DEFAULT_WEIGHTS = {
    "urgency": 0.4,
    "importance": 0.4,
    "effort": 0.15,
    "dependency": 0.05
}


def assign_ids(tasks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Ensure each task dict has a numeric 'id'. Returns the same list (mutates task dicts)."""
    for i, t in enumerate(tasks):
        if 'id' not in t:
            t['id'] = i + 1
    return tasks


def score_tasks(tasks: List[Dict[str, Any]], weights: Dict[str, float]) -> List[Dict[str, Any]]:
    """Calculate score for each task and return a new list of task dicts including 'score'."""
    scored = []
    for t in tasks:
        score = calculate_priority(t, tasks, weights)
        item = dict(t)  # shallow copy so we don't modify caller's dict unexpectedly
        item['score'] = score
        scored.append(item)
    return scored


def _parse_date_safe(d) -> Optional[date]:
    """Return a date object if d is date-like (date or ISO string), else None."""
    if isinstance(d, date):
        return d
    if isinstance(d, str):
        try:
            # Accept ISO-like strings with optional time part
            return datetime.fromisoformat(d).date()
        except Exception:
            try:
                return datetime.fromisoformat(d.split('T', 1)[0]).date()
            except Exception:
                return None
    return None


def check_and_respond_cycles(tasks: List[Dict[str, Any]]):
    """Detect cycles and, if present, return a DRF Response with 400 and cycle details; otherwise None."""
    cycles = detect_circular_dependencies(tasks)
    if cycles:
        return Response({"error": "Circular dependencies detected", "cycles": cycles},
                        status=status.HTTP_400_BAD_REQUEST)
    return None


class AnalyzeTasks(APIView):
    """
    POST /api/tasks/analyze/
    Accepts a list of tasks, validates them, detects circular dependencies,
    calculates score for each task and returns sorted list (desc).
    """

    def post(self, request):
        serializer = TaskInputSerializer(data=request.data, many=True)
        serializer.is_valid(raise_exception=True)
        tasks = serializer.validated_data  # list of dict-like objects

        # Ensure each task has an 'id' for dependency resolution
        assign_ids(tasks)

        # detect cycles and return 400 if any
        cycle_resp = check_and_respond_cycles(tasks)
        if cycle_resp:
            return cycle_resp

        scored = score_tasks(tasks, DEFAULT_WEIGHTS)
        scored_sorted = sorted(scored, key=lambda x: x['score'], reverse=True)
        return Response(scored_sorted, status=status.HTTP_200_OK)


class SuggestTasks(APIView):
    """
    POST /api/tasks/suggest/
    Accepts tasks array in body (same format as analyze), returns top 3 tasks
    with a short explanation for each.
    """

    def post(self, request):
        serializer = TaskInputSerializer(data=request.data, many=True)
        serializer.is_valid(raise_exception=True)
        tasks = serializer.validated_data

        assign_ids(tasks)

        cycle_resp = check_and_respond_cycles(tasks)
        if cycle_resp:
            return cycle_resp

        scored_with_expl = []
        scored = score_tasks(tasks, DEFAULT_WEIGHTS)

        for item in scored:
            t = item  # already a shallow copy that includes 'score'
            explanation_parts: List[str] = []

            # parse due date safely (accept date or ISO string)
            due_raw = t.get('due_date')
            due_dt = _parse_date_safe(due_raw)
            if due_dt is not None:
                days_left = (due_dt - date.today()).days
                if days_left < 0:
                    explanation_parts.append('Overdue')
                elif days_left == 0:
                    explanation_parts.append('Due today')
                elif days_left <= 3:
                    explanation_parts.append(f'Due in {days_left} day(s)')

            # importance
            if t.get('importance', 0) >= 8:
                explanation_parts.append('High importance')

            # effort
            try:
                est = float(t.get('estimated_hours', 999))
            except Exception:
                est = 999.0
            if est <= 2:
                explanation_parts.append('Quick win (low effort)')

            # dependencies
            deps = t.get('dependencies') or []
            if deps:
                explanation_parts.append(f'Blocks {len(deps)} task(s)')

            t['explanation'] = ' · '.join(explanation_parts) or 'Balanced factors'
            scored_with_expl.append(t)

        top3 = sorted(scored_with_expl, key=lambda x: x['score'], reverse=True)[:3]
        return Response({"top_3": top3}, status=status.HTTP_200_OK)
