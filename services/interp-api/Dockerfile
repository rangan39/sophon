FROM python:3.11-slim AS builder

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1
ENV VIRTUAL_ENV=/opt/venv
ENV PATH="/opt/venv/bin:$PATH"

RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential git \
  && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml README.md ./
COPY sophon_interp ./sophon_interp

RUN python -m venv "$VIRTUAL_ENV" \
  && pip install --upgrade pip \
  && pip install .

FROM python:3.11-slim AS runner

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV VIRTUAL_ENV=/opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY --from=builder /opt/venv /opt/venv

RUN groupadd --system --gid 1001 sophon \
  && useradd --system --uid 1001 --gid sophon sophon \
  && mkdir -p /cache/huggingface /cache/torch \
  && chown -R sophon:sophon /app /cache

USER sophon

EXPOSE 8000

CMD ["uvicorn", "sophon_interp.api:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
