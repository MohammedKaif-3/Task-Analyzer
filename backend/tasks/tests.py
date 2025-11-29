from django.test import TestCase
from .scoring import calculate_priority
from datetime import date, timedelta

class ScoringTests(TestCase):
    def test_overdue_has_higher_score_than_future(self):
        """Ensure an overdue task scores higher than the same task due in the future."""
        overdue = {"title":"A","due_date": (date.today() - timedelta(days=2)), "estimated_hours":3, "importance":5, "dependencies": []}
        future = {"title":"A","due_date": (date.today() + timedelta(days=5)), "estimated_hours":3, "importance":5, "dependencies": []}
        tasks = [overdue, future]

        s_overdue = calculate_priority(overdue, tasks, {"urgency":0.4,"importance":0.4,"effort":0.15,"dependency":0.05})
        s_future = calculate_priority(future, tasks, {"urgency":0.4,"importance":0.4,"effort":0.15,"dependency":0.05})

        self.assertGreater(s_overdue, s_future)

    def test_quick_win_boosts_score(self):
        future = date.today() + timedelta(days=5)
        t1 = {"title":"Quick","due_date": future, "estimated_hours": 0.5, "importance": 4, "dependencies": []}
        t2 = {"title":"Slow","due_date": future, "estimated_hours": 8, "importance": 4, "dependencies": []}
        s1 = calculate_priority(t1, [t1,t2], {"urgency":0.4,"importance":0.4,"effort":0.15,"dependency":0.05})
        s2 = calculate_priority(t2, [t1,t2], {"urgency":0.4,"importance":0.4,"effort":0.15,"dependency":0.05})
        self.assertGreater(s1, s2)

    def test_dependency_increases_priority(self):
        future = date.today() + timedelta(days=10)
        t1 = {"id":1,"title":"A","due_date": future, "estimated_hours": 3, "importance": 6, "dependencies":[2]}
        t2 = {"id":2,"title":"B","due_date": future, "estimated_hours": 2, "importance": 5, "dependencies": []}
        s1 = calculate_priority(t1, [t1,t2], {"urgency":0.4,"importance":0.4,"effort":0.15,"dependency":0.05})
        s2 = calculate_priority(t2, [t1,t2], {"urgency":0.4,"importance":0.4,"effort":0.15,"dependency":0.05})
        self.assertGreater(s1, s2)
