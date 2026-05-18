# ============================================================
# TPS-703 ATP Automation System — Production Dockerfile
# Multi-stage build: Node (frontend) → Python (backend + static)
# ============================================================

# ---------- Stage 1: Build the React frontend ----------
FROM node:20-alpine AS frontend-build

WORKDIR /app/frontend

# Install dependencies first (layer caching)
COPY tps703-atp/frontend/package.json tps703-atp/frontend/package-lock.json ./
RUN npm ci

# Copy frontend source and build
COPY tps703-atp/frontend/ ./
RUN npm run build

# ---------- Stage 2: Python backend + built frontend ----------
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies for compiled Python packages
RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc && \
    rm -rf /var/lib/apt/lists/*

# Install Python dependencies first (layer caching)
COPY tps703-atp/backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source
COPY tps703-atp/backend/ ./

# Copy built frontend into backend/static so FastAPI can serve it
COPY --from=frontend-build /app/frontend/dist ./static

# Render injects $PORT at runtime; locally we fall back to 8000.
ENV PORT=8000
EXPOSE 8000

# Run with uvicorn — bind to 0.0.0.0 so Docker networking works.
# Use sh -c so $PORT is expanded from the env at start time.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
