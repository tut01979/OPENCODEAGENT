# Force rebuild 2026-03-29
FROM node:20-slim AS builder

# Instalar dependencias para compilar módulos nativos (necesario para sqlite y canvas si fallan)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    pkg-config \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./
RUN npm install

# Copiar código fuente
COPY . .

# Compilar TypeScript a JavaScript
RUN npm run build

# --- Stage de Producción ---
FROM node:20-slim

# Instalar librerías de sistema necesarias en ejecución (especialmente para PDF y Canvas)
RUN apt-get update && apt-get install -y \
    libcairo2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libjpeg62-turbo \
    libgif7 \
    librsvg2-2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Crear directorios para datos y credenciales
RUN mkdir -p /app/data /app/credentials /app/uploads

# Copiar solo lo necesario del builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist

# Forzamos copiar desde /app/data (builder) hacia ./credentials para que
# los archivos actualizados anulen los del volumen persistente en Railway.
COPY --from=builder /app/data/gmail-credentials.json* ./credentials/
COPY --from=builder /app/service-account.json* ./
COPY --from=builder /app/token.json* ./

# Variables de entorno por defecto (en Railway se configuran en el Dashboard)
ENV NODE_ENV=production

# El bot se inicia desde el archivo index comprimido
CMD ["node", "dist/index.js"]
