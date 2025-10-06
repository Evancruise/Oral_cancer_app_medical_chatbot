import winston from 'winston';

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

export default logger;