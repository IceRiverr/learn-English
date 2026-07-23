import { openDB } from "idb";
import { z } from "zod";
import type { RuntimeLesson, RuntimeSegment } from "./content";

export type Segment = RuntimeSegment;

export interface Course {
  schemaVersion?: 2;
  id: string;
  title: string;
  audioFilename: string;
  duration: number;
  revision?: number;
  language?: string;
  defaultRenditionId?: "en" | "zh-ai";
  segments: Segment[];
  audioLocation?: "opfs" | "indexeddb";
}

export interface SavedProgress {
  currentTime: number;
  playbackRate: number;
}

export interface LastPlayed {
  courseId: string;
  updatedAt: number;
}

const segmentSchema = z.object({
  id: z.string().min(1),
  start: z.number().nonnegative(),
  end: z.number().positive(),
  text: z.string().min(1),
  translations: z.object({ "zh-Hans": z.string().min(1).optional() }).optional(),
  speaker: z.string().min(1).optional()
});

const savedCourseSchema = z.object({
  schemaVersion: z.literal(2).optional(),
  id: z.string().min(1),
  title: z.string().min(1),
  audioFilename: z.string().min(1),
  duration: z.number().positive(),
  revision: z.number().int().positive().optional(),
  language: z.string().min(1).optional(),
  defaultRenditionId: z.enum(["en", "zh-ai"]).optional(),
  segments: z.array(segmentSchema).min(1),
  audioLocation: z.enum(["opfs", "indexeddb"]).optional()
});

const savedProgressSchema = z.object({
  currentTime: z.number().finite(),
  playbackRate: z.number().positive().finite()
});

const lastPlayedSchema = z.object({
  courseId: z.string().min(1),
  updatedAt: z.number().finite()
});

const database = openDB("english-listening", 1, {
  upgrade(db) {
    db.createObjectStore("app-data");
  }
});

function audioFileName(courseId: string): string {
  return `${courseId.replace(/[^a-zA-Z0-9._-]/g, "_")}.mp3`;
}

async function saveAudioToOpfs(courseId: string, audio: Blob): Promise<boolean> {
  if (typeof navigator.storage?.getDirectory !== "function") return false;

  try {
    const root = await navigator.storage.getDirectory();
    const audioDirectory = await root.getDirectoryHandle("audio", { create: true });
    const file = await audioDirectory.getFileHandle(audioFileName(courseId), { create: true });
    const writer = await file.createWritable();
    await writer.write(audio);
    await writer.close();
    return true;
  } catch {
    return false;
  }
}

async function deleteOpfsAudio(courseId: string): Promise<void> {
  if (typeof navigator.storage?.getDirectory !== "function") return;
  try {
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle("audio");
    await directory.removeEntry(audioFileName(courseId));
  } catch {
    // Missing OPFS files are already in the desired state.
  }
}

export async function saveCourse(
  course: Omit<Course | RuntimeLesson, "audioLocation">,
  audio: Blob
): Promise<Course> {
  const db = await database;
  const audioLocation = (await saveAudioToOpfs(course.id, audio)) ? "opfs" : "indexeddb";
  const savedCourse: Course = { ...course, audioLocation };
  const transaction = db.transaction("app-data", "readwrite");

  await transaction.store.put(savedCourse, `course:${course.id}`);
  if (audioLocation === "indexeddb") {
    await transaction.store.put(audio, `audio:${course.id}`);
  } else {
    await transaction.store.delete(`audio:${course.id}`);
  }
  await transaction.done;

  if (audioLocation === "indexeddb") await deleteOpfsAudio(course.id);
  return savedCourse;
}

export async function loadCourse(courseId: string): Promise<Course | undefined> {
  const parsed = savedCourseSchema.safeParse(await (await database).get("app-data", `course:${courseId}`));
  return parsed.success ? parsed.data : undefined;
}

export async function saveCourseMetadata(
  course: Omit<Course, "audioLocation">
): Promise<Course | undefined> {
  const existing = await loadCourse(course.id);
  if (!existing?.audioLocation) return undefined;
  const savedCourse: Course = { ...course, audioLocation: existing.audioLocation };
  await (await database).put("app-data", savedCourse, `course:${course.id}`);
  return savedCourse;
}

export async function loadAudio(courseId: string): Promise<Blob | undefined> {
  const course = await loadCourse(courseId);
  if (!course) return undefined;

  if (course.audioLocation === "indexeddb") {
    const value = await (await database).get("app-data", `audio:${courseId}`);
    return value instanceof Blob ? value : undefined;
  }
  if (course.audioLocation !== "opfs") return undefined;

  try {
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle("audio");
    const handle = await directory.getFileHandle(audioFileName(courseId));
    return await handle.getFile();
  } catch {
    return undefined;
  }
}

export async function saveProgress(courseId: string, progress: SavedProgress): Promise<void> {
  await (await database).put("app-data", progress, `progress:${courseId}`);
}

export async function loadProgress(courseId: string): Promise<SavedProgress | undefined> {
  const parsed = savedProgressSchema.safeParse(await (await database).get("app-data", `progress:${courseId}`));
  return parsed.success ? parsed.data : undefined;
}

export async function saveLastPlayed(courseId: string): Promise<void> {
  const value: LastPlayed = { courseId, updatedAt: Date.now() };
  await (await database).put("app-data", value, "last-played");
}

export async function loadLastPlayed(): Promise<LastPlayed | undefined> {
  const parsed = lastPlayedSchema.safeParse(await (await database).get("app-data", "last-played"));
  return parsed.success ? parsed.data : undefined;
}

export async function clearLastPlayed(): Promise<void> {
  await (await database).delete("app-data", "last-played");
}

export async function deleteCourse(courseId: string, preserveProgress = false): Promise<void> {
  const db = await database;
  const transaction = db.transaction("app-data", "readwrite");
  const deletions = [
    transaction.store.delete(`course:${courseId}`),
    transaction.store.delete(`audio:${courseId}`)
  ];
  if (!preserveProgress) deletions.push(transaction.store.delete(`progress:${courseId}`));
  await Promise.all(deletions);
  await transaction.done;
  await deleteOpfsAudio(courseId);
}
