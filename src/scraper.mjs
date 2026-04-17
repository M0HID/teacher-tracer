import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { getDomain } from "tldts";

const STEM_KEYWORDS = [
  ["math", /\b(math|mathematics|algebra|geometry|calculus|statistics|statistical|trigonometry|quantitative)\b/i],
  ["science", /\b(science|biology|chemistry|physics|environmental|earth science|life science|physical science|anatomy|astronomy|geology|biomedical)\b/i],
  ["stem", /\b(stem|steam|engineering|robotics|computer science|coding|programming|technology education|tech ed|tech education|maker|innovation|design lab|data science)\b/i],
];

const TEACHER_SIGNAL = /\b(teacher|educator|faculty|instructor|professor|department chair|department head|interventionist|specialist)\b/i;
const EXPLICIT_STEM_ROLE_SIGNAL = /\b(science teacher|math teacher|stem teacher|teacher, science|teacher, math|teacher, stem|computer science|engineering|robotics|physics|chemistry|biology|algebra|geometry|calculus|statistics|technology education|technology teacher|mathematics teacher|teacher\s*[-,:]\s*(math|mathematics|science|stem|computer science)|\b(math|mathematics|science|physics|chemistry|biology|computer science|engineering|robotics)\b.*\bteacher\b)\b/i;
const STEM_STAFF_SIGNAL = /\b(digital learning leader|tech ed|tech education|technology teacher|technology integration|stem coach|science coach|math coach|math specialist|science specialist|stem specialist|robotics|engineering|computer science|data science|instructional technology)\b/i;
const NEGATIVE_ROLE_SIGNAL = /\b(principal|assistant principal|guidance|counselor|clerical|secretary|custodian|nurse|social worker|psychologist|paraeducator|paraprofessional|superintendent|manager|coordinator|transportation|food service|board|school board|board member|vice chair|term expiring|coach|athletic director|bookkeeper|instructional aide|aide|attendance|registrar|special education|learning behavior specialist|lab specialist|department assistant|dept\.?\s*asst\.?)\b/i;
const NON_TEACHING_TITLE_SIGNAL = /\b(administrative assistant|assistant principal|principal|director|coordinator|secretary|counselor|manager|registrar|bookkeeper|dean|superintendent)\b/i;
const INVALID_NAME_SIGNAL = /^(read more|watch now|learn more|staff directory|search results|home|your name:?|your e-mail:?|subject:?|message:?|academic departments|departments|curriculum and instruction|students have worked with:?|graduation requirements|become a mentor)$/i;
const NON_PERSON_NAME_SIGNAL = /\b(course calendars?|course(?:s)?|grading policy|course offerings?|qualified entry|review sessions?|nobel laureates?|make-?up labs?|links|forms|library|museum|attendance|jupitered|calendar|search|translate|policy|requirements|instructions?|q\s*(?:&|and)\s*a|assistant principal|principal|comp sci|computer science|engineering|technology|chemistry|physics|mathematics|biology|biological sciences|special education|college services|health & safety|faculty members?)\b/i;
const INVALID_ROLE_SIGNAL = /^(home|department department head\/email)$/i;
const NEGATIVE_CONTEXT_SIGNAL = /\b(parent teacher conferences?|half day|translate|search results|graduation requirements|applications? occur|internship|job training|become a mentor|support the team|department information|course descriptions)\b/i;
const ANTI_BOT_SIGNAL = /\b(cloudflare|access denied|forbidden|captcha|verify you are human|attention required|just a moment|security check|press & hold|checking your browser|performing security verification|malicious bots|ray id)\b/i;
const STEM_SUBJECT_ONLY_LINE = /\b(math|mathematics|science|biology|chemistry|physics|computer science|engineering|robotics|technology|instructional technology|anatomy|physiology)\b/i;
const DEGREE_LINE_SIGNAL = /\b(b\.?s\.?|bachelor(?:'s)?|m\.?s\.?|master(?:'s)?|m\.?ed\.?|m\.?a\.?t\.?|ph\.?d\.?|ed\.?d\.?|degree|licensed|certified)\b/i;
const STRONG_LINK_SIGNAL = /\b(staff|faculty|directory|directories)\b/i;
const SCHOOL_LINK_SIGNAL = /\b(school|high school|middle school|elementary|academy|campus|district)\b/i;
const STEM_LINK_SIGNAL = /\b(science|math|mathematics|stem|steam|engineering|robotics|computer science|departments?)\b/i;
const SOFT_LINK_SIGNAL = /\b(about|contact|academics|curriculum|departments?)\b/i;
const NEGATIVE_LINK_SIGNAL = /\b(calendar|news|events|athletics|sports|employment|jobs|board|policy|meal|lunch|bus|transportation|facebook|instagram|youtube|twitter|login|powerschool|schoology|students|parents|families|alumni|donate|fundraiser)\b/i;
const DISTRICT_TITLE_SIGNAL = /\b(public schools|school district|unified school district|county schools|board of education|department of education)\b/i;
const FILE_LINK_SIGNAL = /\.(pdf|jpg|jpeg|png|gif|docx?|xlsx?|pptx?)$/i;
const ROOT_STAFF_PATH_SIGNAL = /^\/(?:staff|staff-directory|directory|faculty|teachers|people)$/i;
const CMS_STAFF_PATH_SIGNAL = /^\/(?:apps\/staff(?:\/index\.jsp)?|apps3\/staff)$/i;
const NESTED_STAFF_PATH_SIGNAL = /\/(?:about|about-us|our-school|school|school-info|school-information|contact|contact-us)\/(?:staff|staff-directory|directory|faculty|teachers|people)$/i;
const REPEATED_STAFF_PATH_SIGNAL = /\/(?:staff|staff-directory|directory|faculty|teachers|people)\/(?:staff|staff-directory|directory|faculty|teachers|people)(?:\/|$)/i;

