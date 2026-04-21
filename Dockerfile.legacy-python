# ── Build stage ───────────────────────────────────────────────────────────────
FROM python:3.11-slim AS base

WORKDIR /app

# System deps for Playwright + httpx
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl \
        wget \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Playwright browser (chromium only — kept small)
RUN playwright install chromium --with-deps

# ── App source ────────────────────────────────────────────────────────────────
COPY . .

# Persistent data directory (mount a volume here in production)
RUN mkdir -p /app/data

# ── Dashboard image ───────────────────────────────────────────────────────────
FROM base AS dashboard
EXPOSE 8501
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD curl -f http://localhost:8501/_stcore/health || exit 1
ENTRYPOINT ["streamlit", "run", "dashboard/app.py", \
            "--server.port=8501", "--server.address=0.0.0.0", \
            "--server.headless=true"]

# ── Scraper / pipeline image ──────────────────────────────────────────────────
FROM base AS scraper
ENTRYPOINT ["python", "main.py"]

# Scheduler image
FROM base AS scheduler
ENTRYPOINT ["python", "scheduler.py"]
