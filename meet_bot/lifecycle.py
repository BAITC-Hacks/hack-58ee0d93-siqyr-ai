from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Lifecycle:
    started_ms: int
    alone_since_ms: int | None = None
    stop_requested: bool = False

    def reason(self, now_ms: int, participant_count: int | None, meeting_ended: bool,
               alone_timeout_s: int, max_duration_s: int) -> str | None:
        if self.stop_requested:
            return "requested"
        if meeting_ended:
            return "meeting_ended"
        if now_ms - self.started_ms >= max_duration_s * 1000:
            return "max_duration"
        if participant_count is None:
            self.alone_since_ms = None
        elif participant_count <= 1:
            if self.alone_since_ms is None:
                self.alone_since_ms = now_ms
            if now_ms - self.alone_since_ms >= alone_timeout_s * 1000:
                return "alone"
        else:
            self.alone_since_ms = None
        return None
