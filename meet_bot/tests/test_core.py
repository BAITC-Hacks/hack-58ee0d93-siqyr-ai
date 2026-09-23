import asyncio
from pathlib import Path

from meet_bot.lifecycle import Lifecycle
from meet_bot.sinks import FileSink


def test_lifecycle_alone_and_reset():
    state = Lifecycle(started_ms=1000)
    assert state.reason(1000, 1, False, 2, 100) is None
    assert state.reason(2000, 2, False, 2, 100) is None
    assert state.reason(3000, 1, False, 2, 100) is None
    assert state.reason(5000, 1, False, 2, 100) == "alone"


def test_lifecycle_stop_and_max():
    state = Lifecycle(started_ms=0)
    assert state.reason(2000, None, False, 10, 2) == "max_duration"
    state.stop_requested = True
    assert state.reason(2000, None, False, 10, 2) == "requested"


def test_file_sink_segment_seq_and_idempotency(tmp_path: Path):
    sink = FileSink(tmp_path)
    async def run():
        await sink.chunk("demo", 0, 0, 123, b"header")
        await sink.chunk("demo", 0, 0, 123, b"header")
        await sink.chunk("demo", 0, 1, 123, b"payload")
        await sink.chunk("demo", 1, 0, 456, b"new-header")
    asyncio.run(run())
    assert (tmp_path / "demo/segment-0/chunk-000000.webm").read_bytes() == b"header"
    assert (tmp_path / "demo/segment-1/started_at_ms.txt").read_text() == "456"
