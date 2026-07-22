import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

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

function sourceSnapshot(course) {
  return {
    version: course.version,
    course: {
      id: course.course.id,
      title: course.course.title,
      audioFilename: course.course.audioFilename,
      duration: course.course.duration
    },
    segments: course.segments.map(({ id, start, end, text }) => ({ id, start, end, text }))
  };
}

function digest(course) {
  return createHash("sha256").update(JSON.stringify(sourceSnapshot(course))).digest("hex");
}

function minuteLabel(value) {
  return String(value).padStart(3, "0");
}

function validateBasicShape(course) {
  if (!course?.course?.id || !Array.isArray(course.segments) || course.segments.length === 0) {
    fail("source is not a course transcript");
  }
  const ids = new Set();
  for (const segment of course.segments) {
    if (!segment.id || typeof segment.text !== "string" || typeof segment.start !== "number" || typeof segment.end !== "number") {
      fail("every segment must have id, start, end, and text");
    }
    if (ids.has(segment.id)) fail(`duplicate segment ID ${segment.id}`);
    ids.add(segment.id);
  }
}

function prepare(sourceFile, workDirectory, windowMinutes) {
  const course = readJson(sourceFile);
  validateBasicShape(course);
  mkdirSync(workDirectory, { recursive: true });
  const glossaryFile = join(workDirectory, "glossary.json");
  const glossary = existsSync(glossaryFile) ? readJson(glossaryFile) : {};

  const windowSeconds = windowMinutes * 60;
  const groups = new Map();
  course.segments.forEach((segment, index) => {
    const bucket = Math.floor(segment.start / windowSeconds);
    const group = groups.get(bucket) ?? [];
    group.push({ segment, index });
    groups.set(bucket, group);
  });

  const chunks = [];
  for (const [bucket, entries] of groups) {
    const startMinute = bucket * windowMinutes;
    const endMinute = Math.min((bucket + 1) * windowMinutes, Math.ceil(course.course.duration / 60));
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
      course: {
        id: course.course.id,
        title: course.course.title,
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
      contextBefore: course.segments.slice(Math.max(0, firstIndex - 3), firstIndex).map(({ id, text }) => ({ id, text })),
      targetSegments,
      contextAfter: course.segments.slice(lastIndex + 1, lastIndex + 4).map(({ id, text }) => ({ id, text }))
    });

    chunks.push({
      inputFile,
      outputFile,
      targetIds: targetSegments.map(({ id }) => id)
    });
  }

  writeJson(join(workDirectory, "manifest.json"), {
    sourceFile: basename(sourceFile),
    courseId: course.course.id,
    sourceDigest: digest(course),
    windowMinutes,
    segmentCount: course.segments.length,
    chunks
  });
  console.log(`Prepared ${chunks.length} chunk(s) for ${course.segments.length} segments in ${workDirectory}`);
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
    const outputIds = Object.keys(output.translations);
    const targetIds = new Set(chunk.targetIds);
    for (const id of outputIds) {
      if (!targetIds.has(id)) fail(`${chunk.outputFile} contains unexpected ID ${id}`);
      const text = output.translations[id];
      if (typeof text !== "string" || text.trim() === "") fail(`${chunk.outputFile} has an empty translation for ${id}`);
      if (translations.has(id)) fail(`translation for ${id} appears more than once`);
      translations.set(id, text.trim());
    }
    for (const id of targetIds) {
      if (!translations.has(id)) fail(`${chunk.outputFile} is missing translation for ${id}`);
    }
  }

  for (const id of expectedIds) {
    if (!translations.has(id)) fail(`missing translation for ${id}`);
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
    const output = readJson(outputPath);
    if (output.language !== language || !output.translations || Array.isArray(output.translations)) {
      fail(`${chunk.outputFile} must contain language ${language} and a translations object`);
    }
    const expectedIds = new Set(chunk.targetIds);
    const actualIds = Object.keys(output.translations);
    for (const id of actualIds) {
      if (!expectedIds.has(id)) fail(`${chunk.outputFile} contains unexpected ID ${id}`);
      if (typeof output.translations[id] !== "string" || output.translations[id].trim() === "") {
        fail(`${chunk.outputFile} has an empty translation for ${id}`);
      }
    }
    for (const id of expectedIds) {
      if (!(id in output.translations)) fail(`${chunk.outputFile} is missing translation for ${id}`);
    }
    if (actualIds.length !== expectedIds.size) fail(`${chunk.outputFile} has the wrong number of translations`);
    completedChunks += 1;
    completedSegments += expectedIds.size;
    console.log(`complete ${chunk.outputFile} (${expectedIds.size} segments)`);
  }
  console.log(`Status: ${completedChunks}/${manifest.chunks.length} chunks, ${completedSegments}/${manifest.segmentCount} segments complete`);
}

