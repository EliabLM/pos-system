# pos-system-app — Expo SDK 57 (React Native + expo-router)
# En docker solo levantamos el bundle WEB (`expo start --web`) para smoke testing local.
# El testing en dispositivo/emulador se hace FUERA de docker (`pnpm start`) apuntando
# EXPO_PUBLIC_API_URL al server. Ver docs/deployment/docker-local.md.
# `--ignore-workspace`: vease nota en pos-system-server/Dockerfile.

FROM node:22-alpine
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@10.7.1 --activate
WORKDIR /app

COPY package.json ./
RUN pnpm install --ignore-workspace --no-frozen-lockfile

COPY . .

ENV EXPO_WEB_PORT=8082
EXPOSE 8082

CMD ["pnpm", "exec", "expo", "start", "--web", "--host", "0.0.0.0", "--port", "8082"]