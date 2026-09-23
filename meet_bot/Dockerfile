FROM mcr.microsoft.com/playwright/python:v1.55.0-noble
WORKDIR /app
COPY meet_bot/requirements.txt /app/meet_bot/requirements.txt
RUN pip install --no-cache-dir -r /app/meet_bot/requirements.txt && apt-get update && apt-get install -y --no-install-recommends xvfb ffmpeg && rm -rf /var/lib/apt/lists/*
COPY meet_bot /app/meet_bot
ENV BOT_PROFILE_DIR=/data/profile OUTPUT_DIR=/data/output BOT_BIND_HOST=0.0.0.0
VOLUME ["/data"]
EXPOSE 8100
CMD ["xvfb-run", "-a", "python", "-m", "meet_bot", "serve"]
