import { scrapeSchoolStaff } from "./scraper.mjs";

const argv = process.argv.slice(2);

if (!argv.length || argv.includes("--help") || argv.includes("-h")) {
  printHelp();
  process.exit(0);
}

const parsed = parseArgs(argv);

try {
  const result = await scrapeSchoolStaff(parsed);
  console.log(`Completed in ${formatDuration(result.durationMs)}.`);
  console.log(`Visited ${result.visitedPages} pages.`);
  console.log(`Found ${result.matchedTeachers} STEM teachers.`);
  if (result.blockedPages?.length) {
    const sampledLabel = result.blockedProbeSamplingUsed && result.crawlBlocked ? " sampled" : "";
    console.log(`Blocked pages: ${result.blockedPages.length}/${result.visitedPages}${sampledLabel}.`);
    if (result.blockedSummary?.breakdown?.length) {
      const breakdown = result.blockedSummary.breakdown.map((entry) => `${entry.label} x${entry.count}`).join(", ");
      console.log(`Blocked patterns: ${breakdown}`);
    }
    if (result.crawlBlocked) {
      console.log(result.blockedProbeSamplingUsed
        ? "The crawl was blocked before the site content loaded, so the scraper stopped after a small blocked-url sample."
        : "The crawl was blocked before the site content loaded.");
    }
    const shown = Math.min(3, result.blockedPages.length);
    for (const [index, page] of result.blockedPages.slice(0, shown).entries()) {
      const parts = [page.blocked?.summary, page.url].filter(Boolean).join(" - ");
      console.log(`Blocked sample ${index + 1}/${shown}: ${parts}`);
      if (page.blocked?.snippet) {
        console.log(`  ${page.blocked.snippet}`);
      }
    }
  }
  if (result.failedPages?.length) {
    console.log(`Failed pages: ${result.failedPages.length}/${result.visitedPages}.`);
    if (result.failedSummary?.breakdown?.length) {
      const breakdown = result.failedSummary.breakdown.map((entry) => `${entry.label} x${entry.count}`).join(", ");
      console.log(`Failure patterns: ${breakdown}`);
    }
    if (result.crawlFailed) {
      console.log("The crawl failed before any page content loaded.");
    }
    const shown = Math.min(3, result.failedPages.length);
    for (const [index, page] of result.failedPages.slice(0, shown).entries()) {
      const parts = [page.error, page.url].filter(Boolean).join(" - ");
      console.log(`Failed sample ${index + 1}/${shown}: ${parts}`);
    }
  }
  if (result.topTeachers.length) {
    console.log("Top teachers:");
    for (const teacher of result.topTeachers) {
      const summary = [teacher.name, teacher.role, teacher.school_name].filter(Boolean).join(" - ");
      console.log(`${teacher.rank}. ${summary}`);
    }
  } else {
    console.log("No STEM teachers matched the filter.");
  }
  console.log(`CSV: ${result.outputPath}`);
} catch (error) {
  console.error(error.message || String(error));
  process.exit(1);
}

function parseArgs(args) {
  const options = {
    url: "",
    outputPath: "",
    topCount: 25,
    concurrency: 4,
    headless: true,
    verbose: !args.includes("--quiet"),
    useAi: !args.includes("--no-ai"),
  };

  const positionals = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--top") {
      options.topCount = Number(args[index + 1] || 10);
      index += 1;
      continue;
    }
    if (value === "--headful") {
      options.headless = false;
      continue;
    }
    if (value === "--headless") {
      options.headless = true;
      continue;
    }
    if (value === "--output") {
      options.outputPath = args[index + 1] || "";
      index += 1;
      continue;
    }
    if (value === "--model") {
      options.openRouterModel = args[index + 1] || "moonshotai/kimi-k2";
      index += 1;
      continue;
    }
    if (value === "--max-pages") {
      options.maxPages = Number(args[index + 1] || 40);
      index += 1;
      continue;
    }
    if (value === "--concurrency") {
      options.concurrency = Number(args[index + 1] || 4);
      index += 1;
      continue;
    }
    if (value === "--challenge-wait-ms") {
      options.challengeWaitMs = Number(args[index + 1] || 8000);
      index += 1;
      continue;
    }
    if (value === "--quiet") {
      options.verbose = false;
      continue;
    }
    if (!value.startsWith("--")) {
      positionals.push(value);
    }
  }

  options.url = positionals[0] || "";
  if (positionals[1] && !options.outputPath) {
    options.outputPath = positionals[1];
  }
  return options;
}

function printHelp() {
  console.log(`School STEM Staff Scraper

Usage:
  node src/cli.mjs <url> [output.csv] [--top 10] [--headful] [--no-ai]
  ./fetch.sh <url> [output.csv] [--top 10] [--headful] [--no-ai]

Options:
  --output <path>    Write CSV to a specific path
  --top <count>      Print the top N teachers in the console summary
  --max-pages <n>    Limit the crawl size
  --concurrency <n>  Visit multiple pages in parallel
  --challenge-wait-ms <n>
                     Extra wait for bot-check interstitials before classifying as blocked
  --model <name>     Override the OpenRouter model
  --headful          Show the Chromium browser window
  --quiet            Reduce progress logging
  --no-ai            Disable OpenRouter enrichment
`);
}

function formatDuration(durationMs) {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }
  if (durationMs < 10000) {
    return `${(durationMs / 1000).toFixed(1)}s`;
  }
  return `${Math.round(durationMs / 1000)}s`;
}
