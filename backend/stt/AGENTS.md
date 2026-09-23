# backend/stt — Alibi (модель и adapter), Meiirlan (интеграция)

Интерфейс для остального кода один:
`transcribe(audio_path: Path, lang: str = "rukk") -> list[Segment]` (Segment из backend/shared/schemas.py).

Модель: `alibiserikbay/kazakh-russian-mixed-stt` (Apache-2.0, публичная).
- wav2vec2 + CTC, TorchScript: грузить через `torch.jit.load`, НЕ через transformers `from_pretrained`.
- `asr/rukk` — казахско-русская смешанная речь за один проход; `asr/kk`, `asr/ru` — одноязычные.
- Вход строго 16 кГц моно float32. Любой файл сначала через ffmpeg.
- VAD — `vad/vad.onnx` из того же репо; длинные реплики до 18 секунд. Не удалять тишину со сдвигом исходных timestamps.
- Жадный CTC в MVP. KenLM вне freeze: прирост на отдельном KK benchmark нельзя обещать для нашего mixed meeting pipeline.
- Диаризация pyannote.audio 4.0.7 + Community-1, локальный CPU по STACK; принять gated условия и скачать заранее. Нет меток слов: хранить сегментные. Waveform в памяти избегает лишнего файлового декодирования.
- Не считать VAD диаризацией и не назначать всем SPEAKER_00 при сбое. Unknown/null и review_reasons при overlap; короткие реплики проверять, контекст не смешивать уверенно с соседним голосом.
- Сначала smoke env; не ломать рабочий baseline для переустановки пакетов. Local ADM weights и HF artifact могут отличаться: проверять hash и соответствующий tokens.lst.
- Автоматический mapper предлагает имена, человек подтверждает. Число участников не равно числу голосов. Поручение внешнему юристу не создаёт новый акустический speaker.
- Прогнать RU, KK и mixed по DATA.md. Существующие 27.52 с — только acoustic inference, 16/16 — ручная обнаружимость. Не записывать их как E2E accuracy.
- Не клонировать репо модели целиком (9 ГБ): `snapshot_download(..., allow_patterns=["asr/rukk/*", "vad/*", "config.json"])`.

Файлы: engine.py (модель, Alibi), diarize.py (pyannote), audio.py (ffmpeg → wav 16k).
STT_MODE=mock возвращает сегменты из data/seed/demo_meeting.json.
Все mock outputs явно помечены. Данные встреч не отправлять в Brev/OpenAI; до подтверждения правил Brev только для синтетики. Planning-only — без изменений engine/adapter.