const STATE_CODES = "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC";
const STREET_SUFFIXES = "Street|St|Road|Rd|Avenue|Ave|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Circle|Cir|Way|Highway|Hwy|Route|Rt|Parkway|Pkwy|Place|Pl|Terrace|Ter|Trail|Trl|Loop|Center|Ctr|Broadway|Turnpike|Tpke";
const ADDRESS_REGEX = new RegExp(`\\b\\d{1,6}\\s+[A-Za-z0-9.'#-]+(?:\\s+[A-Za-z0-9.'#-]+){0,7}\\s+(?:${STREET_SUFFIXES})\\b[\\s,]+[A-Za-z][A-Za-z.'-]*(?:\\s+[A-Za-z][A-Za-z.'-]*){0,4}[\\s,]+(?:${STATE_CODES})\\s+\\d{5}(?:-\\d{4})?`, "gi");
const CITY_STATE_ZIP_EXACT = new RegExp(`^[A-Za-z][A-Za-z.'-]*(?:\\s+[A-Za-z][A-Za-z.'-]*){0,4},?\\s+(?:${STATE_CODES})\\s+\\d{5}(?:-\\d{4})?$`, "i");
const STREET_LINE_SIGNAL = new RegExp(`\\b(?:${STREET_SUFFIXES})\\b`, "i");

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
  challengeWaitMs: 8000,
  blockedProbeCount: 5,
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
  options.challengeWaitMs = normalizeNonNegativeInteger(options.challengeWaitMs, DEFAULTS.challengeWaitMs);
  options.blockedProbeCount = normalizeNonNegativeInteger(options.blockedProbeCount, DEFAULTS.blockedProbeCount);
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

    const focusedRecords = focusRecordsToInstitution(enriched.filter((record) => shouldKeepRecord(record)), crawl.pages[0]?.title || "", startUrl);
    const dedupedRecords = dedupeRecords(focusedRecords);
    const finalRecords = sortFinalRecords(dedupedRecords).map((record, index) => formatOutputRecord(record, index + 1));
    const outputPath = await writeCsv(finalRecords, options.outputPath || defaultOutputPath(startUrl));
    const blockedPages = crawl.pages.filter((page) => page.antiBotBlocked && page.blocked);
    const failedPages = crawl.pages.filter((page) => page.error);
    const blockedSummary = summarizeBlockedPages(blockedPages);
    const failedSummary = summarizeFailedPages(failedPages);
    logger.log(`Wrote ${finalRecords.length} final records to ${outputPath}`);

    return {
      durationMs: Date.now() - startedAt,
      outputPath,
      visitedPages: crawl.pages.length,
      rawCandidates: crawl.rawCandidates.length,
      matchedTeachers: finalRecords.length,
      topTeachers: finalRecords.slice(0, options.topCount),
      pages: crawl.pages,
      blockedPages,
      failedPages,
      blockedSummary,
      failedSummary,
      blockedProbeSamplingUsed: crawl.blockedProbeSamplingUsed,
      crawlBlocked: blockedPages.length > 0 && blockedPages.length === crawl.pages.length,
      crawlFailed: failedPages.length > 0 && failedPages.length === crawl.pages.length,
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
  let blockedProbeSamplingUsed = false;

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

      const discoveredLinks = snapshot.pageInfo.antiBotBlocked ? [] : [...snapshot.links, ...snapshot.generatedLinks];
      if (snapshot.pageInfo.antiBotBlocked) {
        if (next.depth <= 1) {
          const blockedProbeUrls = collectBlockedProbeUrls(snapshot.pageInfo.url, options.blockedProbeCount);
          if (blockedProbeUrls.length) {
            blockedProbeSamplingUsed = true;
          }
          for (const guessedUrl of blockedProbeUrls) {
            discoveredLinks.push({ href: guessedUrl, text: "blocked probe", ariaLabel: "", guessed: true, generatedScore: scoreGuessedLink(guessedUrl, snapshot.pageInfo.url) });
          }
        }
      } else if (next.depth <= 1 && (snapshot.pageInfo.isLikelyHome || snapshot.pageInfo.isLikelySchoolHome)) {
        for (const guessedUrl of collectGuessUrls(snapshot.pageInfo.url)) {
          discoveredLinks.push({ href: guessedUrl, text: "guessed staff page", ariaLabel: "", guessed: true, generatedScore: scoreGuessedLink(guessedUrl, snapshot.pageInfo.url) });
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
              currentStemContext: detectSubjectTags(`${snapshot.pageInfo.title} ${snapshot.pageInfo.url}`).length > 0,
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
    blockedProbeSamplingUsed,
  };
}

async function visitQueuedPage(context, next, scope, options, logger, meta) {
  const page = await context.newPage();
  const startedAt = Date.now();

  try {
    const snapshot = await visitPage(page, next.url, scope, options, next);
    const candidateCount = snapshot.candidates.length;
    const linkCount = snapshot.links.length + snapshot.generatedLinks.length;
    const status = snapshot.error ? "failed" : snapshot.pageInfo.antiBotBlocked ? "blocked" : "done";
    const blockedSummary = snapshot.pageInfo.blocked?.summary ? ` [${snapshot.pageInfo.blocked.summary}]` : "";
    logger.log(`Page ${meta.batchNumber}.${meta.slot}/${meta.total} ${status}${blockedSummary}: ${shortUrl(snapshot.pageInfo.url)} -> ${candidateCount} candidate${plural(candidateCount)}, ${linkCount} link${plural(linkCount)} in ${formatDuration(Date.now() - startedAt)}`);
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
  let responseStatus = null;

  try {
    const response = await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: options.timeoutMs });
    responseStatus = response?.status() ?? null;
    await page.waitForLoadState("networkidle", { timeout: options.networkIdleTimeoutMs }).catch(() => {});
    if (options.postLoadDelayMs > 0) {
      await page.waitForTimeout(options.postLoadDelayMs);
    }

    const challengeSnapshot = await detectChallengeInterstitial(page);
    if (challengeSnapshot.blocked && options.challengeWaitMs > 0) {
      await page.waitForTimeout(options.challengeWaitMs);
      await page.waitForLoadState("networkidle", { timeout: options.networkIdleTimeoutMs }).catch(() => {});
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
        antiBotBlocked: false,
        blocked: null,
        responseStatus,
        depth: context.depth,
        error: error.message,
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
        if (/^to\b/i.test(line)) {
          return false;
        }
        if (/^(?:B\.(?:A|S)\.|M\.(?:A|S|Ed|AT)\.|Ph\.?D\.?|Ed\.?D\.?)\s+/i.test(line)) {
          return false;
        }
        if (/^(?:math(?:ematics)?|science|english|social studies|social science|world language|special education|physical education|visual(?:\s*&\s*|\s+and\s+)performing arts|guidance|biology|chemistry|physics|computer science|engineering|robotics|stem)$/i.test(line)) {
          return false;
        }
        if (/@|\d{3}[-.\s]?\d{3}|\b(phone|fax|teacher|science|math|stem|school|district|office|department|educator|specialist|principal|counselor|advisor|coach|search|select|jump to page|menu|translate|find us|stay connected)\b/i.test(line)) {
          return false;
        }
        const words = line.split(/\s+/).filter(Boolean);
        if (words.length < 2 || words.length > 5) {
          return false;
        }
        const strongNameWordCount = words.filter((word) => {
          const cleaned = word.replace(/^[^A-Za-z]+|[^A-Za-z'.-]+$/g, "");
          return /^[A-Z][a-z'.-]+$/.test(cleaned) || /^[A-Z][A-Z'.-]+$/.test(cleaned) || /^[A-Z]\.$/.test(cleaned);
        }).length;
        return strongNameWordCount >= Math.max(2, words.length - 1);
      };

      const isCompactPersonRow = (element, rawText) => {
        if (!element || element.tagName !== "TR") {
          return false;
        }
        const lines = linesOf(rawText);
        if (lines.length < 2 || lines.length > 8) {
          return false;
        }
        const emailCount = (rawText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).length;
        if (emailCount > 1) {
          return false;
        }
        const hasName = lines.some((line) => isLikelyNameLine(line));
        const hasRole = lines.some((line) => looksLikeRoleLine(line));
        return hasName && hasRole;
      };

      const looksLikeRoleLine = (line) => {
        if (!line || line.length < 3 || line.length > 140) {
          return false;
        }
        if (/@|\b(phone|fax)\b/i.test(line)) {
          return false;
        }
        if (/\b(b\.?s\.?|bachelor(?:'s)?|m\.?s\.?|master(?:'s)?|m\.?ed\.?|ph\.?d\.?|ed\.?d\.?|degree|licensed|certified)\b/i.test(line) && !/\bteacher\b/i.test(line)) {
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
          if (isCompactPersonRow(current, rawText)) {
            return current;
          }
          if (current.matches?.("[data-testid='staff-card'], .contact-box, .staff-card, .staff-categoryStaffMember")) {
            const hasName = lines.some((line) => isLikelyNameLine(line)) || Boolean(current.querySelector("dt, .name, [class*='name']"));
            const hasRole = lines.some((line) => looksLikeRoleLine(line)) || Boolean(current.querySelector("dd, .title, .department, [class*='title'], [class*='department']"));
            if (hasName && hasRole && emailCount <= 1) {
              return current;
            }
          }
          if (blockTags.has(current.tagName) && text.length >= 30 && text.length <= 900 && lines.length >= 2 && lines.length <= 18 && current.children.length <= 40 && emailCount <= 1) {
            return current;
          }
          current = current.parentElement;
        }
        return null;
      };

      const extractStaffCategory = (container) => {
        const categoryRoot = container?.closest?.(".staff-category");
        const headerCategory = compact(textOf(categoryRoot?.querySelector?.(".staff-header h1, .staff-header [role='heading'], .staff-header")));
        const linkCategory = compact(container?.getAttribute?.("title") || container?.closest?.("a[title]")?.getAttribute?.("title") || "");
        return headerCategory || linkCategory || "";
      };

      const extractMailtoEmail = (link) => {
        const visibleEmail = compact(textOf(link)).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || "";
        const hrefEmail = (link.getAttribute("href") || "").replace(/^mailto:/i, "").split("?")[0].trim();
        return visibleEmail || hrefEmail;
      };

      const collectEmails = (element, text) =>
        Array.from(
          new Set([
            ...Array.from(element.querySelectorAll('a[href^="mailto:"]')).map((link) => extractMailtoEmail(link)),
            ...(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []),
          ].filter(Boolean).map((value) => value.toLowerCase()))
        );

      const collectPhones = (element, text) =>
        Array.from(
          new Set([
            ...Array.from(element.querySelectorAll('a[href^="tel:"]')).map((link) => (link.getAttribute("href") || "").replace(/^tel:/i, "").trim()),
            ...(text.match(/(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}/g) || []),
          ].filter(Boolean).map(compact))
        );

      const extractCard = (container) => {
        const rawText = textOf(container);
        const text = compact(rawText);
        const lines = linesOf(rawText);
        const emails = collectEmails(container, text);
        const phones = collectPhones(container, text);

        const structuredName = compact(textOf(container.querySelector(".name, [data-testid='staff-name'], [class*='name']")));
        const structuredTitle = compact(textOf(container.querySelector(".title, [data-testid='staff-title'], [class*='title']")));
        const structuredDepartment = compact(textOf(container.querySelector(".department, [data-testid='staff-department'], [class*='department']")));
        const headingName = Array.from(container.querySelectorAll("h1, h2, h3, h4, h5, strong, b, [class*='name'], dt"))
          .map((node) => compact(textOf(node)))
          .find((line) => isLikelyNameLine(line));

        const name = headingName || (isLikelyNameLine(structuredName) ? structuredName : "") || lines.find((line) => isLikelyNameLine(line)) || "";
        const structuredRole = structuredTitle && structuredDepartment && !new RegExp(`\\b${structuredDepartment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(structuredTitle)
          ? `${structuredTitle} - ${structuredDepartment}`
          : structuredTitle || structuredDepartment;
        const role = compact(structuredRole || lines.find((line) => line !== name && looksLikeRoleLine(line) && !emails.includes(line.toLowerCase()) && !phones.includes(line)) || "");
        const location = lines.find((line) => line !== name && line !== role && looksLikeLocationLine(line)) || "";
        const schoolLine = lines.find((line) => line !== name && line !== role && /\b(school|academy|campus|district)\b/i.test(line)) || location || "";
        const category = extractStaffCategory(container);
        const degreeLines = Array.from(container.querySelectorAll(".staffDegrees, dd.staffDegrees, dd"))
          .map((node) => compact(textOf(node)))
          .filter((line) => line && line !== role && line !== location && line !== schoolLine && /\b(B\.|M\.|Ph\.?D|Ed\.?D|degree|mathematics|science|chemistry|physics|engineering|computer science|biology)\b/i.test(line));

        return {
          name: compact(name),
          role: compact(role),
          location: compact(location),
          schoolLine: compact(schoolLine),
          category: compact(category),
          degrees: degreeLines.join(" | ").slice(0, 300),
          snippet: lines.slice(0, 8).join(" | ").slice(0, 700),
          text: text.slice(0, 1600),
          emails,
          phones,
        };
      };

      const extractStructuredRowCards = () => {
        const cards = [];
        const seenCards = new Set();
        const subjectCellSignal = /\b(math|mathematics|science|biology|chemistry|physics|computer science|engineering|robotics|stem|technology|english|social science|world language|special education|physical education|visual|performing arts)\b/i;

        for (const table of Array.from(document.querySelectorAll("table")).slice(0, 40)) {
          const firstRow = table.querySelector("tr");
          const headerCells = Array.from(firstRow?.querySelectorAll("th, td") || []).map((cell) => compact(textOf(cell))).filter(Boolean);
          const headerText = headerCells.join(" | ");
          const headerRoleCell = headerCells.find((value) => /\b(head|chair|teacher|faculty|staff|contact|email)\b/i.test(value) && !/^name$/i.test(value)) || "";
          const tableLooksDirectory = /\b(name|staff|teacher|faculty|department|email|contact)\b/i.test(headerText);

          for (const row of table.querySelectorAll("tr")) {
            const rawText = textOf(row);
            const text = compact(rawText);
            const cells = Array.from(row.querySelectorAll("th, td"));
            if (!text || cells.length < 2 || cells.length > 5 || text.length > 260) {
              continue;
            }

            const cellTexts = cells.map((cell) => compact(textOf(cell))).filter(Boolean);
            if (cellTexts.length < 2) {
              continue;
            }

            const emails = collectEmails(row, text);
            const phones = collectPhones(row, text);
            const nameCandidates = Array.from(
              new Set(
                [
                  ...Array.from(row.querySelectorAll("a, strong, b")).map((node) => compact(textOf(node))),
                  ...cellTexts,
                ].filter((value) => isLikelyNameLine(value) && !subjectCellSignal.test(value) && !/\bdepartment\b/i.test(value))
              )
            );
            const nonNameCells = cellTexts.filter((value) => !nameCandidates.includes(value));
            const departmentCell = nonNameCells.find((value) => subjectCellSignal.test(value)) || "";
            const explicitRole = nonNameCells.find((value) => value !== departmentCell && looksLikeRoleLine(value)) || "";
            const mailtoPairs = Array.from(row.querySelectorAll('a[href^="mailto:"]')).map((link) => ({
              label: compact(textOf(link)),
              email: extractMailtoEmail(link).toLowerCase(),
            }));

            if (!nameCandidates.length || (!tableLooksDirectory && !departmentCell && !explicitRole)) {
              continue;
            }

            let role = explicitRole || departmentCell;
            if (headerRoleCell && departmentCell && /\b(head|chair|teacher|faculty|staff)\b/i.test(headerRoleCell)) {
              const normalizedHeaderRole = compact(headerRoleCell.replace(/\/?\s*email\b/gi, "").replace(/\bcontact\b/gi, ""));
              role = [normalizedHeaderRole, departmentCell].filter(Boolean).join(" - ");
            }
            role = compact(role.replace(/\bdepartment\s+department\b/i, "Department").replace(/\s{2,}/g, " "));

            for (const name of nameCandidates.slice(0, 3)) {
              const matchedEmail = mailtoPairs.find((pair) => pair.label === name || pair.label.includes(name) || name.includes(pair.label))?.email || (emails.length === 1 ? emails[0] : "");
              const key = `${name}|${role}|${matchedEmail || emails.join(",")}`;
              if (!role || seenCards.has(key)) {
                continue;
              }
              seenCards.add(key);
              cards.push({
                name,
                role: compact(role),
                location: "",
                schoolLine: "",
                category: "",
                degrees: "",
                snippet: cellTexts.join(" | ").slice(0, 700),
                text: text.slice(0, 1600),
                emails: matchedEmail ? [matchedEmail] : emails,
                phones,
              });
            }
          }
        }

        return cards;
      };

      const pageSignalText = `${document.title} ${location.href} ${textOf(document.body).slice(0, 5000)}`;
      const pageLooksStaff = /\b(staff|faculty|directory)\b/i.test(pageSignalText);
      const seenContainers = new Set();
      const containers = [];
      const seedNodes = Array.from(document.querySelectorAll("a[href^='mailto:'], a[href^='tel:'], h3, h4, h5, strong, b, dt, [class*='name'], .staff-categoryStaffMember"));

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
          if (element.matches?.("#staff, .staff-category, .staff-categoryStaffMembers, .staff-header") || element.querySelectorAll?.(".staff-categoryStaffMember").length > 1) {
            continue;
          }
          const rawText = textOf(element);
          const text = compact(rawText);
          const emailCount = (rawText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).length;
          const compactPersonRow = isCompactPersonRow(element, rawText);
          const structuredStaffCard = element.matches?.(".staff-categoryStaffMember");
          if (!compactPersonRow && !structuredStaffCard && (text.length < 40 || text.length > 900)) {
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

      const candidates = [...containers.map((container) => extractCard(container)), ...extractStructuredRowCards()]
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
  const blocked = detectBlockedPage({
    url: actualUrl,
    title,
    bodyText: extracted.bodyText,
    responseStatus,
  });
  const antiBotBlocked = Boolean(blocked);
  const isLikelyStaff = /\b(staff|faculty|directory)\b/.test(signalText) || extracted.candidates.length >= 4;
  const isLikelyHome = isHomeLikePath(urlObject.pathname);
  const isLikelySchoolHome = !isLikelyStaff && (SCHOOL_LINK_SIGNAL.test(title) || isLikelyHome || context.depth === 0);

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

  const rosterCandidates = extractRosterCandidatesFromBody(extracted.bodyText, title);

  const candidates = [...extracted.candidates, ...rosterCandidates]
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
      antiBotBlocked,
      blocked,
      responseStatus,
      depth: context.depth,
    },
    links: extracted.links,
    generatedLinks,
    candidates,
    addresses: pageAddresses,
  };
}

async function detectChallengeInterstitial(page) {
  const title = collapseWhitespace(await page.title().catch(() => ""));
  const bodyText = collapseWhitespace(
    await page
      .locator("body")
      .innerText()
      .catch(() => "")
  ).slice(0, 3000);
  return {
    blocked: Boolean(detectBlockedPage({ url: page.url(), title, bodyText, responseStatus: null })),
    title,
    bodyText,
  };
}

function detectBlockedPage({ url, title, bodyText, responseStatus }) {
  const combined = collapseWhitespace(`${title || ""} ${bodyText || ""} ${url || ""}`);
  if (!combined) {
    return null;
  }

  const normalized = combined.toLowerCase();
  const provider = /cloudflare/i.test(combined)
    ? "cloudflare"
    : /akamai/i.test(combined)
      ? "akamai"
      : /imperva/i.test(combined)
        ? "imperva"
        : /sucuri/i.test(combined)
          ? "sucuri"
          : "unknown";
  const challengeSignals = [
    /just a moment/i,
    /performing security verification/i,
    /this website uses a security service to protect against malicious bots/i,
    /verify you are human/i,
    /checking your browser/i,
    /attention required/i,
    /security check/i,
    /please enable cookies/i,
    /review the security of your connection/i,
    /ray id\s*:/i,
  ];
  const deniedSignals = [
    /sorry, you have been blocked/i,
    /you are unable to access/i,
    /access denied/i,
    /forbidden/i,
    /request blocked/i,
    /captcha/i,
    /press & hold/i,
  ];
  const matchedChallenge = challengeSignals.some((signal) => signal.test(combined));
  const matchedDenied = deniedSignals.some((signal) => signal.test(combined));
  const hasBotSignal = ANTI_BOT_SIGNAL.test(normalized);
  const statusBlocked = Number(responseStatus) >= 400;

  if (!matchedChallenge && !matchedDenied && !(hasBotSignal && statusBlocked)) {
    return null;
  }

  const rayId = combined.match(/ray id\s*:\s*([a-z0-9-]+)/i)?.[1] || "";
  const kind = matchedDenied ? "denied" : matchedChallenge ? "challenge" : "blocked";
  const summaryParts = [];
  if (provider !== "unknown") summaryParts.push(provider);
  summaryParts.push(kind);
  if (responseStatus) summaryParts.push(String(responseStatus));
  if (rayId) summaryParts.push(`ray ${rayId}`);

  return {
    provider,
    kind,
    statusCode: responseStatus,
    rayId,
    summary: summaryParts.join(" "),
    snippet: collapseWhitespace(bodyText || "").slice(0, 280),
  };
}

function summarizeBlockedPages(blockedPages) {
  const breakdown = new Map();

  for (const page of blockedPages || []) {
    const provider = page?.blocked?.provider || "unknown";
    const kind = page?.blocked?.kind || "blocked";
    const statusCode = page?.blocked?.statusCode || "";
    const key = [provider, kind, statusCode].filter(Boolean).join(" ");
    breakdown.set(key, (breakdown.get(key) || 0) + 1);
  }

  return {
    total: blockedPages?.length || 0,
    breakdown: [...breakdown.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label)),
  };
}

function summarizeFailedPages(failedPages) {
  const breakdown = new Map();

  for (const page of failedPages || []) {
    const error = collapseWhitespace(page?.error || page?.title || "failed");
    const key = error.split(":")[0] || error;
    breakdown.set(key, (breakdown.get(key) || 0) + 1);
  }

  return {
    total: failedPages?.length || 0,
    breakdown: [...breakdown.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label)),
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
  const schoolPathRoot = extractSchoolPathRoot(basePath);
  const guesses = new Set();
  const baseCandidates = [
    "/staff",
    "/staff-directory",
    "/directory",
    "/faculty",
    "/teachers",
    "/apps/staff",
    "/apps/staff/",
    "/apps/staff/index.jsp",
    "/apps3/staff",
  ];
  const suffixes = ["staff", "staff-directory", "directory", "faculty", "teachers", "apps/staff", "apps/staff/index.jsp", "apps3/staff"];
  const scopedPrefixes = schoolPathRoot
    ? collectPathPrefixes(basePath).filter((prefix) => prefix === schoolPathRoot || prefix.startsWith(`${schoolPathRoot}/`))
    : collectPathPrefixes(basePath);

  if (!schoolPathRoot) {
    for (const candidate of baseCandidates) {
      guesses.add(new URL(candidate, current.origin).toString());
    }
  }

  if (schoolPathRoot) {
    for (const suffix of suffixes) {
      guesses.add(new URL(`${schoolPathRoot}/${suffix}`.replace(/\/+/g, "/"), current.origin).toString());
    }
  }

  for (const prefix of scopedPrefixes) {
    for (const suffix of suffixes) {
      guesses.add(new URL(`${prefix}/${suffix}`.replace(/\/+/g, "/"), current.origin).toString());
    }
  }

  return [...guesses].map((value) => normalizeUrlForQueue(value)).filter(Boolean);
}

function buildAnchoredStaffGuessUrls(pageUrl) {
  const current = new URL(pageUrl);
  const guesses = new Set();
  const directCandidates = [
    "/staff",
    "/staff-directory",
    "/directory",
    "/faculty",
    "/teachers",
    "/people",
    "/apps/staff",
    "/apps/staff/",
    "/apps/staff/index.jsp",
    "/apps3/staff",
  ];
  const suffixes = ["staff", "staff-directory", "directory", "faculty", "teachers", "people"];

  for (const candidate of directCandidates) {
    guesses.add(new URL(candidate, current.origin).toString());
  }

  for (const root of collectGuessBasePaths(current.pathname)) {
    if (root === "/") {
      continue;
    }
    for (const suffix of suffixes) {
      guesses.add(new URL(`${root}/${suffix}`.replace(/\/+/g, "/"), current.origin).toString());
    }
    guesses.add(new URL(`${root}/apps/staff`.replace(/\/+/g, "/"), current.origin).toString());
    guesses.add(new URL(`${root}/apps/staff/index.jsp`.replace(/\/+/g, "/"), current.origin).toString());
    guesses.add(new URL(`${root}/apps3/staff`.replace(/\/+/g, "/"), current.origin).toString());
  }

  return [...guesses].map((value) => normalizeUrlForQueue(value)).filter(Boolean);
}

function collectBlockedProbeUrls(pageUrl, limit = 5) {
  return buildAnchoredStaffGuessUrls(pageUrl)
    .filter((value) => value && value !== normalizeUrlForQueue(pageUrl))
    .sort((left, right) => scoreGuessedLink(right, pageUrl) - scoreGuessedLink(left, pageUrl) || left.localeCompare(right))
    .slice(0, limit);
}

function collectGuessBasePaths(pathname) {
  const bases = new Set(["/"]);
  const schoolBasePath = extractBlockedSchoolBasePath(pathname);
  if (schoolBasePath) {
    bases.add(schoolBasePath);
  }
  return [...bases];
}

function extractBlockedSchoolBasePath(pathname) {
  const normalized = String(pathname || "/").replace(/\/+/g, "/").replace(/\/+$/, "") || "/";
  if (normalized === "/") {
    return "";
  }

  const schoolPathRoot = extractSchoolPathRoot(normalized);
  if (schoolPathRoot) {
    return schoolPathRoot;
  }

  const parts = normalized.split("/").filter(Boolean);
  if (!parts.length) {
    return "";
  }

  if (parts[0] && !/^(home|welcome|about|overview|index|staff|staff-directory|directory|faculty|teachers|people|apps)$/i.test(parts[0])) {
    return `/${parts[0]}`;
  }

  return "";
}

function collectPathPrefixes(pathname) {
  const normalized = String(pathname || "/").replace(/\/+$/, "") || "/";
  if (normalized === "/") {
    return ["/"];
  }

  const parts = normalized.split("/").filter(Boolean);
  const prefixes = [];
  for (let count = 1; count <= parts.length; count += 1) {
    prefixes.push(`/${parts.slice(0, count).join("/")}`);
  }
  return uniqueStrings(prefixes);
}

function extractSchoolPathRoot(pathname) {
  const match = String(pathname || "").match(/^\/(?:o|school|schools|site)\/[^/?#]+/i);
  return collapseWhitespace(match?.[0] || "").replace(/\/+$/, "");
}

function extractSchoolPathKey(pathname) {
  const match = String(pathname || "").match(/^\/(?:o|school|schools|site)\/([^/?#]+)/i);
  return normalizeKey(match?.[1] || "");
}

function scoreGuessedLink(candidateUrl, currentUrl) {
  let score = 46;

  try {
    const parsed = new URL(candidateUrl);
    const current = new URL(currentUrl);
    const normalizedPath = parsed.pathname.replace(/\/+$/, "") || "/";
    const currentSchoolPathKey = extractSchoolPathKey(current.pathname);
    const candidateSchoolPathKey = extractSchoolPathKey(parsed.pathname);
    const currentSchoolPathRoot = extractSchoolPathRoot(current.pathname);
    const candidateSchoolPathRoot = extractSchoolPathRoot(parsed.pathname);

    if (ROOT_STAFF_PATH_SIGNAL.test(normalizedPath)) score += 34;
    if (CMS_STAFF_PATH_SIGNAL.test(normalizedPath)) score += 52;
    if (NESTED_STAFF_PATH_SIGNAL.test(normalizedPath)) score += 24;
    if (REPEATED_STAFF_PATH_SIGNAL.test(normalizedPath)) score -= 90;
    if (currentSchoolPathKey && candidateSchoolPathKey && currentSchoolPathKey === candidateSchoolPathKey) {
      score += 96;
    }
    if (currentSchoolPathKey && candidateSchoolPathKey && currentSchoolPathKey !== candidateSchoolPathKey) {
      score -= 48;
    }
    if (currentSchoolPathRoot && parsed.hostname === current.hostname) {
      if (candidateSchoolPathRoot === currentSchoolPathRoot || parsed.pathname.startsWith(`${currentSchoolPathRoot}/`)) {
        score += 28;
      } else if (!candidateSchoolPathRoot) {
        score -= 72;
      }
    }
    if (/pREC_ID=staff/i.test(parsed.search)) score += 42;
    if (parsed.pathname.startsWith(`${current.pathname.replace(/\/+$/, "")}/staff`)) {
      score -= 30;
    }
  } catch {
    return score;
  }

  return score;
}

function scoreLink(link, context) {
  let parsed;
  try {
    parsed = new URL(link.href);
  } catch {
    return -100;
  }

  const currentUrl = new URL(context.currentUrl);
  const normalizedPath = parsed.pathname.replace(/\/+$/, "") || "/";
  const currentSchoolPathKey = extractSchoolPathKey(currentUrl.pathname);
  const candidateSchoolPathKey = extractSchoolPathKey(parsed.pathname);
  const currentSchoolPathRoot = extractSchoolPathRoot(currentUrl.pathname);
  const candidateSchoolPathRoot = extractSchoolPathRoot(parsed.pathname);
  const combined = collapseWhitespace(`${link.text || ""} ${link.ariaLabel || ""} ${link.href}`).toLowerCase();
  const looksLikeProfile = scoreName(link.text || "") > 1 || /(?:^|[?&])type=u(?:&|$)/i.test(parsed.search);
  let score = 0;

  if (STRONG_LINK_SIGNAL.test(combined)) score += 80;
  if (STEM_LINK_SIGNAL.test(combined)) score += 35;
  if (SOFT_LINK_SIGNAL.test(combined)) score += 10;
  if (SCHOOL_LINK_SIGNAL.test(combined)) score += 14;
  if (ROOT_STAFF_PATH_SIGNAL.test(normalizedPath)) score += 18;
  if (CMS_STAFF_PATH_SIGNAL.test(normalizedPath)) score += 54;
  if (NESTED_STAFF_PATH_SIGNAL.test(normalizedPath)) score += 28;
  if (REPEATED_STAFF_PATH_SIGNAL.test(normalizedPath)) score -= 90;
  if (currentSchoolPathKey && candidateSchoolPathKey && currentSchoolPathKey === candidateSchoolPathKey) score += 92;
  if (context.depth === 0 && currentSchoolPathKey && candidateSchoolPathKey && currentSchoolPathKey !== candidateSchoolPathKey) score -= 72;
  if (currentSchoolPathRoot && parsed.hostname === currentUrl.hostname) {
    if (candidateSchoolPathRoot === currentSchoolPathRoot || parsed.pathname.startsWith(`${currentSchoolPathRoot}/`)) {
      score += 24;
    } else if (!candidateSchoolPathRoot) {
      score -= 64;
    } else {
      score -= 88;
    }
  }
  if (context.depth === 0 && SCHOOL_LINK_SIGNAL.test(combined) && parsed.hostname !== currentUrl.hostname) score += 120;
  if (context.depth === 0 && parsed.hostname !== currentUrl.hostname && isHomeLikePath(parsed.pathname)) score += 90;
  if (NEGATIVE_LINK_SIGNAL.test(combined)) score -= 30;
  if (/\/default-board-post-page|\/post\//i.test(parsed.pathname)) score -= 40;
  if (FILE_LINK_SIGNAL.test(parsed.pathname)) score -= 80;
  if (/^(mailto|tel):/i.test(link.href)) score -= 90;
  if (context.isLikelyStaff && /(?:page(?:_|-)?no|const_page|page)=\d+/i.test(parsed.search)) score += 35;
  if (/(?:^|[?&])pREC_ID=staff(?:&|$)/i.test(parsed.search)) score += 44;
  if (context.currentStemContext && /(?:^|[?&])pREC_ID=staff(?:&|$)/i.test(parsed.search)) score += 30;
  if (context.currentStemContext && looksLikeProfile) score += 42;
  if (context.currentStemContext && /\b(staff|teacher|faculty)\b/.test(combined)) score += 18;
  if (context.depth === 0 && parsed.hostname !== currentUrl.hostname) score += 8;
  if (isHomeLikePath(parsed.pathname)) score += 4;
  if (parsed.pathname === currentUrl.pathname && parsed.search === currentUrl.search) score -= 100;

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
        sourcePageTitles: uniqueStrings([candidate.sourcePageTitle]),
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
    sourcePageTitles: uniqueStrings([...(left.sourcePageTitles || [left.sourcePageTitle]), ...(right.sourcePageTitles || [right.sourcePageTitle])]),
    snippets: uniqueStrings([...(left.snippets || [left.snippet]), ...(right.snippets || [right.snippet])]),
    sourceLinkScore: Math.max(left.sourceLinkScore || 0, right.sourceLinkScore || 0),
    pageIsLikelyStaff: Boolean(left.pageIsLikelyStaff || right.pageIsLikelyStaff),
    pageIsLikelySchoolHome: Boolean(left.pageIsLikelySchoolHome || right.pageIsLikelySchoolHome),
    name: chooseBetterName(left.name, right.name),
    role: chooseBetterRole(left.role, right.role),
    location: chooseBetterText(left.location, right.location),
    schoolLine: chooseBetterText(left.schoolLine, right.schoolLine),
    category: chooseBetterText(left.category, right.category),
    degrees: chooseBetterText(left.degrees, right.degrees),
    snippet: chooseBetterText(left.snippet, right.snippet),
    text: chooseBetterText(left.text, right.text),
  };
}

function enrichCandidateHeuristically(candidate, addressBook, index) {
  const normalizedName = chooseBetterName(candidate.name, inferNameFromSnippet(candidate.snippet));
  const localSnippet = extractLocalSnippetWindow(candidate.snippet, normalizedName) || candidate.snippet;
  const normalizedRole = chooseBetterRole(candidate.role, inferRoleFromSnippet(localSnippet, normalizedName));
  const snippetHasName = normalizedName && normalizePersonKey(localSnippet).includes(normalizePersonKey(normalizedName));
  const normalizedSnippet = snippetHasName
    ? localSnippet
    : [normalizedName, normalizedRole].filter(Boolean).join(" | ") || localSnippet;
  const normalizedCandidate = {
    ...candidate,
    name: normalizedName,
    role: normalizedRole,
    snippet: normalizedSnippet,
  };

  const localEvidenceText = collapseWhitespace(
    [
      normalizedCandidate.name,
      normalizedCandidate.role,
      normalizedCandidate.location,
      normalizedCandidate.schoolLine,
      normalizedSnippet,
    ].join(" ")
  );
  const contextText = collapseWhitespace(
    [
      localEvidenceText,
      normalizedCandidate.sourcePageTitle,
      normalizedCandidate.sourcePageUrl,
    ].join(" ")
  );

  const subjectTags = detectSubjectTags(contextText);
  const teacherSignal = TEACHER_SIGNAL.test(localEvidenceText) || EXPLICIT_STEM_ROLE_SIGNAL.test(localEvidenceText);
  const stemStaffSignal = STEM_STAFF_SIGNAL.test(localEvidenceText);
  const explicitRoleSignal = EXPLICIT_STEM_ROLE_SIGNAL.test(collapseWhitespace([normalizedCandidate.role, localSnippet].join(" ")));
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
  const value = stripInstitutionStemNoise(text || "");
  const tags = [];
  for (const [tag, regex] of STEM_KEYWORDS) {
    if (!regex.test(value)) {
      continue;
    }
    if (tag === "science" && /\bsocial science\b/i.test(value) && !/\b(biology|chemistry|physics|anatomy|environmental|earth science|life science|physical science|astronomy|geology|biomedical)\b/i.test(value)) {
      continue;
    }
    if (tag === "stem" && /\binstructional technology\b/i.test(value) && !/\b(computer science|technology teacher|technology education|engineering|robotics|coding|programming|maker|data science)\b/i.test(value)) {
      continue;
    }
    tags.push(tag);
  }
  if (/\btechnology teacher\b/i.test(value) || /\bteacher\b/i.test(value) && /\binstructional technology\b/i.test(value)) {
    tags.push("stem");
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

  const titles = [candidate.sourcePageTitle, ...(candidate.sourcePageTitles || [])];
  for (const title of titles) {
    const schoolTitle = extractSchoolTitle(title, candidate.sourcePageUrl);
    const schoolKey = normalizeKey(schoolTitle || "");
    if (schoolTitle && schoolKey && !/^(home|staff|faculty|directory)$/.test(schoolKey) && schoolKey !== normalizeKey(candidate.sourceHost || "")) {
      return schoolTitle;
    }
  }

  const fallbackTitle = extractSchoolTitle(candidate.sourcePageTitle, candidate.sourcePageUrl);
  const fallbackKey = normalizeKey(fallbackTitle || "");
  if (fallbackTitle && fallbackKey && !/^(home|staff|faculty|directory)$/.test(fallbackKey)) {
    return fallbackTitle;
  }

  return candidate.sourceHost;
}

function inferSchoolNameFromUrl(pageUrl) {
  try {
    const parsed = new URL(pageUrl);
    const match = parsed.pathname.match(/^\/(?:school|schools|site|o)\/([^/]+)/i);
    const slug = match?.[1] || "";
    if (!slug || !/-/.test(slug)) {
      return "";
    }
    return slug
      .split("-")
      .map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : "")
      .join(" ")
      .trim();
  } catch {
    return "";
  }
}

function extractSchoolTitle(pageTitle, pageUrl = "") {
  const segments = String(pageTitle || "")
    .split(/[|\-]/)
    .map((segment) => collapseWhitespace(segment))
    .filter(Boolean);
  const nonGenericSegments = segments.filter((segment) => !STRONG_LINK_SIGNAL.test(segment) && !/^(home|about|contact|academics|departments?|staff|faculty|directory)$/i.test(segment));
  const titledSchoolSegment = nonGenericSegments.find((segment) => SCHOOL_LINK_SIGNAL.test(segment));
  const urlSchoolName = inferSchoolNameFromUrl(pageUrl);
  if (titledSchoolSegment) {
    if (urlSchoolName && DISTRICT_TITLE_SIGNAL.test(titledSchoolSegment) && normalizeKey(urlSchoolName) !== normalizeKey(titledSchoolSegment)) {
      return urlSchoolName;
    }
    return titledSchoolSegment;
  }
  if (urlSchoolName) {
    return urlSchoolName;
  }
  return nonGenericSegments[0] || segments[0] || "";
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
  const identity = normalizeEmail(candidate.emails?.[0] || "") || normalizePersonKey(candidate.name);
  const school = normalizeHostKey(candidate.sourceHost || "") || normalizeKey(candidate.schoolLine || candidate.sourcePageTitle || "");
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

function scoreRoleText(value) {
  const role = collapseWhitespace(value || "");
  if (!role) {
    return -100;
  }
  let score = 0;
  if (TEACHER_SIGNAL.test(role)) score += 8;
  if (EXPLICIT_STEM_ROLE_SIGNAL.test(role)) score += 8;
  if (STEM_STAFF_SIGNAL.test(role)) score += 5;
  score += detectSubjectTags(role).length * 2;
  if (NEGATIVE_ROLE_SIGNAL.test(role)) score -= 10;
  if (/^(math|mathematics|science|biology|biological sciences|chemistry|physics|computer science|engineering|robotics|stem|comp sci|cte, computer science & engineering)$/i.test(role)) score -= 8;
  if (/^(assistant principal|principal|guidance counselor|secretary|support)$/i.test(role)) score -= 12;
  score += Math.min(role.length, 80) / 100;
  return score;
}

function countTeacherRoleClauses(value) {
  return (collapseWhitespace(value || "").match(/\bteacher\s*[-‑–—,:]\s*/gi) || []).length;
}

function isDepartmentOnlyRole(value) {
  const role = collapseWhitespace(value || "");
  if (!role) {
    return false;
  }
  if (/\b(title|titles)\s*:/i.test(role)) {
    return false;
  }
  if (/\b(teacher|educator|faculty|instructor|professor|specialist|chair|head|principal|assistant|director|coordinator|counselor|secretary|manager|dean)\b/i.test(role)) {
    return false;
  }

  const normalized = role
    .replace(/^departments?:\s*/i, "")
    .replace(/\s*&\s*/g, ", ")
    .replace(/\s+and\s+/gi, ", ")
    .replace(/\s*\/\s*/g, ", ");
  const parts = normalized.split(",").map((part) => collapseWhitespace(part)).filter(Boolean);
  if (!parts.length || parts.length > 8) {
    return false;
  }

  return parts.every((part) => /^(applied arts|business|computer science|cte|data science|digital learning|engineering|english|family and consumer sciences|instructional technology|maker|math|mathematics|physics|chemistry|biology|science|stem|steam|technology|technology education|robotics|social studies|world language|physical education)$/i.test(part));
}

function chooseBetterRole(left, right) {
  const leftValue = collapseWhitespace(left || "");
  const rightValue = collapseWhitespace(right || "");
  if (!leftValue) return rightValue;
  if (!rightValue) return leftValue;

  const leftTeacherClauses = countTeacherRoleClauses(leftValue);
  const rightTeacherClauses = countTeacherRoleClauses(rightValue);
  if (leftValue !== rightValue && leftValue.includes(rightValue) && leftTeacherClauses >= 2 && leftTeacherClauses > rightTeacherClauses) {
    return rightValue;
  }
  if (leftValue !== rightValue && rightValue.includes(leftValue) && rightTeacherClauses >= 2 && rightTeacherClauses > leftTeacherClauses) {
    return leftValue;
  }

  const leftDepartmentOnly = isDepartmentOnlyRole(leftValue);
  const rightDepartmentOnly = isDepartmentOnlyRole(rightValue);
  if (leftDepartmentOnly !== rightDepartmentOnly) {
    const preferred = leftDepartmentOnly ? rightValue : leftValue;
    const fallback = leftDepartmentOnly ? leftValue : rightValue;
    if (TEACHER_SIGNAL.test(preferred) || NON_TEACHING_TITLE_SIGNAL.test(preferred) || EXPLICIT_STEM_ROLE_SIGNAL.test(preferred)) {
      return preferred;
    }
    if (TEACHER_SIGNAL.test(fallback) || NON_TEACHING_TITLE_SIGNAL.test(fallback) || EXPLICIT_STEM_ROLE_SIGNAL.test(fallback)) {
      return fallback;
    }
  }

  const leftScore = scoreRoleText(leftValue);
  const rightScore = scoreRoleText(rightValue);
  if (rightScore !== leftScore) {
    return rightScore > leftScore ? rightValue : leftValue;
  }
  return rightValue.length < leftValue.length ? rightValue : leftValue;
}

function chooseBetterName(left, right) {
  const leftValue = cleanPersonName(left || "");
  const rightValue = cleanPersonName(right || "");
  if (!leftValue) return rightValue;
  if (!rightValue) return leftValue;
  const leftScore = scoreName(leftValue);
  const rightScore = scoreName(rightValue);
  if (rightScore !== leftScore) {
    return rightScore > leftScore ? rightValue : leftValue;
  }
  const leftQuality = scoreDisplayNameQuality(leftValue);
  const rightQuality = scoreDisplayNameQuality(rightValue);
  if (rightQuality !== leftQuality) {
    return rightQuality > leftQuality ? rightValue : leftValue;
  }
  return rightValue.length < leftValue.length ? rightValue : leftValue;
}

function specializeRoleWithCategory(role, category) {
  const roleText = collapseWhitespace(role || "");
  const categoryText = collapseWhitespace(category || "");
  if (!roleText || !categoryText) {
    return roleText;
  }
  if (!detectSubjectTags(categoryText).length) {
    return roleText;
  }
  if (/\b(special education|learning behavior specialist|case manager|counselor|social worker)\b/i.test(roleText)) {
    return roleText;
  }
  if (detectSubjectTags(roleText).length) {
    return roleText;
  }
  if (TEACHER_SIGNAL.test(roleText)) {
    return `${roleText} - ${categoryText}`;
  }
  return roleText;
}

function isAddressLikeLine(value) {
  const text = collapseWhitespace(value || "");
  if (!text) {
    return false;
  }
  return Boolean(extractAddressesFromText(text).length) || CITY_STATE_ZIP_EXACT.test(text) || (/\d/.test(text) && STREET_LINE_SIGNAL.test(text));
}

function scoreName(value) {
  const cleaned = cleanPersonName(value);
  if (INVALID_NAME_SIGNAL.test(cleaned) || NON_PERSON_NAME_SIGNAL.test(cleaned)) {
    return 0;
  }
  if (/\d/.test(cleaned) || /[:/@()]/.test(cleaned) || isAddressLikeLine(cleaned)) {
    return 0;
  }
  if (/\b(requirements|mentor|curriculum|department|program|instruction|information)\b/i.test(cleaned) || /^the\b/i.test(cleaned) || /\bof\b/i.test(cleaned)) {
    return 0;
  }
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 5) {
    return 0;
  }
  if (/\b(staff|directory|teacher|science|math|mathematics|stem|leader|school|board|chair|specialist|coordinator|coach|home|department|office|support|website|email)\b/i.test(cleaned)) {
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

function isStandaloneSubjectLine(value) {
  const line = collapseWhitespace(value || "");
  if (!line || DEGREE_LINE_SIGNAL.test(line) || TEACHER_SIGNAL.test(line) || isAddressLikeLine(line)) {
    return false;
  }
  if (!STEM_SUBJECT_ONLY_LINE.test(line)) {
    return false;
  }
  const words = line.split(/\s+/).filter(Boolean);
  return words.length <= 6;
}

function extractLocalSnippetWindow(snippet, name) {
  const parts = String(snippet || "").split(" | ").map((part) => collapseWhitespace(part)).filter(Boolean);
  if (!parts.length) {
    return "";
  }

  const nameKey = normalizePersonKey(name);
  const start = nameKey ? Math.max(0, parts.findIndex((part) => normalizePersonKey(part) === nameKey)) : 0;
  const startIndex = start >= 0 ? start : 0;
  const windowStartIndex = startIndex > 0 && isStandaloneSubjectLine(parts[startIndex - 1]) ? startIndex - 1 : startIndex;
  let endIndex = parts.length;

  for (let index = startIndex + 1; index < parts.length; index += 1) {
    const part = parts[index];
    const partKey = normalizePersonKey(part);
    if (!partKey || partKey === nameKey) {
      continue;
    }
    if (scoreName(part) > 1 || /^to\b/i.test(part)) {
      endIndex = index;
      break;
    }
  }

  return parts
    .slice(windowStartIndex, endIndex)
    .filter((part, index) => index === 0 || !DEGREE_LINE_SIGNAL.test(part) || /\bteacher\b/i.test(part))
    .join(" | ");
}

function inferRoleFromSnippet(snippet, name) {
  const parts = String(snippet || "").split(" | ").map((part) => collapseWhitespace(part)).filter(Boolean);
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (!part || part === name) {
      continue;
    }
    if (/@|\b(phone|fax)\b/i.test(part) || isAddressLikeLine(part)) {
      continue;
    }
    if (DEGREE_LINE_SIGNAL.test(part) && !/\bteacher\b/i.test(part)) {
      continue;
    }
    if (/^(email|visit website|your name:?|your e-mail:?|subject:?|message:?)$/i.test(part)) {
      continue;
    }
    if (/^teacher$/i.test(part) && isStandaloneSubjectLine(parts[index + 1] || "")) {
      return `Teacher - ${parts[index + 1]}`;
    }
    if (
      (isStandaloneSubjectLine(part) || /^(comp sci|cte, computer science & engineering|biological sciences)$/i.test(part)) &&
      (parts[index + 1] === name || /\bteacher\b/i.test(parts[index + 1] || "") || /\bteacher\b/i.test(parts[index + 2] || ""))
    ) {
      continue;
    }
    if (SCHOOL_LINK_SIGNAL.test(part) && !TEACHER_SIGNAL.test(part) && !STEM_STAFF_SIGNAL.test(part)) {
      continue;
    }
    return part;
  }
  return "";
}

function extractStaffListDepartment(pageTitle) {
  const title = collapseWhitespace(pageTitle || "");
  const match = title.match(/^staff list\s*[-|:]\s*(.+?)\s*[-|:]\s*(?:academic(?: departments?)?|educational support|departments?|faculty|staff)\b/i);
  return collapseWhitespace(match?.[1] || "");
}

function isRosterUtilityLine(line, department = "", institutionName = "") {
  const value = collapseWhitespace(line || "");
  if (!value) {
    return true;
  }
  if (department && normalizeKey(value) === normalizeKey(department)) {
    return true;
  }
  if (institutionName && normalizeKey(value) === normalizeKey(institutionName)) {
    return true;
  }
  if (isAddressLikeLine(value) || /^(p:|f:)\b/i.test(value)) {
    return true;
  }
  return /^(home|staff list|full faculty directory\.?|course descriptions|video & audio|tutoring(?: schedule)?|links|work-based learning|search:?|there is no staff matching your search criteria|skip to content|skip to menu|x|translate|non-discrimination statement|web accessibility statement)$/i.test(value);
}

function extractRosterCandidatesFromBody(bodyText, pageTitle) {
  const department = extractStaffListDepartment(pageTitle);
  const institutionName = extractSchoolTitle(pageTitle);
  if (!department) {
    return [];
  }

  const lines = String(bodyText || "")
    .split(/\n+/)
    .map((line) => collapseWhitespace(line))
    .filter(Boolean);
  if (!lines.length) {
    return [];
  }

  const normalizedDepartment = normalizeKey(department);
  const departmentIndexes = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => normalizeKey(line) === normalizedDepartment)
    .map(({ index }) => index);

  const startIndex = departmentIndexes.length ? departmentIndexes[departmentIndexes.length - 1] : 0;
  let section = lines.slice(startIndex);
  const footerIndex = section.findIndex(
    (line, index) =>
      index > 0 &&
      (isRosterUtilityLine(line, department, institutionName) || /non-discrimination statement|web accessibility statement/i.test(line))
  );
  if (footerIndex > 0) {
    section = section.slice(0, footerIndex);
  }

  section = section.filter((line) => !isRosterUtilityLine(line, department, institutionName));
  if (section.length < 4) {
    return [];
  }

  const teacherLikeCount = section.filter((line) => /\bteacher\b/i.test(line)).length;
  const records = [];
  for (let index = 0; index < section.length; index += 1) {
    const name = section[index];
    if (scoreName(name) <= 1) {
      continue;
    }

    let cursor = index + 1;
    let role = "";
    const extras = [];
    while (cursor < section.length && scoreName(section[cursor]) <= 1) {
      const line = section[cursor];
      if (!role && !isRosterUtilityLine(line, department, institutionName)) {
        role = line;
      } else if (!isRosterUtilityLine(line, department, institutionName)) {
        extras.push(line);
      }
      cursor += 1;
    }

    if (!role && teacherLikeCount >= 5) {
      role = "Teacher";
    }

    records.push({
      name,
      role,
      location: "",
      schoolLine: "",
      category: department,
      degrees: extras
        .filter((line) => /\b(B\.|M\.|Ph\.?D|Ed\.?D|degree|mathematics|science|chemistry|physics|engineering|computer science|biology)\b/i.test(line))
        .join(" | ")
        .slice(0, 300),
      snippet: [department, name, role, ...extras.slice(0, 2)].filter(Boolean).join(" | ").slice(0, 700),
      text: [department, name, role, ...extras].filter(Boolean).join(" | ").slice(0, 1600),
      emails: [],
      phones: [],
    });

    index = cursor - 1;
  }

  return records.filter((record) => record.name && scoreName(record.name) > 1 && record.role);
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
  const cleanedName = cleanPersonName(record.name || "");
  if (/^(?:B\.(?:A|S)\.|M\.(?:A|S|Ed|AT)\.|Ph\.?D\.?|Ed\.?D\.?)\s+/i.test(cleanedName)) {
    return false;
  }
  const roleText = collapseWhitespace(record.role || "");
  const localSnippet = extractLocalSnippetWindow(record.snippet, record.name) || record.snippet;
  const rawSnippetText = collapseWhitespace([record.snippet, record.text].filter(Boolean).join(" "));
  const localContextText = stripInstitutionStemNoise([record.name, roleText, localSnippet].join(" "));
  const contextText = stripInstitutionStemNoise([localContextText, record.whyIncluded, record.sourcePageTitle].join(" "));
  const explicitStemInRole = EXPLICIT_STEM_ROLE_SIGNAL.test(roleText) || /\b(math|mathematics|science|biology|chemistry|physics|computer science|engineering|robotics|stem|technology teacher|technology education)\b/i.test(roleText);
  const hardStemEvidence = /\b(math|mathematics|biology|chemistry|physics|computer science|engineering|robotics|stem|technology teacher|technology education|anatomy|physiology)\b/i.test(contextText);
  const localStemEvidence = /\b(math|mathematics|science|biology|chemistry|physics|computer science|engineering|robotics|stem|technology teacher|technology education|instructional technology|anatomy|physiology)\b/i.test(localContextText);
  const hasTeacherLikeEvidence = TEACHER_SIGNAL.test(contextText) || STEM_STAFF_SIGNAL.test(contextText) || EXPLICIT_STEM_ROLE_SIGNAL.test(contextText);
  const hasDirectTeacherLikeEvidence = TEACHER_SIGNAL.test(localContextText) || STEM_STAFF_SIGNAL.test(localContextText) || EXPLICIT_STEM_ROLE_SIGNAL.test(localContextText);
  const hasDirectTeacherTitleEvidence = TEACHER_SIGNAL.test(localContextText) || EXPLICIT_STEM_ROLE_SIGNAL.test(localContextText);
  const hasSnippetTeacherTitleEvidence = TEACHER_SIGNAL.test(rawSnippetText) || EXPLICIT_STEM_ROLE_SIGNAL.test(rawSnippetText);
  const hasStemEvidence = explicitStemInRole || localStemEvidence;
  const hasDirectNonTeachingTitle = NON_TEACHING_TITLE_SIGNAL.test(localContextText);
  const hasSnippetNonTeachingTitle = NON_TEACHING_TITLE_SIGNAL.test(rawSnippetText);
  const genericRoleOnly = /^(teacher|educator|faculty|instructor|specialist)$/i.test(roleText);
  const departmentOnlyRole = isDepartmentOnlyRole(roleText);
  if (INVALID_NAME_SIGNAL.test(record.name) || INVALID_ROLE_SIGNAL.test(roleText) || isAddressLikeLine(roleText)) {
    return false;
  }
  if (roleText && normalizeKey(cleanedName) === normalizeKey(roleText)) {
    return false;
  }
  if (NEGATIVE_CONTEXT_SIGNAL.test(contextText) && !hasDirectTeacherLikeEvidence) {
    return false;
  }
  if (NEGATIVE_ROLE_SIGNAL.test(roleText)) {
    return false;
  }
  if ((hasDirectNonTeachingTitle && !hasDirectTeacherTitleEvidence) || (hasSnippetNonTeachingTitle && !hasSnippetTeacherTitleEvidence)) {
    return false;
  }
  if (departmentOnlyRole && !hasDirectTeacherTitleEvidence && !hasSnippetTeacherTitleEvidence) {
    return false;
  }
  if (/\b(assistant principal|principal)\b/i.test(contextText) && !/\bteacher\b/i.test(roleText)) {
    return false;
  }
  if (DEGREE_LINE_SIGNAL.test(roleText) && !/\bteacher\b/i.test(roleText)) {
    return false;
  }
  if (genericRoleOnly && !localStemEvidence) {
    return false;
  }
  if (/\b(art|music|english|history|social studies|world language|guidance|political science)\b/i.test(contextText) && !hardStemEvidence) {
    return false;
  }
  if (/\b(art|music|english|history|social studies|world language|political science)\b/i.test(contextText) && !explicitStemInRole) {
    return false;
  }
  if (/\bsocial science\b/i.test(contextText) && !/\b(biology|chemistry|physics|anatomy|environmental|earth science|life science|physical science|astronomy|geology|biomedical)\b/i.test(contextText)) {
    return false;
  }
  if (!hasTeacherLikeEvidence || !hasStemEvidence) {
    return false;
  }
  return true;
}

function focusRecordsToInstitution(records, startingPageTitle, startUrl = "") {
  const institution = extractSchoolTitle(startingPageTitle, startUrl);
  const startParsedUrl = new URL(startUrl || "https://example.invalid");
  const startHostKey = normalizeHostKey(startParsedUrl.hostname || "");
  const startSchoolPathKey = extractSchoolPathKey(startParsedUrl.pathname || "");
  const institutionLooksDistrict = /\bdistrict\b/i.test(institution || "") || DISTRICT_TITLE_SIGNAL.test(institution || "");
  if (!institution && !startSchoolPathKey) {
    return records;
  }
  if (institutionLooksDistrict && !startSchoolPathKey) {
    return records;
  }
  const institutionKey = normalizeKey(institution);
  const focused = records.filter((record) => {
    const schoolKey = normalizeKey(record.schoolName || record.schoolLine || "");
    const sourceHostKey = normalizeHostKey(record.sourceHost || "");
    let sourceSchoolPathKey = "";
    try {
      sourceSchoolPathKey = extractSchoolPathKey(new URL(record.sourcePageUrl || startUrl || "https://example.invalid").pathname || "");
    } catch {
      sourceSchoolPathKey = "";
    }
    if (schoolKey && (schoolKey.includes(institutionKey) || institutionKey.includes(schoolKey))) {
      return true;
    }
    if (startSchoolPathKey) {
      return sourceSchoolPathKey ? startSchoolPathKey === sourceSchoolPathKey : false;
    }
    return startHostKey && sourceHostKey === startHostKey;
  });
  if (startSchoolPathKey) {
    return focused;
  }
  return focused.length >= 3 ? focused : records;
}

function dedupeRecords(records) {
  const deduped = [];
  const indexByKey = new Map();

  for (const record of sortFinalRecords(records)) {
    const keys = buildRecordIdentityKeys(record);
    const existingIndex = keys.find((key) => indexByKey.has(key));
    if (existingIndex == null) {
      const index = deduped.length;
      deduped.push(record);
      for (const key of keys) {
        indexByKey.set(key, index);
      }
      continue;
    }

    const index = indexByKey.get(existingIndex);
    const merged = mergeEnrichedRecords(deduped[index], record);
    deduped[index] = merged;
    for (const key of buildRecordIdentityKeys(merged)) {
      indexByKey.set(key, index);
    }
  }

  return deduped;
}

function buildRecordIdentityKeys(record) {
  const schoolKey = normalizeHostKey(record.sourceHost || "") || normalizeKey(record.schoolName || record.schoolLine || record.sourcePageTitle || "");
  const fallbackSchoolKeys = uniqueStrings([
    record.schoolName,
    record.schoolLine,
    extractSchoolTitle(record.sourcePageTitle),
    ...((record.sourcePageTitles || []).map((title) => extractSchoolTitle(title))),
  ])
    .map((value) => normalizeKey(value || ""))
    .filter((value) => value && value !== schoolKey);
  const pageKey = normalizeUrlForQueue(record.sourcePageUrl || "");
  const keys = [];
  const emailKey = normalizeEmail(record.emails?.[0] || "");
  const nameKey = normalizePersonKey(record.name);

  if (emailKey) {
    keys.push(`email:${emailKey}`);
    if (schoolKey) keys.push(`email:${emailKey}|${schoolKey}`);
    for (const fallbackSchoolKey of fallbackSchoolKeys) {
      keys.push(`email:${emailKey}|${fallbackSchoolKey}`);
    }
  }

  if (nameKey) {
    if (schoolKey) keys.push(`name:${nameKey}|${schoolKey}`);
    for (const fallbackSchoolKey of fallbackSchoolKeys) {
      keys.push(`name:${nameKey}|${fallbackSchoolKey}`);
    }
    if (pageKey) keys.push(`page:${pageKey}|${nameKey}`);
  }

  return uniqueStrings(keys);
}

function mergeEnrichedRecords(left, right) {
  const merged = mergeCandidateRecords(left, right);
  const { firstName, lastName } = splitName(merged.name);
  return {
    ...merged,
    include: Boolean(left.include || right.include),
    heuristicScore: Math.max(left.heuristicScore || 0, right.heuristicScore || 0),
    topScore: Math.max(left.topScore || 0, right.topScore || 0),
    confidence: Math.max(left.confidence || 0, right.confidence || 0),
    subjectTags: uniqueStrings([...(left.subjectTags || []), ...(right.subjectTags || [])]),
    mailingAddress: chooseBetterText(left.mailingAddress, right.mailingAddress),
    schoolName: chooseBetterText(left.schoolName, right.schoolName),
    whyIncluded: chooseBetterText(left.whyIncluded, right.whyIncluded),
    firstName,
    lastName,
    enrichmentSource: left.enrichmentSource === "openrouter" || right.enrichmentSource === "openrouter" ? "openrouter" : left.enrichmentSource || right.enrichmentSource || "heuristic",
  };
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
    parsed.hostname = normalizeHostname(parsed.hostname);
    return parsed.toString();
  } catch {
    return "";
  }
}

function normalizeUrlForQueue(raw) {
  try {
    const parsed = new URL(raw);
    parsed.hash = "";
    parsed.hostname = normalizeHostname(parsed.hostname);
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^__cf_/i.test(key)) {
        parsed.searchParams.delete(key);
      }
    }
    if ((parsed.protocol === "https:" && parsed.port === "443") || (parsed.protocol === "http:" && parsed.port === "80")) {
      parsed.port = "";
    }
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

function normalizeHostKey(value) {
  const normalized = normalizeHostname(collapseWhitespace(value || ""));
  if (!normalized) {
    return "";
  }
  return getDomain(normalized) || normalized;
}

function normalizeHostname(value) {
  return collapseWhitespace(value || "").toLowerCase().replace(/^www\./, "");
}

function cleanPersonName(value) {
  return collapseWhitespace(value || "")
    .replace(/[|]+/g, " ")
    .replace(/\s+[.,;:]+$/g, "")
    .replace(/([A-Za-z])\.$/, "$1")
    .trim();
}

function scoreDisplayNameQuality(value) {
  const cleaned = cleanPersonName(value);
  let score = 0;
  if (cleaned && !/[.,;:]+$/.test(cleaned)) score += 2;
  if (/^(Mr|Mrs|Ms|Miss|Mx|Dr)\.?\s+[A-Z][a-z'.-]+(?:\s+[A-Z][a-z'.-]+)+$/.test(cleaned)) score += 4;
  if (/^[A-Z][a-z'.-]+(?:\s+[A-Z][a-z'.-]+)+$/.test(cleaned)) score += 3;
  if (/^[A-Z][A-Z'.-]+(?:\s+[A-Z][A-Z'.-]+)+$/.test(cleaned)) score += 1;
  if (/[a-z]/.test(cleaned) && /[A-Z]/.test(cleaned)) score += 1;
  return score;
}

function normalizeEmail(value) {
  return collapseWhitespace(value || "").toLowerCase();
}

function normalizePersonKey(value) {
  return normalizeKey(value || "").replace(/^(mr|mrs|ms|miss|mx|dr)\s+/, "");
}

function stripInstitutionStemNoise(value) {
  return collapseWhitespace(value || "")
    .replace(/\b(?:elementary|middle|high school|school|academy|institute|campus|center|centre)\s+of\s+(?:science|math(?:ematics)?|technology|engineering|stem)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
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
