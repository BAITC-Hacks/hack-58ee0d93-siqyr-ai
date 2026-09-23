import asyncio
import base64
import shutil
import subprocess
from pathlib import Path

import pytest


@pytest.mark.skipif(shutil.which("ffprobe") is None, reason="ffprobe нужен для проверки длительности")
def test_webrtc_loopback_records_playable_audio(tmp_path):
    playwright = pytest.importorskip("playwright.async_api")

    async def run():
        events = []
        async with playwright.async_playwright() as api:
            browser = await api.chromium.launch(headless=True, args=["--autoplay-policy=no-user-gesture-required"])
            context = await browser.new_context()
            await context.expose_binding("__siqyrReceive", lambda _source, event: events.append(event))
            script = Path(__file__).parents[1].joinpath("capture.js").read_text(encoding="utf-8")
            await context.add_init_script(script=script.replace("window.__SIQYR_CHUNK_MS || 10000", "1000"))
            page = await context.new_page()
            await page.goto(Path(__file__).with_name("fixtures").joinpath("loopback.html").as_uri())
            await page.locator("#start").click()
            await page.wait_for_function("document.querySelector('#status').textContent === 'done'")
            await page.evaluate("window.__siqyrCapture.stop()")
            await page.wait_for_timeout(800)
            await browser.close()
        chunks = sorted((e for e in events if e.get("type") == "chunk"), key=lambda e: e["seq"])
        assert chunks and all(base64.b64decode(e["base64"]) for e in chunks)
        audio = tmp_path / "loopback.webm"
        audio.write_bytes(b"".join(base64.b64decode(e["base64"]) for e in chunks))
        probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                "-of", "default=noprint_wrappers=1:nokey=1", str(audio)],
                               capture_output=True, text=True, check=True)
        assert abs(float(probe.stdout.strip()) - 3.0) <= 1.0

    asyncio.run(run())
