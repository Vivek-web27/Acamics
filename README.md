# Academic Calendar & Event Management System

A working, offline, no-framework version of the CEP project — built to
actually implement the two features the project claims to have
(clash detection and reminders), not just display them.

## Why it's built this way

- **No React / MERN / any web framework.** Backend is Python's
  built-in `http.server`; frontend is plain HTML/CSS/JS.
- **No database.** Events persist to a single JSON file
  (`data/events.json`) via plain file I/O.
- **No internet required.** Everything runs on `localhost`.
- **Four hand-written data structures do real work** — this isn't a
  CRUD app with DSA bolted on for show:

| Structure | File | What it actually does |
|---|---|---|
| Linked-list Queue | `structures.py` → `Queue` | Reminders are collected for the next 3 days, then drained FIFO (soonest first) to build the reminder panel — an actual pipeline, not just a sorted list. |
| Array Stack | `structures.py` → `Stack` | Every create/cancel pushes an undo record. "Undo last action" pops it and reverses it. |
| Sorted Doubly Linked List | `structures.py` → `SortedLinkedList` | One per (department, year). New events are inserted in the right chronological position so the agenda view never has to re-sort. |
| Binary Search Tree | `structures.py` → `ScheduleTree` | One per (department, year, date). Holds only non-overlapping intervals, so a new event's clash check only ever has to compare against its in-order predecessor and successor — O(log n), and *correct*, not a hand-wave. |

## Why clash detection actually works

`ScheduleTree.try_insert` keeps the invariant "everything already in
this tree is non-overlapping." Because of that invariant, a new
`[start, end)` interval can only possibly clash with the interval
immediately before or after it in sorted order — never with anything
further away. So every insert does a real overlap check
(`a_start < b_end and b_start < a_end`), scoped to
department + year + date, before the event is allowed to exist. Two
events for different departments, or on different days, never clash
each other. Back-to-back events (one ending exactly when the next
starts) are correctly allowed, not falsely flagged.

Try it: add "Mid Sem Exam" 10:00–12:00 for CSE Year 2 on some date,
then try to add "Guest Lecture" 11:00–12:30 for the same
department/year/date — it will be rejected with the exact conflicting
event named.

## Why reminders actually work

`upcoming_reminders()` filters events into whatever falls within the
next N days (default 3), sorts them by how soon they're due, loads
them into the `Queue`, and drains the queue FIFO into the response.
The reminder panel re-fetches this every time you change a filter or
add/cancel an event, so it's live, not static.

## Running it

```bash
cd backend
python server.py
```

Then open **http://localhost:8000** in a browser. No install step,
no dependencies beyond the Python 3 standard library.

Data is saved to `data/events.json` as you go — stop and restart the
server and everything you added is still there.

## Project layout

```
academic_calendar/
├── backend/
│   ├── structures.py   # Queue, Stack, SortedLinkedList, ScheduleTree
│   ├── models.py        # Event dataclass
│   ├── datastore.py     # JSON file load/save
│   ├── scheduler.py     # ties structures + datastore into one engine
│   └── server.py        # stdlib HTTP API + static file serving
├── frontend/
│   ├── index.html
│   ├── style.css
│   └── app.js
├── data/
│   └── events.json      # created automatically on first run
└── README.md
```

## What this deliberately leaves out (and why)

- **Login/auth** — every request is treated as one shared session for
  now. Easy to bolt a simple "pick your role from a dropdown" step on
  top later without touching the engine.
- **Deleting from the ScheduleTree on cancel** — rebuilding a BST on
  every delete isn't worth the complexity at this scale; cancelled
  events are just filtered out by status everywhere they'd otherwise
  show up, and the tree only needs to be correct for *new* inserts.
- **Recurring events, multi-day events, timezones** — out of scope for
  a sem project; the model assumes single-day, single-timezone events.

## Natural next steps, if you want to extend it

1. Add a `role` dropdown (student/faculty/admin) and hide the "Add
   Event" panel from students on the frontend — plus check the role
   server-side too, not just hide the button.
2. Add a day/week calendar grid view instead of the flat table.
3. Swap the reminder panel's manual refresh for a `setInterval` poll
   every 60s.
