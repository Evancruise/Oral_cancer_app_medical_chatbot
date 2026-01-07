FROM python:3.10-slim

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

CMD ["gunicorn", "-b", "0.0.0.0:8080", "app:app"]