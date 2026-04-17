# Teacher Tracer

Playwright-based scraper for school or district sites that discovers staff pages, extracts science/math/STEM teachers, enriches the results, and exports them to CSV.

## Setup

```bash
./fetch.sh setup
```

Optional AI enrichment uses OpenRouter:

```bash
export OPENROUTER_API_KEY="your-key"
export OPENROUTER_MODEL="moonshotai/kimi-k2"
```

## Usage

```bash
./fetch.sh https://example-school.edu
./fetch.sh https://example-school.edu output/custom.csv --top 10
./fetch.sh --headful https://example-school.edu
./fetch.sh https://example-school.edu --concurrency 6
./fetch.sh https://example-school.edu --challenge-wait-ms 12000
./fetch.sh https://example-school.edu --quiet
```

If a site serves an anti-bot interstitial instead of the real page, the scraper now reports the blocked pages explicitly (for example Cloudflare challenge pages) instead of silently returning zero matches. When that happens, it samples a small set of representative staff/directory URLs and stops instead of hammering more guessed pages.

## Output

- CSV with ranked STEM teachers and contact details.
- Live progress logs during crawling, then a console summary with top-ranked teachers and the CSV path.
