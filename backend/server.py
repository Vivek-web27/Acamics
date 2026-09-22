"""
Acamics Standard Library HTTP Server with WebPush and PWA support.
Zero external dependencies required.
"""
from http.server import SimpleHTTPRequestHandler, HTTPServer
import json
import os
import sys
from models import Event, Reminder
from structures import EventBST, ReminderQueue, UndoStack
from scheduler import Scheduler

PORT = 8000
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(BACKEND_DIR)
DATA_PATH = os.path.join(BASE_DIR, "data", "events.json")
REMINDERS_PATH = os.path.join(BASE_DIR, "data", "reminders.json")
SUBS_PATH = os.path.join(BASE_DIR, "data", "subscriptions.json")
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")

scheduler = Scheduler()
undo_stack = UndoStack()
reminder_queue = ReminderQueue()

def load_events_from_disk() -> EventBST:
    bst = EventBST()
    if os.path.exists(DATA_PATH):
        try:
            with open(DATA_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                for item in data:
                    bst.insert(Event.from_dict(item))
        except Exception as e:
            print(f"Error loading {DATA_PATH}: {e}", file=sys.stderr)
    return bst

def load_reminders():
    if os.path.exists(REMINDERS_PATH):
        try:
            with open(REMINDERS_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                for r in data:
                    reminder_queue.push(Reminder.from_dict(r))
        except Exception as e:
            print(f"Error loading {REMINDERS_PATH}: {e}", file=sys.stderr)

load_reminders()

class AcamicsHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=FRONTEND_DIR, **kwargs)

    def guess_type(self, path):
        if path.endswith(".json") or path.endswith("manifest.json"):
            return "application/manifest+json"
        if path.endswith(".js"):
            return "application/javascript"
        return super().guess_type(path)

    def _send_json(self, status_code: int, data: any):
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(json.dumps(data, indent=2).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        bst = load_events_from_disk()
        all_sorted = bst.get_all_sorted()

        if self.path == "/api/events":
            self._send_json(200, [e.to_dict() for e in all_sorted])
        elif self.path.startswith("/api/events/"):
            try:
                event_id = int(self.path.split("/")[-1])
                target = bst.search_by_id(event_id)
                if target:
                    self._send_json(200, target.to_dict())
                else:
                    self._send_json(404, {"error": "Event not found"})
            except ValueError:
                self._send_json(400, {"error": "Invalid Event ID"})
        elif self.path == "/api/reminders":
            self._send_json(200, [r.to_dict() for r in reminder_queue.to_list()])
        else:
            super().do_GET()

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length).decode("utf-8")
        try:
            payload = json.loads(body) if body else {}
        except json.JSONDecodeError:
            self._send_json(400, {"error": "Malformed JSON"})
            return

        if self.path == "/api/reminders":
            try:
                new_reminder = Reminder(
                    id=len(reminder_queue.heap) + 1,
                    event_id=int(payload.get("event_id", 0)),
                    remind_at=str(payload.get("remind_at", "")),
                    title=str(payload.get("title", "Event Alert")),
                    message=str(payload.get("message", ""))
                )
                reminder_queue.push(new_reminder)
                
                os.makedirs(os.path.dirname(REMINDERS_PATH), exist_ok=True)
                with open(REMINDERS_PATH, "w", encoding="utf-8") as f:
                    json.dump([r.to_dict() for r in reminder_queue.to_list()], f, indent=2)

                self._send_json(201, {"status": "success", "reminder": new_reminder.to_dict()})
            except Exception as e:
                self._send_json(500, {"error": str(e)})

        elif self.path == "/api/push-subscribe":
            os.makedirs(os.path.dirname(SUBS_PATH), exist_ok=True)
            subs = []
            if os.path.exists(SUBS_PATH):
                with open(SUBS_PATH, "r", encoding="utf-8") as f:
                    subs = json.load(f)
            subs.append(payload)
            with open(SUBS_PATH, "w", encoding="utf-8") as f:
                json.dump(subs, f, indent=2)
            self._send_json(200, {"status": "Subscribed to push alerts"})
        else:
            self._send_json(404, {"error": "Endpoint not found"})

if __name__ == "__main__":
    print(f"==================================================")
    print(f" Acamics Academic Server Running")
    print(f" Port: http://localhost:{PORT}")
    print(f" Frontend: {FRONTEND_DIR}")
    print(f" Data: {DATA_PATH}")
    print(f"==================================================")
    server = HTTPServer(("0.0.0.0", PORT), AcamicsHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Acamics server.")
        server.server_close()