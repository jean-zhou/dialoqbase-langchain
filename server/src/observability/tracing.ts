import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";

// Enable verbose logs in development
if (process.env.OTEL_DEBUG === "1") {
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
}

const exporter = new OTLPTraceExporter({
  // Default to localhost collector
  url: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || "http://localhost:4318/v1/traces",
  headers: {},
});

const sdk = new NodeSDK({
  traceExporter: exporter,
  serviceName: process.env.OTEL_SERVICE_NAME || "dialoqbase-server",
  instrumentations: [getNodeAutoInstrumentations()],
});

// Start immediately
sdk.start().catch((err) => {
  // Do not crash the app if tracing fails to start
  console.error("OpenTelemetry SDK start error:", err);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  sdk.shutdown().catch(() => undefined);
});


