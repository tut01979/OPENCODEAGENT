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

# Copiar solo lo necesario del builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist
# Mantener las rutas de uploads y base de datos
RUN mkdir -p uploads data
# Copiar las credenciales si están en el repo (OJO: mejor si las montas con Docker Volumes luego)
COPY gmail-credentials.json* .
COPY service-account.json* .
COPY token.json* .
COPY .env .

# Variables de entorno por defecto
ENV NODE_ENV=production

# El bot se inicia desde el archivo index comprimido
CMD ["node", "dist/index.js"]
