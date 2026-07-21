import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const EPISODES = {
  475: {
    id: "lex-475-demis-hassabis-2",
    title: "Lex Fridman Podcast #475: Demis Hassabis 2",
    publisher: "Lex Fridman Podcast",
    episodeNumber: 475,
    episodeUrl: "https://lexfridman.com/demis-hassabis-2/",
    transcriptUrl: "https://lexfridman.com/demis-hassabis-2-transcript/",
    audioUrl: "https://media.blubrry.com/takeituneasy/content.blubrry.com/takeituneasy/lex_ai_demis_hassabis_2.mp3",
    audioFilename: "lex_ai_demis_hassabis_2.mp3",
    publishedAt: "2025-07-23",
    duration: 9296,
    rightsStatus: "unverified",
    rssUrl: "https://lexfridman.com/feed/podcast/"
  }
};

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizeSpace(value) {
  return value.replace(/\s+/g, " ").trim();
}

function decodeHtml(value) {
  const named = { amp: "&", apos: "'", quot: '"', nbsp: " ", lt: "<", gt: ">", hellip: "…", ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”" };
  return value.replace(/&#(x[0-9a-f]+|\d+);|&([a-z]+);/gi, (match, numeric, name) => {
    if (numeric) return String.fromCodePoint(Number.parseInt(numeric.replace(/^x/i, ""), numeric[0].toLowerCase() === "x" ? 16 : 10));
    return named[name.toLowerCase()] ?? match;
  });
}

function textContent(html) {
  return normalizeSpace(decodeHtml(html.replace(/<[^>]*>/g, " ")));
}

function classContent(block, className) {
  const expression = new RegExp(`<(?:span|div)[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/(?:span|div)>`, "i");
  return expression.exec(block)?.[1];
}

