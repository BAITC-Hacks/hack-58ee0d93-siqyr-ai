# Фронтенд: сборка Vite -> статика в nginx. Контекст сборки — корень репо.
FROM node:22-alpine AS build
WORKDIR /app
ARG VITE_API_URL=http://localhost:8000
ENV VITE_API_URL=$VITE_API_URL VITE_FAKE=0
COPY frontend/ .
RUN if [ -f pnpm-lock.yaml ]; then corepack enable && pnpm install --frozen-lockfile && pnpm build; \
    else (npm ci || npm install) && npm run build; fi

FROM nginx:alpine
COPY infra/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
