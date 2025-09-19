Offline evaluation scaffold

Structure:
- datasets/
  - qa.jsonl
  - summarize.jsonl
- run_eval.py (Ragas/DeepEval based)
- config.yaml (API endpoint, params, prompt_version)

Usage:
1) Prepare API and set prompt_version/flags in config.yaml
2) Run Python script to call API and compute metrics
3) Outputs JSON + HTML report into docs/eval/


