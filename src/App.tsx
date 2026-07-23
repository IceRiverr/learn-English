import {
  forwardRef,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from "react";
import { z } from "zod";
import {
  clearLastPlayed,
  deleteCourse,
  loadAudio,
  loadCourse,
  loadLastPlayed,
  loadProgress,
  saveCourse,
  saveCourseMetadata,
  saveLastPlayed,
  saveProgress,
  type Course,
  type SavedProgress,
  type Segment
} from "./db";
import {
  assembleRuntimeLesson,
  catalogDocumentSchema,
  collectionDocumentSchema,
  lessonDocumentSchema,
  resolveAudioSourceUrl,
  resolveContentSourceUrl,
  type CatalogDocument,
  type CollectionDocument,
  type CollectionLessonSummary,
  type RuntimeLesson
} from "./content";
import {
  ArrowLeftIcon,
  CheckIcon,
  DownloadIcon,
  LoaderIcon,
  LocateIcon,
  PauseIcon,
  PlayIcon,
  SlidersExpandIcon,
  SlidersIcon,
  SkipBackIcon,
  SkipForwardIcon,
  TrashIcon
} from "./icons";

const speeds = [0.75, 0.9, 1, 1.25, 1.5] as const;
const translationLanguage = "zh-Hans";
const translationPreferenceKey = "show-translation";
const repeatPreferenceKey = "segment-repeat-count";
const repeatLimits = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, "infinite"] as const;
type RepeatLimit = (typeof repeatLimits)[number];
type OpenPlayerMenu = "speed" | "repeat" | "reading" | undefined;
type PlayerView = "focus" | "transcript";
type AppView = "library" | "collection" | "player";
type Lesson = CollectionLessonSummary;
type LoadedLesson = {
  course: Course;
  audio?: Blob;
  source?: string;
  isLocal: boolean;
};
type PublishedLesson = {
  course: RuntimeLesson;
  audioUrl: string;
};
type ResumePreview = {
  lesson: Lesson;
  currentTime: number;
  unavailable: boolean;
};
type TimedTextToken = {
  text: string;
  wordIndex?: number;
  weight: number;
};

