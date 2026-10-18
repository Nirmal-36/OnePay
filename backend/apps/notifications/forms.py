from django import forms

from .models import Notification


class SystemAnnouncementForm(forms.ModelForm):
    class Meta:
        model = Notification
        fields = ("title", "message", "navigation_target")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.instance._state.adding:
            self.instance.recipient = None
            self.instance.category = Notification.Category.SYSTEM
            self.instance.event_type = Notification.EventType.SYSTEM_ANNOUNCEMENT
            self.instance.related_transaction = None
            self.instance.is_announcement = True
