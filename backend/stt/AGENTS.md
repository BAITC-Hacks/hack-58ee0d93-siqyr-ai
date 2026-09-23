# backend/stt — Alibi (модель) + Meiirlan (сервис)

Интерфейс для остального кода один:
`transcribe(audio_path: Path, lang: str = "rukk") -> list[Segment]` (Segment из backend/shared/schemas.py).

Модель: `alibiserikbay/kazakh-russian-mixed-stt` (Apache-2.0, публичная).
- wav2vec2 + CTC, TorchScript: грузить через `torch.jit.load`, НЕ через transformers `from_pretrained`.
- `asr/rukk` — казахско-русская смешанная речь за один проход; `asr/kk`, `asr/ru` — одноязычные.
- Вход строго 16 кГц моно float32. Любой файл сначала через ffmpeg.
- Нарезка на 10–20 с куски — `vad/vad.onnx` из того же репо.
- Жадный CTC-декодинг в MVP. KenLM (−4 WER, +3 ГБ) — в cut list.
- Нет меток говорящих и таймкодов слов: сначала диаризация (pyannote, нужен HF_TOKEN), потом распознаём каждую реплику.
- Не клонировать репо модели целиком (9 ГБ): `snapshot_download(..., allow_patterns=["asr/rukk/*", "vad/*", "config.json"])`.

Файлы: engine.py (модель, Alibi), diarize.py (pyannote), audio.py (ffmpeg → wav 16k).
STT_MODE=mock возвращает сегменты из data/seed/demo_meeting.json.