function secondsFromTimestamp(value) {
  const parts = value.replace(/[()]/g, "").split(":").map(Number);
  invariant(parts.length === 3 && parts.every(Number.isFinite), `invalid transcript timestamp ${value}`);
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

export function extractTranscript(html, transcriptUrl = "fixture://transcript") {
  const blocks = [...html.matchAll(/<div[^>]*class=["'][^"']*\bts-segment\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)];
  invariant(blocks.length > 0, "Lex transcript structure changed: no .ts-segment elements found");
  let speaker = "";
  const paragraphs = blocks.map((match, index) => {
    const block = match[1];
    const speakerHtml = classContent(block, "ts-name");
    const timestampHtml = classContent(block, "ts-timestamp");
    const bodyHtml = classContent(block, "ts-text");
    invariant(speakerHtml !== undefined && timestampHtml !== undefined && bodyHtml !== undefined,
      `Lex transcript structure changed: paragraph ${index + 1} is missing .ts-name, .ts-timestamp, or .ts-text`);
    const explicitSpeaker = textContent(speakerHtml);
    if (explicitSpeaker) speaker = explicitSpeaker;
    invariant(speaker, `paragraph ${index + 1} has no speaker to inherit`);
    const timestamp = textContent(timestampHtml);
    const start = secondsFromTimestamp(timestamp);
    const hrefSeconds = /[?&](?:amp;)?t=(\d+)/i.exec(decodeHtml(timestampHtml))?.[1];
    invariant(hrefSeconds === undefined || Number(hrefSeconds) === start,
      `paragraph ${index + 1} timestamp text and link disagree`);
    const text = textContent(bodyHtml);
    invariant(text, `paragraph ${index + 1} has empty .ts-text`);
    return { id: `p${String(index + 1).padStart(4, "0")}`, speaker, start, text };
  });
  paragraphs.forEach((paragraph, index) => {
    if (index > 0) invariant(paragraph.start >= paragraphs[index - 1].start,
      `transcript timestamps move backwards at ${paragraph.id}`);
  });
  const fingerprint = createHash("sha256").update(JSON.stringify(paragraphs)).digest("hex");
  return { transcriptUrl, fingerprint, paragraphs };
}

const abbreviations = new Set(["mr.", "mrs.", "ms.", "dr.", "prof.", "sr.", "jr.", "st.", "vs.", "etc.", "e.g.", "i.e.", "u.s.", "u.k."]);

export function splitSentences(text) {
  const tokens = text.match(/\S+/g) ?? [];
  const sentences = [];
  let current = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    current.push(token);
    const lower = token.toLowerCase().replace(/[”’"')\]]+$/, "");
    const next = tokens[index + 1] ?? "";
    const terminal = /[.!?][”’"')\]]*$/.test(token);
    const decimal = /\d\.\d/.test(token);
    const initial = /^[A-Z]\.$/.test(lower);
    if (terminal && !decimal && !initial && !abbreviations.has(lower) && (!next || /^[A-Z“‘]/.test(next))) {
      sentences.push(current.join(" "));
      current = [];
    }
  }
  if (current.length) sentences.push(current.join(" "));
  return sentences;
}

function wordCount(text) {
  return text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)?.length ?? 1;
}

function splitLongUnit(text, maxWords = 55) {
  if (wordCount(text) <= maxWords) return [text];
  const clauses = text.split(/(?<=[,;:—])\s+/);
  const result = [];
  let current = "";
  for (const clause of clauses) {
    if (wordCount(clause) > maxWords) {
      if (current) result.push(current), current = "";
      const words = clause.split(/\s+/);
      for (let i = 0; i < words.length; i += maxWords) result.push(words.slice(i, i + maxWords).join(" "));
    } else if (!current || wordCount(`${current} ${clause}`) <= maxWords) {
      current = current ? `${current} ${clause}` : clause;
    } else {
      result.push(current);
      current = clause;
    }
  }
  if (current) result.push(current);
  return result;
}

function groupLearningUnits(units, intervalDuration, totalWords) {
  const groups = [];
  let current = [];
  let currentWords = 0;
  for (const unit of units) {
    const unitWords = wordCount(unit);
    const candidateDuration = intervalDuration * (currentWords + unitWords) / totalWords;
    const currentDuration = intervalDuration * currentWords / totalWords;
    if (current.length && (current.length === 3 || (currentDuration >= 8 && candidateDuration > 25))) {
      groups.push(current.join(" "));
      current = [];
      currentWords = 0;
    }
    current.push(unit);
    currentWords += unitWords;
    if (current.length === 3 || intervalDuration * currentWords / totalWords >= 8) {
      groups.push(current.join(" "));
      current = [];
      currentWords = 0;
    }
  }
  if (current.length) {
    groups.push(current.join(" "));
  }
  return groups;
}

export function segmentTranscript(extraction, duration) {
  const segments = [];
  for (let groupStart = 0; groupStart < extraction.paragraphs.length;) {
    let groupEnd = groupStart + 1;
    while (groupEnd < extraction.paragraphs.length && extraction.paragraphs[groupEnd].start === extraction.paragraphs[groupStart].start) groupEnd += 1;
    const rawGroup = extraction.paragraphs.slice(groupStart, groupEnd).map((paragraph) => ({
      paragraph, units: splitSentences(paragraph.text).flatMap((sentence) => splitLongUnit(sentence))
    }));
    const totalWords = rawGroup.reduce((sum, entry) => sum + entry.units.reduce((unitSum, unit) => unitSum + wordCount(unit), 0), 0);
    const naturalDuration = Math.max(1, totalWords / 2.5);
    const intervalStart = rawGroup[0].paragraph.start;
    const intervalEnd = extraction.paragraphs[groupEnd]?.start ?? Math.min(duration, intervalStart + naturalDuration);
    invariant(intervalEnd > intervalStart, `cannot estimate a positive interval for ${rawGroup[0].paragraph.id}`);
    const group = rawGroup.map(({ paragraph, units }) => ({
      paragraph,
      units: groupLearningUnits(units, intervalEnd - intervalStart, totalWords)
    }));
    let elapsedWords = 0;
    for (const { paragraph, units } of group) {
      for (const unit of units) {
        const start = intervalStart + (intervalEnd - intervalStart) * elapsedWords / totalWords;
        elapsedWords += wordCount(unit);
        const end = intervalStart + (intervalEnd - intervalStart) * elapsedWords / totalWords;
        segments.push({
          id: `s${String(segments.length + 1).padStart(4, "0")}`,
          speaker: paragraph.speaker,
          start: Number(start.toFixed(6)),
          end: Number(end.toFixed(6)),
          text: unit,
          timingQuality: "estimated",
          sourceSegmentId: paragraph.id
        });
      }
    }
    groupStart = groupEnd;
  }
  return segments;
}

export function buildCourse(episode, extraction) {
  return {
    version: 1,
    course: {
      id: episode.id,
      title: episode.title,
      audioFilename: episode.audioFilename,
      duration: episode.duration,
      language: "en",
      source: {
        publisher: episode.publisher,
        episodeNumber: episode.episodeNumber,
        episodeUrl: episode.episodeUrl,
        transcriptUrl: episode.transcriptUrl,
        audioUrl: episode.audioUrl,
        publishedAt: episode.publishedAt,
        rightsStatus: episode.rightsStatus,
        transcriptSha256: extraction.fingerprint
      }
    },
    segments: segmentTranscript(extraction, episode.duration)
  };
}

export function validateCourse(course, { requireTranslations = true, publicOutput = false } = {}) {
  invariant(course?.version === 1 && course.course && Array.isArray(course.segments) && course.segments.length > 0, "invalid course shape");
  const source = course.course.source;
  invariant(source && source.publisher && source.episodeUrl && source.transcriptUrl && source.audioUrl && source.transcriptSha256,
    "Lex course source metadata is incomplete");
  invariant(["unverified", "approved", "private-only"].includes(source.rightsStatus), "invalid rightsStatus");
  if (publicOutput) invariant(source.rightsStatus === "approved", "publication blocked: rightsStatus must be approved");
  const ids = new Set();
  const estimated = [];
  const underEightSeconds = [];
  const overThirtySeconds = [];
  let previousEnd = -1;
  for (const segment of course.segments) {
    invariant(segment.id && !ids.has(segment.id), `duplicate or missing segment ID ${segment.id ?? ""}`);
    ids.add(segment.id);
    invariant(typeof segment.text === "string" && segment.text.trim() && segment.speaker, `${segment.id} is missing text or speaker`);
    invariant(Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.start >= 0 && segment.start < segment.end,
      `${segment.id} has invalid timing`);
    invariant(segment.start >= previousEnd && segment.end <= course.course.duration, `${segment.id} is out of order, overlaps, or exceeds duration`);
    invariant(["official", "aligned", "estimated"].includes(segment.timingQuality), `${segment.id} has invalid timingQuality`);
    if (segment.timingQuality === "estimated") estimated.push(segment.id);
    if (segment.end - segment.start < 8) underEightSeconds.push(segment.id);
    if (segment.end - segment.start > 30) overThirtySeconds.push(segment.id);
    if (requireTranslations) invariant(typeof segment.translations?.["zh-Hans"] === "string" && segment.translations["zh-Hans"].trim(),
      `${segment.id} is missing zh-Hans translation`);
    previousEnd = segment.end;
  }
  return {
    courseId: course.course.id,
    segmentCount: course.segments.length,
    estimatedCount: estimated.length,
    estimatedSegmentIds: estimated,
    underEightSecondsCount: underEightSeconds.length,
    overThirtySecondsCount: overThirtySeconds.length,
    overThirtySecondSegmentIds: overThirtySeconds,
    translationStatus: requireTranslations ? "complete" : "draft-not-checked",
    rightsStatus: source.rightsStatus,
    publishable: source.rightsStatus === "approved"
  };
}

async function fetchText(url, label) {
  let response;
  try {
    response = await fetch(url, { headers: { "user-agent": "learn-English Lex production script" } });
  } catch (error) {
    throw new Error(`${label} request failed for ${url}: ${error instanceof Error ? error.message : String(error)}`);
  }
  invariant(response.ok, `${label} returned HTTP ${response.status}`);
  return response.text();
}

function rssItemForEpisode(xml, episodeNumber) {
  const item = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((match) => match[1])
    .find((value) => new RegExp(`#${episodeNumber}\\b`).test(textContent(value)));
  invariant(item, `RSS does not contain episode #${episodeNumber}`);
  return item;
}

export async function probeEpisode(episode) {
  const [page, transcriptHtml, rss] = await Promise.all([
    fetchText(episode.episodeUrl, "episode page"),
    fetchText(episode.transcriptUrl, "transcript page"),
    fetchText(episode.rssUrl, "podcast RSS")
  ]);
  invariant(page.includes(`#${episode.episodeNumber}`), "episode page does not identify the expected episode");
  const extraction = extractTranscript(transcriptHtml, episode.transcriptUrl);
  const item = rssItemForEpisode(rss, episode.episodeNumber);
  invariant(decodeHtml(item).includes(episode.audioUrl), "RSS enclosure does not match the configured official audio URL");
  let audioResponse;
  try {
    audioResponse = await fetch(episode.audioUrl, { headers: { Range: "bytes=0-0", "user-agent": "learn-English Lex production script" } });
  } catch (error) {
    throw new Error(`audio Range request failed for ${episode.audioUrl}: ${error instanceof Error ? error.message : String(error)}`);
  }
  invariant(audioResponse.status === 206, `audio range probe expected HTTP 206, received ${audioResponse.status}`);
  invariant((audioResponse.headers.get("content-type") ?? "").toLowerCase().includes("audio"), "audio Content-Type is not audio/*");
  invariant(audioResponse.headers.get("access-control-allow-origin"), "audio response has no CORS access-control-allow-origin header");
  const totalBytes = Number(/\/(\d+)$/.exec(audioResponse.headers.get("content-range") ?? "")?.[1]);
  return { episode: episode.episodeNumber, paragraphCount: extraction.paragraphs.length, firstTimestamp: extraction.paragraphs[0].start,
    lastTimestamp: extraction.paragraphs.at(-1).start, transcriptSha256: extraction.fingerprint, audioBytes: totalBytes,
    rangeSupported: true, corsOrigin: audioResponse.headers.get("access-control-allow-origin") };
}

function parseArguments(values) {
  const result = { _: [] };
  for (let index = 0; index < values.length; index += 1) {
    if (!values[index].startsWith("--")) result._.push(values[index]);
    else {
      const key = values[index].slice(2);
      result[key] = values[index + 1] && !values[index + 1].startsWith("--") ? values[++index] : true;
    }
  }
  return result;
}

function episodeFromArguments(args) {
  const number = Number(args.episode ?? 475);
  invariant(EPISODES[number], `unsupported Lex episode ${args.episode}; this script currently supports #475 only`);
  return EPISODES[number];
}

function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function isPublicPath(file) {
  const fromRoot = relative(process.cwd(), file).replaceAll("\\", "/");
  return fromRoot === "public" || fromRoot.startsWith("public/");
}

async function main() {
  const [command, ...values] = process.argv.slice(2);
  const args = parseArguments(values);
  invariant(command, "usage: lex-podcast.mjs probe|extract|segment|build|validate [--episode 475] [--course file] [--draft]");
  if (command === "validate") {
    const courseFile = resolve(String(args.course ?? args._[0] ?? ""));
    invariant(args.course || args._[0], "validate requires --course <file>");
    const course = JSON.parse(readFileSync(courseFile, "utf8"));
    console.log(JSON.stringify(validateCourse(course, { requireTranslations: !args.draft, publicOutput: isPublicPath(courseFile) }), null, 2));
    return;
  }
  const episode = episodeFromArguments(args);
  const workDirectory = resolve(String(args.workdir ?? `.lex-work/${episode.id}`));
  if (command === "probe") {
    const report = await probeEpisode(episode);
    writeJson(resolve(String(args.output ?? `${workDirectory}/probe.json`)), report);
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const html = await fetchText(episode.transcriptUrl, "transcript page");
  const extraction = extractTranscript(html, episode.transcriptUrl);
  if (command === "extract") {
    const output = resolve(String(args.output ?? `${workDirectory}/transcript.json`));
    writeJson(output, extraction);
    console.log(`Extracted ${extraction.paragraphs.length} official paragraphs to ${output}`);
    return;
  }
  const course = buildCourse(episode, extraction);
  if (args["approve-publication"]) course.course.source.rightsStatus = "approved";
  if (command === "segment") {
    const output = resolve(String(args.output ?? `${workDirectory}/segments.json`));
    writeJson(output, { transcriptSha256: extraction.fingerprint, segments: course.segments });
    console.log(`Generated ${course.segments.length} estimated learning segments in ${output}`);
    return;
  }
  invariant(command === "build", `unknown command ${command}`);
  const output = resolve(String(args.output ?? `${workDirectory}/course.json`));
  validateCourse(course, { requireTranslations: false, publicOutput: isPublicPath(output) });
  writeJson(output, course);
  const report = {
    ...validateCourse(course, { requireTranslations: false }),
    officialParagraphCount: extraction.paragraphs.length,
    sourceFingerprint: extraction.fingerprint
  };
  const reportFile = resolve(String(args.report ?? `${workDirectory}/quality-report.json`));
  writeJson(reportFile, report);
  console.log(`Built local draft with ${course.segments.length} segments at ${output}`);
  console.log(`Quality report: ${reportFile}; rightsStatus=${course.course.source.rightsStatus}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) main().catch((error) => { console.error(`Lex podcast error: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
