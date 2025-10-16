FROM node:20

WORKDIR /app

RUN npm install

COPY . .

ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build

EXPOSE 3000
CMD ["npm", "start"]