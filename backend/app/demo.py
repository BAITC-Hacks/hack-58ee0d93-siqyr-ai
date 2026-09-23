"""The checked-in fixture contains synthetic data only."""
import json
from .config import ROOT


def demo_meeting() -> dict:
    return json.loads((ROOT / "data/seed/demo_meeting.json").read_text(encoding="utf-8"))
