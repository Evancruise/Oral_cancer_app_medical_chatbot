import winston from 'winston';
import 'dotenv/config';
import fs from 'fs';

function logToFile(message, level = "INFO") {
  const timestamp = new Date().toISOString().replace('T', ' ').split('.')[0];
  const logLine = `[${timestamp}] [${level}] ${message}\n`;
  console.log(logLine.trim());

  if (process.env.NODE_ENV === "development") {
    fs.appendFileSync('./db_dev.log', logLine);
  } else if (process.env.NODE_ENV === "production") {
    fs.appendFileSync("./db_prod.log", logLine);
  }
}

/*
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine((
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
    )),
    defaultMeta: { 
        service: 'acquisitions-api',
        pod: process.env.POD_NAME || 'unknown'
    },
    transports: [
        // new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
        // new winston.transports.File({ filename: 'logs/combined.log' }),
        new winston.transports.Console()
    ],
});

if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple(),
        )
    }));
}

console.log(">>> LOADING logger.js from acquisitions-api");
*/

export { logToFile };