import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { collectDefaultMetrics, Counter, Histogram, Registry } from "prom-client";

// Shared registry for this process
const register = new Registry();
collectDefaultMetrics({ register });

// Export a few commonly used metrics for other modules to import if needed
export const pipelineLatencyMs = new Histogram({
  name: "pipeline_latency_ms",
  help: "End-to-end pipeline latency in milliseconds",
  buckets: [50, 100, 200, 500, 1000, 2000, 5000, 10000],
  registers: [register],
});

export const llmTokenCostUsd = new Histogram({
  name: "llm_token_cost_usd",
  help: "LLM token cost in USD per request",
  buckets: [0.0001, 0.001, 0.005, 0.01, 0.05, 0.1],
  registers: [register],
});

export const cacheHitTotal = new Counter({
  name: "cache_hit_total",
  help: "Total cache hits",
  registers: [register],
});

export const pipelineFailReasonTotal = new Counter({
  name: "pipeline_fail_reason_total",
  help: "Pipeline failure reason counts",
  labelNames: ["reason"],
  registers: [register],
});

export default fp(async function metricsPlugin(fastify: FastifyInstance) {
  fastify.get("/metrics", async (_req, reply) => {
    reply.header("Content-Type", register.contentType);
    return register.metrics();
  });
});


