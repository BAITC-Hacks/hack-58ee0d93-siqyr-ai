import asyncio

import httpx

from meet_bot.sinks import HttpSink


def test_http_sink_spools_and_retries_same_seq(tmp_path):
    attempts = []

    def handler(request):
        attempts.append(request)
        if len(attempts) == 1:
            return httpx.Response(503)
        return httpx.Response(200, json={})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    sink = HttpSink("http://localhost:8000", "", tmp_path, client)

    async def run():
        await sink.chunk("demo", 2, 3, 1234, b"abc")
        assert (tmp_path / "demo/segment-2/chunk-000003.webm").exists()
        assert await sink.flush("demo") is True
        assert not (tmp_path / "demo/segment-2/chunk-000003.webm").exists()
        await client.aclose()

    asyncio.run(run())
    assert len(attempts) == 2
    assert b'name="seq"' in attempts[0].content
    assert b"3" in attempts[0].content
