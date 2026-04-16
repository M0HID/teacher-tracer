import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { getDomain } from "tldts";

const STEM_KEYWORDS = [
  ["math", /\b(math|mathematics|algebra|geometry|calculus|statistics|statistical|trigonometry|quantitative)\b/i],
  ["science", /\b(science|biology|chemistry|physics|environmental|earth science|life science|physical science|anatomy|astronomy|geology|biomedical)\b/i],
  ["stem", /\b(stem|steam|engineering|robotics|computer science|coding|programming|technology education|tech ed|tech education|technology|digital|digital learning|maker|innovation|design lab|data science)\b/i],
];

const TEACHER_SIGNAL = /\b(teacher|educator|faculty|instructor|professor|department chair|department head|interventionist|specialist)\b/i;
const EXPLICIT_STEM_ROLE_SIGNAL = /\b(science teacher|math teacher|stem teacher|teacher, science|teacher, math|teacher, stem|computer science|engineering|robotics|physics|chemistry|biology|algebra|geometry|calculus|statistics|technology education)\b/i;
const STEM_STAFF_SIGNAL = /\b(digital learning leader|tech ed|tech education|technology teacher|technology integration|stem coach|science coach|math coach|math specialist|science specialist|stem specialist|robotics|engineering|computer science|data science)\b/i;
const NEGATIVE_ROLE_SIGNAL = /\b(principal|assistant principal|guidance|counselor|clerical|secretary|custodian|nurse|social worker|psychologist|paraeducator|paraprofessional|superintendent|manager|transportation|food service|board|school board|board member|vice chair|chair|term expiring|coach|athletic director|bookkeeper)\b/i;
const INVALID_NAME_SIGNAL = /^(read more|watch now|learn more|staff directory|search results|home)$/i;
const STRONG_LINK_SIGNAL = /\b(staff|faculty|directory|directories)\b/i;
const SCHOOL_LINK_SIGNAL = /\b(school|high school|middle school|elementary|academy|campus|district)\b/i;
const STEM_LINK_SIGNAL = /\b(science|math|mathematics|stem|steam|engineering|robotics|computer science|departments?)\b/i;
const SOFT_LINK_SIGNAL = /\b(about|contact|academics|curriculum|departments?)\b/i;
const NEGATIVE_LINK_SIGNAL = /\b(calendar|news|events|athletics|sports|employment|jobs|board|policy|meal|lunch|bus|transportation|facebook|instagram|youtube|twitter|login|powerschool|schoology|students|parents|families|alumni|donate|fundraiser)\b/i;
const FILE_LINK_SIGNAL = /\.(pdf|jpg|jpeg|png|gif|docx?|xlsx?|pptx?)$/i;

const STATE_CODES = "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC";
const STREET_SUFFIXES = "Street|St|Road|Rd|Avenue|Ave|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Circle|Cir|Way|Highway|Hwy|Route|Rt|Parkway|Pkwy|Place|Pl|Terrace|Ter|Trail|Trl|Loop|Center|Ctr|Broadway|Turnpike|Tpke";
const ADDRESS_REGEX = new RegExp(`\\b\\d{1,6}\\s+[A-Za-z0-9.'#-]+(?:\\s+[A-Za-z0-9.'#-]+){0,7}\\s+(?:${STREET_SUFFIXES})\\b[\\s,]+[A-Za-z][A-Za-z.'-]*(?:\\s+[A-Za-z][A-Za-z.'-]*){0,4}[\\s,]+(?:${STATE_CODES})\\s+\\d{5}(?:-\\d{4})?`, "gi");

const DEFAULTS = {
  outputPath: "",
  topCount: 25,
  maxPages: 40,
  concurrency: 4,
  minLinkScore: 10,
  maxAiCandidates: 120,
  timeoutMs: 45000,
  networkIdleTimeoutMs: 1500,
  postLoadDelayMs: 200,
  postScrollDelayMs: 120,
  scrollDurationMs: 900,
  headless: true,
  verbose: true,
  useAi: Boolean(process.env.OPENROUTER_API_KEY),
  openRouterModel: process.env.OPENROUTER_MODEL || "moonshotai/kimi-k2",
};

export async function scrapeSchoolStaff(inputOptions) {
  const options = { ...DEFAULTS, ...inputOptions };
  options.topCount = normalizePositiveInteger(options.topCount, DEFAULTS.topCount);
  options.maxPages = normalizePositiveInteger(options.maxPages, DEFAULTS.maxPages);
  options.concurrency = normalizePositiveInteger(options.concurrency, DEFAULTS.concurrency);
  options.maxAiCandidates = normalizePositiveInteger(options.maxAiCandidates, DEFAULTS.maxAiCandidates);
  options.timeoutMs = normalizePositiveInteger(options.timeoutMs, DEFAULTS.timeoutMs);
  options.networkIdleTimeoutMs = normalizePositiveInteger(options.networkIdleTimeoutMs, DEFAULTS.networkIdleTimeoutMs);
  options.postLoadDelayMs = normalizeNonNegativeInteger(options.postLoadDelayMs, DEFAULTS.postLoadDelayMs);
  options.postScrollDelayMs = normalizeNonNegativeInteger(options.postScrollDelayMs, DEFAULTS.postScrollDelayMs);
  options.scrollDurationMs = normalizeNonNegativeInteger(options.scrollDurationMs, DEFAULTS.scrollDurationMs);
  const startedAt = Date.now();
  const logger = createLogger(options, startedAt);
  const startUrl = normalizeUrl(inputOptions.url);
  if (!startUrl) {
    throw new Error("A valid school website URL is required.");
  }

  const scope = createScope(startUrl);
  logger.log(`Starting school scrape for ${startUrl}`);
  logger.log(`Crawl settings: concurrency ${options.concurrency}, max pages ${options.maxPages}, AI ${options.useAi ? `on (${options.openRouterModel})` : "off"}`);
  const browser = await chromium.launch({ headless: options.headless });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });

  try {
    const crawl = await crawlSite(context, startUrl, scope, options, logger);
    logger.log(`Crawl complete: ${crawl.pages.length} pages visited, ${crawl.rawCandidates.length} raw candidates found`);
    const merged = mergeCandidates(crawl.rawCandidates);
    logger.log(`Merging and scoring ${merged.length} candidate profiles`);
    const heuristicPool = merged
      .map((candidate, index) => enrichCandidateHeuristically(candidate, crawl.addressBook, index))
      .sort((left, right) => right.heuristicScore - left.heuristicScore);

    const enriched = options.useAi
      ? await enrichWithOpenRouter(heuristicPool, crawl, options, logger).catch((error) => {
          logger.log(`AI enrichment failed, falling back to heuristics: ${error.message}`);
          return heuristicPool.filter((item) => item.include);
        })
      : heuristicPool.filter((item) => item.include);

    const focusedRecords = focusRecordsToInstitution(enriched.filter((record) => shouldKeepRecord(record)), crawl.pages[0]?.title || "");
    const finalRecords = sortFinalRecords(focusedRecords).map((record, index) => formatOutputRecord(record, index + 1));
    const outputPath = await writeCsv(finalRecords, options.outputPath || defaultOutputPath(startUrl));
    logger.log(`Wrote ${finalRecords.length} final records to ${outputPath}`);

    return {
      durationMs: Date.now() - startedAt,
      outputPath,
      visitedPages: crawl.pages.length,
      rawCandidates: crawl.rawCandidates.length,
      matchedTeachers: finalRecords.length,
      topTeachers: finalRecords.slice(0, options.topCount),
      pages: crawl.pages,
    };
  } finally {
    await context.close();
    await browser.close();
  }
}

