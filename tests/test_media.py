"""Приём записи: белый список расширений, MIME аудио/видео и сигнатура контейнера по первым байтам."""
import pytest

from backend.app import media

WAV = b"RIFF\x24\0\0\0WAVEfmt "
MP3 = b"\xff\xfb\x90\x64" + bytes(28)
M4A = b"\0\0\0\x20ftypM4A \0\0\0\0isomM4A mp42"
OGG = b"OggS\0\x02" + bytes(26)
WEBM = b"\x1a\x45\xdf\xa3\x9f\x42\x86\x81\x01\x42\xf7\x81\x01"
FLAC = b"fLaC\0\0\0\x22" + bytes(24)


@pytest.mark.parametrize("name, head, stored", [
    ("meeting.wav", WAV, ".wav"),
    ("long.wav", b"RF64\xff\xff\xff\xffWAVEds64", ".wav"),
    ("dictaphone.mp3", MP3, ".mp3"),
    ("tagged.mp3", b"ID3\x04\0\0\0\0\0\x05" + bytes(5) + MP3, ".mp3"),
    ("stream.aac", b"\xff\xf1\x50\x80\x2e\x7f\xfc", ".aac"),
    ("Запись разговора.m4a", M4A, ".m4a"),
    ("teams.mp4", b"\0\0\0\x18ftypmp42\0\0\0\0mp42isom", ".mp4"),
    ("iphone.mov", b"\0\0\0\x14ftypqt  \0\0\0\0", ".mov"),
    ("android.3gp", b"\0\0\0\x18ftyp3gp4\0\0\0\0", ".3gp"),
    ("telegram.ogg", OGG, ".ogg"),
    ("voice.opus", OGG, ".opus"),
    ("meet.webm", WEBM, ".webm"),
    ("obs.mkv", WEBM, ".mkv"),
    ("studio.flac", FLAC, ".flac"),
    ("tagged.flac", b"ID3\x03\0\0\0\0\0\x04" + bytes(4) + FLAC, ".flac"),
    ("old.wma", media.ASF + bytes(16), ".wma"),
    ("phone.amr", b"#!AMR\n" + bytes(10), ".amr"),
    ("mac.aiff", b"FORM\0\0\0\0AIFFCOMM", ".aiff"),
    ("camera.avi", b"RIFF\0\0\0\0AVI LIST", ".avi"),
    ("dvd.mpg", b"\0\0\x01\xba" + bytes(12), ".mpg"),
])
def test_recording_formats_are_recognised(name, head, stored):
    suffix = media.check_declared(name, "application/octet-stream")
    assert media.check_content(suffix, head) == stored


@pytest.mark.parametrize("name, head, stored", [
    ("meeting.mp3", M4A, ".m4a"),   # телефон сохранил AAC в MP4, а файл переименовали
    ("meeting.webm", OGG, ".ogg"),
    ("meeting.wav", MP3, ".mp3"),
])
def test_stored_suffix_follows_container(name, head, stored):
    assert media.check_content(media.check_declared(name, None), head) == stored


@pytest.mark.parametrize("head", [b"%PDF-1.7\n%\xe2\xe3", b"MZ\x90\0\x03\0\0\0", b"PK\x03\x04\x14\0\x06\0",
                                  b"\x89PNG\r\n\x1a\n", "протокол совещания".encode(), b"RIFF\0\0\0\0WEBPVP8 ", b"x"])
def test_renamed_documents_are_rejected(head):
    with pytest.raises(media.UnsupportedRecording, match="не похоже на аудио"):
        media.check_content(".mp3", head)


@pytest.mark.parametrize("name, content_type", [("setup.exe", "application/octet-stream"), ("meeting", "audio/wav"),
                                                ("notes.txt", "text/plain"), ("protocol.docx", None),
                                                ("meeting.wav", "text/plain"), ("meeting.mp3", "image/png")])
def test_declared_name_or_type_rejected(name, content_type):
    with pytest.raises(media.UnsupportedRecording):
        media.check_declared(name, content_type)


@pytest.mark.parametrize("name, content_type", [("M.MP3", "audio/mpeg; charset=binary"), ("m.opus", ""),
                                                ("m.ogg", "application/ogg"), ("m.m4a", "audio/x-m4a"),
                                                ("m.mkv", "video/x-matroska"), ("m.amr", None), ("m.mp4", "application/mp4")])
def test_declared_media_types_accepted(name, content_type):
    assert media.check_declared(name, content_type) == name[name.rindex("."):].lower()


def test_upload_keeps_recording_under_detected_container(client):
    phone = client.post("/api/runs", files={"file": ("Запись разговора.m4a", M4A, "audio/x-m4a")}, data={"meeting_date": "2026-09-23"})
    assert phone.status_code == 201, phone.text
    assert (client.settings.uploads_dir / f"{phone.json()['run_id']}.m4a").read_bytes() == M4A
    renamed = client.post("/api/runs", files={"file": ("meeting.mp3", M4A, "audio/mpeg")}, data={"meeting_date": "2026-09-23"})
    assert renamed.status_code == 201, renamed.text
    run_id = renamed.json()["run_id"]
    assert (client.settings.uploads_dir / f"{run_id}.m4a").is_file()
    assert not (client.settings.uploads_dir / f"{run_id}.mp3").exists()


@pytest.mark.parametrize("upload", [("protocol.mp3", b"%PDF-1.7\n" + bytes(64), "audio/mpeg"),
                                    ("meeting.wav", WAV, "text/plain"), ("notes.txt", b"hello", "text/plain")])
def test_upload_rejects_non_recordings(client, upload):
    response = client.post("/api/runs", files={"file": upload}, data={"meeting_date": "2026-09-23"})
    assert response.status_code == 415, response.text
    assert "MP3, M4A" in response.json()["detail"]  # пользователю перечислены допустимые форматы
    assert not list(client.settings.uploads_dir.iterdir())
    assert client.get("/api/runs").json() == []


def test_formats_endpoint_lists_accepted_recordings(client):
    body = client.get("/api/formats").json()
    assert body["max_upload_mb"] == client.settings.max_upload_mb
    accept = body["accept"].split(",")
    assert {".wav", ".mp3", ".m4a", ".mp4", ".webm", ".ogg", ".opus"} <= set(body["extensions"]) <= set(accept)
    assert {"audio/webm", "audio/mpeg", "video/mp4"} <= set(accept)
    assert {f["id"] for f in body["formats"]} >= {"wav", "mp3", "mp4", "ogg", "webm", "flac"}
