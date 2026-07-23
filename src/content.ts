import { z } from "zod";

const idSchema = z.string().min(1).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const safeRelativeKeySchema = z.string().min(1).refine(
  (value) => !value.startsWith("/") && !value.startsWith("\\")
    && !value.includes("..") && !/^[a-zA-Z]:[\\/]/.test(value),
  "Key must be a safe relative path"
);
const audioKeySchema = safeRelativeKeySchema;
const contentKeySchema = safeRelativeKeySchema.refine((value) => value.endsWith(".json"), "Content key must reference JSON");

export const collectionKindSchema = z.enum(["course", "series", "podcast", "album", "book", "curated"]);
export const lessonKindSchema = z.enum([
  "textbook",
  "podcast",
  "song",
  "audiobook",
  "video",
  "speech",
  "conversation",
  "other"
]);

export const collectionLessonSummarySchema = z.object({
  id: idSchema,
  kind: lessonKindSchema,
  title: z.string().trim().min(1),
  duration: z.number().positive(),
  byteLength: z.number().int().positive(),
  availableLanguages: z.array(z.enum(["en", "zh-Hans"])).min(1).superRefine((languages, context) => {
    if (!languages.includes("en")) {
      context.addIssue({ code: "custom", message: "English must be available" });
    }
    if (new Set(languages).size !== languages.length) {
      context.addIssue({ code: "custom", message: "Available languages must be unique" });
    }
  }),
  documentKey: contentKeySchema
}).strict();

export const collectionDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  id: idSchema,
  kind: collectionKindSchema,
  title: z.string().trim().min(1),
  subtitle: z.string().trim().min(1).optional(),
  lessons: z.array(collectionLessonSummarySchema).min(1)
}).strict().superRefine((collection, context) => {
  const seen = new Set<string>();
  collection.lessons.forEach((lesson, index) => {
    if (seen.has(lesson.id)) {
      context.addIssue({
        code: "custom",
        message: `Duplicate Lesson ID ${lesson.id}`,
        path: ["lessons", index, "id"]
      });
    }
    seen.add(lesson.id);
  });
});

export const catalogCollectionSummarySchema = z.object({
  id: idSchema,
  kind: collectionKindSchema,
  title: z.string().trim().min(1),
  subtitle: z.string().trim().min(1).optional(),
  lessonCount: z.number().int().positive(),
  documentKey: contentKeySchema
}).strict();

export const catalogDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  collections: z.array(catalogCollectionSummarySchema).min(1)
}).strict().superRefine((catalog, context) => {
  const seen = new Set<string>();
  catalog.collections.forEach((collection, index) => {
    if (seen.has(collection.id)) {
      context.addIssue({
        code: "custom",
        message: `Duplicate Collection ID ${collection.id}`,
        path: ["collections", index, "id"]
      });
    }
    seen.add(collection.id);
  });
});

const speakerSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1),
  role: z.enum(["host", "guest", "narrator", "speaker"]).optional()
}).strict();

const segmentSchema = z.object({
  id: z.string().trim().min(1),
  speakerId: idSchema.optional(),
  text: z.string().trim().min(1),
  translation: z.object({
    text: z.string().trim().min(1),
    speechText: z.string().trim().min(1).optional()
  }).strict().optional()
}).strict();

const cueSchema = z.object({
  segmentId: z.string().trim().min(1),
  start: z.number().nonnegative(),
  end: z.number().positive()
}).strict();

const renditionSchema = z.object({
  id: z.enum(["en", "zh-ai"]),
  language: z.enum(["en", "zh-Hans"]),
  role: z.enum(["original", "dub"]),
  audio: z.object({
    key: audioKeySchema,
    mimeType: z.literal("audio/mpeg"),
    byteLength: z.number().int().positive(),
    sha256: sha256Schema
  }).strict(),
  duration: z.number().positive(),
  cues: z.array(cueSchema).min(1)
}).strict();

