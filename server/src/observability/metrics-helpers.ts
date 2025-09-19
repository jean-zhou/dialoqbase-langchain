import { context, trace, Span, SpanStatusCode } from "@opentelemetry/api";
import { pipelineLatencyMs, llmTokenCostUsd, cacheHitTotal, pipelineFailReasonTotal } from "../plugins/metrics";

export function startSpan(name: string, attributes?: Record<string, any>): Span {
  const tracer = trace.getTracer("dialoqbase-server");
  const span = tracer.startSpan(name);
  if (attributes) {
    for (const [k, v] of Object.entries(attributes)) {
      span.setAttribute(k, v as any);
    }
  }
  return span;
}

export function endSpan(span: Span, error?: unknown) {
  if (error) {
    span.recordException(error as any);
    span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
  } else {
    span.setStatus({ code: SpanStatusCode.OK });
  }
  span.end();
}

export function observePipelineLatency(ms: number) {
  pipelineLatencyMs.observe(ms);
}

export function observeTokenCostUSD(cost: number) {
  llmTokenCostUsd.observe(cost);
}

export function incCacheHit() {
  cacheHitTotal.inc();
}

export function incFail(reason: string) {
  pipelineFailReasonTotal.labels({ reason }).inc();
}


