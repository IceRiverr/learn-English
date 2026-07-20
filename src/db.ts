import { openDB } from "idb";

export interface Segment {
  id: string;
  start: number;
  end: number;
  text: string;
}

export interface Course {
  id: string;
  title: string;
  audioFilename: string;
  duration: number;
  segments: Segment[];
  audioLocation: "opfs" | "indexeddb";
}

export interface SavedProgress {
  currentTime: number;
  playbackRate: number;
}

const database = openDB("english-listening", 1, {
  upgrade(db) {
    db.createObjectStore("app-data");
  }
});

async function saveAudioToOpfs(audio: Blob): Promise<boolean> {
  if (typeof navigator.storage?.getDirectory !== "function") {
    return false;
  }

  try {
    const root = await navigator.storage.getDirectory();
    const audioDirectory = await root.getDirectoryHandle("audio", { create: true });
    const file = await audioDirectory.getFileHandle("current.mp3", { create: true });
    const writer = await file.createWritable();
    await writer.write(audio);
    await writer.close();
    return true;
  } catch {
    return false;
  }
}

export async function saveCourse(
  course: Omit<Course, "audioLocation">,
  audio: Blob
): Promise<Course> {
  const db = await database;
  const audioLocation = (await saveAudioToOpfs(audio)) ? "opfs" : "indexeddb";
  const savedCourse: Course = { ...course, audioLocation };
  const transaction = db.transaction("app-data", "readwrite");

  await transaction.store.put(savedCourse, "course");
  if (audioLocation === "indexeddb") {
    await transaction.store.put(audio, "audio-blob");
  } else {
    await transaction.store.delete("audio-blob");
  }
  await transaction.done;
  return savedCourse;
}

export async function loadCourse(): Promise<Course | undefined> {
  return (await database).get("app-data", "course") as Promise<Course | undefined>;
}

export async function loadAudio(course: Course): Promise<Blob | undefined> {
  if (course.audioLocation === "indexeddb") {
    return (await database).get("app-data", "audio-blob") as Promise<Blob | undefined>;
  }

  try {
    const root = await navigator.storage.getDirectory();
    const directory = await root.getDirectoryHandle("audio");
    const handle = await directory.getFileHandle("current.mp3");
    return await handle.getFile();
  } catch {
    return undefined;
  }
}

export async function saveProgress(progress: SavedProgress): Promise<void> {
  await (await database).put("app-data", progress, "progress");
}

export async function loadProgress(): Promise<SavedProgress | undefined> {
  return (await database).get("app-data", "progress") as Promise<SavedProgress | undefined>;
}

export async function deleteCourse(): Promise<void> {
  const db = await database;
  const transaction = db.transaction("app-data", "readwrite");
  await Promise.all([
    transaction.store.delete("course"),
    transaction.store.delete("progress"),
    transaction.store.delete("audio-blob")
  ]);
  await transaction.done;

  if (typeof navigator.storage?.getDirectory === "function") {
    try {
      const root = await navigator.storage.getDirectory();
      const directory = await root.getDirectoryHandle("audio");
      await directory.removeEntry("current.mp3");
    } catch {
      // The file or OPFS may not exist. IndexedDB data is already removed.
    }
  }
}
