import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildCourse, extractTranscript, segmentTranscript, splitSentences, validateCourse } from "../scripts/lex-podcast.mjs";

const fixture = readFileSync(new URL("./fixtures/lex-transcript.html", import.meta.url), "utf8");
const episode = {
  id: "lex-475-demis-hassabis-2", title: "Lex #475", publisher: "Lex Fridman Podcast", episodeNumber: 475,
  episodeUrl: "https://lexfridman.com/demis-hassabis-2/", transcriptUrl: "https://lexfridman.com/demis-hassabis-2-transcript/",
  audioUrl: "https://example.test/audio.mp3", audioFilename: "audio.mp3", publishedAt: "2025-07-23", duration: 45,
  rightsStatus: "unverified"
};

test("extracts timestamps, text, inherited speakers, and a stable source fingerprint", () => {
  const first = extractTranscript(fixture);
  const second = extractTranscript(fixture);
  assert.equal(first.paragraphs.length, 3);
  assert.equal(first.paragraphs[1].speaker, "Lex Fridman");
  assert.deepEqual(first.paragraphs.map(({ start }) => start), [0, 12, 12]);
  assert.match(first.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(first.fingerprint, second.fingerprint);
});

test("fails clearly when the required Lex structure changes", () => {
  assert.throws(() => extractTranscript(fixture.replace("ts-text", "changed-text")), /structure changed.*missing/);
  assert.throws(() => extractTranscript("<main>no transcript</main>"), /no \.ts-segment/);
});

test("sentence splitting preserves abbreviations and decimals", () => {
  assert.deepEqual(splitSentences("Dr. Smith measured 3.14 units. It worked!"), ["Dr. Smith measured 3.14 units.", "It worked!"]);
});

test("learning segments stay within source paragraphs and have monotonic estimated timing", () => {
  const extraction = extractTranscript(fixture);
  const segments = segmentTranscript(extraction, episode.duration);
  assert.ok(segments.length >= extraction.paragraphs.length);
  for (let index = 0; index < segments.length; index += 1) {
    assert.equal(segments[index].timingQuality, "estimated");
    assert.ok(segments[index].start < segments[index].end);
    if (index) assert.ok(segments[index].start >= segments[index - 1].end);
  }
  assert.ok(segments.every((segment) => segment.sourceSegmentId && segment.speaker));
});

test("course validation covers source, rights, timing, and translations", () => {
  const course = buildCourse(episode, extractTranscript(fixture));
  const draftReport = validateCourse(course, { requireTranslations: false });
  assert.equal(draftReport.rightsStatus, "unverified");
  assert.equal(draftReport.publishable, false);
  assert.throws(() => validateCourse(course), /missing zh-Hans translation/);
  assert.throws(() => validateCourse(course, { requireTranslations: false, publicOutput: true }), /publication blocked/);
  course.course.source.rightsStatus = "approved";
  for (const segment of course.segments) segment.translations = { "zh-Hans": "测试译文" };
  assert.equal(validateCourse(course, { publicOutput: true }).publishable, true);
});
