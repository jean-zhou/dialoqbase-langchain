import Redis from "ioredis";
import crypto from "crypto";
import { parseRedisUrl } from "./redis";

let redisClient: Redis | null = null;

function getRedis(): Redis | null {
  try {
    if (redisClient) return redisClient;
    const redis_url = process.env.DB_REDIS_URL || process.env.REDIS_URL;
    if (!redis_url) return null;
    const parsed = parseRedisUrl(redis_url);
    if (!parsed) return null;
    redisClient = new Redis({
      host: parsed.host,
      port: parsed.port,
      password: parsed.password,
      username: process?.env?.DB_REDIS_USERNAME,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    // Best-effort connect
    redisClient.connect().catch(() => undefined);
    return redisClient;
  } catch {
    return null;
  }
}

export function stableHash(input: unknown): string {
  const json = typeof input === "string" ? input : JSON.stringify(input);
  return crypto.createHash("sha1").update(json).digest("hex");
}

export function makeKey(parts: (string | number | boolean | null | undefined)[]): string {
  return parts.map((p) => String(p ?? "")).join(":");
}

export async function getJson<T>(key: string): Promise<T | null> {
  const r = getRedis();
  if (!r) return null;
  try {
    const val = await r.get(key);
    if (!val) return null;
    return JSON.parse(val) as T;
  } catch {
    return null;
  }
}

export async function setJsonTTL(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    const payload = JSON.stringify(value);
    const ttl = ttlSeconds ?? Number(process.env.DB_CACHE_TTL_S || 600);
    if (ttl > 0) {
      await r.setex(key, ttl, payload);
    } else {
      await r.set(key, payload);
    }
  } catch {
    // ignore
  }
}