function merge(sourceFile, workDirectory, language, sourceLanguage) {
  const course = readJson(sourceFile);
  const manifest = readJson(join(workDirectory, "manifest.json"));
  validateBasicShape(course);
  if (course.course.id !== manifest.courseId) fail("course ID does not match the manifest");
  if (digest(course) !== manifest.sourceDigest) fail("English source, IDs, or timeline changed after chunks were prepared");

  const translations = collectTranslations(workDirectory, manifest, language);
  course.course.language = sourceLanguage;
  for (const segment of course.segments) {
    segment.translations = {
      ...(segment.translations ?? {}),
      [language]: translations.get(segment.id)
    };
  }

  const temporaryFile = `${sourceFile}.translation-tmp`;
  writeJson(temporaryFile, course);
  renameSync(temporaryFile, sourceFile);
  console.log(`Merged ${translations.size} ${language} translations into ${sourceFile}`);
}

function validate(sourceFile, workDirectory, language, sourceLanguage) {
  const course = readJson(sourceFile);
  const manifest = readJson(join(workDirectory, "manifest.json"));
  validateBasicShape(course);
  if (digest(course) !== manifest.sourceDigest) fail("English source, IDs, or timeline differ from the prepared manifest");
  if (course.course.language !== sourceLanguage) fail(`course.language must be ${sourceLanguage}`);

  const translations = collectTranslations(workDirectory, manifest, language);
  const expectedIds = new Set(manifest.chunks.flatMap((chunk) => chunk.targetIds));
  for (const segment of course.segments) {
    const translated = segment.translations?.[language];
    if (expectedIds.has(segment.id) && (typeof translated !== "string" || translated.trim() === "")) {
      fail(`missing ${language} translation for ${segment.id}`);
    }
    if (expectedIds.has(segment.id) && translated !== translations.get(segment.id)) {
      fail(`${language} translation for ${segment.id} differs from the prepared chunk output`);
    }
  }
  if (expectedIds.size !== manifest.segmentCount) fail("manifest does not cover every source segment");
  console.log(`Validated ${expectedIds.size}/${manifest.segmentCount} translations; English source and timeline are unchanged`);
}

const [command, sourceArgument, workArgument, optionArgument, sourceLanguageArgument] = process.argv.slice(2);
if (!command || !sourceArgument || (command !== "status" && !workArgument)) {
  fail("usage: prepare <source> <work-dir> [window-minutes] | merge/validate <source> <work-dir> [language] [source-language] | status <work-dir> [language]");
}

if (command === "status") {
  status(resolve(sourceArgument), workArgument ?? "zh-Hans");
} else if (command === "prepare") {
  const sourceFile = resolve(sourceArgument);
  const workDirectory = resolve(workArgument);
  const windowMinutes = Number(optionArgument ?? 10);
  if (!Number.isFinite(windowMinutes) || windowMinutes <= 0) fail("window minutes must be positive");
  prepare(sourceFile, workDirectory, windowMinutes);
} else if (command === "merge") {
  const sourceFile = resolve(sourceArgument);
  const workDirectory = resolve(workArgument);
  merge(sourceFile, workDirectory, optionArgument ?? "zh-Hans", sourceLanguageArgument ?? "en");
} else if (command === "validate") {
  const sourceFile = resolve(sourceArgument);
  const workDirectory = resolve(workArgument);
  validate(sourceFile, workDirectory, optionArgument ?? "zh-Hans", sourceLanguageArgument ?? "en");
} else {
  fail(`unknown command ${command}`);
}
