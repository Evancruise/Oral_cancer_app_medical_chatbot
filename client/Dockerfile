FROM node:18-alpine

WORKDIR /app

# 只需要 client 的 package.json
COPY package*.json ./

RUN npm install --production

# 把 client 所有程式碼複製進 image
COPY . .

ENV PORT=8080
EXPOSE 8080

# 確保 Express 會 listen 在 PORT
CMD ["node", "src/index.js"]