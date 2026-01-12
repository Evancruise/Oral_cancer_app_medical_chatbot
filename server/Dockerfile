FROM python:3.10

# ===== system deps =====
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# ===== workdir =====
WORKDIR /app

# ===== copy deps =====
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ===== copy source =====
COPY . .

# ===== expose =====
ENV PORT=8080
ENV GUNICORN_CMD_ARGS="--workers 1 --threads 1 --timeout 180"

RUN python - <<EOF
import timm, torch, transformers
import google.cloud.tasks_v2 as t
print("timm OK", timm.__version__)
print("torch OK", torch.__version__)
print("hf OK", transformers.__version__)
print("tasks_v2 OK", t)
EOF

CMD gunicorn app:app --bind 0.0.0.0:8080