export const lessonDocumentSchema = z.object({
  schemaVersion: z.literal(2),
  lesson: z.object({
    id: idSchema,
    kind: lessonKindSchema,
    title: z.string().trim().min(1),
    sourceLanguage: z.literal("en"),
    translationLanguage: z.literal("zh-Hans"),
    transcriptRevision: z.number().int().positive(),
    defaultRenditionId: z.enum(["en", "zh-ai"])
  }).strict(),
  source: z.object({
    type: z.enum(["textbookLesson", "podcastEpisode", "song", "audiobookChapter", "video", "speech", "other"]),
    series: z.string().trim().min(1).optional(),
    volume: z.string().trim().min(1).optional(),
    publisher: z.string().trim().min(1).optional(),
    webUrl: z.string().url().optional()
  }).strict(),
  rights: z.object({
    status: z.enum(["unverified", "restricted", "licensed", "public-domain"]),
    notes: z.string().trim().min(1).optional(),
    attribution: z.string().trim().min(1).optional()
  }).strict(),
  speakers: z.array(speakerSchema),
  segments: z.array(segmentSchema).min(1),
  renditions: z.array(renditionSchema).min(1)
}).strict().superRefine((document, context) => {
  const speakerIds = new Set<string>();
  document.speakers.forEach((speaker, index) => {
    if (speakerIds.has(speaker.id)) {
      context.addIssue({ code: "custom", message: `Duplicate speaker ID ${speaker.id}`, path: ["speakers", index, "id"] });
    }
    speakerIds.add(speaker.id);
  });

  const segmentIds = new Set<string>();
  document.segments.forEach((segment, index) => {
    if (segmentIds.has(segment.id)) {
      context.addIssue({ code: "custom", message: `Duplicate segment ID ${segment.id}`, path: ["segments", index, "id"] });
    }
    segmentIds.add(segment.id);
    if (segment.speakerId && !speakerIds.has(segment.speakerId)) {
      context.addIssue({ code: "custom", message: `Unknown speaker ID ${segment.speakerId}`, path: ["segments", index, "speakerId"] });
    }
  });

  const renditionIds = new Set<string>();
  document.renditions.forEach((rendition, renditionIndex) => {
    if (renditionIds.has(rendition.id)) {
      context.addIssue({ code: "custom", message: `Duplicate rendition ID ${rendition.id}`, path: ["renditions", renditionIndex, "id"] });
    }
    renditionIds.add(rendition.id);
    if ((rendition.id === "en") !== (rendition.language === "en" && rendition.role === "original")) {
      context.addIssue({ code: "custom", message: "The en rendition must be the English original", path: ["renditions", renditionIndex] });
    }
    if ((rendition.id === "zh-ai") !== (rendition.language === "zh-Hans" && rendition.role === "dub")) {
      context.addIssue({ code: "custom", message: "The zh-ai rendition must be the Simplified Chinese dub", path: ["renditions", renditionIndex] });
    }

    const cueIds = new Set<string>();
    let previousStart = -1;
    rendition.cues.forEach((cue, cueIndex) => {
      if (!segmentIds.has(cue.segmentId)) {
        context.addIssue({ code: "custom", message: `Unknown Segment ID ${cue.segmentId}`, path: ["renditions", renditionIndex, "cues", cueIndex, "segmentId"] });
      }
      if (cueIds.has(cue.segmentId)) {
        context.addIssue({ code: "custom", message: `Duplicate Cue Segment ID ${cue.segmentId}`, path: ["renditions", renditionIndex, "cues", cueIndex, "segmentId"] });
      }
      cueIds.add(cue.segmentId);
      if (cue.end <= cue.start) {
        context.addIssue({ code: "custom", message: "Cue end must be greater than start", path: ["renditions", renditionIndex, "cues", cueIndex, "end"] });
      }
      if (cue.start < previousStart) {
        context.addIssue({ code: "custom", message: "Cues must be ordered by start time", path: ["renditions", renditionIndex, "cues", cueIndex, "start"] });
      }
      if (cue.end > rendition.duration + 1) {
        context.addIssue({ code: "custom", message: "Cue exceeds rendition duration", path: ["renditions", renditionIndex, "cues", cueIndex, "end"] });
      }
      previousStart = cue.start;
    });
  });

  if (!renditionIds.has(document.lesson.defaultRenditionId)) {
    context.addIssue({ code: "custom", message: "Default rendition does not exist", path: ["lesson", "defaultRenditionId"] });
  }
});

