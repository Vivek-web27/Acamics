"""
Clash Detection Engine supporting multi-day intervals and audience scopes.
Formula: Overlap occurs iff max(A_start, B_start) < min(A_end, B_end)
"""
from typing import List, Tuple, Optional
from datetime import datetime
from models import Event

class Scheduler:
    def __init__(self):
        pass

    @staticmethod
    def parse_dt(date_str: str, time_str: str) -> datetime:
        # Fallback to standard day bounds if time parsing fails
        t_str = time_str.split(" - ")[0].strip() if " - " in time_str else time_str.strip()
        for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%d %I:%M %p", "%Y-%m-%d %I:%M%p"):
            try:
                return datetime.strptime(f"{date_str} {t_str}", fmt)
            except ValueError:
                continue
        # Fallback to midnight
        return datetime.strptime(f"{date_str} 00:00", "%Y-%m-%d %H:%M")

    @staticmethod
    def parse_dt_end(date_str: str, time_str: str) -> datetime:
        t_str = time_str.split(" - ")[-1].strip() if " - " in time_str else time_str.strip()
        for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%d %I:%M %p", "%Y-%m-%d %I:%M%p"):
            try:
                return datetime.strptime(f"{date_str} {t_str}", fmt)
            except ValueError:
                continue
        # Default end time to 23:59
        return datetime.strptime(f"{date_str} 23:59", "%Y-%m-%d %H:%M")

    def scopes_conflict(self, ev1: Event, ev2: Event) -> bool:
        # Venue conflict check
        if ev1.location and ev2.location and ev1.location.lower() != "to be announced":
            if ev1.location.strip().lower() == ev2.location.strip().lower():
                return True

        # Group conflict check
        same_dept = (ev1.department == "All Departments" or ev2.department == "All Departments" or ev1.department == ev2.department)
        same_year = (ev1.year == "All Years" or ev2.year == "All Years" or ev1.year == ev2.year)
        same_sec = (ev1.section == "All Sections" or ev2.section == "All Sections" or ev1.section == ev2.section)

        return same_dept and same_year and same_sec

    def check_clash(self, candidate: Event, existing_events: List[Event]) -> Tuple[bool, Optional[Event], str]:
        c_start = self.parse_dt(candidate.start_date, candidate.start_time)
        c_end = self.parse_dt_end(candidate.end_date, candidate.end_time)

        if c_end <= c_start:
            return True, None, "Invalid event duration: End timestamp is before or equal to start timestamp."

        for ev in existing_events:
            if ev.id == candidate.id:
                continue
            
            e_start = self.parse_dt(ev.start_date, ev.start_time)
            e_end = self.parse_dt_end(ev.end_date, ev.end_time)

            # Mathematical interval intersection check
            if max(c_start, e_start) < min(c_end, e_end):
                if self.scopes_conflict(candidate, ev):
                    reason = f"Clash with '{ev.title}' ({ev.start_date} to {ev.end_date}) at {ev.location} for {ev.department}/{ev.year}."
                    return True, ev, reason

        return False, None, "No clashes detected."