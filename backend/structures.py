"""
Core DSA implementations for CampusSync:
1. EventBST: Binary Search Tree for events sorted by start_date & start_time
2. ReminderQueue: Min-Heap for priority event alert dispatching
3. DayAgenda: Doubly-linked list for chronological event stepping
4. UndoStack: LIFO stack for rollbacks
"""
from typing import List, Optional
from models import Event, Reminder

class BSTNode:
    def __init__(self, event: Event):
        self.event: Event = event
        self.left: Optional[BSTNode] = None
        self.right: Optional[BSTNode] = None

class EventBST:
    """Binary Search Tree keyed by start_date + start_time."""
    def __init__(self):
        self.root: Optional[BSTNode] = None

    def _key(self, ev: Event) -> str:
        return f"{ev.start_date} {ev.start_time}"

    def insert(self, event: Event) -> None:
        new_node = BSTNode(event)
        if not self.root:
            self.root = new_node
            return
        
        curr = self.root
        target_key = self._key(event)
        while True:
            if target_key < self._key(curr.event):
                if curr.left is None:
                    curr.left = new_node
                    break
                curr = curr.left
            else:
                if curr.right is None:
                    curr.right = new_node
                    break
                curr = curr.right

    def in_order(self, node: Optional[BSTNode], result: List[Event]) -> None:
        if node:
            self.in_order(node.left, result)
            result.append(node.event)
            self.in_order(node.right, result)

    def get_all_sorted(self) -> List[Event]:
        result: List[Event] = []
        self.in_order(self.root, result)
        return result

    def search_by_id(self, event_id: int) -> Optional[Event]:
        events = self.get_all_sorted()
        for ev in events:
            if ev.id == event_id:
                return ev
        return None


class ReminderQueue:
    """Min-Heap Priority Queue for managing temporal alerts."""
    def __init__(self):
        self.heap: List[Reminder] = []

    def push(self, reminder: Reminder) -> None:
        self.heap.append(reminder)
        self._sift_up(len(self.heap) - 1)

    def pop(self) -> Optional[Reminder]:
        if not self.heap:
            return None
        if len(self.heap) == 1:
            return self.heap.pop()
        
        root = self.heap[0]
        self.heap[0] = self.heap.pop()
        self._sift_down(0)
        return root

    def peek(self) -> Optional[Reminder]:
        return self.heap[0] if self.heap else None

    def _sift_up(self, idx: int) -> None:
        parent = (idx - 1) // 2
        while idx > 0 and self.heap[idx].remind_at < self.heap[parent].remind_at:
            self.heap[idx], self.heap[parent] = self.heap[parent], self.heap[idx]
            idx = parent
            parent = (idx - 1) // 2

    def _sift_down(self, idx: int) -> None:
        smallest = idx
        left = 2 * idx + 1
        right = 2 * idx + 2

        if left < len(self.heap) and self.heap[left].remind_at < self.heap[smallest].remind_at:
            smallest = left
        if right < len(self.heap) and self.heap[right].remind_at < self.heap[smallest].remind_at:
            smallest = right

        if smallest != idx:
            self.heap[idx], self.heap[smallest] = self.heap[smallest], self.heap[idx]
            self._sift_down(smallest)

    def to_list(self) -> List[Reminder]:
        return sorted(self.heap, key=lambda r: r.remind_at)


class DLLNode:
    def __init__(self, event: Event):
        self.event: Event = event
        self.prev: Optional['DLLNode'] = None
        self.next: Optional['DLLNode'] = None

class DayAgenda:
    """Doubly Linked List for traversing a sequential day's agenda."""
    def __init__(self):
        self.head: Optional[DLLNode] = None
        self.tail: Optional[DLLNode] = None

    def append(self, event: Event) -> None:
        node = DLLNode(event)
        if not self.head:
            self.head = self.tail = node
        else:
            node.prev = self.tail
            if self.tail:
                self.tail.next = node
            self.tail = node

    def to_list(self) -> List[Event]:
        items = []
        curr = self.head
        while curr:
            items.append(curr.event)
            curr = curr.next
        return items


class UndoStack:
    """LIFO Stack for state rollback tracking."""
    def __init__(self):
        self.stack = []

    def push(self, action_type: str, payload: dict) -> None:
        self.stack.append({"action": action_type, "payload": payload})

    def pop(self) -> Optional[dict]:
        return self.stack.pop() if self.stack else None

    def is_empty(self) -> bool:
        return len(self.stack) == 0