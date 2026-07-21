import { useEffect, useRef, useState } from "react";
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
    audioUrl: "https://media.blubrry.com/takeituneasy/content.blubrry.com/takeituneasy/lex_ai_demis_hassabis_2.mp3",
    transcriptUrl: "/samples/lex-475-demis-hassabis-2.json"
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
    language: z.string().min(1).optional(),
    source: z.object({
      publisher: z.string().min(1),
      episodeNumber: z.number().int().positive().optional(),
      episodeUrl: z.url(),
      transcriptUrl: z.url(),
      audioUrl: z.url(),
      publishedAt: z.string().min(1).optional(),
      rightsStatus: z.enum(["unverified", "approved", "private-only"]),
      transcriptSha256: z.string().regex(/^[a-f0-9]{64}$/).optional()
    }).optional()
  }),
  segments: z.array(z.object({
    id: z.string().min(1),
    start: z.number().nonnegative(),
    end: z.number().positive(),
    text: z.string().min(1),
    translations: z.record(z.string(), z.string().min(1)).optional(),
    speaker: z.string().min(1).optional(),
    timingQuality: z.enum(["official", "aligned", "estimated"]).optional(),
    sourceSegmentId: z.string().min(1).optional()
  })).min(1)
});

type TranscriptInput = z.infer<typeof transcriptSchema>;
const speeds = [0.75, 0.9, 1, 1.25, 1.5] as const;
const translationLanguage = "zh-Hans";
const translationPreferenceKey = "show-translation";

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
    language: input.course.language,
    source: input.course.source,
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

  useEffect(() => {
    let cancelled = false;
    refreshDownloadedCourses()
      .catch((restoreError) => !cancelled && setError(messageFromError(restoreError)))
      .finally(() => !cancelled && setCheckingDownloads(false));
    return () => {
      cancelled = true;
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    };
  }, []);

  useEffect(() => {
    if (loopSegment === undefined || !course) return;
    let frame = 0;
    let timer = 0;
    let waiting = false;
    const monitor = () => {
      const audio = audioRef.current;
      const segment = course.segments[loopSegment];
      if (audio && !document.hidden && !waiting && audio.currentTime >= Math.min(course.duration, segment.end + 0.2)) {
        waiting = true;
        audio.pause();
        timer = window.setTimeout(() => {
          audio.currentTime = Math.max(0, segment.start - 0.15);
          void audio.play();
          waiting = false;
        }, 300);
      }
      frame = requestAnimationFrame(monitor);
    };
    frame = requestAnimationFrame(monitor);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
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

  async function showCourse(nextCourse: Course, source: string, isLocal: boolean) {
    const progress = await loadProgress(nextCourse.id);
    restoreTime.current = progress?.currentTime ?? 0;
    setSpeed(progress?.playbackRate ?? 1);
    setCurrentTime(restoreTime.current);
    setCurrentSegment(findSegmentIndex(nextCourse.segments, restoreTime.current));
    setLoopSegment(undefined);
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
            if (translationCount(latestCourse) > translationCount(saved)) {
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
    audio.currentTime = Math.max(0, Math.min(value, course.duration));
    setCurrentTime(audio.currentTime);
    setCurrentSegment(findSegmentIndex(course.segments, audio.currentTime));
    saveCurrentProgress(audio.currentTime, audio.playbackRate);
  }

  function seekToSegment(index: number, autoplay = true) {
    if (!course) return;
    const next = Math.max(0, Math.min(index, course.segments.length - 1));
    setCurrentSegment(next);
    setLoopSegment((current) => current === undefined ? undefined : next);
    seekTo(Math.max(0, course.segments[next].start - 0.15));
    if (autoplay) void audioRef.current?.play();
  }

  function changeSpeed(value: number) {
    const audio = audioRef.current;
    if (audio) audio.playbackRate = value;
    setSpeed(value);
    saveCurrentProgress(audio?.currentTime ?? currentTime, value);
  }

  function toggleTranslation() {
    const nextValue = !showTranslation;
    setShowTranslation(nextValue);
    try {
      localStorage.setItem(translationPreferenceKey, String(nextValue));
    } catch {
      // The display preference can remain in React state when storage is unavailable.
    }
  }

  function returnToCourses() {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      saveCurrentProgress(audio.currentTime, audio.playbackRate);
    }
    replaceObjectUrl();
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
    <main className="player-page">
      <header>
        <button className="back" onClick={returnToCourses}>← 返回课程</button>
        <div className="brand">LISTEN / 0005</div>
        <h1>{course.title}</h1>
        {course.source && (
          <p className="source-note">
            来源：<a href={course.source.episodeUrl} target="_blank" rel="noreferrer">{course.source.publisher}</a>
            {` · 版权状态：${course.source.rightsStatus}`}
          </p>
        )}
        <div className="time-row"><span>{formatTime(currentTime)}</span><span>{formatTime(course.duration)}</span></div>
        <input className="timeline" type="range" min="0" max={course.duration} step="0.05" value={currentTime}
          aria-label="播放进度" onChange={(event) => seekTo(Number(event.target.value))} />
      </header>

      <section className="focus-sentence" aria-live="polite">
        <span>当前句 · {currentSegment + 1}/{course.segments.length}</span>
        {activeSegment.speaker && <span>{activeSegment.speaker}</span>}
        <p className="focus-english">{activeSegment.text}</p>
        {showTranslation && activeTranslation && <p className="focus-translation">{activeTranslation}</p>}
      </section>
      <section className="transcript" aria-label="完整字幕">
        {course.segments.map((segment, index) => (
          <button key={segment.id} className={index === currentSegment ? "segment active" : "segment"}
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
        ))}
      </section>
      {error && <p className="error" role="alert">{error}</p>}

      <section className="controls" aria-label="播放器控制">
        <audio ref={audioRef} src={audioUrl} preload="metadata"
          onLoadedMetadata={(event) => {
            event.currentTarget.playbackRate = speed;
            event.currentTarget.currentTime = Math.min(restoreTime.current, course.duration);
            setCurrentTime(event.currentTarget.currentTime);
            setCurrentSegment(findSegmentIndex(course.segments, event.currentTarget.currentTime));
          }}
          onPlay={() => setPlaying(true)}
          onPause={(event) => {
            setPlaying(false);
            saveCurrentProgress(event.currentTarget.currentTime, event.currentTarget.playbackRate);
          }}
          onTimeUpdate={(event) => {
            let time = event.currentTarget.currentTime;
            if (loopSegment !== undefined && document.hidden) {
              const segment = course.segments[loopSegment];
              if (time >= Math.min(course.duration, segment.end + 0.2)) {
                time = Math.max(0, segment.start - 0.15);
                event.currentTarget.currentTime = time;
              }
            }
            setCurrentTime(time);
            const index = loopSegment ?? findSegmentIndex(course.segments, time);
            setCurrentSegment((current) => current === index ? current : index);
            if (Date.now() - lastSavedAt.current > 5000) {
              lastSavedAt.current = Date.now();
              saveCurrentProgress(time, event.currentTarget.playbackRate);
            }
          }}
          onError={() => setError("浏览器无法播放课程音频；如果当前离线，请先下载课程。")}
        />
        <div className="speed-row">
          {speeds.map((value) => <button key={value} className={speed === value ? "selected" : ""}
            onClick={() => changeSpeed(value)}>{value}×</button>)}
        </div>
        <div className="main-controls">
          <button onClick={() => seekTo(currentTime - 5)} aria-label="后退五秒">−5s</button>
          <button onClick={() => seekToSegment(currentSegment - 1)} aria-label="上一句">‹</button>
          <button className="play" onClick={() => playing ? audioRef.current?.pause() : void audioRef.current?.play()}
            aria-label={playing ? "暂停" : "播放"}>{playing ? "Ⅱ" : "▶"}</button>
          <button onClick={() => seekToSegment(currentSegment + 1)} aria-label="下一句">›</button>
          <button onClick={() => seekTo(currentTime + 5)} aria-label="前进五秒">+5s</button>
        </div>
        <div className="control-footer">
          <button className={loopSegment !== undefined ? "loop active-loop" : "loop"}
            onClick={() => setLoopSegment((value) => value === undefined ? currentSegment : undefined)}>↻ 当前句</button>
          <button
            className={showTranslation && availableTranslations > 0 ? "translation-toggle enabled" : "translation-toggle"}
            disabled={availableTranslations === 0}
            aria-pressed={availableTranslations > 0 ? showTranslation : undefined}
            onClick={toggleTranslation}
          >
            {availableTranslations === 0 ? "暂无中文" : showTranslation ? "中文 开" : "中文 关"}
          </button>
          {localPlayback && <button className="delete" onClick={() => void removeCurrentCourse()}>删除本地课程</button>}
        </div>
      </section>
    </main>
  );
}
