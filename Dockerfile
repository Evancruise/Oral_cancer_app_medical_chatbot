# -----------------------------------
#   Build Flask + Node.js Container
# -----------------------------------

FROM python:3.10-slim as python-base
WORKDIR /app/server

COPY server/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server/ .

# -----------------------------------
#   client: Install Node.js
# -----------------------------------

FROM node:18-slim as node-base

WORKDIR /app/client

COPY client/package*.json ./
RUN npm install --production

COPY client/ .

# ------------------------------------
#   Combined Both
# ------------------------------------

FROM node:18-slim

# Install python
RUN apt-get update && apt-get install -y python3 python3-pip && apt-get clean

# Copy node.js app
WORKDIR /app
COPY --from=node-base /app/client ./client

# Copy flask app
COPY --from=python-base /app/server ./server

# Install python deps
RUN pip3 install -r server/requirements.txt

# -------------------------------
#   Start servers
# -------------------------------
ENV PORT=8080

CMD ["base", "-c", "python3 server/app.py & cd client & node src/index.js"]