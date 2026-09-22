"""
Data models for CampusSync Academic Calendar & Event Management System.
Backward compatible with legacy single-date schemas.
"""
from dataclasses import dataclass, field, asdict
from typing import Optional
from datetime import datetime

@dataclass
class Event:
    id: int
    title: str
    description: str
    event_type: str
    start_date: str
    end_date: str
    start_time: str = "09:00"
    end_time: str = "17:00"
    location: str = "To be announced"
    location_type: str = "Physical"
    department: str = "All Departments"
    academic_year: str = "2026-27"
    year: str = "All Years"
    section: str = "All Sections"
    organizer: str = "Institute Academic Cell"
    status: str = "Upcoming"
    category: str = "Academic"
    tag_day: str = ""
    tag_date: str = ""
    poster: str = ""
    color_theme: str = "linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)"
    source: str = "MIT CSN Academic Calendar AY 2026-27"
    created_by: str = "Dean Academics"
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())

    @classmethod
    def from_dict(cls, data: dict):
        # Backward compatibility for legacy 'date' and 'venue'
        start_date = data.get("start_date") or data.get("date") or "2026-07-13"
        end_date = data.get("end_date") or start_date
        location = data.get("location") or data.get("venue") or "To be announced"
        category = data.get("category") or data.get("event_type") or "Academic"
        event_type = data.get("event_type") or category

        return cls(
            id=int(data.get("id", 0)),
            title=str(data.get("title", "Untitled Event")),
            description=str(data.get("description", "Not specified")),
            event_type=event_type,
            start_date=start_date,
            end_date=end_date,
            start_time=str(data.get("start_time", data.get("time", "09:00"))),
            end_time=str(data.get("end_time", "17:00")),
            location=location,
            location_type=str(data.get("location_type", "Physical")),
            department=str(data.get("department", "All Departments")),
            academic_year=str(data.get("academic_year", "2026-27")),
            year=str(data.get("year", "All Years")),
            section=str(data.get("section", "All Sections")),
            organizer=str(data.get("organizer", "Institute Academic Cell")),
            status=str(data.get("status", "Upcoming")),
            category=category,
            tag_day=str(data.get("tag_day", "")),
            tag_date=str(data.get("tag_date", "")),
            poster=str(data.get("poster", "")),
            color_theme=str(data.get("color_theme", "linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)")),
            source=str(data.get("source", "MIT CSN Academic Calendar AY 2026-27")),
            created_by=str(data.get("created_by", "Dean Academics")),
            created_at=str(data.get("created_at", datetime.now().isoformat()))
        )

    def to_dict(self) -> dict:
        d = asdict(self)
        d["venue"] = self.location  # Backward compatibility field
        d["date"] = self.start_date  # Backward compatibility field
        return d

@dataclass
class Reminder:
    id: int
    event_id: int
    remind_at: str
    title: str
    message: str
    is_sent: bool = False

    @classmethod
    def from_dict(cls, data: dict):
        return cls(
            id=int(data["id"]),
            event_id=int(data["event_id"]),
            remind_at=str(data["remind_at"]),
            title=str(data["title"]),
            message=str(data["message"]),
            is_sent=bool(data.get("is_sent", False))
        )

    def to_dict(self) -> dict:
        return asdict(self)