const timedWordPattern = /[\p{L}\p{N}]+(?:['’\u2010-\u2015-][\p{L}\p{N}]+)*/gu;
const timedCharacterPattern = /[\p{L}\p{N}]/gu;
const timedTextTokenCache = new Map<string, TimedTextToken[]>();

function tokenizeTimedText(text: string): TimedTextToken[] {
  const cached = timedTextTokenCache.get(text);
  if (cached) return cached;
  const tokens: TimedTextToken[] = [];
  let cursor = 0;
  let wordIndex = 0;

  for (const match of text.matchAll(timedWordPattern)) {
    const index = match.index;
    if (index > cursor) tokens.push({ text: text.slice(cursor, index), weight: 0 });
    const word = match[0];
    const weight = Math.max(1, word.match(timedCharacterPattern)?.length ?? 0);
    tokens.push({ text: word, wordIndex, weight });
    wordIndex += 1;
    cursor = index + word.length;
  }
  if (cursor < text.length) tokens.push({ text: text.slice(cursor), weight: 0 });
  if (timedTextTokenCache.size >= 512) timedTextTokenCache.clear();
  timedTextTokenCache.set(text, tokens);
  return tokens;
}

function findEstimatedWordIndex(segment: Segment, currentTime: number): number {
  const words = tokenizeTimedText(segment.text).filter(
    (token): token is TimedTextToken & { wordIndex: number } => token.wordIndex !== undefined
  );
  if (words.length === 0) return -1;
  if (currentTime >= segment.end) return words.length;
  if (segment.end <= segment.start || currentTime <= segment.start) return 0;

  const progress = Math.min(1, Math.max(0, (currentTime - segment.start) / (segment.end - segment.start)));
  const totalWeight = words.reduce((total, word) => total + word.weight, 0);
  const targetWeight = progress * totalWeight;
  let cumulativeWeight = 0;
  for (const word of words) {
    cumulativeWeight += word.weight;
    if (targetWeight < cumulativeWeight) return word.wordIndex;
  }
  return words.length - 1;
}

const TimedEnglishText = memo(forwardRef<HTMLSpanElement, { text: string }>(
  function TimedEnglishText({ text }, ref) {
    const tokens = useMemo(() => tokenizeTimedText(text), [text]);
    return (
      <span className="timed-text" ref={ref}>
        {tokens.map((token, tokenIndex) => token.wordIndex === undefined
          ? token.text
          : (
            <span key={tokenIndex} className={token.wordIndex === 0 ? "timed-word current" : "timed-word future"}
              data-word-index={token.wordIndex}>{token.text}</span>
          ))}
      </span>
    );
  }
));

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

function isCourseComplete(currentTime: number, duration: number): boolean {
  return currentTime > 0 && (currentTime >= duration * 0.98 || duration - currentTime <= 10);
}

function formatDuration(value: number): string {
  const totalSeconds = Math.floor(value);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds % 3600 / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
    : `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function formatSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function validateTimeline(course: Course, actualDuration: number): void {
  if (Math.abs(course.duration - actualDuration) > 3) {
    throw new Error("字幕记录的时长与音频实际时长不一致。");
  }

  const ids = new Set<string>();
  for (let index = 0; index < course.segments.length; index += 1) {
    const segment = course.segments[index];
    if (ids.has(segment.id)) throw new Error(`字幕 ID ${segment.id} 重复。`);
    ids.add(segment.id);
    if (segment.end <= segment.start) throw new Error(`字幕 ${segment.id} 的结束时间必须大于开始时间。`);
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
    return `内容格式错误：${issue.path.join(".")} ${issue.message}`;
  }
  return error instanceof Error ? error.message : "发生了未知错误。";
}

async function fetchCatalog(): Promise<CatalogDocument> {
  const response = await fetch("/content/catalog.json");
  if (!response.ok) throw new Error("听力库目录加载失败，请检查网络连接。");
  return catalogDocumentSchema.parse(await response.json());
}

async function fetchCollection(documentKey: string, expectedId: string): Promise<CollectionDocument> {
  const response = await fetch(resolveContentSourceUrl(documentKey));
  if (!response.ok) throw new Error("系列内容加载失败，请检查网络连接。");
  const document = collectionDocumentSchema.parse(await response.json());
  if (document.id !== expectedId) throw new Error("系列内容与听力库目录不匹配。");
  return document;
}

async function fetchPublishedLesson(lesson: Lesson): Promise<PublishedLesson> {
  const response = await fetch(resolveContentSourceUrl(lesson.documentKey));
  if (!response.ok) throw new Error("字幕加载失败，请检查网络连接。");
  const document = lessonDocumentSchema.parse(await response.json());
  if (document.lesson.id !== lesson.id) throw new Error("字幕内容与听力列表不匹配。");
  const course = assembleRuntimeLesson(document);
  const rendition = document.renditions.find(({ id }) => id === document.lesson.defaultRenditionId);
  if (!rendition) throw new Error("默认英文原声音频不存在。");
  return {
    course,
    audioUrl: resolveAudioSourceUrl(rendition.audio.key, rendition.audio.sha256)
  };
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
  const lastRepeatFrameAtRef = useRef(0);
  const playerSettingsRef = useRef<HTMLDivElement>(null);
  const playerMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const activeSegmentRef = useRef<HTMLButtonElement>(null);
  const transcriptShouldCenterRef = useRef(false);
  const sessionRequestRef = useRef(0);
  const focusTimedTextRef = useRef<HTMLSpanElement>(null);
  const transcriptTimedTextRef = useRef<HTMLSpanElement>(null);
  const highlightedWordRef = useRef(-2);
  const wordSyncFrameRef = useRef(0);
  const [course, setCourse] = useState<Course>();
  const [audioUrl, setAudioUrl] = useState<string>();
  const [localPlayback, setLocalPlayback] = useState(false);
  const [downloaded, setDownloaded] = useState<Record<string, boolean>>({});
  const [downloading, setDownloading] = useState<string>();
  const [checkingDownloads, setCheckingDownloads] = useState(true);
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
  const [compactHeaderVisible, setCompactHeaderVisible] = useState(false);
  const [appView, setAppView] = useState<AppView>("library");
  const [selectedCollectionId, setSelectedCollectionId] = useState<string>();
  const [playerCollectionId, setPlayerCollectionId] = useState<string>();
  const [resumePreview, setResumePreview] = useState<ResumePreview>();
  const [resumeFromCompleted, setResumeFromCompleted] = useState(false);
  const [catalog, setCatalog] = useState<CatalogDocument>();
  const [collections, setCollections] = useState<CollectionDocument[]>([]);
  const lessons = useMemo(() => {
    const byId = new Map<string, Lesson>();
    for (const collection of collections) {
      for (const lesson of collection.lessons) {
        if (!byId.has(lesson.id)) byId.set(lesson.id, lesson);
      }
    }
    return [...byId.values()];
  }, [collections]);
  const libraryReady = Boolean(catalog) && collections.length === catalog?.collections.length;

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

  async function loadLessonResources(lesson: Lesson): Promise<LoadedLesson> {
    const saved = await loadCourse(lesson.id);
    const audio = saved ? await loadAudio(lesson.id) : undefined;
    if (saved && audio) {
      let localCourse = saved;
      if (translationCount(saved) < saved.segments.length) {
        try {
          const published = await fetchPublishedLesson(lesson);
          const latestCourse = { ...published.course, duration: saved.duration };
          if (translationCount(latestCourse) > translationCount(saved)
            || (latestCourse.revision ?? 0) > (saved.revision ?? 0)) {
            localCourse = (await saveCourseMetadata(latestCourse)) ?? saved;
          }
        } catch {
          // Old downloaded courses must remain playable when offline.
        }
      }
      return { course: localCourse, audio, isLocal: true };
    }

    const published = await fetchPublishedLesson(lesson);
    return {
      course: published.course,
      source: published.audioUrl,
      isLocal: false
    };
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

  function completeRepeatIteration(audio: HTMLAudioElement, resumeImmediately = false) {
    const target = loopSegmentRef.current;
    if (!course || target === undefined || repeatSwitchingRef.current) return;

    const segment = course.segments[target];
    if (audio.currentTime < Math.min(course.duration, segment.end + 0.2)) return;

    repeatSwitchingRef.current = true;
    const limit = repeatLimitRef.current;
    const iteration = repeatIterationRef.current;
    const isComplete = limit !== "infinite" && iteration >= limit;

    if (isComplete && target === course.segments.length - 1) {
      audio.pause();
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
      if (audio.paused) void audio.play();
    };

    if (resumeImmediately) {
      resume();
    } else {
      audio.pause();
      repeatTimerRef.current = window.setTimeout(resume, 300);
    }
  }

  useEffect(() => {
    let cancelled = false;
    const loadLibrary = async () => {
      const nextCatalog = await fetchCatalog();
      const nextCollections = await Promise.all(nextCatalog.collections.map((collection) =>
        fetchCollection(collection.documentKey, collection.id)
      ));
      if (cancelled) return;
      setCatalog(nextCatalog);
      setCollections(nextCollections);
    };
    loadLibrary().catch((libraryError) => {
      if (!cancelled) {
        setError(messageFromError(libraryError));
        setCheckingDownloads(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!libraryReady) return;
    let cancelled = false;
    setCheckingDownloads(true);
    refreshDownloadedCourses()
      .catch((restoreError) => !cancelled && setError(messageFromError(restoreError)))
      .finally(() => !cancelled && setCheckingDownloads(false));
    return () => {
      cancelled = true;
    };
  }, [libraryReady, lessons]);

  useEffect(() => () => {
      clearRepeatTimer();
      cancelAnimationFrame(wordSyncFrameRef.current);
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
  }, []);

  useEffect(() => {
    if (!libraryReady) return;
    let cancelled = false;
    const requestId = ++sessionRequestRef.current;

    const restoreLastSession = async () => {
      const lastPlayed = await loadLastPlayed();
      if (!lastPlayed || cancelled || requestId !== sessionRequestRef.current) return;

      const progress = await loadProgress(lastPlayed.courseId);
      if (cancelled || requestId !== sessionRequestRef.current) return;
      const lesson = lessons.find((item) => item.id === lastPlayed.courseId);
      const previewTime = Number.isFinite(progress?.currentTime) ? Math.max(0, progress?.currentTime ?? 0) : 0;

      try {
        let loaded: LoadedLesson | undefined;
        if (lesson) {
          loaded = await loadLessonResources(lesson);
        } else {
          const [saved, audio] = await Promise.all([
            loadCourse(lastPlayed.courseId),
            loadAudio(lastPlayed.courseId)
          ]);
          if (saved && audio) loaded = { course: saved, audio, isLocal: true };
        }

        if (!loaded) {
          if (!cancelled && requestId === sessionRequestRef.current) await clearLastPlayed();
          return;
        }
        if (cancelled || requestId !== sessionRequestRef.current) return;

        const source = loaded.audio ? replaceObjectUrl(loaded.audio)! : replaceObjectUrl() ?? loaded.source!;
        const shown = await showCourse(loaded.course, source, loaded.isLocal, {
          view: "library",
          remember: false,
          progress,
          requestId
        });
        if (shown && lesson) {
          setResumePreview({ lesson, currentTime: restoreTime.current, unavailable: false });
        }
      } catch {
        if (cancelled || requestId !== sessionRequestRef.current || !lesson) return;
        setResumePreview({ lesson, currentTime: previewTime, unavailable: true });
      }
    };

    void restoreLastSession();
    return () => {
      cancelled = true;
    };
  }, [libraryReady, lessons]);

  useEffect(() => {
    if (loopSegment === undefined || !course) return;
    let frame = 0;
    const monitor = () => {
      lastRepeatFrameAtRef.current = Date.now();
      const audio = audioRef.current;
      if (audio && !document.hidden) completeRepeatIteration(audio);
      frame = requestAnimationFrame(monitor);
    };
    lastRepeatFrameAtRef.current = Date.now();
    frame = requestAnimationFrame(monitor);
    return () => {
      cancelAnimationFrame(frame);
      lastRepeatFrameAtRef.current = 0;
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

  useEffect(() => {
    if (!course || appView !== "player") return;
    let frame = 0;
    let force = true;
    const update = () => {
      const audio = audioRef.current;
      const time = audio && audio.readyState > 0 ? audio.currentTime : restoreTime.current;
      const segmentIndex = loopSegmentRef.current ?? findSegmentIndex(course.segments, time);
      if (segmentIndex !== currentSegment) {
        setCurrentSegment(segmentIndex);
      } else {
        applyEstimatedWordHighlight(course.segments[segmentIndex], time, force);
        force = false;
      }
      if (audio && !audio.paused) frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [appView, course, currentSegment, playerView, playing]);

  useEffect(() => {
    setCompactHeaderVisible(false);
    if (!course || appView !== "player") return;

    let lastScrollY = window.scrollY;
    let direction = 0;
    let distance = 0;
    let userInputUntil = 0;
    const markUserScroll = () => {
      userInputUntil = performance.now() + 600;
    };
    const markKeyboardScroll = (event: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) {
        markUserScroll();
      }
    };
    const handleScroll = () => {
      const nextScrollY = Math.max(0, window.scrollY);
      const delta = nextScrollY - lastScrollY;
      lastScrollY = nextScrollY;

      if (nextScrollY <= 80) {
        direction = 0;
        distance = 0;
        setCompactHeaderVisible(false);
        return;
      }
      if (performance.now() > userInputUntil || delta === 0) {
        direction = 0;
        distance = 0;
        return;
      }

      const nextDirection = Math.sign(delta);
      if (nextDirection !== direction) {
        direction = nextDirection;
        distance = 0;
      }
      distance += Math.abs(delta);
      if (direction < 0 && distance >= 12) {
        setCompactHeaderVisible(true);
        distance = 0;
      } else if (direction > 0 && distance >= 16) {
        setCompactHeaderVisible(false);
        distance = 0;
      }
    };

    window.addEventListener("wheel", markUserScroll, { passive: true });
    window.addEventListener("touchmove", markUserScroll, { passive: true });
    window.addEventListener("keydown", markKeyboardScroll);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("wheel", markUserScroll);
      window.removeEventListener("touchmove", markUserScroll);
      window.removeEventListener("keydown", markKeyboardScroll);
      window.removeEventListener("scroll", handleScroll);
    };
  }, [appView, course?.id]);

  async function showCourse(
    nextCourse: Course,
    source: string,
    isLocal: boolean,
    options: {
      view?: AppView;
      remember?: boolean;
      progress?: SavedProgress;
      requestId?: number;
    } = {}
  ): Promise<boolean> {
    const progress = options.progress ?? await loadProgress(nextCourse.id);
    if (options.requestId !== undefined && options.requestId !== sessionRequestRef.current) return false;
    const savedTime = Number.isFinite(progress?.currentTime) ? Math.max(0, progress?.currentTime ?? 0) : 0;
    const savedRate = progress && speeds.some((value) => value === progress.playbackRate)
      ? progress.playbackRate
      : 1;
    const completed = isCourseComplete(savedTime, nextCourse.duration);
    restoreTime.current = completed ? 0 : Math.min(savedTime, nextCourse.duration);
    setSpeed(savedRate);
    setCurrentTime(restoreTime.current);
    setCurrentSegment(findSegmentIndex(nextCourse.segments, restoreTime.current));
    setResumeFromCompleted(completed);
    resetRepeatTransition();
    updateLoopSegment(undefined);
    updateRepeatIteration(1);
    setOpenPlayerMenu(undefined);
    setPlayerView("focus");
    setFollowingTranscript(true);
    setLocalPlayback(isLocal);
    setCourse(nextCourse);
    setAudioUrl(source);
    setPlaying(false);
    setAppView(options.view ?? "player");
    if (options.remember !== false) void saveLastPlayed(nextCourse.id);
    if ((options.view ?? "player") === "player") window.scrollTo({ top: 0, behavior: "auto" });
    return true;
  }

  async function openLesson(lesson: Lesson, silentFailure = false, collectionId = selectedCollectionId) {
    if (busy || downloading) return;
    if (course?.id === lesson.id && audioUrl) {
      void saveLastPlayed(lesson.id);
      setOpenPlayerMenu(undefined);
      setPlayerCollectionId(collectionId);
      setAppView("player");
      window.scrollTo({ top: 0, behavior: "auto" });
      return;
    }
    const requestId = ++sessionRequestRef.current;
    const currentAudio = audioRef.current;
    if (currentAudio && course) {
      currentAudio.pause();
      saveCurrentProgress(currentAudio.currentTime, currentAudio.playbackRate);
    }
    setBusy(true);
    setError("");
    try {
      const loaded = await loadLessonResources(lesson);
      if (requestId !== sessionRequestRef.current) return;
      const source = loaded.audio ? replaceObjectUrl(loaded.audio)! : replaceObjectUrl() ?? loaded.source!;
      const shown = await showCourse(loaded.course, source, loaded.isLocal, { requestId });
      if (shown) {
        setPlayerCollectionId(collectionId);
        setResumePreview({ lesson, currentTime: restoreTime.current, unavailable: false });
      }
    } catch (openError) {
      if (requestId === sessionRequestRef.current) {
        if (silentFailure) {
          const progress = await loadProgress(lesson.id);
          setResumePreview({
            lesson,
            currentTime: Number.isFinite(progress?.currentTime) ? Math.max(0, progress?.currentTime ?? 0) : 0,
            unavailable: true
          });
        } else {
          setError(messageFromError(openError));
        }
      }
    } finally {
      if (requestId === sessionRequestRef.current) setBusy(false);
    }
  }

  async function downloadLesson(lesson: Lesson) {
    if (downloading) return;
    setDownloading(lesson.id);
    setError("");
    try {
      const published = await fetchPublishedLesson(lesson);
      const audioResponse = await fetch(published.audioUrl);
      if (!audioResponse.ok) throw new Error("音频下载失败，请检查网络连接或存储空间。");
      const audio = await audioResponse.blob();
      const duration = await readAudioDuration(audio);
      validateTimeline(published.course, duration);
      await saveCourse({ ...published.course, duration }, audio);
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
    scheduleEstimatedWordHighlight(course.segments[nextSegment], audio.currentTime);
    if (loopSegmentRef.current !== undefined) {
      updateLoopSegment(nextSegment);
      updateRepeatIteration(1);
    }
    saveCurrentProgress(audio.currentTime, audio.playbackRate);
  }

  function seekToSegment(index: number, autoplay = true) {
    if (!course) return;
    const next = Math.max(0, Math.min(index, course.segments.length - 1));
    // Manual sentence navigation starts at the exact boundary. The 150ms
    // pre-roll belongs to repeat transitions; using it here briefly makes
    // the generic seek path identify the previous sentence.
    seekTo(course.segments[next].start);
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

  function applyEstimatedWordHighlight(segment: Segment, time: number, force = false) {
    const wordIndex = findEstimatedWordIndex(segment, time);
    if (!force && highlightedWordRef.current === wordIndex) return;
    highlightedWordRef.current = wordIndex;

    for (const container of [focusTimedTextRef.current, transcriptTimedTextRef.current]) {
      if (!container) continue;
      for (const word of container.querySelectorAll<HTMLElement>(".timed-word")) {
        const index = Number(word.dataset.wordIndex);
        word.classList.toggle("past", index < wordIndex);
        word.classList.toggle("current", index === wordIndex);
        word.classList.toggle("future", index > wordIndex);
      }
    }
  }

  function scheduleEstimatedWordHighlight(segment: Segment, time: number) {
    cancelAnimationFrame(wordSyncFrameRef.current);
    wordSyncFrameRef.current = requestAnimationFrame(() => {
      wordSyncFrameRef.current = 0;
      applyEstimatedWordHighlight(segment, time, true);
    });
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
    setResumeFromCompleted(false);
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
      saveCurrentProgress(audio.currentTime, audio.playbackRate);
    }
    setOpenPlayerMenu(undefined);
    setCompactHeaderVisible(false);
    if (playerCollectionId && collections.some(({ id }) => id === playerCollectionId)) {
      setSelectedCollectionId(playerCollectionId);
      setAppView("collection");
    } else {
      setAppView("library");
    }
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function openCurrentCourse() {
    if (course) void saveLastPlayed(course.id);
    setOpenPlayerMenu(undefined);
    setAppView("player");
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function openResumeCourse() {
    if (course && audioUrl) {
      openCurrentCourse();
      return;
    }
    if (resumePreview) void openLesson(resumePreview.lesson, true);
  }

  async function removeCurrentCourse() {
    if (!course) return;
    ++sessionRequestRef.current;
    const audio = audioRef.current;
    const savedTime = audio?.currentTime ?? currentTime;
    audio?.pause();
    const catalogLesson = lessons.find((lesson) => lesson.id === course.id);
    await deleteCourse(course.id, Boolean(catalogLesson));
    if (!catalogLesson) await clearLastPlayed();
    setDownloaded((current) => ({ ...current, [course.id]: false }));
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
    setResumeFromCompleted(false);
    setResumePreview(catalogLesson
      ? { lesson: catalogLesson, currentTime: savedTime, unavailable: !navigator.onLine }
      : undefined);
    setAppView(playerCollectionId ? "collection" : "library");
    window.scrollTo({ top: 0, behavior: "auto" });
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
          <span className="segment-english">
            {index === currentSegment
              ? <TimedEnglishText ref={transcriptTimedTextRef} text={segment.text} />
              : segment.text}
          </span>
          {showTranslation && segment.translations?.[translationLanguage] && (
            <span className="segment-translation">{segment.translations[translationLanguage]}</span>
          )}
        </span>
      </button>
    ));
  }, [course, currentSegment, showTranslation]);

  const activeCourse = course;
  const activeAudioUrl = audioUrl;
  const sharedAudio = activeCourse && activeAudioUrl ? (
    <audio ref={audioRef} src={activeAudioUrl} preload="metadata"
      onLoadedMetadata={(event) => {
        event.currentTarget.playbackRate = speed;
        event.currentTarget.currentTime = Math.min(restoreTime.current, activeCourse.duration);
        setCurrentTime(event.currentTarget.currentTime);
        const segmentIndex = findSegmentIndex(activeCourse.segments, event.currentTarget.currentTime);
        setCurrentSegment(segmentIndex);
        scheduleEstimatedWordHighlight(activeCourse.segments[segmentIndex], event.currentTarget.currentTime);
      }}
      onPlay={(event) => handlePlay(event.currentTarget)}
      onPause={(event) => {
        setPlaying(false);
        saveCurrentProgress(event.currentTarget.currentTime, event.currentTarget.playbackRate);
      }}
      onTimeUpdate={(event) => {
        let time = event.currentTarget.currentTime;
        const frameInactive = Date.now() - lastRepeatFrameAtRef.current > 500;
        completeRepeatIteration(event.currentTarget, document.hidden || frameInactive);
        time = event.currentTarget.currentTime;
        setCurrentTime(time);
        const index = loopSegmentRef.current ?? findSegmentIndex(activeCourse.segments, time);
        setCurrentSegment((current) => current === index ? current : index);
        if (Date.now() - lastSavedAt.current > 5000) {
          lastSavedAt.current = Date.now();
          saveCurrentProgress(time, event.currentTarget.playbackRate);
        }
      }}
      onError={() => {
        const lesson = lessons.find((item) => item.id === activeCourse.id);
        if (appView === "library" && !playing && lesson) {
          setResumePreview({ lesson, currentTime, unavailable: true });
          setCourse(undefined);
          setAudioUrl(undefined);
          replaceObjectUrl();
          return;
        }
        setError("浏览器无法播放音频；如果当前离线，请先下载。");
      }}
    />
  ) : null;

  if (!libraryReady) {
    return (
      <main className="center-card catalog-loading">
        <span className="library-mark" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>
        <h1>英语精听</h1>
        {error
          ? <p className="error" role="alert">{error}</p>
          : <p className="intro" role="status">正在加载听力库…</p>}
      </main>
    );
  }

  if (appView !== "player" || !course || !audioUrl) {
    const selectedCollection = collections.find(({ id }) => id === selectedCollectionId);
    const collectionLessons = selectedCollection?.lessons ?? [];
    const quantityLabels = {
      course: "课",
      podcast: "集",
      album: "首",
      book: "章",
      curated: "项",
      series: "项"
    } as const;
    const courseCollections = collections.filter(({ kind }) => kind === "course");
    const podcastCollections = collections.filter(({ kind }) => kind === "podcast");
    const lessonCount = lessons.length;
    const miniSegment = course?.segments[currentSegment];
    const resumeLesson = course ? lessons.find((lesson) => lesson.id === course.id) : resumePreview?.lesson;
    const resumeDuration = course?.duration ?? resumeLesson?.duration;
    const resumeTime = course ? currentTime : resumePreview?.currentTime ?? 0;
    const resumeComplete = resumeFromCompleted
      || (resumeDuration !== undefined && isCourseComplete(resumeTime, resumeDuration));
    const resumeTitle = course?.title ?? resumeLesson?.title;
    const resumeSentence = course?.segments[currentSegment]?.text;
    const resumeUnavailable = !course || !audioUrl ? resumePreview?.unavailable ?? true : false;
    const resumeProgress = resumeDuration
      ? Math.min(100, Math.max(0, (resumeComplete ? 0 : resumeTime) / resumeDuration * 100))
      : 0;
    return (
      <>
      {sharedAudio}
      <main className={resumeTitle ? "center-card course-home has-mini-player" : "center-card course-home"}>
        {appView === "collection" && selectedCollection ? (
          <>
            <header className="course-home-header collection-header">
              <button className="library-back" onClick={() => {
                setAppView("library");
                window.scrollTo({ top: 0, behavior: "auto" });
              }}><ArrowLeftIcon />返回听力库</button>
              <h1>{selectedCollection.title}</h1>
              <p className="intro">{selectedCollection.subtitle ?? (selectedCollection.kind === "podcast" ? "Podcast" : "课程")}</p>
            </header>
            <section className="course-list collection-list" aria-label={`${selectedCollection.title}内容`}>
              {collectionLessons.map((lesson) => {
                const isDownloading = downloading === lesson.id;
                const isDownloaded = downloaded[lesson.id];
                return (
                  <div className="course-row" key={lesson.id}>
                    <button className="course-open" onClick={() => void openLesson(lesson, false, selectedCollection.id)}
                      disabled={busy || Boolean(downloading)}>
                      <span className="course-copy">
                        <strong>{lesson.title}</strong>
                        <span>{formatDuration(lesson.duration)} · 英文原声{lesson.availableLanguages.includes("zh-Hans") ? " · 中文译文" : ""} · {formatSize(lesson.byteLength)}</span>
                      </span>
                    </button>
                    <button
                      className={isDownloaded ? "download downloaded" : "download"}
                      disabled={checkingDownloads || isDownloading || isDownloaded}
                      onClick={() => void downloadLesson(lesson)}
                    >
                      {checkingDownloads || isDownloading
                        ? <LoaderIcon className="button-icon loading-icon" />
                        : isDownloaded
                          ? <CheckIcon className="button-icon" />
                          : <DownloadIcon className="button-icon" />}
                      <span>{checkingDownloads ? "检查中…" : isDownloading ? "下载中…" : isDownloaded ? "已下载" : "下载"}</span>
                    </button>
                  </div>
                );
              })}
            </section>
          </>
        ) : (
          <>
            <header className="course-home-header library-hero">
              <div className="library-hero-title">
                <span className="library-mark" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
                <div>
                  <p className="library-eyebrow">听力资源库</p>
                  <h1>英语精听</h1>
                </div>
              </div>
              <p className="intro">选择一个系列，从一句听懂开始。</p>
              <div className="library-stats" aria-label={`${collections.length} 个系列，共 ${lessonCount} 份内容`}>
                <span><strong>{collections.length}</strong> 个系列</span>
                <i aria-hidden="true" />
                <span><strong>{lessonCount}</strong> 份内容</span>
              </div>
            </header>
            <section className="collection-shelves" aria-label="听力库">
              <div className="collection-shelf">
                <div className="collection-shelf-header">
                  <div>
                    <span>循序渐进</span>
                    <h2>系统课程</h2>
                  </div>
                  <small>{courseCollections.length} 个系列</small>
                </div>
                <div className="collection-grid">
                  {courseCollections.map((collection, index) => (
                    <button className="collection-card collection-card-course" key={collection.id} onClick={() => {
                      setSelectedCollectionId(collection.id);
                      setAppView("collection");
                      window.scrollTo({ top: 0, behavior: "auto" });
                    }}>
                      <span className="collection-card-meta">
                        <span className="collection-card-index">第 {String(index + 1).padStart(2, "0")} 册</span>
                        <span className="collection-card-arrow" aria-hidden="true">→</span>
                      </span>
                      <span className="collection-card-copy">
                        <strong>{collection.title}</strong>
                        {collection.subtitle && <span>{collection.subtitle}</span>}
                      </span>
                      <small>{collection.lessons.length} {quantityLabels[collection.kind]}</small>
                    </button>
                  ))}
                </div>
              </div>
              <div className="collection-shelf">
                <div className="collection-shelf-header">
                  <div>
                    <span>真实语境</span>
                    <h2>精选播客</h2>
                  </div>
                  <small>{podcastCollections.length} 个系列</small>
                </div>
                <div className="collection-grid">
                  {podcastCollections.map((collection) => (
                    <button className="collection-card collection-card-podcast" key={collection.id} onClick={() => {
                      setSelectedCollectionId(collection.id);
                      setAppView("collection");
                      window.scrollTo({ top: 0, behavior: "auto" });
                    }}>
                      <span className="collection-card-meta">
                        <span className="collection-card-index">PODCAST</span>
                        <span className="collection-card-arrow" aria-hidden="true">→</span>
                      </span>
                      <span className="collection-card-copy">
                        <strong>{collection.title}</strong>
                        <span>{collection.subtitle ?? "英文访谈"}</span>
                      </span>
                      <small>{collection.lessons.length} {quantityLabels[collection.kind]}</small>
                    </button>
                  ))}
                </div>
              </div>
            </section>
          </>
        )}

        {error && <p className="error" role="alert">{error}</p>}
      </main>
      {resumeTitle && (
        <section className={resumeUnavailable ? "mini-player unavailable" : "mini-player"} aria-label="迷你播放器">
          <div className="mini-player-progress" aria-hidden="true">
            <span style={{ width: `${resumeProgress}%` }} />
          </div>
          <div className="mini-player-inner">
            <button className="mini-now-playing" onClick={openResumeCourse} disabled={busy}
              aria-label={`${resumeUnavailable ? "恢复上次播放" : "打开正在播放"}：${resumeTitle}`}>
              <strong>{resumeTitle}</strong>
              <span>{resumeUnavailable ? "连接网络后继续" : resumeSentence ?? miniSegment?.text}</span>
            </button>
            <button className="mini-control mini-play" onClick={togglePlayback}
              disabled={!course || !audioUrl || busy}
              aria-label={resumeUnavailable ? "连接网络后继续" : playing ? "暂停" : "播放"}>
              {playing ? <PauseIcon /> : <PlayIcon />}
            </button>
            <button className="mini-control" disabled={!course || !audioUrl || busy}
              onClick={() => seekToSegment(currentSegment + 1)} aria-label="下一句">
              <SkipForwardIcon />
            </button>
          </div>
        </section>
      )}
      </>
    );
  }

  const activeSegment = course.segments[currentSegment];
  const availableTranslations = translationCount(course);
  const activeTranslation = activeSegment.translations?.[translationLanguage];
  return (
    <>
    {sharedAudio}
    <main className={playerSettingsExpanded ? "player-page" : "player-page settings-collapsed"}>
      <div className={compactHeaderVisible ? "compact-player-header visible" : "compact-player-header"}
        aria-hidden={!compactHeaderVisible}>
        <div className="compact-player-header-inner">
          <button className="back" aria-label="返回听力库" title="返回听力库" disabled={!compactHeaderVisible}
            tabIndex={compactHeaderVisible ? 0 : -1}
            onClick={returnToCourses}>
            <ArrowLeftIcon />
          </button>
          <span className="compact-header-divider" aria-hidden="true" />
          <div className="compact-view-switch" role="group" aria-label="阅读视图">
            <button aria-label="单句视图" title="单句" aria-pressed={playerView === "focus"}
              disabled={!compactHeaderVisible} tabIndex={compactHeaderVisible ? 0 : -1}
              onClick={() => changePlayerView("focus")}>单句</button>
            <button aria-label="全文视图" title="全文" aria-pressed={playerView === "transcript"}
              disabled={!compactHeaderVisible} tabIndex={compactHeaderVisible ? 0 : -1}
              onClick={() => changePlayerView("transcript")}>全文</button>
          </div>
          <strong title={course.title}>{course.title}</strong>
        </div>
      </div>
      <header className="player-header">
        <div className="player-topbar">
          <button className="back" aria-label="返回听力库" title="返回听力库" onClick={returnToCourses}>
            <ArrowLeftIcon />
          </button>
          {localPlayback && <button className="delete" onClick={() => void removeCurrentCourse()}><TrashIcon className="button-icon" />删除下载</button>}
        </div>
        <h1>{course.title}</h1>
      </header>

      <div className="player-view-switch" role="group" aria-label="阅读视图">
        <button aria-pressed={playerView === "focus"} onClick={() => changePlayerView("focus")}>单句</button>
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
          <section className="focus-sentence" aria-live="polite" key={currentSegment}>
            <div className="focus-meta">
              <span className="focus-index">{currentSegment + 1} / {course.segments.length}</span>
              {activeSegment.speaker && <><span className="focus-separator">·</span><span className="focus-speaker">{activeSegment.speaker}</span></>}
            </div>
            <p className="focus-english">
              <TimedEnglishText ref={focusTimedTextRef} text={activeSegment.text} />
            </p>
            {showTranslation && activeTranslation && <p className="focus-translation">{activeTranslation}</p>}
          </section>
        ) : (
          <>
            <section className="transcript" aria-label="完整字幕">{transcriptContent}</section>
            {!followingTranscript && (
              <button className="follow-transcript" onClick={resumeTranscriptFollowing}><LocateIcon className="button-icon" />回到当前句</button>
            )}
          </>
        )}
      </div>
      {error && <p className="error" role="alert">{error}</p>}

      <section className="controls" aria-label="播放器控制">
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
                  onClick={() => changeSpeed(value)}><span className="icon-slot">{speed === value && <CheckIcon />}</span>{value}×</button>)}
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
                    onClick={() => selectRepeatLimit(value)}>{repeatLimit === value && <CheckIcon />}{value}</button>)}
                </div>
                <button role="menuitemradio" aria-checked={repeatLimit === "infinite"}
                  className={repeatLimit === "infinite" ? "menu-option selected" : "menu-option"}
                  onClick={() => selectRepeatLimit("infinite")}>
                  <span className="icon-slot">{repeatLimit === "infinite" && <CheckIcon />}</span>∞ 无限循环
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
                  onClick={() => { if (!showTranslation) toggleTranslation(); else closePlayerMenu(); }}><span className="icon-slot">{showTranslation && <CheckIcon />}</span>中英双语</button>
                <button role="menuitemradio" aria-checked={!showTranslation} className={!showTranslation ? "menu-option selected" : "menu-option"}
                  onClick={() => { if (showTranslation) toggleTranslation(); else closePlayerMenu(); }}><span className="icon-slot">{!showTranslation && <CheckIcon />}</span>仅英文</button>
              </div>
            )}
          </div>
        </div>
        <div className="player-progress">
          <input className="timeline" type="range" min="0" max={course.duration} step="0.05" value={currentTime}
            style={{ "--timeline-progress": `${Math.min(100, Math.max(0, currentTime / course.duration * 100))}%` } as CSSProperties}
            aria-label="播放进度" onChange={(event) => seekTo(Number(event.target.value))} />
          <div className="time-row"><span>{formatTime(currentTime)}</span><span>{formatTime(course.duration)}</span></div>
        </div>
        <div className="main-controls">
          <button className="settings-toggle" aria-expanded={playerSettingsExpanded}
            aria-controls="player-settings" aria-label={playerSettingsExpanded ? "收起播放设置" : "展开播放设置"}
            onClick={togglePlayerSettings}>
            {playerSettingsExpanded ? <SlidersIcon /> : <SlidersExpandIcon />}
          </button>
          <button onClick={() => seekToSegment(currentSegment - 1)} aria-label="上一句"><SkipBackIcon /></button>
          <button className="play" onClick={togglePlayback}
            aria-label={playing ? "暂停" : "播放"}>{playing ? <PauseIcon /> : <PlayIcon />}</button>
          <button onClick={() => seekToSegment(currentSegment + 1)} aria-label="下一句"><SkipForwardIcon /></button>
          <span className="main-controls-spacer" aria-hidden="true" />
        </div>
      </section>
    </main>
    </>
  );
}
