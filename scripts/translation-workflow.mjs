import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { legacyCourseDocumentSchema, lessonDocumentSchema } from "../src/content.ts";

function fail(message) {
  console.error(`Translation workflow error: ${message}`);
  process.exit(1);
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    fail(`cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readSource(file) {
  const raw = readJson(file);
  const v2 = lessonDocumentSchema.safeParse(raw);
  if (v2.success) {
    const document = v2.data;
    const rendition = document.renditions.find(({ id }) => id === document.lesson.defaultRenditionId);
    if (!rendition) fail("default rendition is missing");
    const cueById = new Map(rendition.cues.map((cue) => [cue.segmentId, cue]));
    return {
      kind: "v2",
      raw: document,
      lessonId: document.lesson.id,
      title: document.lesson.title,
      duration: rendition.duration,
      revision: document.lesson.transcriptRevision,
      segments: document.segments.map((segment) => {
        const cue = cueById.get(segment.id);
        if (!cue) fail(`default rendition is missing a cue for ${segment.id}`);
        return {
          id: segment.id,
          start: cue.start,
          end: cue.end,
          text: segment.text,
          speakerId: segment.speakerId,
          translation: segment.translation?.text
        };
      })
    };
  }

  const legacy = legacyCourseDocumentSchema.safeParse(raw);
  if (!legacy.success) fail("source is neither a v2 LessonDocument nor a v1 course transcript");
  return {
    kind: "v1",
    raw: legacy.data,
    lessonId: legacy.data.course.id,
    title: legacy.data.course.title,
    duration: legacy.data.course.duration,
    revision: legacy.data.course.revision ?? 1,
    segments: legacy.data.segments.map((segment) => ({
      id: segment.id,
      start: segment.start,
      end: segment.end,
      text: segment.text,
      speakerId: segment.speaker,
      translation: segment.translations?.["zh-Hans"]
    }))
  };
}

function sourceSnapshot(source) {
  return {
    lessonId: source.lessonId,
    transcriptRevision: source.revision,
    segments: source.segments.map(({ id, speakerId, start, end, text }) => ({
      id,
      ...(speakerId ? { speakerId } : {}),
      start,
      end,
      text
    }))
  };
}

function digest(source) {
  return createHash("sha256").update(JSON.stringify(sourceSnapshot(source))).digest("hex");
}

function minuteLabel(value) {
  return String(value).padStart(3, "0");
}

function prepare(sourceFile, workDirectory, windowMinutes) {
  const source = readSource(sourceFile);
  mkdirSync(workDirectory, { recursive: true });
  const glossaryFile = join(workDirectory, "glossary.json");
  const glossary = existsSync(glossaryFile) ? readJson(glossaryFile) : {};
  const windowSeconds = windowMinutes * 60;
  const groups = new Map();

  source.segments.forEach((segment, index) => {
    const bucket = Math.floor(segment.start / windowSeconds);
    const group = groups.get(bucket) ?? [];
    group.push({ segment, index });
    groups.set(bucket, group);
  });

  const chunks = [];
  for (const [bucket, entries] of groups) {
    const startMinute = bucket * windowMinutes;
    const endMinute = Math.min((bucket + 1) * windowMinutes, Math.ceil(source.duration / 60));
    const stem = `${minuteLabel(startMinute)}-${minuteLabel(endMinute)}`;
    const firstIndex = entries[0].index;
    const lastIndex = entries.at(-1).index;
    const inputFile = `${stem}.input.json`;
    const outputFile = `${stem}.zh-Hans.json`;
    const targetSegments = entries.map(({ segment }) => ({
      id: segment.id,
      start: segment.start,
      end: segment.end,
      text: segment.text
    }));

    writeJson(join(workDirectory, inputFile), {
      lesson: {
        id: source.lessonId,
        title: source.title,
        sourceLanguage: "en",
        targetLanguage: "zh-Hans"
      },
      instructions: [
        "Translate only targetSegments into natural Simplified Chinese.",
        "Use contextBefore and contextAfter only for understanding; do not translate them in the output.",
        "Do not add, remove, merge, split, or rename IDs.",
        "Return JSON shaped as { language: 'zh-Hans', translations: { segmentId: translatedText } }."
      ],
      glossary,
      contextBefore: source.segments.slice(Math.max(0, firstIndex - 3), firstIndex).map(({ id, text }) => ({ id, text })),
      targetSegments,
      contextAfter: source.segments.slice(lastIndex + 1, lastIndex + 4).map(({ id, text }) => ({ id, text }))
    });
    chunks.push({ inputFile, outputFile, targetIds: targetSegments.map(({ id }) => id) });
  }

  writeJson(join(workDirectory, "manifest.json"), {
    sourceFile: basename(sourceFile),
    lessonId: source.lessonId,
    sourceDigest: digest(source),
    windowMinutes,
    segmentCount: source.segments.length,
    chunks
  });
  console.log(`Prepared ${chunks.length} chunk(s) for ${source.segments.length} segments in ${workDirectory}`);
}

function collectTranslations(workDirectory, manifest, language) {
  const expectedIds = new Set(manifest.chunks.flatMap((chunk) => chunk.targetIds));
  const translations = new Map();
  for (const chunk of manifest.chunks) {
    const outputPath = join(workDirectory, chunk.outputFile);
    if (!existsSync(outputPath)) fail(`missing translated chunk ${chunk.outputFile}`);
    const output = readJson(outputPath);
    if (output.language !== language || !output.translations || Array.isArray(output.translations)) {
      fail(`${chunk.outputFile} must contain language ${language} and a translations object`);
    }
    const targetIds = new Set(chunk.targetIds);
    for (const [id, text] of Object.entries(output.translations)) {
      if (!targetIds.has(id)) fail(`${chunk.outputFile} contains unexpected ID ${id}`);
      if (typeof text !== "string" || text.trim() === "") fail(`${chunk.outputFile} has an empty translation for ${id}`);
      if (translations.has(id)) fail(`translation for ${id} appears more than once`);
      translations.set(id, text.trim());
    }
    for (const id of targetIds) if (!translations.has(id)) fail(`${chunk.outputFile} is missing translation for ${id}`);
  }
  if (translations.size !== expectedIds.size) fail("translated ID count does not match the manifest");
  return translations;
}

function status(workDirectory, language) {
  const manifest = readJson(join(workDirectory, "manifest.json"));
  let completedSegments = 0;
  let completedChunks = 0;
  for (const chunk of manifest.chunks) {
    const outputPath = join(workDirectory, chunk.outputFile);
    if (!existsSync(outputPath)) {
      console.log(`pending  ${chunk.outputFile}`);
      continue;
    }
    const translations = collectTranslations(workDirectory, { chunks: [chunk] }, language);
    completedChunks += 1;
    completedSegments += translations.size;
    console.log(`complete ${chunk.outputFile} (${translations.size} segments)`);
  }
  console.log(`Status: ${completedChunks}/${manifest.chunks.length} chunks, ${completedSegments}/${manifest.segmentCount} segments complete`);
}

function assertManifest(source, manifest) {
  if ((manifest.lessonId ?? manifest.courseId) !== source.lessonId) fail("Lesson ID does not match the manifest");
  if (digest(source) !== manifest.sourceDigest) fail("English source, IDs, speakers, or timeline changed after chunks were prepared");
}

function merge(sourceFile, workDirectory, language) {
  if (language !== "zh-Hans") fail("only zh-Hans is supported");
  const source = readSource(sourceFile);
  const manifest = readJson(join(workDirectory, "manifest.json"));
  assertManifest(source, manifest);
  const translations = collectTranslations(workDirectory, manifest, language);

  if (source.kind === "v2") {
    source.raw.segments = source.raw.segments.map((segment) => ({
      ...segment,
      translation: {
        ...(segment.translation?.speechText ? { speechText: segment.translation.speechText } : {}),
        text: translations.get(segment.id)
      }
    }));
    lessonDocumentSchema.parse(source.raw);
  } else {
    source.raw.course.language = "en";
    for (const segment of source.raw.segments) {
      segment.translations = { ...(segment.translations ?? {}), "zh-Hans": translations.get(segment.id) };
    }
    legacyCourseDocumentSchema.parse(source.raw);
  }

  const temporaryFile = `${sourceFile}.translation-tmp`;
  writeJson(temporaryFile, source.raw);
  renameSync(temporaryFile, sourceFile);
  console.log(`Merged ${translations.size} ${language} translations into ${sourceFile}`);
}

function validate(sourceFile, workDirectory, language) {
  if (language !== "zh-Hans") fail("only zh-Hans is supported");
  const source = readSource(sourceFile);
  const manifest = readJson(join(workDirectory, "manifest.json"));
  assertManifest(source, manifest);
  const translations = collectTranslations(workDirectory, manifest, language);
  for (const segment of source.segments) {
    if (segment.translation !== translations.get(segment.id)) {
      fail(`${language} translation for ${segment.id} differs from the prepared chunk output`);
    }
  }
  console.log(`Validated ${translations.size}/${manifest.segmentCount} translations; English source and timeline are unchanged`);
}

const [command, sourceArgument, workArgument, optionArgument] = process.argv.slice(2);
if (!command || !sourceArgument || (command !== "status" && !workArgument)) {
  fail("usage: prepare <lesson-file> <work-dir> [window-minutes] | merge/validate <lesson-file> <work-dir> [language] | status <work-dir> [language]");
}
if (command === "status") {
  status(resolve(sourceArgument), workArgument ?? "zh-Hans");
} else if (command === "prepare") {
  const windowMinutes = Number(optionArgument ?? 10);
  if (!Number.isFinite(windowMinutes) || windowMinutes <= 0) fail("window minutes must be positive");
  prepare(resolve(sourceArgument), resolve(workArgument), windowMinutes);
} else if (command === "merge") {
  merge(resolve(sourceArgument), resolve(workArgument), optionArgument ?? "zh-Hans");
} else if (command === "validate") {
  validate(resolve(sourceArgument), resolve(workArgument), optionArgument ?? "zh-Hans");
} else {
  fail(`unknown command ${command}`);
}