async function crawlSite(context, startUrl, scope, options, logger) {
  const queue = [];
  const seen = new Set();
  const pages = [];
  const rawCandidates = [];
  const addresses = [];

  enqueue(queue, seen, {
    url: startUrl,
    score: 100,
    depth: 0,
    reason: "start",
  });

  let batchNumber = 0;
  while (queue.length && seen.size < options.maxPages) {
    const batch = dequeueBatch(queue, seen, options);
    if (!batch.length) {
      break;
    }

    batchNumber += 1;
    logger.log(`Crawl batch ${batchNumber}: visiting ${batch.length} page${plural(batch.length)} in parallel; scheduled ${seen.size}/${options.maxPages}; queued ${queue.length}`);

    const batchStartedAt = Date.now();
    const snapshots = await Promise.all(
      batch.map((next, index) => visitQueuedPage(context, next, scope, options, logger, { batchNumber, slot: index + 1, total: batch.length }))
    );

    let batchCandidates = 0;
    let batchDiscoveredLinks = 0;
    for (const { next, snapshot } of snapshots) {
      pages.push(snapshot.pageInfo);
      rawCandidates.push(...snapshot.candidates);
      addresses.push(...snapshot.addresses);
      batchCandidates += snapshot.candidates.length;

      const discoveredLinks = [...snapshot.links];
      discoveredLinks.push(...snapshot.generatedLinks);
      if (next.depth <= 1 && (snapshot.pageInfo.isLikelyHome || snapshot.pageInfo.isLikelySchoolHome)) {
        for (const guessedUrl of collectGuessUrls(snapshot.pageInfo.url)) {
          discoveredLinks.push({ href: guessedUrl, text: "guessed staff page", ariaLabel: "", guessed: true });
        }
      }
      batchDiscoveredLinks += discoveredLinks.length;

      for (const link of discoveredLinks) {
        const candidateUrl = normalizeUrlForQueue(link.href);
        if (!candidateUrl || seen.has(candidateUrl)) {
          continue;
        }

        const score = link.guessed
          ? link.generatedScore || 88
          : scoreLink(link, {
              currentUrl: snapshot.pageInfo.url,
              currentTitle: snapshot.pageInfo.title,
              depth: next.depth,
              isLikelyStaff: snapshot.pageInfo.isLikelyStaff,
              isLikelySchoolHome: snapshot.pageInfo.isLikelySchoolHome,
            });

        if (score < options.minLinkScore) {
          continue;
        }

        enqueue(queue, seen, {
          url: candidateUrl,
          score,
          depth: next.depth + 1,
          reason: collapseWhitespace(`${link.text || ""} ${link.ariaLabel || ""}`),
        });
      }
    }

    logger.log(`Batch ${batchNumber} complete in ${formatDuration(Date.now() - batchStartedAt)}: ${batchCandidates} candidates, ${batchDiscoveredLinks} links, queue now ${queue.length}`);
  }

  return {
    pages,
    rawCandidates,
    addressBook: buildAddressBook(addresses),
  };
}

async function visitQueuedPage(context, next, scope, options, logger, meta) {
  const page = await context.newPage();
  const startedAt = Date.now();

  try {
    const snapshot = await visitPage(page, next.url, scope, options, next);
    const candidateCount = snapshot.candidates.length;
    const linkCount = snapshot.links.length + snapshot.generatedLinks.length;
    const status = snapshot.error ? "failed" : "done";
    logger.log(`Page ${meta.batchNumber}.${meta.slot}/${meta.total} ${status}: ${shortUrl(snapshot.pageInfo.url)} -> ${candidateCount} candidate${plural(candidateCount)}, ${linkCount} link${plural(linkCount)} in ${formatDuration(Date.now() - startedAt)}`);
    return { next, snapshot };
  } finally {
    await page.close().catch(() => {});
  }
}

function dequeueBatch(queue, seen, options) {
  queue.sort((left, right) => right.score - left.score || left.depth - right.depth);
  const batch = [];
  const limit = Math.max(1, Math.min(options.concurrency, options.maxPages - seen.size));

  while (queue.length && batch.length < limit) {
    const next = queue.shift();
    if (!next || seen.has(next.url)) {
      continue;
    }
    seen.add(next.url);
    batch.push(next);
  }

  return batch;
}

