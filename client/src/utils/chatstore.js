import { redis, redis_publisher } from "#config/redisclient.js";

export const add_message_to_session = async (session_id, role, content) => {
  const key = `chat:${session_id}`;

  const message = {
    role,
    content,
    timestamp: new Date().toISOString(),
  };

  await redis.rpush(key, JSON.stringify(message));
  await redis.ltrim(key, -process.env.MAX_MESSAGES, -1);
  await redis.expire(key, process.env.TTL_SECONDS);
  await redis_publisher.publish(`channel:${session_id}`, JSON.stringify(message));
};

export const get_session_messages = async (session_id) => {
  const key = `chat:${session_id}`;
  const messages = await redis.lrange(key, 0, -1);
  return messages.map(msg => JSON.parse(msg));
};

export const clearSession = async (session_id) => {
  await redis.del(`chat:${session_id}`);
};