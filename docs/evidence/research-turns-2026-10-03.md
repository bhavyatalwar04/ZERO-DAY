# Research turns after the one-turn prompt (2026-10-03)

Model `qwen/qwen3.8-27b`, 12 eval cases, each run starting on an empty token window. **ok 5/12.**

| Case | Status | Model turns | Input tokens | Latency ms | Error |
|---|---|---|---|---|---|
| panic-1 | error | 1 | 1529 | 3785 | tool_use_failed: Groq 400: {"error":{"message":"Failed to call a function. Please adjust y |
| panic-2 | ok | 2 | 4084 | 3698 |  |
| avgdown-1 | error | 1 | 1499 | 7979 | tool_use_failed: Groq 400: {"error":{"message":"Failed to call a function. Please adjust y |
| avgdown-2 | error | 1 | 1497 | 3796 | tool_use_failed: Groq 400: {"error":{"message":"Failed to call a function. Please adjust y |
| revenge-1 | ok | 2 | 4108 | 3746 |  |
| revenge-2 | ok | 3 | 6679 | 2409 |  |
| news-1 | ok | 2 | 3976 | 2118 |  |
| news-2 | ok | 2 | 3973 | 2044 |  |
| oversized-1 | error | 0 | 0 | 139 | rate_limited: All 1 Groq keys returned 429: Rate limit reached for model `qwen/qwen3.8-27b |
| oversized-2 | error | 0 | 0 | 112 | rate_limited: All 1 Groq keys returned 429: Rate limit reached for model `qwen/qwen3.8-27b |
| overtrade-1 | error | 1 | 1434 | 661 | rate_limited: All 1 Groq keys returned 429: Rate limit reached for model `qwen/qwen3.8-27b |
| overtrade-2 | error | 0 | 0 | 134 | rate_limited: All 1 Groq keys returned 429: Rate limit reached for model `qwen/qwen3.8-27b |