async function visitPage(page, targetUrl, scope, options, context) {
  try {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: options.timeoutMs });
    await page.waitForLoadState("networkidle", { timeout: options.networkIdleTimeoutMs }).catch(() => {});
    if (options.postLoadDelayMs > 0) {
      await page.waitForTimeout(options.postLoadDelayMs);
    }
    const shouldScroll = await page
      .evaluate(() => {
        const bodyHeight = document.body?.scrollHeight || 0;
        const docHeight = document.documentElement?.scrollHeight || 0;
        const viewportHeight = window.innerHeight || 0;
        return Math.max(bodyHeight, docHeight) > viewportHeight * 1.25;
      })
      .catch(() => true);
    if (shouldScroll && options.scrollDurationMs > 0) {
      await autoScroll(page, options.scrollDurationMs);
      if (options.postScrollDelayMs > 0) {
        await page.waitForTimeout(options.postScrollDelayMs);
      }
    }
  } catch (error) {
      return {
        pageInfo: {
        url: targetUrl,
        title: `Failed: ${targetUrl}`,
        isLikelyStaff: false,
        isLikelySchoolHome: false,
        isLikelyHome: false,
        depth: context.depth,
      },
      links: [],
      generatedLinks: [],
      candidates: [],
      addresses: [],
      error: error.message,
    };
  }

  const actualUrl = normalizeUrlForQueue(page.url()) || targetUrl;
  const extracted = await page.evaluate(
    ({ currentUrl, registrableDomain }) => {
      const blockTags = new Set(["ARTICLE", "LI", "TR", "SECTION", "DIV"]);

      const clean = (value) =>
        String(value || "")
          .replace(/\u00a0/g, " ")
          .replace(/[ \t]+/g, " ")
          .replace(/\s*\n\s*/g, "\n")
          .replace(/\n{2,}/g, "\n")
          .trim();

      const compact = (value) => clean(value).replace(/\s+/g, " ").trim();
      const textOf = (element) => clean(element?.innerText || element?.textContent || "");
      const linesOf = (value) => clean(value).split(/\n+/).map(compact).filter(Boolean);

      const isWithinScope = (href) => {
        try {
          const parsed = new URL(href, currentUrl);
          if (!/^https?:$/.test(parsed.protocol)) {
            return false;
          }
          const host = parsed.hostname.toLowerCase();
          return host === registrableDomain || host.endsWith(`.${registrableDomain}`);
        } catch {
          return false;
        }
      };

      const isLikelyNameLine = (line) => {
        if (!line || line.length < 4 || line.length > 80) {
          return false;
        }
        if (/@|\d{3}[-.\s]?\d{3}|\b(phone|fax|teacher|science|math|stem|school|district|office|department|educator|specialist|principal|counselor|advisor|coach|search|select|jump to page|menu|translate|find us|stay connected)\b/i.test(line)) {
          return false;
        }
        const words = line.split(/\s+/).filter(Boolean);
        if (words.length < 2 || words.length > 5) {
          return false;
        }
        const titleCaseCount = words.filter((word) => {
          const cleaned = word.replace(/^[^A-Za-z]+|[^A-Za-z'.-]+$/g, "");
          return /^[A-Z][a-z'.-]+$/.test(cleaned) || /^[A-Z]\.$/.test(cleaned);
        }).length;
        const upperCaseCount = words.filter((word) => {
          const cleaned = word.replace(/^[^A-Za-z]+|[^A-Za-z'.-]+$/g, "");
          return /^[A-Z][A-Z'.-]+$/.test(cleaned) || /^[A-Z]\.$/.test(cleaned);
        }).length;
        return titleCaseCount >= Math.max(2, words.length - 1) || upperCaseCount >= Math.max(2, words.length - 1);
      };

      const looksLikeRoleLine = (line) => {
        if (!line || line.length < 3 || line.length > 140) {
          return false;
        }
        if (/@|\b(phone|fax)\b/i.test(line)) {
          return false;
        }
        return /\b(teacher|educator|faculty|instructor|science|math|mathematics|stem|steam|robotics|engineering|computer|physics|chemistry|biology|algebra|geometry|calculus|statistics|technology|maker|department|interventionist|specialist)\b/i.test(line) || /,/.test(line);
      };

      const looksLikeLocationLine = (line) => {
        if (!line || line.length < 4 || line.length > 120) {
          return false;
        }
        if (/@|\b(phone|fax)\b/i.test(line)) {
          return false;
        }
        return /\b(school|academy|campus|district|middle|elementary|high school|center|centre)\b/i.test(line);
      };

      const pickContainer = (seed) => {
        let current = seed instanceof Element ? seed : seed?.parentElement;
        while (current && current !== document.body) {
          const rawText = textOf(current);
          const text = compact(rawText);
          const lines = linesOf(rawText);
          const emailCount = (rawText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).length;
          if (blockTags.has(current.tagName) && text.length >= 30 && text.length <= 900 && lines.length >= 2 && lines.length <= 18 && current.children.length <= 40 && emailCount <= 1) {
            return current;
          }
          current = current.parentElement;
        }
        return null;
      };

      const extractCard = (container) => {
        const rawText = textOf(container);
        const text = compact(rawText);
        const lines = linesOf(rawText);
        const emails = Array.from(
          new Set([
            ...Array.from(container.querySelectorAll('a[href^="mailto:"]')).map((link) => (link.getAttribute("href") || "").replace(/^mailto:/i, "").split("?")[0].trim()),
            ...(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []),
          ].filter(Boolean).map((value) => value.toLowerCase()))
        );
        const phones = Array.from(
          new Set([
            ...Array.from(container.querySelectorAll('a[href^="tel:"]')).map((link) => (link.getAttribute("href") || "").replace(/^tel:/i, "").trim()),
            ...(text.match(/(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}/g) || []),
          ].filter(Boolean).map(compact))
        );

        const headingName = Array.from(container.querySelectorAll("h1, h2, h3, h4, h5, strong, b, [class*='name']"))
          .map((node) => compact(textOf(node)))
          .find((line) => isLikelyNameLine(line));

        const name = headingName || lines.find((line) => isLikelyNameLine(line)) || "";
        const role = lines.find((line) => line !== name && looksLikeRoleLine(line) && !emails.includes(line.toLowerCase()) && !phones.includes(line)) || "";
        const location = lines.find((line) => line !== name && line !== role && looksLikeLocationLine(line)) || "";
        const schoolLine = lines.find((line) => line !== name && line !== role && /\b(school|academy|campus|district)\b/i.test(line)) || location || "";

        return {
          name: compact(name),
          role: compact(role),
          location: compact(location),
          schoolLine: compact(schoolLine),
          snippet: lines.slice(0, 8).join(" | ").slice(0, 700),
          text: text.slice(0, 1600),
          emails,
          phones,
        };
      };

      const pageSignalText = `${document.title} ${location.href} ${textOf(document.body).slice(0, 5000)}`;
      const pageLooksStaff = /\b(staff|faculty|directory)\b/i.test(pageSignalText);
      const seenContainers = new Set();
      const containers = [];
      const seedNodes = Array.from(document.querySelectorAll("a[href^='mailto:'], a[href^='tel:'], h3, h4, h5, strong, b, [class*='name']"));

      for (const seed of seedNodes) {
        const container = pickContainer(seed);
        if (!container) {
          continue;
        }
        const key = compact(textOf(container)).slice(0, 240);
        if (!key || seenContainers.has(key)) {
          continue;
        }
        seenContainers.add(key);
        containers.push(container);
        if (containers.length >= 250) {
          break;
        }
      }

      if (pageLooksStaff) {
        const extras = Array.from(document.querySelectorAll("article, li, tr, section, div, .card"));
        for (const element of extras) {
          if (containers.length >= 250) {
            break;
          }
          const rawText = textOf(element);
          const text = compact(rawText);
          const emailCount = (rawText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).length;
          if (text.length < 40 || text.length > 900) {
            continue;
          }
          if (emailCount > 1) {
            continue;
          }
          const lines = linesOf(rawText);
          const hasName = lines.some((line) => isLikelyNameLine(line));
          const hasRole = lines.some((line) => looksLikeRoleLine(line));
          const hasMail = /@/.test(text);
          if (!(hasName && (hasRole || hasMail))) {
            continue;
          }
          const key = text.slice(0, 240);
          if (seenContainers.has(key)) {
            continue;
          }
          seenContainers.add(key);
          containers.push(element);
        }
      }

      const candidates = containers
        .map((container) => extractCard(container))
        .filter((card) => card.name || card.emails.length || /\b(teacher|science|math|stem)\b/i.test(`${card.role} ${card.text}`));

      const bodyText = clean(document.body?.innerText || "").slice(0, 50000);
      const links = Array.from(document.querySelectorAll("a[href]"))
        .map((anchor) => {
          const href = anchor.getAttribute("href") || "";
          let absolute;
          try {
            absolute = new URL(href, currentUrl).toString();
          } catch {
            absolute = "";
          }
          return {
            href: absolute,
            text: compact(anchor.innerText || anchor.textContent || ""),
            ariaLabel: compact(anchor.getAttribute("aria-label") || ""),
          };
        })
        .filter((link) => link.href && isWithinScope(link.href))
        .slice(0, 500);

      const addressBlocks = [];
      const seenAddressBlocks = new Set();
      for (const selector of ["address", "footer", "[class*='footer']", "[class*='contact']", "[class*='find']"]) {
        for (const element of document.querySelectorAll(selector)) {
          const text = compact(textOf(element));
          if (!text || text.length < 20 || seenAddressBlocks.has(text)) {
            continue;
          }
          seenAddressBlocks.add(text);
          addressBlocks.push(text);
          if (addressBlocks.length >= 25) {
            break;
          }
        }
        if (addressBlocks.length >= 25) {
          break;
        }
      }

      return {
        title: clean(document.title || ""),
        bodyText,
        links,
        candidates,
        addressBlocks,
        searchInfo: {
          hasDirectoryKeywordSearch: Boolean(document.querySelector('input[name="const_search_keyword"]')),
          directoryRoleId: compact(document.querySelector('input[name="const_search_role_ids"]')?.value || "1"),
          siteSearchActions: Array.from(document.querySelectorAll("form[action]"))
            .map((form) => {
              try {
                return new URL(form.getAttribute("action") || currentUrl, currentUrl).toString();
              } catch {
                return "";
              }
            })
            .filter((action) => action && /search-results/i.test(action) && isWithinScope(action)),
        },
      };
    },
    { currentUrl: actualUrl, registrableDomain: scope.registrableDomain }
  );

  const urlObject = new URL(actualUrl);
  const title = extracted.title || urlObject.hostname;
  const signalText = `${title} ${actualUrl} ${extracted.bodyText.slice(0, 8000)}`.toLowerCase();
  const isLikelyStaff = /\b(staff|faculty|directory)\b/.test(signalText) || extracted.candidates.length >= 4;
  const isLikelyHome = isHomeLikePath(urlObject.pathname);
  const isLikelySchoolHome = !isLikelyStaff && (SCHOOL_LINK_SIGNAL.test(title) || isLikelyHome);

  const pageAddresses = uniqueStrings([
    ...extractAddressesFromText(extracted.bodyText),
    ...extracted.addressBlocks.flatMap((block) => extractAddressesFromText(block)),
  ]).map((address) => ({
    address,
    pageUrl: actualUrl,
    pageTitle: title,
    host: urlObject.hostname,
    score: scoreAddress(address, title, actualUrl, isLikelySchoolHome),
  }));

  const candidates = extracted.candidates
    .map((candidate) => ({
      ...candidate,
      emails: uniqueStrings(candidate.emails).map((value) => value.toLowerCase()),
      phones: uniqueStrings(candidate.phones),
      sourcePageUrl: actualUrl,
      sourcePageTitle: title,
      sourceHost: urlObject.hostname,
      sourceDepth: context.depth,
      sourceLinkScore: context.score,
      pageIsLikelyStaff: isLikelyStaff,
      pageIsLikelySchoolHome: isLikelySchoolHome,
      pageSignal: collapseWhitespace(`${title} ${actualUrl}`),
    }))
    .filter((candidate) => candidate.name || candidate.emails.length || candidate.role);

  const generatedLinks = buildSearchQueryLinks(actualUrl, extracted.searchInfo, {
    isLikelyHome,
    isLikelySchoolHome,
    isLikelyStaff,
  });

  return {
    pageInfo: {
      url: actualUrl,
      title,
      isLikelyStaff,
      isLikelySchoolHome,
      isLikelyHome,
      depth: context.depth,
    },
    links: extracted.links,
    generatedLinks,
    candidates,
    addresses: pageAddresses,
  };
}

function enqueue(queue, seen, item) {
  const normalizedUrl = normalizeUrlForQueue(item.url);
  if (!normalizedUrl || seen.has(normalizedUrl)) {
    return;
  }

  const existing = queue.find((entry) => entry.url === normalizedUrl);
  if (existing) {
    if (item.score > existing.score) {
      existing.score = item.score;
      existing.depth = Math.min(existing.depth, item.depth);
      existing.reason = item.reason || existing.reason;
    }
    return;
  }

  queue.push({ ...item, url: normalizedUrl });
}

function collectGuessUrls(pageUrl) {
  const current = new URL(pageUrl);
  const basePath = current.pathname.replace(/\/+$/, "") || "/";
  const guesses = new Set();
  const baseCandidates = ["/staff", "/staff-directory", "/directory", "/faculty", "/teachers"];

  for (const candidate of baseCandidates) {
    guesses.add(new URL(candidate, current.origin).toString());
  }

  if (basePath !== "/") {
    for (const suffix of ["staff", "staff-directory", "directory", "faculty", "teachers"]) {
      guesses.add(new URL(`${basePath}/${suffix}`.replace(/\/+/g, "/"), current.origin).toString());
    }
  }

  return [...guesses].map((value) => normalizeUrlForQueue(value)).filter(Boolean);
}

function scoreLink(link, context) {
  let parsed;
  try {
    parsed = new URL(link.href);
  } catch {
    return -100;
  }

  const combined = collapseWhitespace(`${link.text || ""} ${link.ariaLabel || ""} ${link.href}`).toLowerCase();
  let score = 0;

  if (STRONG_LINK_SIGNAL.test(combined)) score += 80;
  if (STEM_LINK_SIGNAL.test(combined)) score += 35;
  if (SOFT_LINK_SIGNAL.test(combined)) score += 10;
  if (SCHOOL_LINK_SIGNAL.test(combined)) score += 14;
  if (context.depth === 0 && SCHOOL_LINK_SIGNAL.test(combined) && parsed.hostname !== new URL(context.currentUrl).hostname) score += 120;
  if (context.depth === 0 && parsed.hostname !== new URL(context.currentUrl).hostname && isHomeLikePath(parsed.pathname)) score += 90;
  if (NEGATIVE_LINK_SIGNAL.test(combined)) score -= 30;
  if (/\/default-board-post-page|\/post\//i.test(parsed.pathname)) score -= 40;
  if (FILE_LINK_SIGNAL.test(parsed.pathname)) score -= 80;
  if (/^(mailto|tel):/i.test(link.href)) score -= 90;
  if (context.isLikelyStaff && /(?:page(?:_|-)?no|const_page|page)=\d+/i.test(parsed.search)) score += 35;
  if (context.depth === 0 && parsed.hostname !== new URL(context.currentUrl).hostname) score += 8;
  if (isHomeLikePath(parsed.pathname)) score += 4;
  if (parsed.pathname === new URL(context.currentUrl).pathname && parsed.search === new URL(context.currentUrl).search) score -= 100;

  return score;
}

function mergeCandidates(candidates) {
  const merged = new Map();

  for (const candidate of candidates) {
    const key = buildCandidateKey(candidate);
    if (!key) {
      continue;
    }

    if (!merged.has(key)) {
      merged.set(key, {
        ...candidate,
        sourcePages: uniqueStrings([candidate.sourcePageUrl]),
        snippets: uniqueStrings([candidate.snippet]),
      });
      continue;
    }

    merged.set(key, mergeCandidateRecords(merged.get(key), candidate));
  }

  return [...merged.values()];
}

function mergeCandidateRecords(left, right) {
  const preferred = scoreRawCandidate(right) > scoreRawCandidate(left) ? right : left;
  const secondary = preferred === right ? left : right;

  return {
    ...secondary,
    ...preferred,
    emails: uniqueStrings([...(left.emails || []), ...(right.emails || [])]).map((value) => value.toLowerCase()),
    phones: uniqueStrings([...(left.phones || []), ...(right.phones || [])]),
    sourcePages: uniqueStrings([...(left.sourcePages || [left.sourcePageUrl]), ...(right.sourcePages || [right.sourcePageUrl])]),
    snippets: uniqueStrings([...(left.snippets || [left.snippet]), ...(right.snippets || [right.snippet])]),
    sourceLinkScore: Math.max(left.sourceLinkScore || 0, right.sourceLinkScore || 0),
    pageIsLikelyStaff: Boolean(left.pageIsLikelyStaff || right.pageIsLikelyStaff),
    pageIsLikelySchoolHome: Boolean(left.pageIsLikelySchoolHome || right.pageIsLikelySchoolHome),
    name: chooseBetterName(left.name, right.name),
    role: chooseBetterText(left.role, right.role),
    location: chooseBetterText(left.location, right.location),
    schoolLine: chooseBetterText(left.schoolLine, right.schoolLine),
    snippet: chooseBetterText(left.snippet, right.snippet),
    text: chooseBetterText(left.text, right.text),
  };
}

function enrichCandidateHeuristically(candidate, addressBook, index) {
  const normalizedName = chooseBetterName(candidate.name, inferNameFromSnippet(candidate.snippet));
  const normalizedRole = chooseBetterText(candidate.role, inferRoleFromSnippet(candidate.snippet, normalizedName));
  const normalizedCandidate = {
    ...candidate,
    name: normalizedName,
    role: normalizedRole,
  };

  const contextText = collapseWhitespace(
    [
      normalizedCandidate.name,
      normalizedCandidate.role,
      normalizedCandidate.location,
      normalizedCandidate.schoolLine,
      normalizedCandidate.snippet,
      normalizedCandidate.sourcePageTitle,
      normalizedCandidate.sourcePageUrl,
    ].join(" ")
  );

  const subjectTags = detectSubjectTags(contextText);
  const teacherSignal = TEACHER_SIGNAL.test(contextText) || EXPLICIT_STEM_ROLE_SIGNAL.test(contextText);
  const stemStaffSignal = STEM_STAFF_SIGNAL.test(contextText);
  const explicitRoleSignal = EXPLICIT_STEM_ROLE_SIGNAL.test(contextText);
  const negativeRole = NEGATIVE_ROLE_SIGNAL.test(normalizedCandidate.role || "") && !explicitRoleSignal;
  const mailingAddress = pickAddressForCandidate(normalizedCandidate, addressBook);
  const schoolName = pickSchoolName(normalizedCandidate);
  const completeness = (normalizedCandidate.emails[0] ? 1 : 0) + (normalizedCandidate.phones[0] ? 1 : 0) + (mailingAddress ? 1 : 0);

  let heuristicScore = 0;
  heuristicScore += subjectTags.reduce((total, tag) => total + (tag === "stem" ? 34 : 18), 0);
  if (teacherSignal) heuristicScore += 18;
  if (stemStaffSignal) heuristicScore += 28;
  if (explicitRoleSignal) heuristicScore += 22;
  if (candidate.pageIsLikelyStaff) heuristicScore += 10;
  if (candidate.sourceLinkScore >= 70) heuristicScore += 6;
  if (candidate.emails[0]) heuristicScore += 8;
  if (candidate.phones[0]) heuristicScore += 3;
  if (schoolName) heuristicScore += 3;
  heuristicScore += completeness * 4;
  if (negativeRole) heuristicScore -= 35;
  if (!candidate.name) heuristicScore -= 10;

  const include = subjectTags.length > 0 && (teacherSignal || stemStaffSignal) && heuristicScore >= 36 && !negativeRole;
  const confidence = Math.max(0.05, Math.min(0.99, heuristicScore / 100));
  const whyIncluded = buildWhyIncluded({ candidate: normalizedCandidate, subjectTags, teacherSignal, stemStaffSignal, mailingAddress });
  const { firstName, lastName } = splitName(normalizedCandidate.name);

  return {
    ...normalizedCandidate,
    candidateId: `candidate-${index + 1}`,
    include,
    heuristicScore,
    topScore: heuristicScore,
    confidence,
    subjectTags,
    mailingAddress,
    schoolName,
    whyIncluded,
    firstName,
    lastName,
    enrichmentSource: "heuristic",
  };
}

async function enrichWithOpenRouter(pool, crawl, options, logger) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return pool.filter((item) => item.include);
  }

  const candidatePool = pool
    .filter((item) => item.heuristicScore >= 12 || item.subjectTags.length > 0 || TEACHER_SIGNAL.test(`${item.role} ${item.snippet}`))
    .slice(0, options.maxAiCandidates)
    .map((item) => ({
      candidate_id: item.candidateId,
      name: item.name,
      role: item.role,
      school_name: item.schoolName,
      location: item.location,
      emails: item.emails,
      phones: item.phones,
      source_page_title: item.sourcePageTitle,
      source_page_url: item.sourcePageUrl,
      page_is_staff: item.pageIsLikelyStaff,
      mailing_address: item.mailingAddress,
      heuristic_score: item.heuristicScore,
      subject_tags: item.subjectTags,
      snippet: item.snippet,
    }));

  if (!candidatePool.length) {
    return pool.filter((item) => item.include);
  }

  logger.log(`Sending ${candidatePool.length} candidates to OpenRouter for AI cleanup`);

  const pageSummary = crawl.pages.slice(0, 25).map((page) => ({ title: page.title, url: page.url, is_staff_page: page.isLikelyStaff }));

  const systemPrompt = [
    "You clean and rank scraped school staff directory results.",
    "Goal: keep ONLY actual science, math, or STEM teachers or clearly teacher-like STEM instructional staff.",
    "Reject administrators, counselors, generic teachers without STEM evidence, coaches, clerical staff, nurses, paraeducators, and duplicates.",
    "Use only explicit evidence from the candidate fields and page context that you were given.",
    "Do not invent emails, addresses, or roles.",
    "Return JSON only with this exact shape:",
    '{"records":[{"candidate_id":"candidate-1","include":true,"normalized_name":"Full Name","enriched_role":"Teacher, Science","subject_tags":["science"],"confidence":0.98,"top_score":93,"mailing_address":"...","why_included":"short evidence-based reason"}]}'
  ].join(" ");

  const userPrompt = JSON.stringify(
    {
      task: "Filter and rank science/math/STEM teachers from a school website scrape.",
      discovered_pages: pageSummary,
      candidates: candidatePool,
      rules: {
        include_only_if: "candidate is a real science, math, or STEM teacher based on explicit evidence",
        avoid_noise: true,
        max_reason_length: 140,
      },
    },
    null,
    2
  );

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://localhost/fetchbetter",
      "X-Title": "School STEM Staff Scraper",
    },
    body: JSON.stringify({
      model: options.openRouterModel,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter request failed with status ${response.status}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  const parsed = extractJson(content);
  const aiRecords = Array.isArray(parsed?.records) ? parsed.records : [];
  const aiMap = new Map(aiRecords.map((record) => [record.candidate_id, record]));

  const selected = [];
  for (const item of pool) {
    const ai = aiMap.get(item.candidateId);
    if (!ai?.include) {
      continue;
    }
    selected.push({
      ...item,
      name: ai.normalized_name || item.name,
      role: ai.enriched_role || item.role,
      subjectTags: Array.isArray(ai.subject_tags) && ai.subject_tags.length ? uniqueStrings(ai.subject_tags) : item.subjectTags,
      confidence: typeof ai.confidence === "number" ? ai.confidence : item.confidence,
      topScore: typeof ai.top_score === "number" ? ai.top_score : item.topScore,
      mailingAddress: ai.mailing_address || item.mailingAddress,
      whyIncluded: ai.why_included || item.whyIncluded,
      enrichmentSource: "openrouter",
    });
  }

  logger.log(`AI cleanup kept ${selected.length || pool.filter((item) => item.include).length} candidates`);

  return selected.length ? selected : pool.filter((item) => item.include);
}

function buildAddressBook(addresses) {
  const byPage = new Map();
  const byHost = new Map();
  const bySchoolName = new Map();
  let globalBest = null;

  for (const address of addresses) {
    const pageKey = normalizeUrlForQueue(address.pageUrl);
    const hostKey = address.host.toLowerCase();
    const schoolKey = normalizeKey(extractSchoolTitle(address.pageTitle));

    if (!byPage.has(pageKey) || byPage.get(pageKey).score < address.score) {
      byPage.set(pageKey, address);
    }
    if (!byHost.has(hostKey) || byHost.get(hostKey).score < address.score) {
      byHost.set(hostKey, address);
    }
    if (schoolKey && (!bySchoolName.has(schoolKey) || bySchoolName.get(schoolKey).score < address.score)) {
      bySchoolName.set(schoolKey, address);
    }
    if (!globalBest || globalBest.score < address.score) {
      globalBest = address;
    }
  }

  return { byPage, byHost, bySchoolName, globalBest };
}

function pickAddressForCandidate(candidate, addressBook) {
  const schoolKey = normalizeKey(candidate.schoolName || candidate.schoolLine || "");
  if (schoolKey && addressBook.bySchoolName.has(schoolKey)) {
    return addressBook.bySchoolName.get(schoolKey).address;
  }

  for (const pageUrl of [candidate.sourcePageUrl, ...(candidate.sourcePages || [])]) {
    const normalized = normalizeUrlForQueue(pageUrl);
    if (normalized && addressBook.byPage.has(normalized)) {
      return addressBook.byPage.get(normalized).address;
    }
  }

  if (candidate.sourceHost && addressBook.byHost.has(candidate.sourceHost.toLowerCase())) {
    return addressBook.byHost.get(candidate.sourceHost.toLowerCase()).address;
  }

  return addressBook.globalBest?.address || "";
}

function detectSubjectTags(text) {
  const tags = [];
  for (const [tag, regex] of STEM_KEYWORDS) {
    if (regex.test(text)) {
      tags.push(tag);
    }
  }
  return uniqueStrings(tags);
}

function buildWhyIncluded({ candidate, subjectTags, teacherSignal, mailingAddress }) {
  const reasons = [];
  if (candidate.role) reasons.push(`role: ${candidate.role}`);
  if (subjectTags.length) reasons.push(`subjects: ${subjectTags.join(", ")}`);
  if (teacherSignal) reasons.push("teacher-like staff listing");
  if (!teacherSignal && STEM_STAFF_SIGNAL.test(`${candidate.role} ${candidate.snippet}`)) reasons.push("stem-related staff listing");
  if (candidate.emails[0]) reasons.push(`email: ${candidate.emails[0]}`);
  if (mailingAddress) reasons.push(`address: ${mailingAddress}`);
  return reasons.join("; ").slice(0, 180);
}

function pickSchoolName(candidate) {
  if (candidate.schoolLine) {
    return candidate.schoolLine;
  }

  const titleSegments = candidate.sourcePageTitle
    .split(/[|\-]/)
    .map((segment) => collapseWhitespace(segment))
    .filter(Boolean);
  const schoolSegment = titleSegments.find((segment) => SCHOOL_LINK_SIGNAL.test(segment) && !STRONG_LINK_SIGNAL.test(segment));
  if (schoolSegment) {
    return schoolSegment;
  }

  return titleSegments.find((segment) => !STRONG_LINK_SIGNAL.test(segment)) || candidate.sourceHost;
}

function extractSchoolTitle(pageTitle) {
  const segments = String(pageTitle || "")
    .split(/[|\-]/)
    .map((segment) => collapseWhitespace(segment))
    .filter(Boolean);
  return segments.find((segment) => SCHOOL_LINK_SIGNAL.test(segment)) || segments[0] || "";
}

function formatOutputRecord(record, rank) {
  const { firstName, lastName } = splitName(record.name);
  return {
    rank,
    top_teacher: rank <= 25 ? "yes" : "no",
    name: record.name,
    first_name: firstName,
    last_name: lastName,
    email: record.emails[0] || "",
    phone: record.phones[0] || "",
    role: record.role || "",
    subject_area: record.subjectTags.join("|"),
    school_name: record.schoolName || "",
    mailing_address: record.mailingAddress || "",
    confidence: Number(record.confidence || 0).toFixed(2),
    why_included: record.whyIncluded || "",
    enrichment_source: record.enrichmentSource || "heuristic",
    source_page_url: record.sourcePageUrl,
    source_page_title: record.sourcePageTitle,
    source_pages: (record.sourcePages || [record.sourcePageUrl]).join(" | "),
    evidence_snippet: record.snippet || "",
  };
}

function sortFinalRecords(records) {
  return [...records].sort((left, right) => {
    const scoreDifference = (right.topScore || 0) - (left.topScore || 0);
    if (scoreDifference !== 0) {
      return scoreDifference;
    }
    const confidenceDifference = (right.confidence || 0) - (left.confidence || 0);
    if (confidenceDifference !== 0) {
      return confidenceDifference;
    }
    return String(left.name || "").localeCompare(String(right.name || ""));
  });
}

async function writeCsv(records, outputPath) {
  const absolutePath = path.resolve(outputPath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });

  const headers = [
    "rank",
    "top_teacher",
    "name",
    "first_name",
    "last_name",
    "email",
    "phone",
    "role",
    "subject_area",
    "school_name",
    "mailing_address",
    "confidence",
    "why_included",
    "enrichment_source",
    "source_page_url",
    "source_page_title",
    "source_pages",
    "evidence_snippet",
  ];

  const lines = [headers.join(",")];
  for (const record of records) {
    lines.push(headers.map((header) => csvEscape(record[header])).join(","));
  }

  await fs.writeFile(absolutePath, `${lines.join("\n")}\n`, "utf8");
  return absolutePath;
}

function csvEscape(value) {
  const stringValue = String(value ?? "");
  if (!/[",\n]/.test(stringValue)) {
    return stringValue;
  }
  return `"${stringValue.replace(/"/g, '""')}"`;
}

function defaultOutputPath(url) {
  const parsed = new URL(url);
  const slug = slugify(`${parsed.hostname} ${parsed.pathname}`);
  return path.join("output", `${slug}-stem-teachers.csv`);
}

function buildSearchQueryLinks(pageUrl, searchInfo, pageSignals) {
  const links = [];
  const topicalKeywords = ["science", "math", "stem", "tech", "digital", "engineering", "robotics", "computer"];

  if (searchInfo?.hasDirectoryKeywordSearch) {
    for (const keyword of topicalKeywords) {
      const queryUrl = new URL(pageUrl);
      queryUrl.search = "";
      queryUrl.searchParams.set("const_search_keyword", keyword);
      if (searchInfo.directoryRoleId) {
        queryUrl.searchParams.set("const_search_role_ids", searchInfo.directoryRoleId);
      }
      links.push({
        href: queryUrl.toString(),
        text: `directory keyword ${keyword}`,
        ariaLabel: "",
        guessed: true,
        generatedScore: 92,
      });
    }
  }

  if (pageSignals.isLikelyHome || pageSignals.isLikelySchoolHome) {
    for (const action of uniqueStrings(searchInfo?.siteSearchActions || [])) {
      for (const keyword of ["science", "math", "stem", "robotics", "engineering", "computer"]) {
        const queryUrl = new URL(action);
        queryUrl.search = "";
        queryUrl.searchParams.set("q", keyword);
        links.push({
          href: queryUrl.toString(),
          text: `site search ${keyword}`,
          ariaLabel: "",
          guessed: true,
          generatedScore: 78,
        });
      }
    }
  }

  return dedupeLinks(links);
}

function dedupeLinks(links) {
  const seen = new Set();
  const unique = [];
  for (const link of links) {
    const normalized = normalizeUrlForQueue(link.href);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push({ ...link, href: normalized });
  }
  return unique;
}

function scoreRawCandidate(candidate) {
  let score = 0;
  if (candidate.emails?.[0]) score += 12;
  if (candidate.role) score += 10;
  if (candidate.pageIsLikelyStaff) score += 8;
  score += detectSubjectTags(`${candidate.role} ${candidate.snippet} ${candidate.sourcePageTitle}`).length * 12;
  return score;
}

function buildCandidateKey(candidate) {
  const identity = normalizeKey(candidate.name) || normalizeKey(candidate.emails?.[0] || "");
  const school = normalizeKey(candidate.schoolLine || candidate.sourceHost || candidate.sourcePageTitle || "");
  if (!identity) {
    return "";
  }
  return `${identity}|${school}`;
}

function chooseBetterText(left, right) {
  const leftValue = collapseWhitespace(left || "");
  const rightValue = collapseWhitespace(right || "");
  if (!leftValue) return rightValue;
  if (!rightValue) return leftValue;
  const leftSignals = detectSubjectTags(leftValue).length + (TEACHER_SIGNAL.test(leftValue) ? 1 : 0);
  const rightSignals = detectSubjectTags(rightValue).length + (TEACHER_SIGNAL.test(rightValue) ? 1 : 0);
  if (rightSignals > leftSignals) return rightValue;
  if (leftSignals > rightSignals) return leftValue;
  return rightValue.length > leftValue.length ? rightValue : leftValue;
}

function chooseBetterName(left, right) {
  const leftValue = collapseWhitespace(left || "");
  const rightValue = collapseWhitespace(right || "");
  if (!leftValue) return rightValue;
  if (!rightValue) return leftValue;
  return scoreName(rightValue) > scoreName(leftValue) ? rightValue : leftValue;
}

function scoreName(value) {
  const cleaned = collapseWhitespace(value);
  if (INVALID_NAME_SIGNAL.test(cleaned)) {
    return 0;
  }
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 5) {
    return 0;
  }
  if (/\b(staff|directory|teacher|science|math|stem|leader|school|board|chair|specialist|coordinator|coach)\b/i.test(cleaned)) {
    return 1;
  }
  let score = 2;
  if (/^[A-Z][a-z'.-]+(?:\s+[A-Z][a-z'.-]+)+$/.test(cleaned)) score += 3;
  if (/^[A-Z][A-Z'.-]+(?:\s+[A-Z][A-Z'.-]+)+$/.test(cleaned)) score += 2;
  return score;
}

function inferNameFromSnippet(snippet) {
  const parts = String(snippet || "").split(" | ").map((part) => collapseWhitespace(part)).filter(Boolean);
  const candidate = parts[0] || "";
  return scoreName(candidate) > 1 ? candidate : "";
}

function inferRoleFromSnippet(snippet, name) {
  const parts = String(snippet || "").split(" | ").map((part) => collapseWhitespace(part)).filter(Boolean);
  for (const part of parts) {
    if (!part || part === name) {
      continue;
    }
    if (/@|\b(phone|fax)\b/i.test(part)) {
      continue;
    }
    if (SCHOOL_LINK_SIGNAL.test(part) && !TEACHER_SIGNAL.test(part) && !STEM_STAFF_SIGNAL.test(part)) {
      continue;
    }
    return part;
  }
  return "";
}

function extractAddressesFromText(text) {
  const prepared = insertBoundarySpaces(text || "");
  const matches = [];
  for (const match of prepared.matchAll(ADDRESS_REGEX)) {
    matches.push(cleanAddress(match[0]));
  }

  const lines = prepared.split(/\n+/).map((line) => collapseWhitespace(line)).filter(Boolean);
  for (let index = 0; index < lines.length; index += 1) {
    const joined = [lines[index], lines[index + 1], lines[index + 2]].filter(Boolean).join(" ");
    for (const match of joined.matchAll(ADDRESS_REGEX)) {
      matches.push(cleanAddress(match[0]));
    }
  }

  return uniqueStrings(matches.filter(Boolean));
}

function cleanAddress(value) {
  let normalized = collapseWhitespace(String(value || "").replace(/\b(phone|fax)\b.*$/i, "").replace(/[|]+/g, " "));
  const nestedStarts = [...normalized.matchAll(new RegExp(`\\b\\d{1,6}\\s+[A-Za-z0-9.'#-]+(?:\\s+[A-Za-z0-9.'#-]+){0,4}\\s+(?:${STREET_SUFFIXES})\\b`, "gi"))];
  if (nestedStarts.length > 1) {
    normalized = normalized.slice(nestedStarts[nestedStarts.length - 1].index);
  }
  return normalized;
}

function shouldKeepRecord(record) {
  if (!record.name || scoreName(record.name) <= 1) {
    return false;
  }
  if (INVALID_NAME_SIGNAL.test(record.name)) {
    return false;
  }
  if (NEGATIVE_ROLE_SIGNAL.test(record.role || "")) {
    return false;
  }
  return true;
}

function focusRecordsToInstitution(records, startingPageTitle) {
  const institution = extractSchoolTitle(startingPageTitle);
  if (!institution || /\bdistrict\b/i.test(institution)) {
    return records;
  }
  const institutionKey = normalizeKey(institution);
  const focused = records.filter((record) => {
    const schoolKey = normalizeKey(record.schoolName || record.schoolLine || "");
    return schoolKey && (schoolKey.includes(institutionKey) || institutionKey.includes(schoolKey));
  });
  return focused.length >= 3 ? focused : records;
}

function scoreAddress(address, title, url, isLikelySchoolHome) {
  let score = 10;
  if (/\b(contact|find us)\b/i.test(`${title} ${url}`)) score += 20;
  if (isLikelySchoolHome) score += 12;
  if (/\bschool\b/i.test(title)) score += 6;
  if (/\bVT\b|\bCA\b|\bNY\b|\bTX\b/.test(address)) score += 2;
  return score;
}

function splitName(name) {
  const trimmed = collapseWhitespace(name || "");
  const parts = trimmed.split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || "",
    lastName: parts.length > 1 ? parts[parts.length - 1] : "",
  };
}

function createScope(startUrl) {
  const parsed = new URL(startUrl);
  return {
    registrableDomain: (getDomain(parsed.hostname) || parsed.hostname).toLowerCase(),
  };
}

function normalizeUrl(raw) {
  try {
    const parsed = new URL(raw);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function normalizeUrlForQueue(raw) {
  try {
    const parsed = new URL(raw);
    parsed.hash = "";
    if (parsed.pathname !== "/") {
      parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

function slugify(value) {
  return normalizeKey(value).replace(/\s+/g, "-") || "school";
}

function normalizeKey(value) {
  return collapseWhitespace(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => collapseWhitespace(value)).filter(Boolean))];
}

function collapseWhitespace(value) {
  return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function shortUrl(value) {
  try {
    const parsed = new URL(value);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.hostname}${path}${parsed.search}`;
  } catch {
    return collapseWhitespace(value);
  }
}

function plural(count) {
  return count === 1 ? "" : "s";
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

function normalizePositiveInteger(value, fallback) {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized > 0 ? Math.floor(normalized) : fallback;
}

function normalizeNonNegativeInteger(value, fallback) {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized >= 0 ? Math.floor(normalized) : fallback;
}

function createLogger(options, startedAt) {
  const enabled = options.verbose !== false;
  return {
    enabled,
    log(message) {
      if (!enabled) {
        return;
      }
      console.log(`[${formatDuration(Date.now() - startedAt)}] ${message}`);
    },
  };
}

function insertBoundarySpaces(value) {
  return String(value || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2");
}

function isHomeLikePath(pathname) {
  return pathname === "/" || /^\/(home|index)?$/.test(pathname) || /^\/o\/[^/]+$/.test(pathname);
}

function extractJson(content) {
  if (!content) {
    return {};
  }

  if (typeof content === "object") {
    return content;
  }

  const text = String(content).trim();
  try {
    return JSON.parse(text);
  } catch {}

  const objectStart = text.indexOf("{");
  const objectEnd = text.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    try {
      return JSON.parse(text.slice(objectStart, objectEnd + 1));
    } catch {}
  }

  return {};
}

async function autoScroll(page, durationMs) {
  await page.evaluate(async ({ durationMs }) => {
    await new Promise((resolve) => {
      let elapsed = 0;
      const stepMs = 120;
      const timer = setInterval(() => {
        window.scrollBy(0, Math.max(600, Math.floor(window.innerHeight * 0.8)));
        elapsed += stepMs;
        if (elapsed >= durationMs) {
          clearInterval(timer);
          resolve();
        }
      }, stepMs);
    });
    window.scrollTo(0, 0);
  }, { durationMs });
}
