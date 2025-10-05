# Hugging Face Docker for Node.js (Express)
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev

COPY . .
EXPOSE 7860
CMD ["node", "src/index.js"]
