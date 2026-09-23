# Фронтенд: сборка Vite -> статика в nginx. Контекст сборки — корень репо.
FROM node:22-alpine AS build
WORKDIR /app
# Адрес, который открывают пользователи: nginx отдаёт на нём и фронт, и /api.
ARG VITE_API_URL=http://localhost:5173
ENV VITE_API_URL=$VITE_API_URL VITE_FAKE=0
# Строго по package-lock: сборка воспроизводима, без тихого npm install.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

FROM nginx:1.31-alpine
COPY infra/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
