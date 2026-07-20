import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  deleteCourse,
  loadAudio,
  loadCourse,
  loadProgress,
  saveCourse,
  saveProgress,
  type Course,
  type Segment
} from "./db";

const transcriptSchema = z.object({
  version: z.literal(1),
  course: z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    audioFilename: z.string().min(1),
    duration: z.number().positive()
  }),
  segments: z.array(
    z.object({
      id: z.string().min(1),
      start: z.number().nonnegative(),
      end: z.number().positive(),
      text: z.string().min(1)
    })
  ).min(1)
});

type TranscriptInput = z.infer<typeof transcriptSchema>;
const speeds = [0.75, 0.9, 1, 1.25, 1.5] as const;

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
    throw new Error(`字幕要求 ${input.course.audioFilename}，但选择的是 ${filename}。`);
  }

  if (Math.abs(input.course.duration - actualDuration) > 3) {
    throw new Error("字幕记录的时长与音频实际时长不一致。");
  }

  const ids = new Set<string>();
  for (let index = 0; index < input.segments.length; index += 1) {
    const segment = input.segments[index];
    if (ids.has(segment.id)) {
      throw new Error(`字幕 ID ${segment.id} 重复。`);
    }
    ids.add(segment.id);

    if (segment.end <= segment.start) {
      throw new Error(`字幕 ${segment.id} 的结束时间必须大于开始时间。`);
    }
    if (index > 0 && segment.start < input.segments[index - 1].end) {
      throw new Error(`字幕 ${segment.id} 与上一条字幕重叠。`);
    }
    if (segment.end > actualDuration + 1) {
      throw new Error(`字幕 ${segment.id} 超出了音频时长。`);
    }
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

export default function App() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const lastSavedAt = useRef(0);
  const restoreTime = useRef(0);
  const [course, setCourse] = useState<Course>();
  const [audioUrl, setAudioUrl] = useState<string>();
  const [audioFile, setAudioFile] = useState<File>();
  const [transcriptFile, setTranscriptFile] = useState<File>();
  const [currentTime, setCurrentTime] = useState(0);
  const [currentSegment, setCurrentSegment] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loopSegment, setLoopSegment] = useState<number>();
  const [speed, setSpeed] = useState(1);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let url: string | undefined;

    async function restore() {
      try {
        const savedCourse = await loadCourse();
        if (!savedCourse || cancelled) return;
        if (savedCourse.id === "jabberwocky-sample") {
          await deleteCourse();
          return;
        }
        const [audio, progress] = await Promise.all([loadAudio(savedCourse), loadProgress()]);
        if (!audio) throw new Error("课程存在，但本地音频已丢失，请删除后重新导入。");
        url = URL.createObjectURL(audio);
        restoreTime.current = progress?.currentTime ?? 0;
        setSpeed(progress?.playbackRate ?? 1);
        setCourse(savedCourse);
        setAudioUrl(url);
      } catch (restoreError) {
        setError(messageFromError(restoreError));
      } finally {
        if (!cancelled) setBusy(false);
      }
    }

    void restore();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
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
      if (audio && !waiting && audio.currentTime >= Math.min(course.duration, segment.end + 0.2)) {
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
      if (document.hidden && audio) {
        void saveProgress({ currentTime: audio.currentTime, playbackRate: audio.playbackRate });
      }
    };
    document.addEventListener("visibilitychange", saveWhenHidden);
    return () => document.removeEventListener("visibilitychange", saveWhenHidden);
  }, []);

  async function importFiles(audio: File, transcript: File) {
    setBusy(true);
    setError("");
    try {
      const raw: unknown = JSON.parse(await transcript.text());
      const input = transcriptSchema.parse(raw);
      const duration = await readAudioDuration(audio);
      validateTimeline(input, duration, audio.name);

      const saved = await saveCourse(
        {
          id: input.course.id,
          title: input.course.title,
          audioFilename: input.course.audioFilename,
          duration,
          segments: input.segments
        },
        audio
      );

      const url = URL.createObjectURL(audio);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setCourse(saved);
      setAudioUrl(url);
      setCurrentTime(0);
      setCurrentSegment(0);
      setSpeed(1);
      restoreTime.current = 0;
      await saveProgress({ currentTime: 0, playbackRate: 1 });
      try {
        await navigator.storage?.persist?.();
      } catch {
        // Persistence is optional and must not block the player.
      }
    } catch (importError) {
      await deleteCourse();
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

  async function importSample() {
    setBusy(true);
    setError("");
    try {
      const [audioResponse, transcriptResponse] = await Promise.all([
        fetch("/samples/no-brainer.mp3"),
        fetch("/samples/no-brainer.json")
      ]);
      if (!audioResponse.ok || !transcriptResponse.ok) {
        throw new Error("示例课程下载失败，请检查网络连接。");
      }
      const audio = new File([await audioResponse.blob()], "no-brainer.mp3", { type: "audio/mpeg" });
      const transcript = new File([await transcriptResponse.blob()], "no-brainer.json", { type: "application/json" });
      await importFiles(audio, transcript);
    } catch (sampleError) {
      setBusy(false);
      setError(messageFromError(sampleError));
    }
  }

  function seekTo(value: number) {
    const audio = audioRef.current;
    if (!audio || !course) return;
    audio.currentTime = Math.max(0, Math.min(value, course.duration));
    setCurrentTime(audio.currentTime);
    setCurrentSegment(findSegmentIndex(course.segments, audio.currentTime));
    void saveProgress({ currentTime: audio.currentTime, playbackRate: audio.playbackRate });
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
    void saveProgress({ currentTime: audio?.currentTime ?? currentTime, playbackRate: value });
  }

  async function removeCurrentCourse() {
    audioRef.current?.pause();
    await deleteCourse();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setCourse(undefined);
    setAudioUrl(undefined);
    setAudioFile(undefined);
    setTranscriptFile(undefined);
    setCurrentTime(0);
    setLoopSegment(undefined);
    setError("");
  }

  if (busy && !course) {
    return <main className="center-card"><p>正在准备课程…</p></main>;
  }

  if (!course || !audioUrl) {
    return (
      <main className="center-card">
        <div className="brand">LISTEN / 0001</div>
        <h1>一段音频，认真听懂。</h1>
        <p className="intro">先用一分钟验证播放器。资料只保存在你的浏览器中。</p>

        <button className="primary sample" onClick={() => void importSample()} disabled={busy}>
          {busy ? "正在导入…" : "加载 1 分钟示例"}
        </button>

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
          导入所选文件
        </button>

        {error && <p className="error" role="alert">{error}</p>}
        <p className="source-note">示例：VOA Learning English《No Brainer》，公有领域。</p>
      </main>
    );
  }

  const activeSegment = course.segments[currentSegment];

  return (
    <main className="player-page">
      <header>
        <div className="brand">LISTEN / 0001</div>
        <h1>{course.title}</h1>
        <div className="time-row">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(course.duration)}</span>
        </div>
        <input
          className="timeline"
          type="range"
          min="0"
          max={course.duration}
          step="0.05"
          value={currentTime}
          aria-label="播放进度"
          onChange={(event) => seekTo(Number(event.target.value))}
        />
      </header>

      <section className="focus-sentence" aria-live="polite">
        <span>当前句 · {currentSegment + 1}/{course.segments.length}</span>
        <p>{activeSegment.text}</p>
      </section>

      <section className="transcript" aria-label="完整字幕">
        {course.segments.map((segment, index) => (
          <button
            key={segment.id}
            className={index === currentSegment ? "segment active" : "segment"}
            onClick={() => seekToSegment(index)}
          >
            <time>{formatTime(segment.start)}</time>
            <span>{segment.text}</span>
          </button>
        ))}
      </section>

      {error && <p className="error" role="alert">{error}</p>}

      <section className="controls" aria-label="播放器控制">
        <audio
          ref={audioRef}
          src={audioUrl}
          preload="metadata"
          onLoadedMetadata={(event) => {
            event.currentTarget.playbackRate = speed;
            event.currentTarget.currentTime = Math.min(restoreTime.current, course.duration);
            setCurrentTime(event.currentTarget.currentTime);
            setCurrentSegment(findSegmentIndex(course.segments, event.currentTarget.currentTime));
          }}
          onPlay={() => setPlaying(true)}
          onPause={(event) => {
            setPlaying(false);
            void saveProgress({ currentTime: event.currentTarget.currentTime, playbackRate: event.currentTarget.playbackRate });
          }}
          onTimeUpdate={(event) => {
            const time = event.currentTarget.currentTime;
            setCurrentTime(time);
            const index = loopSegment ?? findSegmentIndex(course.segments, time);
            setCurrentSegment((current) => current === index ? current : index);
            if (Date.now() - lastSavedAt.current > 5000) {
              lastSavedAt.current = Date.now();
              void saveProgress({ currentTime: time, playbackRate: event.currentTarget.playbackRate });
            }
          }}
          onError={() => setError("浏览器无法播放这个音频文件。")}
        />

        <div className="speed-row">
          {speeds.map((value) => (
            <button key={value} className={speed === value ? "selected" : ""} onClick={() => changeSpeed(value)}>
              {value}×
            </button>
          ))}
        </div>

        <div className="main-controls">
          <button onClick={() => seekTo(currentTime - 5)} aria-label="后退五秒">−5s</button>
          <button onClick={() => seekToSegment(currentSegment - 1)} aria-label="上一句">‹</button>
          <button
            className="play"
            onClick={() => playing ? audioRef.current?.pause() : void audioRef.current?.play()}
            aria-label={playing ? "暂停" : "播放"}
          >
            {playing ? "Ⅱ" : "▶"}
          </button>
          <button onClick={() => seekToSegment(currentSegment + 1)} aria-label="下一句">›</button>
          <button onClick={() => seekTo(currentTime + 5)} aria-label="前进五秒">+5s</button>
        </div>

        <div className="control-footer">
          <button
            className={loopSegment !== undefined ? "loop active-loop" : "loop"}
            onClick={() => setLoopSegment((value) => value === undefined ? currentSegment : undefined)}
          >
            ↻ 当前句
          </button>
          <button className="delete" onClick={() => void removeCurrentCourse()}>删除课程</button>
        </div>
      </section>
    </main>
  );
}
