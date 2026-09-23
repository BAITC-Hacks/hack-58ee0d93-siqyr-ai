from __future__ import annotations

import argparse
import asyncio
import json
import signal
import uuid

from .bot import BotJob, MeetBot
from .config import Config
from .import_run import import_run


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m meet_bot")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("login")
    join = commands.add_parser("join")
    join.add_argument("--url", required=True)
    join.add_argument("--session-id")
    join.add_argument("--title", default="Google Meet")
    bridge = commands.add_parser("import-run", help="Импорт локальной записи в текущий API Siqyr")
    bridge.add_argument("--session-id", required=True)
    bridge.add_argument("--title", required=True)
    commands.add_parser("serve")
    args = parser.parse_args()
    config = Config()
    config.validate()
    if args.command == "login":
        asyncio.run(MeetBot(config).login())
    elif args.command == "join":
        job = BotJob(meet_url=args.url, session_id=args.session_id or uuid.uuid4().hex, title=args.title)
        async def run_join():
            loop = asyncio.get_running_loop()
            try:
                loop.add_signal_handler(signal.SIGINT, job.stop.set)
            except NotImplementedError:
                signal.signal(signal.SIGINT, lambda *_: loop.call_soon_threadsafe(job.stop.set))
            await MeetBot(config).run(job)
        asyncio.run(run_join())
        print(json.dumps(job.public(), ensure_ascii=False))
    elif args.command == "import-run":
        print(json.dumps(asyncio.run(import_run(args.session_id, args.title, config)), ensure_ascii=False))
    else:
        import uvicorn
        uvicorn.run("meet_bot.service:app", host=config.bind_host, port=8100, reload=False)


if __name__ == "__main__":
    main()
