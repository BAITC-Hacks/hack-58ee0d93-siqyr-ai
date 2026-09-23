"""Hosted test access requires server-owned approval of the actual audio bytes."""
import hashlib
import json
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from backend.agents import trusted_audio
from backend.app import config, pipeline
from backend.app.models import Run
from backend.shared.schemas import Proposal, Segment
from test_api import wait_for


AUDIO = b"RIFF\0\0\0\0WAVE fictional test recording"


def manifest(tmp_path, *, audio=AUDIO, synthetic=True, allowed=True):
    path = tmp_path / "approved-tests.json"
    path.write_text(json.dumps({"version": 1, "files": [{
        "sha256": hashlib.sha256(audio).hexdigest(),
        "allow_dev_openai": allowed, "synthetic": synthetic,
        "description": "Explicitly approved test fixture",
    }]}), encoding="utf-8")
    return path


def configure_runtime(client, path):
    runtime = client.app.state.runtime
    runtime.settings = replace(runtime.settings, agent_mode="real", stt_mode="real",
                               llm_provider="dev_openai", llm_base_url="https://api.openai.com/v1",
                               dev_openai_audio_manifest=path)
    return runtime


def test_manifest_config_is_opt_in_and_resolves_server_path(monkeypatch):
    monkeypatch.delenv("DEV_OPENAI_AUDIO_MANIFEST", raising=False)
    assert config.Settings().dev_openai_audio_manifest is None
    monkeypatch.setenv("DEV_OPENAI_AUDIO_MANIFEST", "data/private-tests.json")
    assert config.Settings().dev_openai_audio_manifest == config.ROOT / "data/private-tests.json"


@pytest.mark.parametrize("client_synthetic", [False, True])
@pytest.mark.parametrize("registered", [False, True])
def test_uploaded_synthetic_flag_never_grants_hosted_access(client, tmp_path, client_synthetic, registered):
    audio = tmp_path / "uploaded.wav"
    audio.write_bytes(AUDIO + b"unapproved change")
    path = manifest(tmp_path) if registered else None
    runtime = configure_runtime(client, path)
    with pytest.raises(ValueError, match="DEV_OPENAI_AUDIO_MANIFEST"):
        runtime.guard_llm_destination(Run(title="Upload", audio_path=str(audio), synthetic=client_synthetic))


@pytest.mark.parametrize("endpoint", [
    "https://other.example/v1", "https://api.openai.com.evil.example/v1",
    "http://api.openai.com/v1", "https://api.openai.com:8443/v1",
    "https://user:password@api.openai.com/v1",
])
def test_even_approved_audio_cannot_use_foreign_or_insecure_host(client, tmp_path, monkeypatch, endpoint):
    runtime = configure_runtime(client, manifest(tmp_path))
    runtime.settings = replace(runtime.settings, llm_base_url=endpoint)
    verifier = Mock(side_effect=AssertionError("Host must be rejected before reading audio"))
    monkeypatch.setattr(pipeline, "verify_audio", verifier)
    with pytest.raises(ValueError, match="Внешний LLM"):
        runtime.guard_llm_destination(Run(title="Upload", audio_path="unused.wav", synthetic=True))
    verifier.assert_not_called()


def test_approval_does_not_relax_local_destination(client, tmp_path):
    runtime = configure_runtime(client, manifest(tmp_path))
    runtime.settings = replace(runtime.settings, llm_provider="local")
    with pytest.raises(ValueError, match="local"):
        runtime.guard_llm_destination(Run(title="Upload", audio_path="unused.wav", synthetic=True))
    runtime.settings = replace(runtime.settings, llm_base_url="http://127.0.0.1:11434/v1")
    assert runtime.guard_llm_destination(Run(title="Upload", audio_path="unused.wav")) is None


def test_verified_audio_is_hashed_once_and_modified_file_rejected(tmp_path, monkeypatch):
    audio = tmp_path / "uploaded.wav"
    audio.write_bytes(AUDIO)
    path = manifest(tmp_path)
    digest = Mock(wraps=hashlib.file_digest)
    monkeypatch.setattr(trusted_audio.hashlib, "file_digest", digest)
    verified = trusted_audio.verify_audio(str(audio), path)
    assert trusted_audio.verify_audio(str(audio), path, verified) == verified
    assert digest.call_count == 1
    audio.write_bytes(AUDIO + b"changed during STT")
    with pytest.raises(ValueError, match="изменился"):
        trusted_audio.verify_audio(str(audio), path, verified)


