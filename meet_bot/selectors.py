"""Meet UI labels live here; update against a real test account when Google changes UI."""

JOIN = ("Join now", "Ask to join", "Присоединиться", "Попросить присоединиться")
MICROPHONE = ("Turn off microphone", "Выключить микрофон")
CAMERA = ("Turn off camera", "Выключить камеру")
CHAT = ("Chat with everyone", "Chat", "Чат со всеми", "Чат")
SEND = ("Send a message", "Send", "Отправить сообщение", "Отправить")
CAPTIONS = ("Turn on captions", "Включить субтитры")
PEOPLE = ("Show everyone", "People", "Показать всех", "Участники")
LEAVE = ("Leave call", "Покинуть встречу", "Выйти из звонка")
DENIED = ("You can't join this video call", "Вам отказано в доступе")


async def first_button(page, labels):
    for label in labels:
        item = page.get_by_role("button", name=label, exact=True)
        if await item.count() and await item.first.is_visible():
            return item.first
    return None
