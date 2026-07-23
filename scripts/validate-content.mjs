import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { basename, relative, resolve, sep } from "node:path";
import { catalogDocumentSchema, collectionDocumentSchema, lessonDocumentSchema } from "../src/content.ts";

const projectDirectory = resolve(import.meta.dirname, "..");
const contentDirectory = resolve(projectDirectory, "content");
const audioDirectory = resolve(projectDirectory, "audio");

export async function listJsonFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return listJsonFiles(path);
    return entry.isFile() && entry.name.endsWith(".json") ? [path] : [];
  }));
  return nested.flat().sort();
}

async function readDocuments(directory, schema) {
  const paths = await listJsonFiles(directory);
  return Promise.all(paths.map(async (path) => ({
    filename: basename(path),
    relativePath: relative(directory, path).split(sep).join("/"),
    document: schema.parse(JSON.parse(await readFile(path, "utf8")))
  })));
}

export function buildLessonSummary(document, relativePath) {
  const rendition = document.renditions.find(({ id }) => id === document.lesson.defaultRenditionId);
  if (!rendition) throw new Error(`Missing default rendition for ${document.lesson.id}`);
  return {
    id: document.lesson.id,
    kind: document.lesson.kind,
    title: document.lesson.title,
    duration: rendition.duration,
    byteLength: rendition.audio.byteLength,
    availableLanguages: [
      "en",
      ...(document.segments.some((segment) => segment.translation) ? ["zh-Hans"] : [])
    ],
    documentKey: `lessons/${relativePath}`
  };
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

export async function validateContent({
  requireAudio = false,
  requireTranslations = false,
  validateCatalog = true
} = {}) {
  const [collectionEntries, lessonEntries] = await Promise.all([
    readDocuments(resolve(contentDirectory, "collections"), collectionDocumentSchema),
    readDocuments(resolve(contentDirectory, "lessons"), lessonDocumentSchema)
  ]);
  const lessons = new Map();
  let segmentCount = 0;
  let translationCount = 0;
  let speakerSegmentCount = 0;

  for (const { filename, relativePath, document } of lessonEntries) {
    if (filename !== `${document.lesson.id}.json`) throw new Error(`Lesson filename does not match ID: ${relativePath}`);
    if (lessons.has(document.lesson.id)) throw new Error(`Duplicate Lesson ID ${document.lesson.id}`);
    lessons.set(document.lesson.id, { document, relativePath });
    segmentCount += document.segments.length;
    translationCount += document.segments.filter((segment) => segment.translation).length;
    speakerSegmentCount += document.segments.filter((segment) => segment.speakerId).length;
    if (requireTranslations && document.segments.some((segment) => !segment.translation)) {
      throw new Error(`Missing migration translation in ${document.lesson.id}`);
    }

    if (requireAudio) {
      for (const rendition of document.renditions) {
        const path = resolve(audioDirectory, rendition.audio.key);
        const metadata = await stat(path);
        if (metadata.size !== rendition.audio.byteLength) throw new Error(`Audio byte length differs for ${document.lesson.id}/${rendition.id}`);
        if (await sha256(path) !== rendition.audio.sha256) throw new Error(`Audio SHA-256 differs for ${document.lesson.id}/${rendition.id}`);
      }
    }
  }

  const collectionIds = new Set();
  const referencedLessonIds = new Set();
  for (const { filename, relativePath: collectionPath, document } of collectionEntries) {
    if (filename !== `${document.id}.json`) throw new Error(`Collection filename does not match ID: ${collectionPath}`);
    if (collectionIds.has(document.id)) throw new Error(`Duplicate Collection ID ${document.id}`);
    collectionIds.add(document.id);
    for (const summary of document.lessons) {
      const lesson = lessons.get(summary.id);
      if (!lesson) throw new Error(`Collection ${document.id} references missing Lesson ${summary.id}`);
      const expected = buildLessonSummary(lesson.document, lesson.relativePath);
      if (JSON.stringify(summary) !== JSON.stringify(expected)) {
        throw new Error(`Collection ${document.id} has a stale summary for Lesson ${summary.id}`);
      }
      referencedLessonIds.add(summary.id);
    }
  }
  for (const lessonId of lessons.keys()) {
    if (!referencedLessonIds.has(lessonId)) throw new Error(`Lesson ${lessonId} is not referenced by a Collection`);
  }

  if (validateCatalog) {
    const catalog = catalogDocumentSchema.parse(JSON.parse(
      await readFile(resolve(contentDirectory, "catalog.json"), "utf8")
    ));
    const expectedCollections = collectionEntries.map(({ relativePath, document }) => ({
      id: document.id,
      kind: document.kind,
      title: document.title,
      ...(document.subtitle ? { subtitle: document.subtitle } : {}),
      lessonCount: document.lessons.length,
      documentKey: `collections/${relativePath}`
    }));
    if (JSON.stringify(catalog.collections) !== JSON.stringify(expectedCollections)) {
      throw new Error("Catalog does not match the current Collection documents");
    }
  }

  return {
    collectionCount: collectionEntries.length,
    lessonCount: lessonEntries.length,
    segmentCount,
    translationCount,
    speakerSegmentCount
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  validateContent({
    requireAudio: process.argv.includes("--require-audio"),
    requireTranslations: process.argv.includes("--require-translations")
  }).then((result) => {
    console.log(JSON.stringify(result));
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
