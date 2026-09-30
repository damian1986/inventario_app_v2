FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client && rm -rf /var/lib/apt/lists/*

RUN groupadd -r appgroup && useradd -r -g appgroup appuser

WORKDIR /app
COPY requirements.txt .

# PIP_EXTRA: por defecto vacío (TLS estricto, ideal para el VPS).
# En equipos con interceptación TLS (antivirus/proxy local) compilar con:
#   docker compose build --build-arg PIP_EXTRA="--trusted-host pypi.org --trusted-host files.pythonhosted.org" backend
ARG PIP_EXTRA=""
RUN pip install --no-cache-dir $PIP_EXTRA -r requirements.txt

RUN mkdir -p /app/backups

COPY . .
RUN chown -R appuser:appgroup /app

USER appuser

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
