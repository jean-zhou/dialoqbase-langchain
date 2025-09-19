import json
import time
import yaml
import requests
from pathlib import Path

# Minimal scaffold: call playground chat API and compute simple accuracy proxy
# For production, integrate ragas/deepeval metrics.

ROOT = Path(__file__).parent

def load_config():
    with open(ROOT / 'config.yaml', 'r', encoding='utf-8') as f:
        return yaml.safe_load(f)

def iter_jsonl(path):
    with open(path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            yield json.loads(line)

def main():
    cfg = load_config()
    api = cfg['api_base']
    ds_path = ROOT / 'datasets' / 'qa.jsonl'
    out_dir = ROOT.parent.parent / 'docs' / 'eval'
    out_dir.mkdir(parents=True, exist_ok=True)

    results = []
    for item in iter_jsonl(ds_path):
        q = item['query']
        bot_id = item.get('bot_id', 'demo')
        t0 = time.time()
        try:
            resp = requests.post(
                f"{api}/api/v1/bot/playground/{bot_id}/chat",
                json={"message": q},
                timeout=cfg.get('timeout_s', 30)
            )
            resp.raise_for_status()
            data = resp.json()
            ans = data.get('bot', {}).get('text', '')
            latency_ms = int((time.time() - t0) * 1000)
            results.append({
                'id': item['id'],
                'query': q,
                'answer_gt': item.get('answer_gt', ''),
                'answer_model': ans,
                'latency_ms': latency_ms,
            })
        except Exception as e:
            results.append({
                'id': item['id'],
                'query': q,
                'error': str(e),
            })

    with open(out_dir / 'report.json', 'w', encoding='utf-8') as f:
        json.dump({'results': results}, f, ensure_ascii=False, indent=2)
    print(f"Saved {len(results)} results to {out_dir / 'report.json'}")

if __name__ == '__main__':
    main()