export const legacyCourseDocumentSchema = z.object({
  version: z.literal(1),
  course: z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    audioFilename: z.string().min(1),
    duration: z.number().positive(),
    revision: z.number().int().positive().optional(),
    language: z.string().min(1).optional()
  }),
  segments: z.array(z.object({
    id: z.string().min(1),
    start: z.number().nonnegative(),
    end: z.number().positive(),
    text: z.string().min(1),
    translations: z.record(z.string(), z.string().min(1)).optional(),
    speaker: z.string().min(1).optional()
  })).min(1)
});

export type CollectionDocument = z.infer<typeof collectionDocumentSchema>;
export type CollectionLessonSummary = z.infer<typeof collectionLessonSummarySchema>;
export type CollectionKind = z.infer<typeof collectionKindSchema>;
export type CatalogDocument = z.infer<typeof catalogDocumentSchema>;
export type CatalogCollectionSummary = z.infer<typeof catalogCollectionSummarySchema>;
export type LessonDocument = z.infer<typeof lessonDocumentSchema>;
export type LessonKind = z.infer<typeof lessonKindSchema>;
export type LegacyCourseDocument = z.infer<typeof legacyCourseDocumentSchema>;

export interface RuntimeSegment {
  id: string;
  start: number;
  end: number;
  text: string;
  translations?: { "zh-Hans"?: string };
  speaker?: string;
}

export interface RuntimeLesson {
  schemaVersion: 2;
  id: string;
  title: string;
  audioFilename: string;
  duration: number;
  revision: number;
  language: "en";
  defaultRenditionId: "en" | "zh-ai";
  segments: RuntimeSegment[];
  audioLocation?: "opfs" | "indexeddb";
}

export function assembleRuntimeLesson(input: unknown): RuntimeLesson {
  const document = lessonDocumentSchema.parse(input);
  const rendition = document.renditions.find(({ id }) => id === document.lesson.defaultRenditionId);
  if (!rendition) throw new Error("Default audio rendition is missing.");
  const cueBySegment = new Map(rendition.cues.map((cue) => [cue.segmentId, cue]));
  const speakerById = new Map(document.speakers.map((speaker) => [speaker.id, speaker.name]));

  return {
    schemaVersion: 2,
    id: document.lesson.id,
    title: document.lesson.title,
    audioFilename: rendition.audio.key.split("/").at(-1) ?? rendition.audio.key,
    duration: rendition.duration,
    revision: document.lesson.transcriptRevision,
    language: "en",
    defaultRenditionId: document.lesson.defaultRenditionId,
    segments: document.segments.map((segment) => {
      const cue = cueBySegment.get(segment.id);
      if (!cue) throw new Error(`Default rendition has no cue for ${segment.id}.`);
      return {
        id: segment.id,
        start: cue.start,
        end: cue.end,
        text: segment.text,
        translations: segment.translation ? { "zh-Hans": segment.translation.text } : undefined,
        speaker: segment.speakerId ? speakerById.get(segment.speakerId) : undefined
      };
    })
  };
}

export function adaptLegacyCourse(input: unknown): Omit<RuntimeLesson, "schemaVersion" | "defaultRenditionId"> {
  const document = legacyCourseDocumentSchema.parse(input);
  return {
    id: document.course.id,
    title: document.course.title,
    audioFilename: document.course.audioFilename,
    duration: document.course.duration,
    revision: document.course.revision ?? 1,
    language: "en",
    segments: document.segments
  };
}

export function resolveAudioSourceUrl(key: string, sha256?: string, audioBaseUrl = "/audio/"): string {
  const safeKey = audioKeySchema.parse(key);
  const base = audioBaseUrl.endsWith("/") ? audioBaseUrl : `${audioBaseUrl}/`;
  const url = `${base}${safeKey}`;
  return sha256 ? `${url}?v=${sha256.slice(0, 12)}` : url;
}

export function resolveContentSourceUrl(key: string, contentBaseUrl = "/content/"): string {
  const safeKey = contentKeySchema.parse(key);
  const base = contentBaseUrl.endsWith("/") ? contentBaseUrl : `${contentBaseUrl}/`;
  return `${base}${safeKey}`;
}
