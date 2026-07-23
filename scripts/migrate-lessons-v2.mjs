import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";
import {
  collectionDocumentSchema,
  legacyCourseDocumentSchema,
  lessonDocumentSchema
} from "../src/content.ts";

const projectDirectory = resolve(import.meta.dirname, "..");
const legacyDirectory = resolve(projectDirectory, "public");
const contentDirectory = resolve(projectDirectory, "content");
const audioDirectory = resolve(projectDirectory, "audio");
const migrationReportsDirectory = resolve(
  projectDirectory,
  "content-work",
  "_shared",
  "migration",
  "lesson-v2",
  "reports"
);

const collectionDefinitions = [
  {
    id: "new-concept-english-book-1",
    legacyId: "nce1",
    kind: "course",
    title: "新概念英语第一册",
    subtitle: "First Things First",
    contentFolder: "new-concept-english-1",
    folder: "新概念1-美音"
  },
  {
    id: "new-concept-english-book-2",
    legacyId: "nce2",
    kind: "course",
    title: "新概念英语第二册",
    subtitle: "Practice and Progress",
    contentFolder: "new-concept-english-2",
    folder: "新概念2-美音"
  },
  {
    id: "new-concept-english-book-3",
    legacyId: "nce3",
    kind: "course",
    title: "新概念英语第三册",
    subtitle: "Developing Skills",
    contentFolder: "new-concept-english-3",
    folder: "新概念3-美音"
  },
  {
    id: "new-concept-english-book-4",
    legacyId: "nce4",
    kind: "course",
    title: "新概念英语第四册",
    subtitle: "Fluency in English",
    contentFolder: "new-concept-english-4",
    folder: "新概念4-美音"
  },
  {
    id: "lex-fridman-podcast",
    kind: "podcast",
    title: "Lex Fridman Podcast",
    contentFolder: "lex-fridman-podcast",
    lessonId: "lex-475-demis-hassabis-2"
  },
  {
    id: "pragmatic-engineer-podcast",
    kind: "podcast",
    title: "The Pragmatic Engineer",
    contentFolder: "pragmatic-engineer-podcast",
    lessonId: "context-engineering-with-dex-horthy"
  }
];

function fail(message) {
  throw new Error(message);
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  }));
  return nested.flat();
}

async function sha256(path) {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex");
}

function relativePath(path) {
  return relative(projectDirectory, path).split(sep).join("/");
}

function collectionFor(path, lessonId) {
  const textbook = collectionDefinitions.find((collection) => collection.folder && path.includes(`${sep}${collection.folder}${sep}`));
  if (textbook) return textbook;
  const podcast = collectionDefinitions.find((collection) => collection.lessonId === lessonId);
  if (podcast) return podcast;
  fail(`No Collection mapping for ${relativePath(path)} (${lessonId})`);
}

