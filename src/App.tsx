import { useI18n } from "./i18n";
import { useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowRight, Home as HomeIcon, Activity, ArrowDownToLine, AudioLines, Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Clapperboard, Clock3, Captions, Download, Film, FolderOpen, Layers, LoaderCircle, Maximize, Pause, Play, Plus, Settings2, ShieldCheck, SkipBack, SkipForward, SlidersHorizontal, WandSparkles, X } from "lucide-react";
import Timeline from "./Timeline";
import Inspector from "./Inspector";
import SourcePreview from './SourcePreview';
import Home, { Brand, LanguageSwitch } from './Home';
import Library, { type Panel } from './Library';
import ProjectDialog, { type ProjectOptions } from './ProjectDialog';
import { createEmptyProject, appendAssetsToProject } from './engine/workflow';
import { TimelinePlayer, exportVideo, getExportFormats } from "./engine/media";
import { captureNoiseProfile, estimateOffset } from "./engine/audio";
import { downloadBlob, downloadProject, importMedia, loadProject, parseProjectFile, parseSubtitles, saveProject, subtitlesToSrt, peekSavedProject, exportSavedProject, type SavedProjectSummary } from "./engine/project";
import { defaultAudio, defaultVideo, projectDuration, timecode, uid, type MediaAsset, type Project } from "./types";
type Modal = "export" | "sync" | "help" | "new" | "settings" | null;
const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);
export default function App() {
  const {
    t
  } = useI18n();
  const [initial] = useState(() => ({
    project: createEmptyProject(),
    assets: [] as MediaAsset[]
  }));
  const [active, setActive] = useState(false),
    [isDemoSession, setIsDemoSession] = useState(false);
  const [recent, setRecent] = useState<SavedProjectSummary | null>(null),
    [sourceId, setSourceId] = useState<string | null>(null),
    [queuedFiles, setQueuedFiles] = useState<File[]>([]);
  const [toastKind, setToastKind] = useState<'info' | 'error'>('info');
  const editBase = useRef<Project | null>(null),
    sessionGeneration = useRef(0),
    transitionBusy = useRef(false);
  const [project, setProject] = useState(initial.project),
    [assets, setAssets] = useState(initial.assets);
  const [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false),
    [selected, setSelected] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>("media"),
    [inspectorOpen, setInspectorOpen] = useState(false);
  const [modal, setModal] = useState<Modal>(null),
    [menu, setMenu] = useState(false),
    [toast, setToast] = useState(""),
    [busy, setBusy] = useState("");
  const [saved, setSaved] = useState(t("Локальний проєкт")),
    [loaded, setLoaded] = useState(false),
    [saveBlocked, setSaveBlocked] = useState(false),
    [history, setHistory] = useState<Project[]>([]),
    [future, setFuture] = useState<Project[]>([]);
  const [exportSize, setExportSize] = useState("source"),
    [exportFormat, setExportFormat] = useState(""),
    [progress, setProgress] = useState<number | null>(null);
  const [syncRef, setSyncRef] = useState(""),
    [syncTarget, setSyncTarget] = useState(""),
    [syncResult, setSyncResult] = useState("");
  const [syncMatch, setSyncMatch] = useState<{
      offset: number;
      confidence: number;
      referenceId: string;
      targetId: string;
    } | null>(null),
    [muteSynced, setMuteSynced] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null),
    fileInput = useRef<HTMLInputElement>(null),
    projectInput = useRef<HTMLInputElement>(null),
    subInput = useRef<HTMLInputElement>(null),
    player = useRef<TimelinePlayer | null>(null),
    abort = useRef<AbortController | null>(null);
  const projectRef = useRef(project),
    assetsRef = useRef(assets),
    timeRef = useRef(time),
    playingRef = useRef(playing);
  projectRef.current = project;
  assetsRef.current = assets;
  timeRef.current = time;
  playingRef.current = playing;
  const [timeDraft, setTimeDraft] = useState<string | null>(null);
  const pendingSeek = useRef<number | null>(null);
  const scrubWasPlaying = useRef(false);
  const initStarted = useRef(false);
  const duration = projectDuration(project);
  const clip = project.clips.find(c => c.id === selected),
    asset = assets.find(a => a.id === clip?.assetId),
    subtitle = project.subtitles.find(s => s.id === selected);
  const notify = (text: string, kind: 'info' | 'error' = 'info') => {
    setToastKind(kind);
    setToast(text);
  };
  const fail = (error: unknown) => notify(errorText(error), 'error');
  function finishEdit() {
    const base = editBase.current;
    editBase.current = null;
    if (base && base !== projectRef.current) {
      setHistory(h => [...h.slice(-59), base]);
      setFuture([]);
    }
  }
  function select(id: string) {
    setSelected(id || null);
    setSourceId(null);
  }
  function removeAsset(id:string){if(project.clips.some(c=>c.assetId===id))return;if(sourceId===id)setSourceId(null);setAssets(previous=>previous.filter(a=>a.id!==id));}
  function previewSource(id: string) {
    const item = assets.find(a => a.id === id);
    if (!item?.url) {
      fileInput.current?.click();
      return;
    }
    player.current?.pause();
    setPlaying(false);
    setSelected(null);
    setSourceId(id);
  }
  function change(next: Project) {
    if (!editBase.current) {
      setHistory(h => [...h.slice(-59), projectRef.current]);
      setFuture([]);
    }
    setProject(next);
  }
  function undo() {
    if (!history.length) return;
    setFuture(f => [project, ...f]);
    setProject(history[history.length - 1]);
    setHistory(history.slice(0, -1));
  }
  function redo() {
    if (!future.length) return;
    setHistory(h => [...h, project]);
    setProject(future[0]);
    setFuture(future.slice(1));
  }
  function seek(t: number) {
    const value = Math.max(0, Math.min(duration, t));
    setTime(value);
    void player.current?.seek(value, playingRef.current).catch(fail);
  }
  async function togglePlay() {
    setSourceId(null);
    if (playingRef.current) {
      player.current?.pause();
      setPlaying(false);
      return;
    }
    try {
      const from = timeRef.current >= projectDuration(projectRef.current) - .03 ? 0 : timeRef.current;
      setPlaying(true);
      await player.current?.play(from);
    } catch (e) {
      setPlaying(false);
      fail(e);
    }
  }
  function split() {
    if (!clip) {
      notify("Спочатку виберіть кліп на шкалі.");
      return;
    }
    const at = time - clip.start;
    if (at <= .04 || at >= clip.duration - .04) {
      notify("Перемістіть курсор усередину вибраного кліпу.");
      return;
    }
    const second = {
      ...structuredClone(clip),
      id: uid(),
      start: time,
      in: clip.in + at,
      duration: clip.duration - at
    };
    change({
      ...project,
      clips: project.clips.flatMap(c => c.id === clip.id ? [{
        ...c,
        duration: at
      }, second] : [c])
    });
    setSelected(second.id);
  }
  function remove() {
    if (!selected) return;
    change({
      ...project,
      clips: project.clips.filter(c => c.id !== selected),
      subtitles: project.subtitles.filter(s => s.id !== selected)
    });
    setSelected(null);
  }
  useEffect(() => {
    if (!active || !canvas.current) return;
    const engine = new TimelinePlayer(canvas.current, () => projectRef.current, () => assetsRef.current, t => {
      setTime(t);
      if (t >= projectDuration(projectRef.current) - .04) setPlaying(false);
    });
    player.current = engine;
    void engine.seek(timeRef.current).catch(fail);
    return () => {
      engine.dispose();
      player.current = null;
    };
  }, [active]);
  useEffect(() => {
    if (!active) return;
    const requested = pendingSeek.current;
    pendingSeek.current = null;
    void (requested === null ? player.current?.update() : player.current?.seek(requested))?.catch(e => notify(errorText(e)));
  }, [project, assets, active]);
  useEffect(() => {
    if (initStarted.current) return;
    initStarted.current = true;
    peekSavedProject().then(setRecent).catch(e => {
      setSaveBlocked(true);
      fail(e);
    }).finally(() => setLoaded(true));
  }, []);
  useEffect(() => {
    if (!active || !loaded || saveBlocked || isDemoSession) return;
    setSaved("Зберігаємо…");
    const generation = sessionGeneration.current;
    const timer = setTimeout(() => {
      saveProject(project, assets).then(() => {
        if (generation !== sessionGeneration.current) return;
        setSaved("Збережено локально");
        void peekSavedProject().then(summary => {
          if (generation === sessionGeneration.current) setRecent(summary);
        }).catch(() => {});
      }).catch(e => {
        if (generation !== sessionGeneration.current) return;
        setSaved("Не збережено");
        fail(e);
      });
    }, 1500);
    return () => clearTimeout(timer);
  }, [project, assets, loaded, saveBlocked, active, isDemoSession]);
  const priorAssets = useRef(assets);
  useEffect(() => {
    const retained = new Set(assets.map(a => a.url));
    for (const a of priorAssets.current) if (a.file && a.url && !retained.has(a.url)) URL.revokeObjectURL(a.url);
    priorAssets.current = assets;
  }, [assets]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 6500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (!loaded || busy) return;
      if (e.key === "Escape") {
        if (progress !== null) abort.current?.abort();else {
          setModal(null);setQueuedFiles([]);
          setInspectorOpen(false);
          setMenu(false);
        }
        return;
      }
      const target = e.target as HTMLElement;
      if (target.closest("input,textarea,select,video,audio,[role=dialog],[contenteditable=\"true\"]") || modal || !active) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "i") {
        e.preventDefault();
        fileInput.current?.click();
      }
      if (e.code === "Space") {
        e.preventDefault();
        void togglePlay();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        downloadProject(project, assets);
      }
      if (e.key.toLowerCase() === "s" && !e.metaKey && !e.ctrlKey) split();
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        remove();
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        seek(time - 1 / project.fps);
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        seek(time + 1 / project.fps);
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  });
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    if (!dialog) return;
    const selector = 'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]';
    const first = dialog.querySelector<HTMLElement>('[autofocus]') || dialog.querySelector<HTMLElement>(selector);
    first?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const elements = Array.from(dialog.querySelectorAll<HTMLElement>(selector)).filter(element => element.offsetParent !== null);
      const a = elements[0],
        b = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === a) {
        event.preventDefault();
        b?.focus();
      } else if (!event.shiftKey && document.activeElement === b) {
        event.preventDefault();
        a?.focus();
      }
    };
    dialog.addEventListener('keydown', trap);
    return () => {
      dialog.removeEventListener('keydown', trap);
      if (previous?.isConnected) previous.focus();
    };
  }, [modal]);
  function addAsset(assetId: string, trackId?: string, start?: number) {
    const a = assets.find(item => item.id === assetId);
    if (!a?.url) return;
    const kind = a.kind === "audio" ? "audio" : "video";
    let tracks = project.tracks;
    let target = tracks.find(track => track.id === trackId) || tracks.filter(track => track.kind === kind).sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)))[0];
    if (!target) {
      const prefix = kind === "audio" ? "a" : "v";
      let index = 1;
      while (tracks.some(track => track.id === `${prefix}${index}`)) index++;
      target = {
        id: `${prefix}${index}`,
        kind,
        name: `${t(kind === "audio" ? "Аудіо" : "Відео")} ${index}`
      };
      tracks = kind === "video" ? [target, ...tracks] : [...tracks, target];
    }
    if (a.kind === "audio" && target.kind !== "audio" || a.kind === "image" && target.kind !== "video") {
      notify("Додайте матеріал на доріжку відповідного типу.");
      return;
    }
    setSourceId(null);
    const at = start ?? Math.max(0, ...project.clips.filter(c => c.trackId === target.id).map(c => c.start + c.duration));
    const newClip = {
      id: uid(),
      assetId: a.id,
      trackId: target.id,
      name: a.name,
      start: at,
      in: 0,
      duration: a.kind === 'image' ? 5 : a.duration,
      muted: false,
      audio: defaultAudio(),
      video: defaultVideo()
    };
    change({
      ...project,
      tracks,
      clips: [...project.clips, newClip]
    });
    setSelected(newClip.id);
    notify("Кліп додано на монтажну шкалу.");
  }
  async function handleFiles(files: FileList | File[] | null) {
    if (!files?.length) return;
    if (busy) return;
    setPanel("media");
    setBusy("Імпортуємо матеріали…");
    const imported: MediaAsset[] = [];
    let errors: string[] = [];
    for (const f of Array.from(files)) {
      try {
        const importedAsset = await importMedia(f);
        imported.push(importedAsset);
        if (importedAsset.kind === "video" && !importedAsset.audioBuffer) errors.push(`Звук «${f.name}» недоступний для обробки. Якщо у відео є звук, додайте його окремим WAV або MP3, інакше його не буде в монтажі та експорті.`);
      } catch (e) {
        errors.push(errorText(e));
      }
    }
    setAssets(prev => {
      let next = [...prev];
      for (const a of imported) {
        const missing = next.find(x => !x.url && x.name === a.name && x.kind === a.kind && (a.kind === "image" || Math.abs(x.duration - a.duration) <= .1));
        if (missing) next = next.map(x => x.id === missing.id ? {
          ...a,
          id: missing.id
        } : x);else next.push(a);
      }
      return next;
    });
    setBusy("");
    notify(errors.length ? errors.join(" ") : `Імпортовано ${imported.length} ${imported.length === 1 ? t("матеріал") : t("матеріалів")}. Додайте їх на шкалу кнопкою + або перетягуванням.`, errors.length ? 'error' : 'info');
  }
  async function handleProject(file: File) {
    try {
      setBusy("Відкриваємо проєкт…");
      const result = await parseProjectFile(file, assets);
      if (active && !isDemoSession && !saveBlocked) await saveProject(projectRef.current, assetsRef.current);
      sessionGeneration.current++;
      editBase.current = null;
      player.current?.pause();
      setPlaying(false);
      setSaveBlocked(false);
      setIsDemoSession(false);
      setActive(true);
      setSourceId(null);
      pendingSeek.current = 0;
      setProject(result.project);
      setAssets(result.assets);
      setTime(0);
      setSelected(result.project.clips[0]?.id || null);
      setHistory([]);
      setFuture([]);
      if (result.missing.length) notify(`Імпортуйте оригінали для відновлення зв’язків: ${result.missing.join(", ")}`);else notify("Проєкт відкрито.");
    } catch (e) {
      fail(e);
    } finally {
      setBusy("");
    }
  }
  async function handleSubs(file: File) {
    try {
      const cues = parseSubtitles(await file.text());
      if (!cues.length) throw new Error(t("У файлі не знайдено субтитрів SRT або VTT."));
      change({
        ...project,
        subtitles: [...project.subtitles, ...cues].sort((a, b) => a.start - b.start)
      });
      setPanel("text");
      notify(`Додано ${cues.length} субтитрів.`);
    } catch (e) {
      fail(e);
    }
  }
  function addSubtitle() {
    const cue = {
      id: uid(),
      start: time,
      end: time + 3,
      text: t("Новий субтитр")
    };
    change({
      ...project,
      subtitles: [...project.subtitles, cue].sort((a, b) => a.start - b.start)
    });
    setSelected(cue.id);
    setSourceId(null);
    setInspectorOpen(true);
    setPanel("text");
  }
  function noise() {
    if (!clip || !asset?.audioBuffer) {
      notify("Виберіть кліп із доступним звуком.");
      return;
    }
    const at = clip.in + time - clip.start;
    if (at < clip.in || at >= clip.in + clip.duration - .05) {
      notify("Поставте курсор у ділянку кліпу, де чути лише шум.");
      return;
    }
    try {
      const noiseProfile = captureNoiseProfile(asset.audioBuffer, at, Math.min(at + .5, clip.in + clip.duration));
      change({
        ...project,
        clips: project.clips.map(c => c.id === clip.id ? {
          ...c,
          audio: {
            ...c.audio,
            noiseProfile,
            noiseReduction: 60
          }
        } : c)
      });
      notify("Взірець шуму знято: до 0,5 с від курсора. Очищення застосовано.");
    } catch (e) {
      fail(e);
    }
  }
  const audioClips = project.clips.filter(c => assets.find(a => a.id === c.assetId)?.audioBuffer);
  function openSync() {
    setSyncRef(audioClips.find(c => c.id !== selected)?.id || "");
    setSyncTarget(audioClips.find(c => c.id === selected)?.id || audioClips[1]?.id || "");
    setSyncResult("");
    setSyncMatch(null);
    setMuteSynced(false);
    setModal("sync");
  }
  async function sync() {
    if (!syncRef || !syncTarget || syncRef === syncTarget) {
      setSyncResult("Оберіть два різні кліпи зі звуком.");
      return;
    }
    const ref = project.clips.find(c => c.id === syncRef)!,
      target = project.clips.find(c => c.id === syncTarget)!;
    setSyncMatch(null);
    setSyncResult('');
    setBusy("Порівнюємо звукові хвилі…");
    try {
      const result = await estimateOffset(assets.find(a => a.id === ref.assetId)!.audioBuffer!, assets.find(a => a.id === target.assetId)!.audioBuffer!);
      if (result.confidence < .35) {
        setSyncResult("Не знайдено надійного збігу. Записи мають містити спільний звук. Спробуйте іншу пару або вирівняйте кліпи вручну.");
        return;
      }
      setSyncMatch({
        ...result,
        referenceId: ref.id,
        targetId: target.id
      });
      setSyncResult('Готово до застосування');
    } catch (e) {
      setSyncResult(errorText(e));
    } finally {
      setBusy("");
    }
  }
  function applySync() {
    if (!syncMatch) return;
    const reference = project.clips.find(c => c.id === syncMatch.referenceId),
      target = project.clips.find(c => c.id === syncMatch.targetId);
    if (!reference || !target) return;
    const start = reference.start + syncMatch.offset + target.in - reference.in;
    const audioTrack = project.tracks.find(track => track.id === target.trackId)?.kind === 'audio';
    change({
      ...project,
      clips: project.clips.map(c => c.id === target.id ? {
        ...c,
        start: audioTrack ? start : Math.max(0, start),
        muted: muteSynced || c.muted
      } : c.id === reference.id && start < 0 && !audioTrack ? {
        ...c,
        start: c.start - start
      } : c)
    });
    select(target.id);
    setSyncMatch(null);
    setModal(null);
    notify('Кліпи вирівняно. Зміну можна скасувати.');
  }
  function outputSize(edge: string) {
    const scale = edge === 'source' ? 1 : +edge / Math.min(project.width, project.height);
    return {
      width: Math.round(project.width * scale / 2) * 2,
      height: Math.round(project.height * scale / 2) * 2
    };
  }
  const formats = typeof MediaRecorder === "undefined" ? [] : getExportFormats();
  async function doExport() {
    if (progress !== null) return;
    try {
      player.current?.pause();
      setPlaying(false);
      setProgress(0);
      abort.current = new AbortController();
      const {
        width,
        height
      } = outputSize(exportSize);
      const result = await exportVideo(project, assets, {
        width,
        height,
        fps: project.fps,
        mimeType: exportFormat || formats[0]?.mimeType
      }, setProgress, abort.current.signal);
      downloadBlob(result.blob, `${project.name}.${result.extension}`);
      notify("Відео готове. Файл збережено на ваш пристрій.");
      setModal(null);
    } catch (e) {
      fail(e);
    } finally {
      setProgress(null);
      abort.current = null;
      void player.current?.seek(time).catch(fail);
    }
  }
  const source = assets.find(a => a.id === sourceId);
  const previewRatio = source?.width && source.height ? source.width / source.height : source?.kind === 'audio' ? 16 / 9 : project.width / project.height;
  const unplaced = assets.filter(a => a.url && !project.clips.some(c => c.assetId === a.id));
  const missingMedia = assets.filter(a => !a.url && project.clips.some(c => c.assetId === a.id));
  const canExport = duration > 0 && !missingMedia.length;
  function addAll() {
    const result = appendAssetsToProject(project, assets, {
      assetIds: unplaced.map(a => a.id)
    });
    if (!result.clipIds.length) return;
    change(result.project);
    select(result.clipIds[0]);
    seek(Math.min(...result.project.clips.filter(c => result.clipIds.includes(c.id)).map(c => c.start)));
  }
  function install(next: Project, media: MediaAsset[], at = 0, demo = false) {
    sessionGeneration.current++;
    editBase.current = null;
    player.current?.pause();
    setPlaying(false);
    setIsDemoSession(demo);
    setSourceId(null);
    pendingSeek.current = at;
    setProject(next);
    setAssets(media);
    setTime(at);
    setSelected(next.clips[0]?.id || null);
    setPanel('media');
    setHistory([]);
    setFuture([]);
    setSaveBlocked(false);
    setActive(true);
    setModal(null);
  }
  function startNew(options: ProjectOptions) {
    const files = queuedFiles;
    setQueuedFiles([]);
    install(createEmptyProject(options), []);
    if (files.length) void handleFiles(files);
  }
  async function openDemo() {
    try {
      setBusy('Відкриваємо демо…');
      const {
        createDemo
      } = await import('./demo');
      const demo = createDemo();
      install(demo.project, demo.assets, 4.2, true);
    } catch (error) {
      fail(error);
    } finally {
      setBusy('');
    }
  }
  async function resumeSaved() {
    try {
      setBusy('Відновлюємо проєкт і матеріали…');
      const saved = await loadProject();
      if (!saved) throw new Error('У цьому браузері немає збереженого проєкту.');
      install(saved.project, saved.assets, 0, recent?.isDemo ?? false);
    } catch (error) {
      fail(error);
    } finally {
      setBusy('');
    }
  }
  async function goHome() {
    if (transitionBusy.current) return false;
    transitionBusy.current = true;
    setBusy('Зберігаємо проєкт…');
    try {
      finishEdit();
      player.current?.pause();
      setPlaying(false);
      setSourceId(null);
      if (active && !isDemoSession && !saveBlocked) await saveProject(projectRef.current, assetsRef.current);
      setRecent(await peekSavedProject());
      sessionGeneration.current++;
      setActive(false);
      setSelected(null);
      setInspectorOpen(false);
      setAssets([]);
      return true;
    } catch (error) {
      fail(error);
      return false;
    } finally {
      transitionBusy.current = false;
      setBusy('');
    }
  }
  function openExport() {
    if (!canExport) return;
    player.current?.pause();
    setPlaying(false);
    setSourceId(null);
    setExportSize(Math.min(project.width, project.height) > 1080 ? '1080' : 'source');
    setExportFormat(formats[0]?.mimeType || '');
    setModal('export');
  }
  return <div className={`studio ${active ? 'is-editing' : 'is-home'} ${inspectorOpen ? 'inspector-open' : ''}`} onDragOver={e => {
    if (e.dataTransfer.types.includes('Files')) e.preventDefault();
  }} onDrop={e => {
    if (!e.dataTransfer.files.length || busy || modal || !loaded) return;
    e.preventDefault();
    if (active) void handleFiles(e.dataTransfer.files);else {
      setQueuedFiles(Array.from(e.dataTransfer.files));
      setModal('new');
    }
  }}>
    <input type="file" multiple accept="video/*,audio/*,image/*,.mkv,.mov,.m4a,.flac" ref={fileInput} hidden onChange={e => {
      void handleFiles(e.target.files);
      e.target.value = '';
    }} />
    <input type="file" accept=".json" ref={projectInput} hidden onChange={e => {
      if (e.target.files?.[0]) void handleProject(e.target.files[0]);
      e.target.value = '';
    }} />
    <input type="file" accept=".srt,.vtt" ref={subInput} hidden onChange={e => {
      if (e.target.files?.[0]) void handleSubs(e.target.files[0]);
      e.target.value = '';
    }} />
    {!active ? <Home recent={recent} loading={!loaded} onCreate={() => setModal('new')} onOpen={() => projectInput.current?.click()} onResume={() => void resumeSaved()} onDemo={() => void openDemo()} /> : <>
    <header className="app-header"><Brand onClick={() => void goHome()} /><span className="header-separator" /><div className="project-title"><input key={project.name} defaultValue={project.name} aria-label={t('Назва проєкту')} maxLength={100} onBlur={e => {
            const name = e.target.value.trim() || project.name;
            if (name !== project.name) change({
              ...project,
              name
            });
          }} onKeyDown={e => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              e.currentTarget.value = project.name;
              e.currentTarget.blur();
            }
          }} /><span>{project.width} × {project.height} · {project.fps} fps</span></div><span className={`save-indicator ${isDemoSession ? 'demo-status' : ''}`}><span className="status-dot" />{t(isDemoSession ? 'Демо · ваш проєкт захищений' : saved)}</span><div className="header-actions"><LanguageSwitch /><button className="header-help" title={t('Довідка та гарячі клавіші')} onClick={() => setModal('help')}><CircleHelp size={18} /></button><div className="project-menu-wrap"><button className="secondary-button project-button" aria-expanded={menu} onClick={() => setMenu(!menu)}><FolderOpen size={15} /><span>{t('Проєкт')}</span><ChevronDown size={12} /></button>{menu && <><div className="menu-backdrop" onClick={() => setMenu(false)} /><div className="dropdown-menu" role="menu"><button role="menuitem" onClick={() => {
                  setMenu(false);
                  void goHome();
                }}><ChevronLeft size={15} />{t('На стартову сторінку')}</button><button role="menuitem" onClick={() => {
                  setMenu(false);
                  setModal('settings');
                }}><Settings2 size={15} />{t('Налаштування проєкту')}</button><button role="menuitem" onClick={() => {
                  setMenu(false);
                  downloadProject(project, assets);
                }}><Download size={15} />{t('Завантажити файл проєкту')}</button><span className="menu-divider" /><button role="menuitem" onClick={() => {
                  setMenu(false);
                  setModal('new');
                }}><Plus size={15} />{t('Новий проєкт')}</button><button role="menuitem" onClick={() => {
                  setMenu(false);
                  projectInput.current?.click();
                }}><FolderOpen size={15} />{t('Відкрити проєкт')}</button></div></>}</div><button className="primary-button export-button" disabled={!canExport} title={!duration ? t('Спочатку додайте кліпи на шкалу') : missingMedia.length ? t('Спочатку відновіть медіафайли') : t('Експорт відео')} onClick={openExport}><ArrowDownToLine size={16} />{t('Експорт')}<ChevronRight size={13} /></button></div></header>
    <div className="workflow-bar"><div className="workflow-nav">{[{
            label: 'Матеріали',
            done: assets.length > 0,
            action: () => setPanel('media')
          }, {
            label: 'Монтаж',
            done: project.clips.length > 0,
            action: () => document.querySelector('.timeline-panel')?.scrollIntoView({
              block: 'nearest',
              behavior: 'smooth'
            })
          }, {
            label: 'Звук і колір',
            done: false,
            action: () => {
              setInspectorOpen(true);
              if (!selected && project.clips.length) setSelected(project.clips[0].id);
            }
          }, {
            label: 'Експорт',
            done: false,
            action: openExport
          }].map((step, i) => <button key={step.label} disabled={i === 3 && !canExport || i === 2 && !project.clips.length} onClick={step.action}><span className={step.done ? 'done' : ''}>{step.done ? <Check size={11} /> : i + 1}</span>{t(step.label)}{i < 3 && <ChevronRight size={12} />}</button>)}</div><span className="workflow-hint">{t(!assets.length ? 'Імпортуйте файли, щоб почати.' : !project.clips.length ? 'Додайте матеріали на шкалу.' : 'Виберіть кліп, щоб змінити його параметри.')}</span></div>
    {active&&isDemoSession&&<div className="demo-session-banner"><span><Play size={13}/>{t('Зміни в демо не перезаписують ваш проєкт.')}</span><button onClick={()=>downloadProject(project,assets)}><Download size={13}/>{t('Завантажити файл проєкту')}</button></div>}
    {missingMedia.length > 0 && <div className="missing-media-banner"><span><AlertCircle size={15} />{t('Потрібно відновити медіафайли')}: {missingMedia.length}</span><button onClick={() => fileInput.current?.click()}>{t('Вибрати оригінальні файли')}<ArrowRight size={13} /></button></div>}
    <div className="workspace"><nav className="rail" aria-label={t('Інструменти')}><div className="rail-top">{[{
              id: 'media',
              icon: FolderOpen,
              label: 'Матеріали'
            }, {
              id: 'text',
              icon: Captions,
              label: 'Субтитри'
            }, {
              id: 'effects',
              icon: SlidersHorizontal,
              label: 'Образ'
            }].map(item => <button key={item.id} className={`rail-button ${panel === item.id ? 'active' : ''}`} aria-pressed={panel === item.id} onClick={() => setPanel(item.id as Panel)}><item.icon size={21} /><span>{t(item.label)}</span></button>)}</div><div className="rail-bottom"><button className="rail-button" onClick={() => setModal('help')}><CircleHelp size={20} /><span>{t('Довідка')}</span></button><button className="rail-button home-return" onClick={() => void goHome()} title={t('На стартову сторінку')}><HomeIcon size={19} /><span>{t('На старт')}</span></button></div></nav>
    <Library onRemove={removeAsset} panel={panel} project={project} assets={assets} sourceId={sourceId} clip={clip} selected={selected} onImport={() => fileInput.current?.click()} onAdd={addAsset} onAddAll={addAll} onPreview={previewSource} onSubtitle={addSubtitle} onImportSubs={() => subInput.current?.click()} onExportSubs={() => downloadBlob(new Blob([subtitlesToSrt(project.subtitles)], {
          type: 'text/plain'
        }), `${project.name}.srt`)} onSelectSubtitle={cue => {
          select(cue.id);
          seek(cue.start);
          setInspectorOpen(true);
        }} onLook={values => {
          if (clip) change({
            ...project,
            clips: project.clips.map(c => c.id === clip.id ? {
              ...c,
              video: {
                ...c.video,
                ...values
              }
            } : c)
          });
        }} />
    <main className="editor-main"><div className="viewer-heading"><div className="viewer-tabs"><button className={!source ? 'selected' : ''} onClick={() => setSourceId(null)}><Layers size={13} />{t('Послідовність')}</button>{source && <span className="source-tab selected"><Film size={13} />{t('Джерело')}<button className="tool" aria-label={t('Закрити джерело')} onClick={() => setSourceId(null)}><X size={12} /></button></span>}</div><div className="viewer-heading-tools"><button className="tool" title={t('Відкрити інспектор')} onClick={() => setInspectorOpen(true)}><Settings2 size={16} /></button><button className="tool" title={t('На весь екран')} onClick={() => void document.querySelector('.viewer-area')?.requestFullscreen().catch(() => notify('Повноекранний режим недоступний у цьому браузері.'))}><Maximize size={15} /></button></div></div>
    <div className="viewer-area"><div className={`video-stage ${source ? 'source-mode' : ''}`} style={!source && !project.clips.length ? {
              width: '100%',
              height: '100%',
              aspectRatio: 'auto'
            } : {
              aspectRatio: previewRatio,
              width: `min(100%, calc(100cqh * ${previewRatio}))`
            }}><canvas ref={canvas} width={project.width} height={project.height} aria-label={t('Попередній перегляд монтажу')} style={{
                display: source ? 'none' : 'block'
              }} onClick={() => void togglePlay()} />{source && <SourcePreview key={source.id} source={source} />}{!source && !project.clips.length && <div className="viewer-empty"><span className="empty-viewer-icon"><Clapperboard size={32} /></span><h2>{t(assets.length ? 'Матеріали готові до монтажу' : 'Тут буде ваша історія')}</h2><p>{t(assets.length ? 'Додайте файли з медіатеки на шкалу нижче.' : 'Імпортуйте відео, звук або фото. Почніть з одного файлу.')}</p>{unplaced.length > 0 && <button className="primary-button" onClick={addAll}><Plus size={15} />{t('Додати матеріали на шкалу')}</button>}</div>}</div></div>
    {source ? <div className="source-transport"><div><small>{t('Перегляд оригіналу')}</small><span title={source.name}>{source.name}</span></div><button className="secondary-button" onClick={() => addAsset(source.id)}><Plus size={14} />{t('На шкалу')}</button><button className="tool" title={t('Повернутися до монтажу')} onClick={() => setSourceId(null)}><X size={17} /></button></div> : <div className="transport"><div className="time-display"><span>{timecode(time, project.fps)}<small>/ {timecode(duration, project.fps)}</small></span><label className="playhead-entry"><input aria-label={t('Позиція курсора, с')} title={t('Введіть точний час у секундах')} type="number" min="0" max={duration} step={1 / project.fps} value={timeDraft ?? Number(time.toFixed(3))} onFocus={() => setTimeDraft(String(Number(time.toFixed(3))))} onChange={e => setTimeDraft(e.target.value)} onBlur={() => {
                  if (timeDraft !== null && timeDraft.trim() && Number.isFinite(+timeDraft)) seek(+timeDraft);
                  setTimeDraft(null);
                }} onKeyDown={e => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                }} /><span>{t('с')}</span></label></div><div className="playback-buttons"><button className="tool" title={t('На початок')} disabled={!duration} onClick={() => seek(0)}><SkipBack size={16} /></button><button className="tool" title={t('Кадр назад (←)')} disabled={!duration} onClick={() => seek(time - 1 / project.fps)}><ChevronLeft size={19} /></button><button className="play-button" title={t(playing ? 'Пауза (Space)' : 'Відтворити (Space)')} onClick={() => void togglePlay()} disabled={!duration}>{playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</button><button className="tool" title={t('Кадр уперед (→)')} disabled={!duration} onClick={() => seek(time + 1 / project.fps)}><ChevronRight size={19} /></button><button className="tool" title={t('У кінець')} disabled={!duration} onClick={() => seek(duration)}><SkipForward size={16} /></button></div><div className="preview-tools"><span>{project.fps} fps</span><span className="separator" /><span>{t('Вмістити')}</span></div></div>}
    <div className="sequence-info"><span><Layers size={13} />{t('Монтажна послідовність')}</span><button disabled={audioClips.length < 2} title={audioClips.length < 2 ? t('Додайте два кліпи зі спільним звуком') : t('Синхронізувати звук')} onClick={openSync}><WandSparkles size={14} />{t('Синхронізація')}</button><button className="mobile-inspector-button" onClick={() => setInspectorOpen(true)}><Settings2 size={14} />{t('Інспектор')}</button></div></main>
    <button className="inspector-shade" aria-label={t('Закрити інспектор')} onClick={() => setInspectorOpen(false)} /><button className="inspector-mobile-close tool" title={t('Закрити інспектор')} onClick={() => setInspectorOpen(false)}><X size={19} /></button><Inspector clip={clip} asset={asset} subtitle={subtitle} project={project} time={time} onClipChange={next => change({
          ...project,
          clips: project.clips.map(c => c.id === next.id ? next : c)
        })} onProjectChange={change} onCaptureNoise={noise} onSync={openSync} onDelete={remove} onAddSubtitle={project.clips.length ? addSubtitle : undefined} onBeginEdit={() => {
          editBase.current = projectRef.current;
        }} onEndEdit={finishEdit} />
    <div className="timeline-wrap"><Timeline key={sessionGeneration.current} project={project} assets={assets} time={time} selected={selected} onSelect={select} onSeek={seek} onChange={change} onScrubStart={() => {
            setSourceId(null);
            scrubWasPlaying.current = playingRef.current;
            playingRef.current = false;
            player.current?.pause();
            setPlaying(false);
          }} onScrubEnd={at => {
            setTime(at);
            if (scrubWasPlaying.current) {
              playingRef.current = true;
              setPlaying(true);
              void player.current?.play(at).catch(e => {
                setPlaying(false);
                fail(e);
              });
            }
            scrubWasPlaying.current = false;
          }} onSplit={split} onDelete={remove} onUndo={undo} onRedo={redo} canUndo={!!history.length} canRedo={!!future.length} playing={playing} onDrop={addAsset} onImport={() => fileInput.current?.click()} onAddAll={addAll} hasUnplacedMedia={unplaced.length > 0} onAddSubtitle={addSubtitle} /></div></div></>}
    {busy && <div className="busy-overlay" role="status"><div><LoaderCircle size={23} className="spin" /><strong>{t(busy)}</strong><span>{t('Обробка на вашому пристрої')}</span></div></div>}
    {toast && <div className={`toast ${toastKind}`} role={toastKind === 'error' ? 'alert' : 'status'}>{toastKind === 'error' ? <AlertCircle size={18} /> : <Check size={17} />}<span>{t(toast)}</span><button className="tool" title={t('Закрити повідомлення')} onClick={() => setToast('')}><X size={15} /></button></div>}
    {(modal === 'new' || modal === 'settings') && <ProjectDialog mode={modal} project={modal === 'new' ? createEmptyProject() : project} hasPrevious={!!recent || saveBlocked || active && !isDemoSession && (assets.length > 0 || project.clips.length > 0)} onClose={() => {
      setModal(null);
      setQueuedFiles([]);
    }} onBackup={() => {
      if (active && !isDemoSession) downloadProject(project, assets);else void exportSavedProject().catch(fail);
    }} onSubmit={options => {
      if (modal === 'settings') {
        change({
          ...project,
          ...options
        });
        setModal(null);
      } else startNew(options);
    }} />}
 {modal && modal !== 'new' && modal !== 'settings' && <div className="modal-overlay" onMouseDown={e => {
      if (e.target === e.currentTarget && progress === null) setModal(null);
    }}><section className={`modal ${modal === "help" ? "help-modal" : ""}`} role="dialog" aria-modal="true" aria-label={modal === "export" ? t("Експорт відео") : modal === "sync" ? t("Синхронізація") : t("Довідка")}><button className="modal-close tool" title={t("Закрити")} onClick={() => {
          if (progress !== null) abort.current?.abort();else setModal(null);
        }}><X size={20} /></button>
 {modal === "export" && <><div className="modal-icon"><ArrowDownToLine size={25} /></div><h2>{t("Історія готова до перегляду.")}</h2><p>{t("Перевірте початок і кінець, звук та субтитри перед експортом.")}</p><div className="export-summary"><div className="export-thumbnail" style={{
              backgroundImage: `url('${assets.find(a => a.thumbnail)?.thumbnail || ""}')`
            }}><Play size={24} /></div><div><strong>{project.name}</strong><span>{timecode(duration)} · {project.fps} fps · {project.clips.length} {t("кліпів")}</span></div></div><div className="modal-fields"><label>{t("Роздільність")}<select value={exportSize} disabled={progress !== null} onChange={e => setExportSize(e.target.value)}><option value="source">{t('Розмір проєкту')} · {project.width} × {project.height}</option>{['1080', '720', '480'].filter(edge => outputSize(edge).height !== project.height || outputSize(edge).width !== project.width).map(edge => <option value={edge} key={edge}>{edge}p · {outputSize(edge).width} × {outputSize(edge).height}</option>)}</select></label><label>{t("Формат")}<select value={exportFormat || formats[0]?.mimeType || ""} disabled={progress !== null} onChange={e => setExportFormat(e.target.value)}>{formats.map(f => <option key={f.mimeType} value={f.mimeType}>{f.label}</option>)}</select></label></div>{!formats.length && <p className="error-message">{t("Браузер не підтримує відеоекспорт. Відкрийте CutSync в актуальному Chrome, Edge або Safari.")}</p>}{missingMedia.length > 0 && <p className="error-message">{t("Є втрачені медіафайли. Імпортуйте оригінали перед експортом.")}</p>}<div className="export-notice"><Clock3 size={17} /><p>{t("Обробка відбувається в реальному часі.")}<span>{t("Не закривайте та не приховуйте цю вкладку до завершення. Доступні формати залежать від браузера.")}</span></p></div>{progress !== null ? <><div className="export-progress"><span>{t("Створюємо ваше відео")}<strong>{Math.round(progress * 100)}%</strong></span><progress max="1" value={progress} /></div><button className="secondary-button full-width" onClick={() => abort.current?.abort()}>{t("Скасувати експорт")}</button></> : <button className="primary-button full-width" disabled={!formats.length || !canExport} onClick={() => void doExport()}><Download size={17} />{t("Експортувати відео")}</button>}<div className="modal-private"><ShieldCheck size={13} />{t("Без сервера. Без завантаження ваших файлів.")}</div></>}
 {modal === "sync" && <><div className="modal-icon"><Activity size={26} /></div><h2>{t("Один момент. Різні ракурси.")}</h2><p>{t("Спочатку знайдіть збіг, потім застосуйте вирівнювання.")}</p>{audioClips.length < 2 ? <div className="empty-sync"><AudioLines size={30} /><p>{t("Додайте на шкалу щонайменше два кліпи зі звуком — наприклад, відео з камери та запис рекордера.")}</p></div> : <><div className="modal-fields single"><label>{t("Еталонний запис")}<select value={syncRef} onChange={e => {
                  setSyncRef(e.target.value);
                  setSyncMatch(null);
                  setSyncResult('');
                }}><option value="">{t("Оберіть кліп")}</option>{audioClips.map(c => <option key={c.id} value={c.id}>{c.name} ({c.trackId.toUpperCase()})</option>)}</select></label><label>{t("Кліп для вирівнювання")}<select value={syncTarget} onChange={e => {
                  setSyncTarget(e.target.value);
                  setSyncMatch(null);
                  setSyncResult('');
                }}><option value="">{t("Оберіть кліп")}</option>{audioClips.map(c => <option key={c.id} value={c.id}>{c.name} ({c.trackId.toUpperCase()})</option>)}</select></label></div><p className="panel-hint">{t("Порівнюємо звукові хвилі локально. Найкращий результат дають записи зі спільною мовою, музикою або оплесками.")}</p><button className="primary-button full-width" disabled={!!busy || !syncRef || !syncTarget || syncRef === syncTarget} onClick={() => void sync()}>{busy ? <LoaderCircle size={17} className="spin" /> : <WandSparkles size={17} />}{t("Знайти збіг")}</button>{syncResult && <div className="sync-result" role="status">{t(syncResult)}{syncMatch && <div className="sync-match-details"><strong>{syncMatch.offset >= 0 ? '+' : ''}{syncMatch.offset.toFixed(3)} {t('с')}</strong><span>{t('Впевненість')}: {Math.round(syncMatch.confidence * 100)}%</span></div>}</div>}{syncMatch && <><label className="sync-option"><input type="checkbox" checked={muteSynced} onChange={e => setMuteSynced(e.target.checked)} />{t('Вимкнути звук кліпу, що вирівнюється')}</label><button className="primary-button full-width sync-apply" onClick={applySync}><Check size={16} />{t('Застосувати вирівнювання')}</button></>}</>}</>}
 {modal === "help" && <><div className="modal-icon"><CircleHelp size={26} /></div><h2>{t("Монтуйте у своєму ритмі.")}</h2><p>{t("CutSync — ваша локальна монтажна студія.")}</p><div className="help-steps"><div><b>01</b><p><strong>{t("Додайте матеріали")}</strong><span>{t("Імпортуйте файли в медіатеку. Клік відкриває джерело для перегляду; кнопка + або перетягування додає його на шкалу.")}</span></p></div><div><b>02</b><p><strong>{t("Зберіть свою історію")}</strong><span>{t("Переміщуйте кліпи, тягніть за краї для обрізання, розрізайте в позиції курсора. V2 перекриває V1. Звук обох доріжок змішується.")}</span></p></div><div><b>03</b><p><strong>{t("Доведіть до досконалості")}</strong><span>{t("Виберіть кліп і налаштуйте колір та звук праворуч. Для очищення поставте курсор на ділянку лише з шумом і зніміть взірець.")}</span></p></div></div><div className="shortcuts">{[[t("Відтворення / пауза"), "Space"], [t("Розрізати кліп"), "S"], [t("Видалити вибране"), "Delete"], [t("Кадр назад / уперед"), "← / →"], [t("Скасувати / повторити"), "⌘ Z / ⌘ ⇧ Z"], [t("Зберегти проєкт у файл"), "⌘ S"]].map(([label, key]) => <div key={label}><span>{label}</span><kbd>{key}</kbd></div>)}</div><p className="help-privacy"><ShieldCheck size={17} />{t("Файли та зміни зберігаються у цьому браузері. JSON проєкту містить монтаж і назви файлів; збережіть оригінали окремо. Для відео зі звуком потрібен кодек, який браузер може декодувати. Автоматичної транскрипції немає; субтитри вводяться вручну або імпортуються з SRT / VTT.")}</p></>}
 </section></div>}
  </div>;
}
