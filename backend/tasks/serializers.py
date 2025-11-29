from rest_framework import serializers
from datetime import date

class TaskInputSerializer(serializers.Serializer):
    id = serializers.IntegerField(required=False)
    title = serializers.CharField()
    due_date = serializers.DateField()
    estimated_hours = serializers.FloatField(min_value=0)
    importance = serializers.IntegerField(min_value=1, max_value=10)
    dependencies = serializers.ListField(child=serializers.IntegerField(), required=False)

    def validate_due_date(self, value: date):
        # Accept past dates (assignment allows past-due tasks); ensure it's a date
        if not isinstance(value, date):
            raise serializers.ValidationError('Invalid due_date')
        return value
