FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential git \
  && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml README.md ./
COPY sophon_interp ./sophon_interp

RUN pip install --upgrade pip \
  && pip install -e .

EXPOSE 8000

CMD ["uvicorn", "sophon_interp.api:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000", "--reload"]
