# Первый независимый замер AI v0.2

Дата: 2026-09-23. Входы и эталон были зафиксированы отдельно до первого содержательного вызова модели. Только 12 вручную написанных вымышленных транскриптов; исходные записи и их производные не использованы. Модель `gpt-6-luna`, продуктовый `backend.agents.runner.propose()` и `backend.app.llm`, 14 вызовов на 12 случаев (два repair). Все 12 случаев вернули Proposal. Локальную LLM и аудио здесь не измеряли.

## Воспроизведение

```sh
.venv/bin/python eval/ai_quality_v2/check.py validate
.venv/bin/python eval/ai_quality_v2/check.py guard
LLM_API_KEY='<dev key>' .venv/bin/python eval/ai_quality_v2/check.py run --hosted --base-url https://api.openai.com/v1 --model gpt-6-luna --output eval/ai_quality_v2/<new_raw_name>.json
.venv/bin/python eval/ai_quality_v2/check.py score --strict --output eval/ai_quality_v2/first_luna_proposals_raw.json
.venv/bin/python eval/ai_quality_v2/check.py score --output eval/ai_quality_v2/first_luna_proposals_raw.json
```

`guard`: PASS 2/2 — битый индекс и неподтверждённая цитата отклонены с событием `error`.

Изначальный строгий baseline: **6/12 PASS**. Повторная ручная сверка того же raw без нового вызова модели: **8/12 PASS**. Разница вызвана двумя правилами checker: дополнительные корректные `speaker_uncertain`/`deadline_unknown` не являются потерей обязательных причин review; `deadline_candidates` вправе сохранять дословные русские формулировки вместо ISO. Эталон и raw не изменялись после первого содержательного замера. `--strict` сохраняет воспроизводимость исходного счёта.

## По случаям (ручная семантическая сверка raw)

| Случай | Результат | Конкретная ошибка |
|---|---|---|
| ru_self | PASS | — |
| ru_other_mention | PASS | — |
| ru_blurry_name | FAIL | Имя говорящего оставлено неизвестным, `Speaker.candidate_names` и review заполнены, но `AssignmentDraft.assignee_candidates` пуст. |
| ru_same_first_name | FAIL | Два одноимённых кандидата говорящего сохранены, но список кандидатов ответственного пуст. |
| kk_self | PASS | — |
| kk_other | PASS | — |
| mixed_external | PASS | Внешний отдел стал ответственным и не стал говорящим. |
| unknown_overlap | PASS | Дополнительная причина `speaker_uncertain` корректна для `speaker=null`. |
| two_tasks_one_segment | PASS | Два отдельных поручения и разные сроки сохранены. |
| true_deadline_conflict | PASS | Срок оставлен неизвестным; обе произнесённые даты и `deadline_conflict` сохранены. |
| unapproved_move | FAIL | После неутверждённого предложения перенести срок на 19.10 действующий согласованный срок 16.10 обнулился; конфликт оставлен на review. |
| mixed_unknown_owner | FAIL | Из действия выпал объект («тізімін»), осталось только «дайындау керек»; `scope_incomplete` отсутствует. |

Пустые кандидаты ответственного ухудшают подсказку секретарю, но не создают ложного назначения: `assignee=null`, speaker review сохранён. Случаи `unapproved_move` и `mixed_unknown_owner` требуют исправления или обязательной ручной правки до утверждения: первый теряет действующий срок, второй допускает бессодержательное поручение без соответствующей причины review. Этот замер не доказывает готовность полного audio → approve → export пути.

До успешного измерения были две сохранённые ошибки транспорта: `first_luna_raw.json` — 401 из-за placeholder `LLM_API_KEY=local`; `first_luna_authenticated_raw.json` — 400 из-за ошибочного выбора `max_tokens` в eval harness. Они не являются модельными ответами. Содержательный результат хранится в `first_luna_proposals_raw.json`; файл не перезаписывался.

SHA-256: inputs `d1139b7308374d2edcfccc43690e9a5d8c6738e574966b4f72fd18afbbc0d27a`; expected `825d3dfb94bb638dcd8be6583b45f920e91022e8f26fef03c7c679b4267daab7`; raw `05798b6b232d1e106fc479a71e11d12df7462cc3440dac21cae5f50f598dbf7d`. Frozen product versions: runner `266737962543bbf02c8f8570e73db75ef4b1a694f3661b0a324d34ce9a8c6f44`, grounding `c82de8bfd688d58077a8bbd19e492823b9632907fbe6f2b51a76f6fbc47ad8d8`, deadlines `84061f330ac89a87900a3f456c157c074c31ed3c0fbc840b74e7017c4f896003`, prompt `d5c2610e24efc64093e002268163ed8e6b64b9f76070e4f5d815b7661c8d7653`.
