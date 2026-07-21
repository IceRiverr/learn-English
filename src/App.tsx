import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import {
  deleteCourse,
  loadAudio,
  loadCourse,
  loadProgress,
  saveCourse,
  saveCourseMetadata,
  saveProgress,
  type Course,
  type Segment
} from "./db";

const lessons = [
  {
    id: "voa-no-brainer",
    title: "VOA English in a Minute: No Brainer",
    durationLabel: "1 分钟",
    audioUrl: "/samples/no-brainer.mp3",
    transcriptUrl: "/samples/no-brainer.json"
  },
  {
    id: "context-engineering-with-dex-horthy",
    title: "Context engineering with Dex Horthy",
    durationLabel: "92 分钟",
    sizeLabel: "90 MB",
    audioUrl: "/samples/context-engineering-with-dex-horthy.mp3",
    transcriptUrl: "/samples/context-engineering-with-dex-horthy.json"
  },
  {
    id: "lex-475-demis-hassabis-2",
    title: "Lex Fridman Podcast #475: Demis Hassabis 2",
    durationLabel: "155 分钟",
    sizeLabel: "106 MB",
    audioUrl: "/samples/lex_ai_demis_hassabis_2.mp3",
    transcriptUrl: "/samples/lex-475-demis-hassabis-2.json?v=3"
  }
] as const;

type Lesson = (typeof lessons)[number];

const transcriptSchema = z.object({
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

type TranscriptInput = z.infer<typeof transcriptSchema>;
const speeds = [0.75, 0.9, 1, 1.25, 1.5] as const;
const translationLanguage = "zh-Hans";
const translationPreferenceKey = "show-translation";
const repeatPreferenceKey = "segment-repeat-count";
const repeatLimits = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, "infinite"] as const;
type RepeatLimit = (typeof repeatLimits)[number];
type OpenPlayerMenu = "speed" | "repeat" | "reading" | undefined;
type PlayerView = "focus" | "transcript";

function readRepeatLimit(): RepeatLimit {
  try {
    const value = localStorage.getItem(repeatPreferenceKey);
    if (value === "infinite") return value;
    if (["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"].includes(value ?? "")) {
      return Number(value) as RepeatLimit;
    }
    return 3;
  } catch {
    return 3;
  }
}

function findSegmentIndex(segments: readonly Segment[], time: number): number {
  let low = 0;
  let high = segments.length - 1;
  let result = 0;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (segments[middle].start <= time) {
      result = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return result;
}

function validateTimeline(input: TranscriptInput, actualDuration: number, filename: string): void {
  if (input.course.audioFilename !== filename) {
    throw new Error(`字幕要求 ${input.course.audioFilename}，但音频是 ${filename}。`);
  }
  if (Math.abs(input.course.duration - actualDuration) > 3) {
    throw new Error("字幕记录的时长与音频实际时长不一致。");
  }

  const ids = new Set<string>();
  for (let index = 0; index < input.segments.length; index += 1) {
    const segment = input.segments[index];
    if (ids.has(segment.id)) throw new Error(`字幕 ID ${segment.id} 重复。`);
    ids.add(segment.id);
    if (segment.end <= segment.start) throw new Error(`字幕 ${segment.id} 的结束时间必须大于开始时间。`);
    if (index > 0 && segment.start < input.segments[index - 1].end) {
      throw new Error(`字幕 ${segment.id} 与上一条字幕重叠。`);
    }
    if (segment.end > actualDuration + 1) throw new Error(`字幕 ${segment.id} 超出了音频时长。`);
  }
}

function readAudioDuration(audio: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const element = new Audio();
    const url = URL.createObjectURL(audio);
    element.preload = "metadata";
    element.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(element.duration);
    };
    element.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("浏览器无法读取这个音频文件。"));
    };
    element.src = url;
  });
}

function courseFromTranscript(input: TranscriptInput, duration = input.course.duration): Omit<Course, "audioLocation"> {
  return {
    id: input.course.id,
    title: input.course.title,
    audioFilename: input.course.audioFilename,
    duration,
    revision: input.course.revision,
    language: input.course.language,
    segments: input.segments
  };
}

