import Redis from 'ioredis';
import logger from '#config/logger.js';

const redis_url = process.env.REDIS_URL || "redis://localhost:6379";

export const redis_publisher = new Redis(redis_url);
export const redis_subscriber = new Redis(redis_url);

redis_publisher.on("connect", () => logger.info("Redis publisher connected"));
redis_subscriber.on("connect", () => logger.info("Redis subscriber connected"));