function speakerId(name, usedIds) {
  const base = name.normalize("NFKD").replace(/[^\x00-\x7F]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "speaker";
  let id = base;
  let suffix = 2;
  while (usedIds.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(id);
  return id;
}

function sourceFor(collection) {
  if (collection.folder) {
    const book = collection.id.at(-1);
    return { type: "textbookLesson", series: "New Concept English", volume: `Book ${book}` };
  }
  if (collection.id === "lex-fridman-podcast") {
    return { type: "podcastEpisode", series: "Lex Fridman Podcast", publisher: "Lex Fridman" };
  }
  return {
    type: "podcastEpisode",
    series: "The Pragmatic Engineer",
    publisher: "The Pragmatic Engineer",
    webUrl: "https://newsletter.pragmaticengineer.com/p/context-engineering-with-dex-horthy"
  };
}

async function readLegacyInventory() {
  const files = await listFiles(legacyDirectory);
  const jsonFiles = files.filter((path) => path.toLowerCase().endsWith(".json"));
  const allMp3Files = files.filter((path) => path.toLowerCase().endsWith(".mp3"));
  const records = [];
  const lessonIds = new Set();

  for (const jsonPath of jsonFiles.sort()) {
    const legacy = legacyCourseDocumentSchema.parse(JSON.parse(await readFile(jsonPath, "utf8")));
    if (lessonIds.has(legacy.course.id)) fail(`Duplicate Lesson ID ${legacy.course.id}`);
    lessonIds.add(legacy.course.id);
    if (legacy.course.language !== "en") fail(`Legacy language is not en: ${relativePath(jsonPath)}`);

    const audioPath = resolve(dirname(jsonPath), legacy.course.audioFilename);
    let audioStat;
    try {
      audioStat = await stat(audioPath);
    } catch {
      fail(`Missing MP3 ${relativePath(audioPath)} for ${legacy.course.id}`);
    }
    const segmentIds = new Set();
    for (const segment of legacy.segments) {
      if (segmentIds.has(segment.id)) fail(`Duplicate Segment ID ${segment.id} in ${legacy.course.id}`);
      segmentIds.add(segment.id);
      if (segment.end <= segment.start) fail(`Invalid timeline for ${legacy.course.id}/${segment.id}`);
      if (!segment.translations?.["zh-Hans"]?.trim()) fail(`Missing zh-Hans for ${legacy.course.id}/${segment.id}`);
    }

    records.push({
      jsonPath,
      audioPath,
      audioByteLength: audioStat.size,
      audioSha256: await sha256(audioPath),
      legacy,
      collection: collectionFor(jsonPath, legacy.course.id)
    });
  }

  if (allMp3Files.length !== records.length) {
    const referenced = new Set(records.map(({ audioPath }) => audioPath.toLowerCase()));
    const unreferenced = allMp3Files.filter((path) => !referenced.has(path.toLowerCase())).map(relativePath);
    fail(`Expected one MP3 per JSON; JSON=${records.length}, MP3=${allMp3Files.length}, unreferenced=${unreferenced.join(", ")}`);
  }
  return records;
}

function summary(records) {
  return {
    lessonCount: records.length,
    audioCount: records.length,
    segmentCount: records.reduce((total, { legacy }) => total + legacy.segments.length, 0),
    translationCount: records.reduce(
      (total, { legacy }) => total + legacy.segments.filter((segment) => segment.translations?.["zh-Hans"]?.trim()).length,
      0
    ),
    speakerSegmentCount: records.reduce(
      (total, { legacy }) => total + legacy.segments.filter((segment) => segment.speaker?.trim()).length,
      0
    )
  };
}

function buildLessonDocument(record) {
  const speakerIdByName = new Map();
  const usedSpeakerIds = new Set();
  for (const segment of record.legacy.segments) {
    if (segment.speaker && !speakerIdByName.has(segment.speaker)) {
      speakerIdByName.set(segment.speaker, speakerId(segment.speaker, usedSpeakerIds));
    }
  }
  const lessonId = record.legacy.course.id;
  return lessonDocumentSchema.parse({
    schemaVersion: 2,
    lesson: {
      id: lessonId,
      kind: record.collection.folder ? "textbook" : "podcast",
      title: record.legacy.course.title,
      sourceLanguage: "en",
      translationLanguage: "zh-Hans",
      transcriptRevision: record.legacy.course.revision ?? 1,
      defaultRenditionId: "en"
    },
    source: sourceFor(record.collection),
    rights: {
      status: "unverified",
      notes: "Migrated from legacy published content; migration does not establish redistribution rights."
    },
    speakers: [...speakerIdByName].map(([name, id]) => ({ id, name })),
    segments: record.legacy.segments.map((segment) => ({
      id: segment.id,
      ...(segment.speaker ? { speakerId: speakerIdByName.get(segment.speaker) } : {}),
      text: segment.text,
      ...(segment.translations?.["zh-Hans"] ? { translation: { text: segment.translations["zh-Hans"] } } : {})
    })),
    renditions: [{
      id: "en",
      language: "en",
      role: "original",
      audio: {
        key: `lessons/${record.collection.contentFolder}/${lessonId}-en.mp3`,
        mimeType: "audio/mpeg",
        byteLength: record.audioByteLength,
        sha256: record.audioSha256
      },
      duration: record.legacy.course.duration,
      cues: record.legacy.segments.map((segment) => ({
        segmentId: segment.id,
        start: segment.start,
        end: segment.end
      }))
    }]
  });
}

function buildCollectionLessonSummary(record, document) {
  const rendition = document.renditions.find(({ id }) => id === document.lesson.defaultRenditionId);
  if (!rendition) fail(`Missing default rendition for ${document.lesson.id}`);
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
    documentKey: `lessons/${record.collection.contentFolder}/${document.lesson.id}.json`
  };
}

function buildCollections(lessonDocuments) {
  return collectionDefinitions.map((definition) => collectionDocumentSchema.parse({
    schemaVersion: 1,
    id: definition.id,
    kind: definition.kind,
    title: definition.title,
    ...(definition.subtitle ? { subtitle: definition.subtitle } : {}),
    lessons: lessonDocuments.filter(({ record }) => record.collection.id === definition.id)
      .map(({ record, document }) => buildCollectionLessonSummary(record, document))
  }));
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeBaseline(records) {
  const details = records.map((record) => ({
    lessonId: record.legacy.course.id,
    title: record.legacy.course.title,
    duration: record.legacy.course.duration,
    segmentCount: record.legacy.segments.length,
    translationCount: record.legacy.segments.filter((segment) => segment.translations?.["zh-Hans"]?.trim()).length,
    speakerSegmentCount: record.legacy.segments.filter((segment) => segment.speaker?.trim()).length,
    json: relativePath(record.jsonPath),
    audio: relativePath(record.audioPath),
    audioByteLength: record.audioByteLength,
    audioSha256: record.audioSha256
  }));
  const digest = createHash("sha256").update(JSON.stringify(details)).digest("hex");
  await writeJson(resolve(migrationReportsDirectory, "baseline.json"), {
    createdAt: new Date().toISOString(),
    sourceRoot: "public",
    summary: summary(records),
    digest,
    lessons: details
  });
}

async function assertSameOrCopy(source, destination) {
  try {
    const [sourceBytes, destinationBytes] = await Promise.all([readFile(source), readFile(destination)]);
    if (!sourceBytes.equals(destinationBytes)) fail(`Refusing to overwrite different target ${relativePath(destination)}`);
    return;
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
  }
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

async function migrate(records) {
  const staging = resolve(projectDirectory, `.lesson-migration-staging-${randomUUID()}`);
  try {
    const lessonDocuments = records.map((record) => ({ record, document: buildLessonDocument(record) }));
    const collections = buildCollections(lessonDocuments);
    for (const collection of collections) {
      await writeJson(resolve(staging, "content", "collections", `${collection.id}.json`), collection);
    }
    for (const { record, document } of lessonDocuments) {
      await writeJson(
        resolve(staging, "content", "lessons", record.collection.contentFolder, `${document.lesson.id}.json`),
        document
      );
      const stagingAudioDirectory = resolve(staging, "audio", "lessons", record.collection.contentFolder);
      await copyFile(record.audioPath, resolve(stagingAudioDirectory, `${document.lesson.id}-en.mp3`))
        .catch(async (error) => {
          if (error?.code !== "ENOENT") throw error;
          await mkdir(stagingAudioDirectory, { recursive: true });
          await copyFile(record.audioPath, resolve(stagingAudioDirectory, `${document.lesson.id}-en.mp3`));
        });
    }

    for (const collection of collections) {
      const source = resolve(staging, "content", "collections", `${collection.id}.json`);
      await assertSameOrCopy(source, resolve(contentDirectory, "collections", basename(source)));
    }
    for (const { record, document } of lessonDocuments) {
      const lessonFilename = `${document.lesson.id}.json`;
      const audioFilename = `${document.lesson.id}-en.mp3`;
      await assertSameOrCopy(
        resolve(staging, "content", "lessons", record.collection.contentFolder, lessonFilename),
        resolve(contentDirectory, "lessons", record.collection.contentFolder, lessonFilename)
      );
      await assertSameOrCopy(
        resolve(staging, "audio", "lessons", record.collection.contentFolder, audioFilename),
        resolve(audioDirectory, "lessons", record.collection.contentFolder, audioFilename)
      );
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function verify(records) {
  const newLessonFiles = (await listFiles(resolve(contentDirectory, "lessons")))
    .filter((path) => path.toLowerCase().endsWith(".json"));
  if (newLessonFiles.length !== records.length) fail(`Lesson count differs: old=${records.length}, new=${newLessonFiles.length}`);
  const newIds = new Set();
  let segmentCount = 0;
  let translationCount = 0;
  let speakerSegmentCount = 0;

  for (const record of records) {
    const lessonId = record.legacy.course.id;
    const document = lessonDocumentSchema.parse(JSON.parse(
      await readFile(resolve(contentDirectory, "lessons", record.collection.contentFolder, `${lessonId}.json`), "utf8")
    ));
    newIds.add(document.lesson.id);
    const rendition = document.renditions.find(({ id }) => id === "en");
    if (!rendition) fail(`Missing en rendition for ${lessonId}`);
    const cueById = new Map(rendition.cues.map((cue) => [cue.segmentId, cue]));
    const speakerById = new Map(document.speakers.map((speaker) => [speaker.id, speaker.name]));

    if (document.lesson.id !== lessonId
      || document.lesson.title !== record.legacy.course.title
      || document.lesson.transcriptRevision !== (record.legacy.course.revision ?? 1)
      || rendition.duration !== record.legacy.course.duration) {
      fail(`Lesson metadata differs for ${lessonId}`);
    }
    if (document.segments.length !== record.legacy.segments.length) fail(`Segment count differs for ${lessonId}`);
    record.legacy.segments.forEach((oldSegment, index) => {
      const segment = document.segments[index];
      const cue = cueById.get(segment.id);
      if (segment.id !== oldSegment.id || segment.text !== oldSegment.text
        || segment.translation?.text !== oldSegment.translations?.["zh-Hans"]
        || cue?.start !== oldSegment.start || cue?.end !== oldSegment.end
        || (segment.speakerId ? speakerById.get(segment.speakerId) : undefined) !== oldSegment.speaker) {
        fail(`Segment differs for ${lessonId}/${oldSegment.id}`);
      }
    });

    const newAudioPath = resolve(audioDirectory, rendition.audio.key);
    const [newStat, newSha] = await Promise.all([stat(newAudioPath), sha256(newAudioPath)]);
    if (newStat.size !== record.audioByteLength || newSha !== record.audioSha256
      || rendition.audio.byteLength !== record.audioByteLength || rendition.audio.sha256 !== record.audioSha256) {
      fail(`Audio differs for ${lessonId}`);
    }
    segmentCount += document.segments.length;
    translationCount += document.segments.filter((segment) => segment.translation).length;
    speakerSegmentCount += document.segments.filter((segment) => segment.speakerId).length;
  }

  const collections = await Promise.all(
    (await readdir(resolve(contentDirectory, "collections"))).filter((name) => name.endsWith(".json"))
      .map(async (name) => collectionDocumentSchema.parse(JSON.parse(
        await readFile(resolve(contentDirectory, "collections", name), "utf8")
      )))
  );
  const referencedIds = new Set(collections.flatMap((collection) => collection.lessons.map(({ id }) => id)));
  for (const id of newIds) if (!referencedIds.has(id)) fail(`Lesson ${id} is not in a Collection`);
  for (const id of referencedIds) if (!newIds.has(id)) fail(`Collection references missing Lesson ${id}`);

  return {
    lessonCount: newIds.size,
    audioCount: records.length,
    segmentCount,
    translationCount,
    speakerSegmentCount,
    collectionCount: collections.length
  };
}

async function main() {
  const command = process.argv[2];
  if (!["inventory", "dry-run", "migrate", "verify"].includes(command)) {
    fail("Usage: node scripts/migrate-lessons-v2.mjs inventory|dry-run|migrate|verify");
  }
  const records = await readLegacyInventory();
  const inventorySummary = summary(records);
  if (command === "inventory") {
    await writeBaseline(records);
    console.log(JSON.stringify({
      ...inventorySummary,
      baseline: relativePath(resolve(migrationReportsDirectory, "baseline.json"))
    }));
    return;
  }
  if (command === "dry-run") {
    const lessonDocuments = records.map((record) => ({ record, document: buildLessonDocument(record) }));
    buildCollections(lessonDocuments);
    console.log(JSON.stringify({ ...inventorySummary, collectionCount: collectionDefinitions.length }));
    return;
  }
  if (command === "migrate") {
    await migrate(records);
  }
  const result = await verify(records);
  console.log(JSON.stringify(result));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