function translationCount(course: Course): number {
  return course.segments.filter((segment) => Boolean(segment.translations?.[translationLanguage])).length;
}

function formatTime(value: number): string {
  if (!Number.isFinite(value)) return "00:00";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function messageFromError(error: unknown): string {
  if (error instanceof z.ZodError) {
    const issue = error.issues[0];
    return `字幕格式错误：${issue.path.join(".")} ${issue.message}`;
  }
  return error instanceof Error ? error.message : "发生了未知错误。";
}

async function fetchTranscript(lesson: Lesson): Promise<TranscriptInput> {
  const response = await fetch(lesson.transcriptUrl);
  if (!response.ok) throw new Error("课程字幕加载失败，请检查网络连接。");
  const input = transcriptSchema.parse(await response.json());
  const filename = lesson.audioUrl.split("/").at(-1) ?? "";
  validateTimeline(input, input.course.duration, filename);
  if (input.course.id !== lesson.id) throw new Error("课程字幕与课程目录不匹配。");
  return input;
}

export default function App() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const objectUrl = useRef<string | undefined>(undefined);
  const lastSavedAt = useRef(0);
  const restoreTime = useRef(0);
  const loopSegmentRef = useRef<number | undefined>(undefined);
  const repeatIterationRef = useRef(1);
  const repeatLimitRef = useRef<RepeatLimit>(3);
  const repeatSwitchingRef = useRef(false);
  const repeatFinishedRef = useRef(false);
  const repeatTimerRef = useRef(0);
  const playerSettingsRef = useRef<HTMLDivElement>(null);
  const playerMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const activeSegmentRef = useRef<HTMLButtonElement>(null);
  const transcriptShouldCenterRef = useRef(false);
  const [course, setCourse] = useState<Course>();
  const [audioUrl, setAudioUrl] = useState<string>();
  const [localPlayback, setLocalPlayback] = useState(false);
  const [downloaded, setDownloaded] = useState<Record<string, boolean>>({});
  const [downloading, setDownloading] = useState<string>();
  const [checkingDownloads, setCheckingDownloads] = useState(true);
  const [audioFile, setAudioFile] = useState<File>();
  const [transcriptFile, setTranscriptFile] = useState<File>();
  const [currentTime, setCurrentTime] = useState(0);
  const [currentSegment, setCurrentSegment] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loopSegment, setLoopSegment] = useState<number>();
  const [repeatLimit, setRepeatLimit] = useState<RepeatLimit>(() => {
    const value = readRepeatLimit();
    repeatLimitRef.current = value;
    return value;
  });
  const [repeatIteration, setRepeatIteration] = useState(1);
  const [openPlayerMenu, setOpenPlayerMenu] = useState<OpenPlayerMenu>();
  const [playerSettingsExpanded, setPlayerSettingsExpanded] = useState(true);
  const [playerView, setPlayerView] = useState<PlayerView>("focus");
  const [followingTranscript, setFollowingTranscript] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [showTranslation, setShowTranslation] = useState(() => {
    try {
      return localStorage.getItem(translationPreferenceKey) !== "false";
    } catch {
      return true;
    }
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function replaceObjectUrl(blob?: Blob): string | undefined {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    const nextUrl = blob ? URL.createObjectURL(blob) : undefined;
    objectUrl.current = nextUrl;
    return nextUrl;
  }

  async function refreshDownloadedCourses() {
    const entries = await Promise.all(lessons.map(async (lesson) => {
      const [saved, audio] = await Promise.all([loadCourse(lesson.id), loadAudio(lesson.id)]);
      return [lesson.id, Boolean(saved && audio)] as const;
    }));
    setDownloaded(Object.fromEntries(entries));
  }

  function clearRepeatTimer() {
    window.clearTimeout(repeatTimerRef.current);
    repeatTimerRef.current = 0;
  }

  function updateLoopSegment(value: number | undefined) {
    loopSegmentRef.current = value;
    setLoopSegment(value);
  }

  function updateRepeatIteration(value: number) {
    repeatIterationRef.current = value;
    setRepeatIteration(value);
  }

  function resetRepeatTransition() {
    clearRepeatTimer();
    repeatSwitchingRef.current = false;
    repeatFinishedRef.current = false;
  }

  function completeRepeatIteration(audio: HTMLAudioElement) {
    const target = loopSegmentRef.current;
    if (!course || target === undefined || repeatSwitchingRef.current) return;

    const segment = course.segments[target];
    if (audio.currentTime < Math.min(course.duration, segment.end + 0.2)) return;

    repeatSwitchingRef.current = true;
    audio.pause();
    const limit = repeatLimitRef.current;
    const iteration = repeatIterationRef.current;
    const isComplete = limit !== "infinite" && iteration >= limit;

    if (isComplete && target === course.segments.length - 1) {
      audio.currentTime = Math.min(course.duration, segment.end);
      setCurrentTime(audio.currentTime);
      repeatFinishedRef.current = true;
      return;
    }

    const nextTarget = isComplete ? target + 1 : target;
    const nextIteration = isComplete ? 1 : iteration + 1;
    const resume = () => {
      updateLoopSegment(nextTarget);
      updateRepeatIteration(nextIteration);
      audio.currentTime = Math.max(0, course.segments[nextTarget].start - 0.15);
      setCurrentTime(audio.currentTime);
      setCurrentSegment(nextTarget);
      repeatSwitchingRef.current = false;
      void audio.play();
    };

    if (document.hidden) {
      resume();
    } else {
      repeatTimerRef.current = window.setTimeout(resume, 300);
    }
  }

  useEffect(() => {
    let cancelled = false;
    refreshDownloadedCourses()
      .catch((restoreError) => !cancelled && setError(messageFromError(restoreError)))
      .finally(() => !cancelled && setCheckingDownloads(false));
    return () => {
      cancelled = true;
      clearRepeatTimer();
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    };
  }, []);

  useEffect(() => {
    if (loopSegment === undefined || !course) return;
    let frame = 0;
    const monitor = () => {
      const audio = audioRef.current;
      if (audio && !document.hidden) completeRepeatIteration(audio);
      frame = requestAnimationFrame(monitor);
    };
    frame = requestAnimationFrame(monitor);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [course, loopSegment]);

  useEffect(() => {
    const saveWhenHidden = () => {
      const audio = audioRef.current;
      if (document.hidden && audio && course) {
        void saveProgress(course.id, { currentTime: audio.currentTime, playbackRate: audio.playbackRate });
      }
    };
    document.addEventListener("visibilitychange", saveWhenHidden);
    return () => document.removeEventListener("visibilitychange", saveWhenHidden);
  }, [course]);

  useEffect(() => {
    if (!openPlayerMenu) return;
    const closeFromOutside = (event: PointerEvent) => {
      const target = event.target;
      if (playerSettingsRef.current?.contains(target as Node)
        || (target instanceof Element && target.closest(".settings-toggle"))) return;
      closePlayerMenu();
    };
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePlayerMenu();
    };
    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeFromKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("keydown", closeFromKeyboard);
    };
  }, [openPlayerMenu]);

  useEffect(() => {
    if (playerView !== "transcript" || !followingTranscript) return;
    const center = transcriptShouldCenterRef.current;
    transcriptShouldCenterRef.current = false;
    const frame = requestAnimationFrame(() => scrollActiveSegment(center));
    return () => cancelAnimationFrame(frame);
  }, [currentSegment, followingTranscript, playerView]);

  async function showCourse(nextCourse: Course, source: string, isLocal: boolean) {
    const progress = await loadProgress(nextCourse.id);
    restoreTime.current = progress?.currentTime ?? 0;
    setSpeed(progress?.playbackRate ?? 1);
    setCurrentTime(restoreTime.current);
    setCurrentSegment(findSegmentIndex(nextCourse.segments, restoreTime.current));
    resetRepeatTransition();
    updateLoopSegment(undefined);
    updateRepeatIteration(1);
    setOpenPlayerMenu(undefined);
    setPlayerView("focus");
    setFollowingTranscript(true);
    setLocalPlayback(isLocal);
    setCourse(nextCourse);
    setAudioUrl(source);
  }

  async function openLesson(lesson: Lesson) {
    if (busy || downloading) return;
    setBusy(true);
    setError("");
    try {
      const saved = await loadCourse(lesson.id);
      const audio = saved ? await loadAudio(lesson.id) : undefined;
      if (saved && audio) {
        let localCourse = saved;
        if (translationCount(saved) < saved.segments.length) {
          try {
            const input = await fetchTranscript(lesson);
            const latestCourse = courseFromTranscript(input, saved.duration);
            if (translationCount(latestCourse) > translationCount(saved)
              || (latestCourse.revision ?? 0) > (saved.revision ?? 0)) {
              localCourse = (await saveCourseMetadata(latestCourse)) ?? saved;
            }
          } catch {
            // Old downloaded courses must remain playable when offline.
          }
        }
        await showCourse(localCourse, replaceObjectUrl(audio)!, true);
      } else {
        const input = await fetchTranscript(lesson);
        await showCourse(courseFromTranscript(input), replaceObjectUrl() ?? lesson.audioUrl, false);
      }
    } catch (openError) {
      setError(messageFromError(openError));
    } finally {
      setBusy(false);
    }
  }

  async function downloadLesson(lesson: Lesson) {
    if (downloading) return;
    setDownloading(lesson.id);
    setError("");
    try {
      const [audioResponse, input] = await Promise.all([fetch(lesson.audioUrl), fetchTranscript(lesson)]);
      if (!audioResponse.ok) throw new Error("课程音频下载失败，请检查网络连接或存储空间。");
      const audio = await audioResponse.blob();
      const duration = await readAudioDuration(audio);
      validateTimeline(input, duration, lesson.audioUrl.split("/").at(-1) ?? "");
      await saveCourse(courseFromTranscript(input, duration), audio);
      setDownloaded((current) => ({ ...current, [lesson.id]: true }));
      try {
        await navigator.storage?.persist?.();
      } catch {
        // Persistent storage is optional.
      }
    } catch (downloadError) {
      setDownloaded((current) => ({ ...current, [lesson.id]: false }));
      setError(messageFromError(downloadError));
    } finally {
      setDownloading(undefined);
    }
  }

  async function importFiles(audio: File, transcript: File) {
    setBusy(true);
    setError("");
    try {
      const input = transcriptSchema.parse(JSON.parse(await transcript.text()) as unknown);
      const duration = await readAudioDuration(audio);
      validateTimeline(input, duration, audio.name);
      const saved = await saveCourse(courseFromTranscript(input, duration), audio);
      await saveProgress(saved.id, { currentTime: 0, playbackRate: 1 });
      await showCourse(saved, replaceObjectUrl(audio)!, true);
      if (lessons.some((lesson) => lesson.id === saved.id)) {
        setDownloaded((current) => ({ ...current, [saved.id]: true }));
      }
      try {
        await navigator.storage?.persist?.();
      } catch {
        // Persistent storage is optional.
      }
    } catch (importError) {
      setError(messageFromError(importError));
    } finally {
      setBusy(false);
    }
  }

  async function importSelectedFiles() {
    if (!audioFile || !transcriptFile) {
      setError("请选择 MP3 和字幕 JSON 文件。");
      return;
    }
    await importFiles(audioFile, transcriptFile);
  }

  function saveCurrentProgress(time: number, rate: number) {
    if (course) void saveProgress(course.id, { currentTime: time, playbackRate: rate });
  }

  function seekTo(value: number) {
    const audio = audioRef.current;
    if (!audio || !course) return;
    resetRepeatTransition();
    audio.currentTime = Math.max(0, Math.min(value, course.duration));
    setCurrentTime(audio.currentTime);
    const nextSegment = findSegmentIndex(course.segments, audio.currentTime);
    setCurrentSegment(nextSegment);
    if (loopSegmentRef.current !== undefined) {
      updateLoopSegment(nextSegment);
      updateRepeatIteration(1);
    }
    saveCurrentProgress(audio.currentTime, audio.playbackRate);
  }

  function seekToSegment(index: number, autoplay = true) {
    if (!course) return;
    const next = Math.max(0, Math.min(index, course.segments.length - 1));
    seekTo(Math.max(0, course.segments[next].start - 0.15));
    setCurrentSegment(next);
    if (loopSegmentRef.current !== undefined) {
      updateLoopSegment(next);
      updateRepeatIteration(1);
    }
    if (autoplay) void audioRef.current?.play();
  }

  function toggleRepeat() {
    const audio = audioRef.current;
    if (!audio || !course) return;
    if (loopSegmentRef.current !== undefined) {
      const resumeAfterTransition = repeatSwitchingRef.current && audio.paused && !repeatFinishedRef.current;
      resetRepeatTransition();
      updateLoopSegment(undefined);
      if (resumeAfterTransition) void audio.play();
      return;
    }

    resetRepeatTransition();
    updateLoopSegment(currentSegment);
    updateRepeatIteration(1);
    audio.currentTime = Math.max(0, course.segments[currentSegment].start - 0.15);
    setCurrentTime(audio.currentTime);
    saveCurrentProgress(audio.currentTime, audio.playbackRate);
    void audio.play();
  }

  function selectRepeatLimit(nextLimit: RepeatLimit) {
    repeatLimitRef.current = nextLimit;
    setRepeatLimit(nextLimit);
    if (nextLimit !== "infinite" && repeatIterationRef.current > nextLimit) {
      updateRepeatIteration(nextLimit);
    }
    try {
      localStorage.setItem(repeatPreferenceKey, String(nextLimit));
    } catch {
      // The repeat preference can remain in React state when storage is unavailable.
    }
    if (loopSegmentRef.current === undefined) toggleRepeat();
    closePlayerMenu();
  }

  function togglePlayerMenu(menu: Exclude<OpenPlayerMenu, undefined>, trigger: HTMLButtonElement) {
    if (openPlayerMenu === menu) {
      closePlayerMenu();
      return;
    }
    playerMenuTriggerRef.current = trigger;
    setOpenPlayerMenu(menu);
  }

  function togglePlayerSettings() {
    if (playerSettingsExpanded) setOpenPlayerMenu(undefined);
    setPlayerSettingsExpanded((expanded) => !expanded);
  }

  function closePlayerMenu() {
    setOpenPlayerMenu(undefined);
    window.setTimeout(() => playerMenuTriggerRef.current?.focus(), 0);
  }

  function scrollActiveSegment(center: boolean) {
    const segment = activeSegmentRef.current;
    if (!segment) return;
    const rect = segment.getBoundingClientRect();
    const controlsTop = document.querySelector<HTMLElement>(".controls")?.getBoundingClientRect().top ?? window.innerHeight;
    if (!center && rect.top >= 12 && rect.bottom <= controlsTop - 12) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    segment.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
  }

  function changePlayerView(view: PlayerView) {
    if (view === playerView) return;
    if (view === "transcript") {
      transcriptShouldCenterRef.current = true;
      setFollowingTranscript(true);
    }
    setPlayerView(view);
  }

  function resumeTranscriptFollowing() {
    transcriptShouldCenterRef.current = true;
    setFollowingTranscript(true);
  }

  function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      return;
    }
    void audio.play();
  }

  function handlePlay(audio: HTMLAudioElement) {
    const target = loopSegmentRef.current;
    if (target !== undefined && repeatFinishedRef.current && course) {
      resetRepeatTransition();
      updateRepeatIteration(1);
      audio.currentTime = Math.max(0, course.segments[target].start - 0.15);
      setCurrentTime(audio.currentTime);
      setCurrentSegment(target);
    }
    setPlaying(true);
  }

  function changeSpeed(value: number) {
    const audio = audioRef.current;
    if (audio) audio.playbackRate = value;
    setSpeed(value);
    saveCurrentProgress(audio?.currentTime ?? currentTime, value);
    closePlayerMenu();
  }

  function toggleTranslation() {
    const nextValue = !showTranslation;
    setShowTranslation(nextValue);
    try {
      localStorage.setItem(translationPreferenceKey, String(nextValue));
    } catch {
      // The display preference can remain in React state when storage is unavailable.
    }
    closePlayerMenu();
  }

  function returnToCourses() {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      saveCurrentProgress(audio.currentTime, audio.playbackRate);
    }
    replaceObjectUrl();
    resetRepeatTransition();
    updateLoopSegment(undefined);
    updateRepeatIteration(1);
    setOpenPlayerMenu(undefined);
    setPlayerView("focus");
    setFollowingTranscript(true);
    setCourse(undefined);
    setAudioUrl(undefined);
    setPlaying(false);
    setError("");
  }

  async function removeCurrentCourse() {
    if (!course) return;
    audioRef.current?.pause();
    await deleteCourse(course.id);
    setDownloaded((current) => ({ ...current, [course.id]: false }));
    returnToCourses();
  }

  const transcriptContent = useMemo(() => {
    if (!course) return null;
    return course.segments.map((segment, index) => (
      <button key={segment.id} ref={index === currentSegment ? activeSegmentRef : undefined}
        className={index === currentSegment ? "segment active" : "segment"}
        onClick={() => seekToSegment(index)}>
        <time>{formatTime(segment.start)}</time>
        <span className="segment-copy">
          {segment.speaker && <small>{segment.speaker}</small>}
          <span>{segment.text}</span>
          {showTranslation && segment.translations?.[translationLanguage] && (
            <span className="segment-translation">{segment.translations[translationLanguage]}</span>
          )}
        </span>
      </button>
    ));
  }, [course, currentSegment, showTranslation]);

  if (!course || !audioUrl) {
    return (
      <main className="center-card course-home">
        <div className="brand">LISTEN / 0005</div>
        <h1>选择一课，认真听懂。</h1>
        <p className="intro">点击课程即可在线播放；下载后也能离线学习。</p>

        <section className="course-list" aria-label="课程列表">
          <h2>课程</h2>
          {lessons.map((lesson) => {
            const isDownloading = downloading === lesson.id;
            const isDownloaded = downloaded[lesson.id];
            return (
              <div className="course-row" key={lesson.id}>
                <button className="course-open" onClick={() => void openLesson(lesson)} disabled={busy || Boolean(downloading)}>
                  <span className="course-copy">
                    <strong>{lesson.title}</strong>
                    <span>{lesson.durationLabel}{"sizeLabel" in lesson ? ` · ${lesson.sizeLabel}` : ""}</span>
                  </span>
                </button>
                <button
                  className={isDownloaded ? "download downloaded" : "download"}
                  disabled={checkingDownloads || isDownloading || isDownloaded}
                  onClick={() => void downloadLesson(lesson)}
                >
                  {checkingDownloads ? "检查中…" : isDownloading ? "下载中…" : isDownloaded ? "已下载" : "下载"}
                </button>
              </div>
            );
          })}
        </section>

        <div className="divider"><span>或者导入自己的课程</span></div>
        <label className="file-field">
          <span>MP3 音频</span>
          <input type="file" accept="audio/mpeg,.mp3" onChange={(event) => setAudioFile(event.target.files?.[0])} />
          <strong>{audioFile?.name ?? "选择文件"}</strong>
        </label>
        <label className="file-field">
          <span>字幕 JSON</span>
          <input type="file" accept="application/json,.json" onChange={(event) => setTranscriptFile(event.target.files?.[0])} />
          <strong>{transcriptFile?.name ?? "选择文件"}</strong>
        </label>
        <button className="secondary" onClick={() => void importSelectedFiles()} disabled={busy}>
          {busy ? "正在打开…" : "导入所选文件"}
        </button>
        {error && <p className="error" role="alert">{error}</p>}
        <p className="source-note">课程资料只在点击“下载”或手动导入后保存到浏览器。</p>
      </main>
    );
  }

  const activeSegment = course.segments[currentSegment];
  const availableTranslations = translationCount(course);
  const activeTranslation = activeSegment.translations?.[translationLanguage];
  return (
    <main className={playerSettingsExpanded ? "player-page" : "player-page settings-collapsed"}>
      <header>
        <button className="back" onClick={returnToCourses}>← 返回课程</button>
        <div className="brand">LISTEN / 0005</div>
        <div className="course-heading">
          <h1>{course.title}</h1>
          {localPlayback && <button className="delete" onClick={() => void removeCurrentCourse()}>删除本地课程</button>}
        </div>
      </header>

      <div className="player-view-switch" role="group" aria-label="正文视图">
        <button aria-pressed={playerView === "focus"} onClick={() => changePlayerView("focus")}>当前句</button>
        <button aria-pressed={playerView === "transcript"} onClick={() => changePlayerView("transcript")}>全文</button>
      </div>

      <div className={playerView === "focus" ? "player-content focus-view" : "player-content transcript-view"}
        onTouchMove={() => {
          if (playerView === "transcript") setFollowingTranscript(false);
        }}
        onWheel={(event) => {
          if (playerView === "transcript" && Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
            setFollowingTranscript(false);
          }
        }}>
        {playerView === "focus" ? (
          <section className="focus-sentence" aria-live="polite">
            <span>当前句 · {currentSegment + 1}/{course.segments.length}</span>
            {activeSegment.speaker && <span>{activeSegment.speaker}</span>}
            <p className="focus-english">{activeSegment.text}</p>
            {showTranslation && activeTranslation && <p className="focus-translation">{activeTranslation}</p>}
          </section>
        ) : (
          <>
            <section className="transcript" aria-label="完整字幕">{transcriptContent}</section>
            {!followingTranscript && (
              <button className="follow-transcript" onClick={resumeTranscriptFollowing}>回到当前句</button>
            )}
          </>
        )}
      </div>
      {error && <p className="error" role="alert">{error}</p>}

      <section className="controls" aria-label="播放器控制">
        <audio ref={audioRef} src={audioUrl} preload="metadata"
          onLoadedMetadata={(event) => {
            event.currentTarget.playbackRate = speed;
            event.currentTarget.currentTime = Math.min(restoreTime.current, course.duration);
            setCurrentTime(event.currentTarget.currentTime);
            setCurrentSegment(findSegmentIndex(course.segments, event.currentTarget.currentTime));
          }}
          onPlay={(event) => handlePlay(event.currentTarget)}
          onPause={(event) => {
            setPlaying(false);
            saveCurrentProgress(event.currentTarget.currentTime, event.currentTarget.playbackRate);
          }}
          onTimeUpdate={(event) => {
            let time = event.currentTarget.currentTime;
            if (document.hidden) completeRepeatIteration(event.currentTarget);
            time = event.currentTarget.currentTime;
            setCurrentTime(time);
            const index = loopSegmentRef.current ?? findSegmentIndex(course.segments, time);
            setCurrentSegment((current) => current === index ? current : index);
            if (Date.now() - lastSavedAt.current > 5000) {
              lastSavedAt.current = Date.now();
              saveCurrentProgress(time, event.currentTarget.playbackRate);
            }
          }}
          onError={() => setError("浏览器无法播放课程音频；如果当前离线，请先下载课程。")}
        />
        <div className="player-settings" id="player-settings" ref={playerSettingsRef} hidden={!playerSettingsExpanded}>
          <div className="player-setting">
            <button className="setting-trigger" aria-expanded={openPlayerMenu === "speed"}
              aria-controls="speed-menu" onClick={(event) => togglePlayerMenu("speed", event.currentTarget)}>
              <strong>{speed}×</strong><span>倍速</span>
            </button>
            {openPlayerMenu === "speed" && (
              <div className="player-menu speed-menu" id="speed-menu" role="menu" aria-label="播放倍速">
                {speeds.map((value) => <button key={value} role="menuitemradio" aria-checked={speed === value}
                  className={speed === value ? "menu-option selected" : "menu-option"}
                  onClick={() => changeSpeed(value)}><span>{speed === value ? "✓" : ""}</span>{value}×</button>)}
              </div>
            )}
          </div>
          <div className="player-setting">
            <button className="setting-trigger" aria-expanded={openPlayerMenu === "repeat"}
              aria-controls="repeat-menu" onClick={(event) => togglePlayerMenu("repeat", event.currentTarget)}>
              <strong>{loopSegment === undefined ? "关闭" : `${repeatIteration}/${repeatLimit === "infinite" ? "∞" : repeatLimit}`}</strong>
              <span>逐句循环</span>
            </button>
            {openPlayerMenu === "repeat" && (
              <div className="player-menu repeat-menu" id="repeat-menu" role="menu" aria-label="逐句循环设置">
                <span className="menu-title">循环次数</span>
                <div className="repeat-grid">
                  {repeatLimits.slice(0, 10).map((value) => <button key={value} role="menuitemradio"
                    aria-checked={repeatLimit === value} className={repeatLimit === value ? "selected" : ""}
                    onClick={() => selectRepeatLimit(value)}>{repeatLimit === value ? `✓ ${value}` : value}</button>)}
                </div>
                <button role="menuitemradio" aria-checked={repeatLimit === "infinite"}
                  className={repeatLimit === "infinite" ? "menu-option selected" : "menu-option"}
                  onClick={() => selectRepeatLimit("infinite")}>
                  <span>{repeatLimit === "infinite" ? "✓" : ""}</span>∞ 无限循环
                </button>
                <button className="menu-option repeat-off" disabled={loopSegment === undefined}
                  onClick={() => { toggleRepeat(); closePlayerMenu(); }}><span />关闭逐句循环</button>
              </div>
            )}
          </div>
          <div className="player-setting">
            <button className="setting-trigger" disabled={availableTranslations === 0}
              aria-expanded={openPlayerMenu === "reading"} aria-controls="reading-menu"
              onClick={(event) => togglePlayerMenu("reading", event.currentTarget)}>
              <strong>{availableTranslations === 0 ? "暂无中文" : showTranslation ? "中英" : "英文"}</strong><span>阅读模式</span>
            </button>
            {openPlayerMenu === "reading" && (
              <div className="player-menu reading-menu" id="reading-menu" role="menu" aria-label="阅读模式">
                <button role="menuitemradio" aria-checked={showTranslation} className={showTranslation ? "menu-option selected" : "menu-option"}
                  onClick={() => { if (!showTranslation) toggleTranslation(); else closePlayerMenu(); }}><span>{showTranslation ? "✓" : ""}</span>中英双语</button>
                <button role="menuitemradio" aria-checked={!showTranslation} className={!showTranslation ? "menu-option selected" : "menu-option"}
                  onClick={() => { if (showTranslation) toggleTranslation(); else closePlayerMenu(); }}><span>{!showTranslation ? "✓" : ""}</span>仅英文</button>
              </div>
            )}
          </div>
        </div>
        <div className="player-progress">
          <input className="timeline" type="range" min="0" max={course.duration} step="0.05" value={currentTime}
            aria-label="播放进度" onChange={(event) => seekTo(Number(event.target.value))} />
          <div className="time-row"><span>{formatTime(currentTime)}</span><span>{formatTime(course.duration)}</span></div>
        </div>
        <div className="main-controls">
          <button className="settings-toggle" aria-expanded={playerSettingsExpanded}
            aria-controls="player-settings" aria-label={playerSettingsExpanded ? "收起播放设置" : "展开播放设置"}
            onClick={togglePlayerSettings}>{playerSettingsExpanded ? "⌄" : "⌃"}</button>
          <button onClick={() => seekToSegment(currentSegment - 1)} aria-label="上一句">‹</button>
          <button className="play" onClick={togglePlayback}
            aria-label={playing ? "暂停" : "播放"}>{playing ? "Ⅱ" : "▶"}</button>
          <button onClick={() => seekToSegment(currentSegment + 1)} aria-label="下一句">›</button>
          <span className="main-controls-spacer" aria-hidden="true" />
        </div>
      </section>
    </main>
  );
}
