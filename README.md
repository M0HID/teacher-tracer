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
./fetch.sh https://example-school.edu --quiet
```

## Output

- CSV with ranked STEM teachers and contact details.
- Live progress logs during crawling, then a console summary with top-ranked teachers and the CSV path.
