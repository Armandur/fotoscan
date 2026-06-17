FROM python:3.12-slim

# exiftool krävs för metadata-export (XMP + EXIF).
# libpango/cairo/gdk-pixbuf + fonts krävs för weasyprint (PDF-album-export).
RUN apt-get update && apt-get install -y --no-install-recommends \
        libimage-exiftool-perl \
        libpango-1.0-0 libpangocairo-1.0-0 libpangoft2-1.0-0 \
        libcairo2 libgdk-pixbuf-2.0-0 libffi8 \
        fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY app ./app

ENV PHOTO_DIR=/photos \
    DATA_DIR=/data \
    EXPORT_DIR=/export \
    PORT=8810

EXPOSE 8810

CMD ["uv", "run", "--no-dev", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8810"]
