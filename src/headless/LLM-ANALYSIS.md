# LLM-Powered Game Balance Analysis

Run bot training and send results to a local LLM (LM Studio / OpenAI-compatible API) for analysis.

## Prerequisites

- Node.js installed
- LM Studio running with a model loaded (e.g. Qwen 3)
- LM Studio API server enabled (default port 1234)

## Usage

### Local (LM Studio on same machine)

```bash
node src/headless/analyze-with-llm.js --games=200
```

### Remote (LM Studio on another machine, e.g. Windows GPU box)

```bash
node src/headless/analyze-with-llm.js --games=200 --api=http://YOUR_WINDOWS_IP:1234/v1
```

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--games=N` | 200 | Number of games to simulate |
| `--api=URL` | `http://localhost:1234/v1` | OpenAI-compatible API endpoint |
| `--model=NAME` | auto-detect | Model name override |

### Environment variables

| Variable | Description |
|----------|-------------|
| `LLM_API_URL` | Base URL of API (same as `--api`) |
| `LLM_MODEL` | Model name (same as `--model`) |

## What it does

1. Runs N headless bot games using the current bot config
2. Computes stats: score/wave distribution, efficiency, upgrade frequency
3. Sends a structured prompt to the LLM with game context and training data
4. Streams the LLM's balance analysis to stdout

If the LLM connection fails, the training data is still printed so you can paste it into any LLM manually.
