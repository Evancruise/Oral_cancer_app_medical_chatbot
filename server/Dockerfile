FROM python:3.11-slim

RUN pip install --upgrade pip setuptools wheel
RUN pip config set global.timeout 120
RUN pip config set global.retries 20
RUN pip config set global.trusted-host "files.pythonhosted.org pypi.org"

WORKDIR /app
COPY requirements.txt .

RUN pip install -r requirements.txt
COPY . .

ENV PORT=8080
EXPOSE 8080
CMD ["python", "app.py"]
