Deploy Dialoqbase on Kubernetes

Quick start with Helm

```bash
helm upgrade --install dbase ./helm/dialoqbase \
  --set image.repository=your-registry/dialoqbase \
  --set image.tag=latest \
  --set ingress.hosts[0].host=dialoqbase.local
```

Resources and Probes
- Requests: 250m CPU / 512Mi RAM; Limits: 1 CPU / 2Gi RAM
- Readiness/Liveness: `/docs` endpoint

Env and Secrets
- See `values.yaml`: `env` for non-sensitive; `secretEnv` for sensitive
- Important: `DATABASE_URL`, `REDIS_URL`, model API keys

Scaling and SLO
- HPA targets 70% CPU; adjust based on `/metrics` P95 latency
- Suggested SLO: P95 < 1500ms for standard QA; Availability 99.9%
- Monitor: `pipeline_latency_ms`, `llm_token_cost_usd`, `cache_hit_total`, `pipeline_fail_reason_total`

Canary / Rollback
- Use `helm upgrade` with small `replicaCount` bump
- Rollback: `helm rollback dbase <REVISION>`

OTEL / Metrics
- OTLP endpoint default: `http://otel-collector:4318/v1/traces`
- Scrape `/metrics` via Prometheus