def test_manifest_revocation_is_checked_again_before_llm(tmp_path):
    audio = tmp_path / "uploaded.wav"
    audio.write_bytes(AUDIO)
    path = manifest(tmp_path)
    verified = trusted_audio.verify_audio(str(audio), path)
    manifest(tmp_path, allowed=False)
    with pytest.raises(ValueError, match="не разрешён"):
        trusted_audio.verify_audio(str(audio), path, verified)


@pytest.mark.parametrize("document", [
    {}, {"version": True, "files": []}, {"version": 2, "files": []},
    {"version": 1, "files": [{"sha256": "*", "allow_dev_openai": True, "synthetic": True}]},
    {"version": 1, "files": [{"sha256": "a" * 64, "allow_dev_openai": "true", "synthetic": True}]},
    {"version": 1, "files": [{"sha256": "a" * 64, "allow_dev_openai": True}]},
])
def test_malformed_manifest_fails_closed(tmp_path, document):
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps(document), encoding="utf-8")
    with pytest.raises(ValueError, match="DEV_OPENAI_AUDIO_MANIFEST"):
        trusted_audio.verify_audio("unused.wav", path)


def test_upload_persists_verified_provenance_and_real_source_mode(client, tmp_path, monkeypatch):
    runtime = configure_runtime(client, manifest(tmp_path))
    segments = [Segment(start=0, end=1, speaker="SPEAKER_00", text="тестовое обсуждение", lang="ru")]
    transcribe = Mock(return_value=segments)
    monkeypatch.setattr(pipeline.stt, "transcribe", transcribe)
    proposed = []

    async def propose(run_input, emit):
        proposed.append(run_input)
        return Proposal(run_id=run_input.run_id, summary="Тест", segments=run_input.segments)

    monkeypatch.setattr(runtime, "runner", lambda: SimpleNamespace(propose=propose))
    response = client.post("/api/runs", files={"file": ("renamed.wav", AUDIO, "audio/wav")},
                           data={"title": "Тест", "synthetic": "true"})
    assert response.status_code == 201
    run_id = response.json()["run_id"]
    detail = wait_for(client, run_id, "awaiting_approval")
    assert detail["run"]["synthetic"] is True
    assert detail["run"]["source_mode"] == detail["proposal"]["source_mode"] == "real"
    assert runtime.get_run(run_id).synthetic is True
    assert proposed[0].segments == segments
    assert transcribe.call_count == 1


def test_manifest_cannot_approve_nonfictional_audio(tmp_path):
    audio = tmp_path / "recording.wav"
    audio.write_bytes(AUDIO)
    with pytest.raises(ValueError, match="полностью вымышленные"):
        trusted_audio.verify_audio(str(audio), manifest(tmp_path, synthetic=False))


def test_unlisted_upload_fails_before_stt_and_propose(client, tmp_path, monkeypatch):
    runtime = configure_runtime(client, manifest(tmp_path))
    transcribe = Mock(side_effect=AssertionError("Unapproved audio must not reach STT"))
    runner = Mock(side_effect=AssertionError("Unapproved audio must not reach LLM"))
    monkeypatch.setattr(pipeline.stt, "transcribe", transcribe)
    monkeypatch.setattr(runtime, "runner", runner)
    response = client.post("/api/runs", files={"file": ("test.wav", AUDIO + b"not approved", "audio/wav")},
                           data={"synthetic": "true"})
    assert response.status_code == 201
    detail = wait_for(client, response.json()["run_id"], "error")
    assert detail["run"]["synthetic"] is False
    assert "SHA-256" in detail["steps"][-1]["content"]
    transcribe.assert_not_called()
    runner.assert_not_called()


def test_audio_modified_by_stt_cannot_reach_llm(client, tmp_path, monkeypatch):
    runtime = configure_runtime(client, manifest(tmp_path))

    def changed_audio(path, lang):
        path.write_bytes(AUDIO + b"changed")
        return [Segment(start=0, end=1, speaker="SPEAKER_00", text="изменённый текст")]

    runner = Mock(side_effect=AssertionError("Changed audio must not reach LLM"))
    monkeypatch.setattr(pipeline.stt, "transcribe", changed_audio)
    monkeypatch.setattr(runtime, "runner", runner)
    response = client.post("/api/runs", files={"file": ("test.wav", AUDIO, "audio/wav")})
    detail = wait_for(client, response.json()["run_id"], "error")
    assert "изменился" in detail["steps"][-1]["content"]
    runner.assert_not_called()


def test_builtin_demo_keeps_existing_hosted_permission(client):
    runtime = configure_runtime(client, None)
    assert runtime.guard_llm_destination(Run(title="Built-in demo", synthetic=True)) is None
