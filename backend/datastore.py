"""datastore.py -- plain JSON file persistence. No database, no ORM."""
import json
import os
import threading
from typing import List
from models import Event

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
EVENTS_FILE = os.path.join(DATA_DIR, "events.json")

_lock = threading.Lock()


def _ensure_data_dir():
    os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.exists(EVENTS_FILE):
        with open(EVENTS_FILE, "w") as f:
            json.dump([], f)


def load_events() -> List[Event]:
    _ensure_data_dir()
    with _lock:
        with open(EVENTS_FILE, "r") as f:
            raw = json.load(f)
    return [Event.from_dict(d) for d in raw]


def save_events(events: List[Event]):
    _ensure_data_dir()
    with _lock:
        with open(EVENTS_FILE, "w") as f:
            json.dump([e.to_dict() for e in events], f, indent=2)
