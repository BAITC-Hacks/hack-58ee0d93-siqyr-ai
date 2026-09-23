"""Форматы записи совещания для загрузки: расширение, заявленный MIME и сигнатура контейнера.

Список ограничен контейнерами, которые ffmpeg переводит в 16 кГц mono для STT. Сигнатура по первым байтам
отсекает переименованный документ или exe до очереди; файл сохраняется с расширением фактического контейнера.
Декодируемость и длительность здесь не проверяются — это делает ffmpeg в STT.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class RecordingFormat:
    id: str
    label: str
    extensions: tuple[str, ...]  # первое — расширение для хранения, если имя файла не совпало с содержимым
    mime_types: tuple[str, ...]


FORMATS = (
    RecordingFormat("wav", "WAV", (".wav",), ("audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave")),
    RecordingFormat("mp3", "MP3", (".mp3",), ("audio/mpeg", "audio/mp3")),
    RecordingFormat("mp4", "M4A / MP4 / MOV / 3GP", (".m4a", ".mp4", ".mov", ".3gp"),
                    ("audio/mp4", "audio/x-m4a", "audio/m4a", "video/mp4", "video/quicktime", "video/3gpp", "audio/3gpp", "application/mp4")),
    RecordingFormat("aac", "AAC", (".aac",), ("audio/aac", "audio/x-aac", "audio/aacp")),
    RecordingFormat("ogg", "OGG / Opus", (".ogg", ".oga", ".opus"), ("audio/ogg", "audio/opus", "application/ogg")),
    RecordingFormat("webm", "WebM / MKV", (".webm", ".mkv"), ("audio/webm", "video/webm", "video/x-matroska", "audio/x-matroska")),
    RecordingFormat("flac", "FLAC", (".flac",), ("audio/flac", "audio/x-flac")),
    RecordingFormat("wma", "WMA", (".wma",), ("audio/x-ms-wma", "video/x-ms-asf")),
    RecordingFormat("amr", "AMR", (".amr",), ("audio/amr", "audio/amr-wb")),
    RecordingFormat("aiff", "AIFF", (".aif", ".aiff"), ("audio/aiff", "audio/x-aiff")),
    RecordingFormat("avi", "AVI", (".avi",), ("video/x-msvideo", "video/avi")),
    RecordingFormat("mpeg", "MPEG", (".mpeg", ".mpg"), ("video/mpeg",)),
)
BY_ID = {f.id: f for f in FORMATS}
EXTENSIONS = {e: f for f in FORMATS for e in f.extensions}
MIME_TYPES = dict.fromkeys(m for f in FORMATS for m in f.mime_types)
# Браузеры на Windows шлют octet-stream или пустой тип для .opus/.mkv/.amr: тогда решает сигнатура.
GENERIC_TYPES = {"", "application/octet-stream", "binary/octet-stream"}
ACCEPT = ",".join([*EXTENSIONS, *MIME_TYPES])  # готовое значение для <input type="file" accept>
NAMES = ", ".join(e[1:].upper() for e in EXTENSIONS)
ASF = bytes.fromhex("3026b2758e66cf11a6d900aa0062ce6c")


class UnsupportedRecording(ValueError):
    pass


def check_declared(filename: str | None, content_type: str | None) -> str:
    """Расширение из белого списка и MIME аудио/видео; возвращает расширение в нижнем регистре."""
    suffix = Path(filename or "").suffix.lower()
    if suffix not in EXTENSIONS:
        raise UnsupportedRecording(f"Формат «{suffix or 'без расширения'}» не принимается. Загрузите запись совещания: {NAMES}.")
    declared = (content_type or "").split(";")[0].strip().lower()
    if not (declared in GENERIC_TYPES or declared in MIME_TYPES or declared.startswith(("audio/", "video/"))):
        raise UnsupportedRecording(f"Тип файла {declared} — не аудио и не видео. Загрузите запись совещания: {NAMES}.")
    return suffix


def check_content(suffix: str, head: bytes) -> str:
    """Контейнер по первым байтам; возвращает расширение для хранения, согласованное с содержимым."""
    found = sniff(head)
    if found is None:
        raise UnsupportedRecording(f"Содержимое файла не похоже на аудио- или видеозапись {suffix.upper()[1:]}: "
                                   f"возможно, это переименованный документ или файл повреждён. Допустимы: {NAMES}.")
    return suffix if suffix in found.extensions else found.extensions[0]


def sniff(head: bytes) -> RecordingFormat | None:
    if head[:3] == b"ID3" and len(head) >= 10:
        # ID3v2 перед MP3/AAC/FLAC: размер тега syncsafe, пропускаем его и смотрим контейнер за ним.
        size = 10 + (head[6] << 21 | head[7] << 14 | head[8] << 7 | head[9]) + (10 if head[5] & 0x10 else 0)
        return sniff(head[size:]) or BY_ID["mp3"]
    tag, kind = head[:4], head[8:12]
    if tag in (b"RIFF", b"RF64", b"BW64") and kind == b"WAVE":
        return BY_ID["wav"]
    if tag == b"RIFF" and kind == b"AVI ":
        return BY_ID["avi"]
    if tag == b"FORM" and kind in (b"AIFF", b"AIFC"):
        return BY_ID["aiff"]
    if head[4:8] in (b"ftyp", b"moov", b"mdat", b"wide", b"free"):  # ISO BMFF и старый QuickTime
        return BY_ID["mp4"]
    if tag == b"OggS":
        return BY_ID["ogg"]
    if tag == b"\x1a\x45\xdf\xa3":  # EBML
        return BY_ID["webm"]
    if tag == b"fLaC":
        return BY_ID["flac"]
    if head[:16] == ASF:
        return BY_ID["wma"]
    if head[:5] == b"#!AMR":
        return BY_ID["amr"]
    if tag in (b"\x00\x00\x01\xba", b"\x00\x00\x01\xb3"):
        return BY_ID["mpeg"]
    if len(head) >= 3 and head[0] == 0xFF:
        if (head[1] & 0xF6) == 0xF0:  # ADTS: синхрослово 0xFFF, layer 00
            return BY_ID["aac"]
        # Кадр MPEG audio без ID3: синхрослово 0xFFE, layer не 00, bitrate не 1111, частота не 11.
        if (head[1] & 0xE0) == 0xE0 and (head[1] & 0x06) and (head[2] >> 4) != 0xF and ((head[2] >> 2) & 3) != 3:
            return BY_ID["mp3"]
    return None


def formats_view(max_upload_mb: int) -> dict:
    return {"max_upload_mb": max_upload_mb, "accept": ACCEPT, "extensions": list(EXTENSIONS),
            "formats": [{"id": f.id, "label": f.label, "extensions": list(f.extensions), "mime_types": list(f.mime_types)}
                        for f in FORMATS]}
