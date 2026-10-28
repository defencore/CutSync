import { useI18n } from "./i18n";
import { useEffect, useRef, useState } from "react";
import { Activity, ArrowDownToLine, AudioLines, Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Clapperboard, Clock3, Captions, Download, Film, FolderOpen, Grid2X2, HardDrive, Headphones, Import, Layers, List, LoaderCircle, Maximize, MoreHorizontal, Music2, Pause, Play, Plus, Search, Settings2, ShieldCheck, SkipBack, SkipForward, SlidersHorizontal, Sparkles, Upload, WandSparkles, X } from "lucide-react";
import Timeline from "./Timeline";
import Inspector from "./Inspector";
import { createDemo } from "./demo";
import { TimelinePlayer, exportVideo, getExportFormats } from "./engine/media";
import { captureNoiseProfile, estimateOffset } from "./engine/audio";
import { downloadBlob, downloadProject, importMedia, loadProject, parseProjectFile, parseSubtitles, saveProject, subtitlesToSrt } from "./engine/project";
import { defaultAudio, defaultVideo, projectDuration, timecode, uid, type MediaAsset, type Project } from "./types";
type Panel = "media" | "audio" | "text" | "effects";
type Modal = "export" | "sync" | "help" | "new" | null;
const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);
export default function App() {
  const {
    t,
    language,
    setLanguage
  } = useI18n();
  const [initial] = useState(createDemo);
  const [project, setProject] = useState(initial.project),
    [assets, setAssets] = useState(initial.assets);
  const [time, setTime] = useState(4.2),
    [playing, setPlaying] = useState(false),
    [selected, setSelected] = useState<string | null>("demo-0");
  const [panel, setPanel] = useState<Panel>("media"),
    [filter, setFilter] = useState("all"),
    [search, setSearch] = useState(""),
    [list, setList] = useState(false),
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
  const [exportSize, setExportSize] = useState("1080"),
    [exportFormat, setExportFormat] = useState(""),
    [progress, setProgress] = useState<number | null>(null);
  const [syncRef, setSyncRef] = useState(""),
    [syncTarget, setSyncTarget] = useState(""),
    [syncResult, setSyncResult] = useState("");
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
  const pendingSeek=useRef<number|null>(null);
  const scrubWasPlaying = useRef(false);
  const initStarted = useRef(false);
  const duration = projectDuration(project);
  const clip = project.clips.find(c => c.id === selected),
    asset = assets.find(a => a.id === clip?.assetId),
    subtitle = project.subtitles.find(s => s.id === selected);
  const notify = (text: string) => setToast(text);
  function change(next: Project) {
    setHistory(h => [...h.slice(-59), projectRef.current]);
    setFuture([]);
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
    void player.current?.seek(value, playingRef.current).catch(e => notify(errorText(e)));
  }
  async function togglePlay() {
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
      notify(errorText(e));
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
    if (!canvas.current) return;
    const engine = new TimelinePlayer(canvas.current, () => projectRef.current, () => assetsRef.current, t => {
      setTime(t);
      if (t >= projectDuration(projectRef.current) - .04) setPlaying(false);
    });
    player.current = engine;
    void engine.seek(timeRef.current).catch(e => notify(errorText(e)));
    return () => {
      engine.dispose();
      player.current = null;
    };
  }, []);
  useEffect(() => {
    const requested=pendingSeek.current;pendingSeek.current=null;
    void (requested===null?player.current?.update():player.current?.seek(requested))?.catch(e=>notify(errorText(e)));
  }, [project, assets]);
  useEffect(() => {
    if (initStarted.current) return;
    initStarted.current = true;
    loadProject().then(saved => {
      if (saved) {
        pendingSeek.current=0;
        setProject(saved.project);
        setAssets(saved.assets);
        setTime(0);
        setSelected(saved.project.clips[0]?.id || null);
        setSaved("Відновлено локально");
      }
    }).catch(e => {
      setSaveBlocked(true);
      setSaved("Помилка відновлення");
      notify(`${errorText(e)} Попереднє збереження захищене. Відкрийте файл проєкту або створіть новий.`);
    }).finally(() => setLoaded(true));
  }, []);
  useEffect(() => {
    if (!loaded || saveBlocked) return;
    setSaved("Зберігаємо…");
    const timer = setTimeout(() => {
      saveProject(project, assets).then(() => setSaved("Збережено локально")).catch(e => {
        setSaved("Не збережено");
        notify(errorText(e));
      });
    }, 1500);
    return () => clearTimeout(timer);
  }, [project, assets, loaded, saveBlocked]);
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
      if (!loaded) return;
      if (e.key === "Escape") {
        if (progress !== null) abort.current?.abort();else {
          setModal(null);
          setInspectorOpen(false);
          setMenu(false);
        }
        return;
      }
      const target = e.target as HTMLElement;
      if (target.closest("input,textarea,select,[contenteditable=\"true\"]") || modal) return;
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
    const at = start ?? Math.max(0, ...project.clips.filter(c => c.trackId === target.id).map(c => c.start + c.duration));
    const newClip = {
      id: uid(),
      assetId: a.id,
      trackId: target.id,
      name: a.name,
      start: at,
      in: 0,
      duration: a.duration,
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
    notify(errors.length ? errors.join(" ") : `Імпортовано ${imported.length} ${imported.length === 1 ? t("матеріал") : t("матеріалів")}. Додайте їх на шкалу кнопкою + або перетягуванням.`);
  }
  async function handleProject(file: File) {
    try {
      setBusy("Відкриваємо проєкт…");
      const result = await parseProjectFile(file, assets);
      player.current?.pause();
      setPlaying(false);
      setSaveBlocked(false);
      pendingSeek.current=0;
      setProject(result.project);
      setAssets(result.assets);
      setTime(0);
      setSelected(result.project.clips[0]?.id || null);
      setHistory([]);
      setFuture([]);
      if (result.missing.length) notify(`Імпортуйте оригінали для відновлення зв’язків: ${result.missing.join(", ")}`);else notify("Проєкт відкрито.");
    } catch (e) {
      notify(errorText(e));
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
      notify(errorText(e));
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
      notify(errorText(e));
    }
  }
  const audioClips = project.clips.filter(c => assets.find(a => a.id === c.assetId)?.audioBuffer);
  function openSync() {
    setSyncRef(audioClips.find(c => c.id !== selected)?.id || "");
    setSyncTarget(audioClips.find(c => c.id === selected)?.id || audioClips[1]?.id || "");
    setSyncResult("");
    setModal("sync");
  }
  async function sync() {
    if (!syncRef || !syncTarget || syncRef === syncTarget) {
      setSyncResult("Оберіть два різні кліпи зі звуком.");
      return;
    }
    const ref = project.clips.find(c => c.id === syncRef)!,
      target = project.clips.find(c => c.id === syncTarget)!;
    setBusy("Порівнюємо звукові хвилі…");
    try {
      const result = await estimateOffset(assets.find(a => a.id === ref.assetId)!.audioBuffer!, assets.find(a => a.id === target.assetId)!.audioBuffer!);
      if (result.confidence < .35) {
        setSyncResult("Не знайдено надійного збігу. Записи мають містити спільний звук. Спробуйте іншу пару або вирівняйте кліпи вручну.");
        return;
      }
      const targetStart = ref.start + result.offset + target.in - ref.in;
      change({
        ...project,
        clips: project.clips.map(c => c.id === target.id ? {
          ...c,
          start: project.tracks.find(track => track.id === target.trackId)?.kind === "audio" ? targetStart : Math.max(0, targetStart)
        } : c.id === ref.id && targetStart < 0 && project.tracks.find(track => track.id === target.trackId)?.kind !== "audio" ? {
          ...c,
          start: c.start - targetStart
        } : c)
      });
      setSyncResult(`Синхронізовано. Зсув ${result.offset >= 0 ? "+" : ""}${result.offset.toFixed(3)} с · впевненість ${Math.round(result.confidence * 100)}%.`);
    } catch (e) {
      setSyncResult(errorText(e));
    } finally {
      setBusy("");
    }
  }
  const formats = typeof MediaRecorder === "undefined" ? [] : getExportFormats();
  async function doExport() {
    if (progress !== null) return;
    try {
      player.current?.pause();
      setPlaying(false);
      setProgress(0);
      abort.current = new AbortController();
      const height = +exportSize,
        width = Math.round(height * project.width / project.height / 2) * 2;
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
      notify(errorText(e));
    } finally {
      setProgress(null);
      abort.current = null;
      void player.current?.seek(time).catch(e => notify(errorText(e)));
    }
  }
  function newProject(demo = false) {
    pendingSeek.current=demo?4.2:0;
    setSaveBlocked(false);
    player.current?.pause();
    setPlaying(false);
    if (demo) {
      const next = createDemo();
      setProject(next.project);
      setAssets(next.assets);
      setTime(4.2);
      setSelected("demo-0");
    } else {
      setProject({
        ...initial.project,
        name: t("Новий проєкт"),
        clips: [],
        subtitles: []
      });
      setAssets([]);
      setTime(0);
      setSelected(null);
    }
    setHistory([]);
    setFuture([]);
    setModal(null);
  }
  const visibleAssets = assets.filter(a => (panel === "audio" ? a.kind === "audio" : filter === "all" || a.kind === filter) && a.name.toLowerCase().includes(search.toLowerCase()));
  return <div className={`studio ${inspectorOpen ? "inspector-open" : ""}`} onDragOver={e => {
    if (e.dataTransfer.types.includes("Files")) e.preventDefault();
  }} onDrop={e => {
    if (e.dataTransfer.files.length) {
      e.preventDefault();
      void handleFiles(e.dataTransfer.files);
    }
  }}>
 <input type="file" multiple accept="video/*,audio/*,image/*,.mkv,.mov,.m4a,.flac" ref={fileInput} hidden onChange={e => {
      void handleFiles(e.target.files);
      e.target.value = "";
    }} /><input type="file" accept=".json" ref={projectInput} hidden onChange={e => {
      if (e.target.files?.[0]) void handleProject(e.target.files[0]);
      e.target.value = "";
    }} /><input type="file" accept=".srt,.vtt" ref={subInput} hidden onChange={e => {
      if (e.target.files?.[0]) void handleSubs(e.target.files[0]);
      e.target.value = "";
    }} />
 <header className="app-header"><a className="brand" href="#" onClick={e => {
        e.preventDefault();
        setModal("new");
      }} aria-label={t("CutSync головна")}><span className="brand-icon"><AudioLines size={25} strokeWidth={2.7} /></span><span>CutSync<span className="brand-dot">.</span></span></a><span className="header-separator" /><div className="project-title"><input aria-label={t("Назва проєкту")} value={project.name} onChange={e => change({
          ...project,
          name: e.target.value
        })} /><span className="project-badge">{t("ПРОЄКТ")}</span></div><div className="save-indicator"><span className="status-dot" />{t(saved)}</div><div className="header-actions"><div className="language-switch" aria-label={t("Мова інтерфейсу")}><button className={language === "en" ? "active" : ""} onClick={() => setLanguage("en")}>EN</button><button className={language === "uk" ? "active" : ""} onClick={() => setLanguage("uk")}>UA</button></div><button className="header-help" onClick={() => setModal("help")} title={t("Довідка та гарячі клавіші")}><CircleHelp size={18} /></button><div className="project-menu-wrap"><button className="secondary-button project-button" onClick={() => setMenu(!menu)}><FolderOpen size={15} /><span>{t("Проєкт")}</span><ChevronDown size={13} /></button>{menu && <><div className="menu-backdrop" onClick={() => setMenu(false)} /><div className="dropdown-menu"><button onClick={() => {
                setMenu(false);
                setModal("new");
              }}><Plus size={15} />{t("Новий проєкт")}</button><button onClick={() => {
                setMenu(false);
                projectInput.current?.click();
              }}><FolderOpen size={15} />{t("Відкрити .cutsync.json")}</button><button onClick={() => {
                setMenu(false);
                downloadProject(project, assets);
              }}><Download size={15} />{t("Зберегти проєкт у файл")}</button><button onClick={() => {
                setMenu(false);
                void saveProject(project, assets).then(() => notify("Проєкт і медіа збережені в цьому браузері.")).catch(e => notify(errorText(e)));
              }}><HardDrive size={15} />{t("Зберегти у браузері")}</button></div></>}</div><button className="primary-button export-button" onClick={() => {
          setExportFormat(formats[0]?.mimeType || "");
          setModal("export");
        }}><ArrowDownToLine size={16} />{t("Експортувати")}<ChevronRight size={14} /></button></div></header>
 <div className="workspace"><nav className="rail" aria-label={t("Інструменти")}><div className="rail-top">{([{
            id: "media",
            icon: Clapperboard,
            label: t("Медіа")
          }, {
            id: "audio",
            icon: Music2,
            label: t("Аудіо")
          }, {
            id: "text",
            icon: Captions,
            label: t("Текст")
          }, {
            id: "effects",
            icon: SlidersHorizontal,
            label: t("Ефекти")
          }] as const).map(n => <button key={n.id} className={`rail-button ${panel === n.id ? "active" : ""}`} onClick={() => setPanel(n.id)}><n.icon size={21} /><span>{n.label}</span></button>)}</div><div className="rail-bottom"><button className="rail-button" title={t("Довідка")} onClick={() => setModal("help")}><CircleHelp size={20} /><span>{t("Довідка")}</span></button><div className="avatar">GA</div></div></nav>
 <aside className="library"><div className="panel-heading"><h2>{panel === "audio" ? t("Аудіотека") : panel === "text" ? t("Субтитри") : panel === "effects" ? t("Ефекти") : t("Медіатека")}</h2><span className="count-badge">{panel === "text" ? project.subtitles.length : panel === "effects" ? 6 : visibleAssets.length}</span><button className="tool" title={t("Відкрити меню проєкту")} onClick={() => setMenu(!menu)}><MoreHorizontal size={19} /></button></div>
 {(panel === "media" || panel === "audio") && <><div className="library-actions"><button className="import-button" onClick={() => fileInput.current?.click()}><Plus size={16} />{t("Імпортувати матеріали")}<span>⌘ I</span></button><div className="search-box"><Search size={14} /><input aria-label={t("Пошук матеріалів")} placeholder={t("Пошук матеріалів…")} value={search} onChange={e => setSearch(e.target.value)} />{search && <button className="tool" onClick={() => setSearch("")} aria-label={t("Очистити пошук")}><X size={12} /></button>}</div></div><div className="library-filters"><div>{(panel === "audio" ? ["all"] : ["all", "video", "audio", "image"]).map(f => <button key={f} className={filter === f ? "selected" : ""} onClick={() => setFilter(f)}>{f === "all" ? t("Усі") : f === "video" ? t("Відео") : f === "audio" ? t("Аудіо") : t("Фото")}</button>)}</div><button className="tool" title={list ? t("Сітка") : t("Список")} onClick={() => setList(!list)}>{list ? <Grid2X2 size={14} /> : <List size={14} />}</button></div><div className={`asset-grid ${list ? "list" : ""}`}>{visibleAssets.map(a => <div className={`asset-card ${asset?.id === a.id ? "is-selected" : ""}`} key={a.id} draggable={!!a.url} onDragStart={e => {
              e.dataTransfer.setData("application/cutsync", a.id);
              e.dataTransfer.effectAllowed = "copy";
            }} onDoubleClick={() => addAsset(a.id)}><div className={`asset-thumb ${a.kind === "audio" ? "audio-thumb" : ""} ${!a.url ? "missing-thumb" : ""}`} style={{
                backgroundImage: a.thumbnail ? `url("${a.thumbnail}")` : "none"
              }}>{a.kind === "audio" && <><AudioLines size={31} /><div className="mini-wave">{Array.from({
                      length: 29
                    }, (_, i) => <i key={i} style={{
                      height: Math.max(1, (a.waveform?.[Math.floor(i / 29 * (a.waveform.length - 1))] ?? 0) * 38)
                    }} />)}</div></>}{!a.url && <span>{t("Зв’яжіть оригінал")}</span>}<span className="asset-kind">{a.kind === "video" ? <Film size={10} /> : a.kind === "audio" ? <Music2 size={10} /> : <Layers size={10} />}</span><span className="asset-duration">{timecode(a.duration).slice(3, 8)}</span><button className="asset-add" title={`${t("Додати на шкалу")}: ${a.name}`} onClick={() => addAsset(a.id)} disabled={!a.url}><Plus size={14} /></button></div><div className="asset-title" title={a.name}>{a.name}</div><div className="asset-meta">{a.kind === "audio" ? t("Аудіо · локальний файл") : `${a.width ? `${a.width} × ${a.height}` : t("Зображення")}${a.demo ? t(" · демо") : ""}`}</div></div>)}{!visibleAssets.length && <div className="empty-library"><FolderOpen size={30} /><p>{t("Тут починається ваша історія")}</p><span>{t("Додайте відео, звук або фото")}</span></div>}</div><button className="drop-zone" onClick={() => fileInput.current?.click()}><Upload size={19} /><span>{t("Перетягніть файли сюди")}</span><small>{t("Відео, аудіо, зображення")}</small></button><div className="library-tip"><ShieldCheck size={16} /><p>{t("Ваші файли — тільки ваші.")}<span>{t("Обробка локально, без завантажень.")}</span></p></div></>}
 {panel === "text" && <div className="text-panel"><button className="import-button" onClick={addSubtitle}><Plus size={16} />{t("Додати субтитр")}</button><div className="sub-actions"><button className="secondary-button" onClick={() => subInput.current?.click()}><Import size={14} />{t("Імпорт SRT / VTT")}</button><button className="tool" title={t("Завантажити SRT")} disabled={!project.subtitles.length} onClick={() => downloadBlob(new Blob([subtitlesToSrt(project.subtitles)], {
              type: "text/plain"
            }), `${project.name}.srt`)}><Download size={16} /></button></div><p className="panel-hint">{t("Текст, час і стиль можна змінити у правій панелі. Субтитри вбудовуються у відео під час експорту.")}</p><div className="subtitle-list">{project.subtitles.map((s, i) => <button className={selected === s.id ? "selected" : ""} key={s.id} onClick={() => {
              setSelected(s.id);
              seek(s.start);
            }}><span className="sub-number">{String(i + 1).padStart(2, "0")}</span><div><small>{timecode(s.start).slice(3, 8)} → {timecode(s.end).slice(3, 8)}</small><p>{s.text}</p></div></button>)}</div></div>}
 {panel === "effects" && <div className="effects-panel"><p className="panel-hint">{t("Виберіть відеокліп на шкалі та застосуйте стиль. Усі параметри можна налаштувати праворуч.")}</p><div className="preset-grid">{[{
              name: t("Оригінал"),
              class: "original",
              b: 1,
              c: 1,
              s: 1,
              t: 0
            }, {
              name: t("Кіно"),
              class: "cinema",
              b: .94,
              c: 1.2,
              s: .8,
              t: -12
            }, {
              name: t("Теплий ранок"),
              class: "warm",
              b: 1.08,
              c: 1.05,
              s: 1.12,
              t: 32
            }, {
              name: t("Чорно-білий"),
              class: "mono",
              b: 1,
              c: 1.25,
              s: 0,
              t: 0
            }, {
              name: t("Яскравий"),
              class: "vivid",
              b: 1.1,
              c: 1.1,
              s: 1.4,
              t: 0
            }, {
              name: t("Туман"),
              class: "mist",
              b: 1.12,
              c: .85,
              s: .7,
              t: -20
            }].map(preset => <button key={preset.name} className="preset-card" onClick={() => {
              if (!clip || asset?.kind === "audio") {
                notify("Виберіть відеокліп або фото на шкалі.");
                return;
              }
              change({
                ...project,
                clips: project.clips.map(c => c.id === clip.id ? {
                  ...c,
                  video: {
                    ...c.video,
                    brightness: preset.b,
                    contrast: preset.c,
                    saturation: preset.s,
                    temperature: preset.t
                  }
                } : c)
              });
            }}><div className={preset.class} style={{
                backgroundImage: `url('${initial.assets[0].thumbnail}')`
              }} /><span>{preset.name}</span></button>)}</div><div className="effect-note"><Sparkles size={17} /><strong>{t("Ваша історія. Ваш колір.")}</strong><p>{t("Експозиція, контраст, насиченість, температура та розмиття — безпосередньо у браузері.")}</p></div></div>}
 </aside>
 <main className="editor-main"><div className="viewer-heading"><div><span className="live-dot" />{t("Попередній перегляд")} <span className="viewer-mode">{t("МОНТАЖ")}</span></div><div><span>{project.width} × {project.height}</span><span className="viewer-heading-divider" /> <span>{project.fps} fps</span><button className="tool" title={t("На весь екран")} onClick={() => {
              void canvas.current?.parentElement?.requestFullscreen().catch(() => notify("Повноекранний режим недоступний у цьому браузері."));
            }}><Maximize size={15} /></button></div></div><div className="viewer-area"><div className="video-stage" style={{
            aspectRatio: `${project.width}/${project.height}`,
            width: `min(100%, calc(100cqh * ${project.width / project.height}))`
          }}><canvas ref={canvas} width={project.width} height={project.height} aria-label={t("Попередній перегляд монтажу")} onClick={() => void togglePlay()} />{!project.clips.length && <div className="viewer-empty"><Clapperboard size={40} /><h2>{t("Кожна історія починається з кадру")}</h2><p>{t("Імпортуйте матеріали та додайте їх на шкалу")}</p><button className="primary-button" onClick={() => fileInput.current?.click()}><Plus size={16} />{t("Додати матеріали")}</button></div>}<span className="stage-corner tl" /><span className="stage-corner tr" /><span className="stage-corner bl" /><span className="stage-corner br" /></div></div>
 <div className="transport"><div className="time-display"><span>{timecode(time)}<small>/ {timecode(duration)}</small></span><label className="playhead-entry"><input aria-label={t("Позиція курсора, с")} title={t("Введіть точний час у секундах")} type="number" min="0" max={duration} step={1 / project.fps} value={timeDraft ?? Number(time.toFixed(3))} onFocus={() => setTimeDraft(String(Number(time.toFixed(3))))} onChange={e => setTimeDraft(e.target.value)} onBlur={() => {
                if (timeDraft !== null && timeDraft.trim() && Number.isFinite(+timeDraft)) seek(+timeDraft);
                setTimeDraft(null);
              }} onKeyDown={e => {
                if (e.key === "Enter") e.currentTarget.blur();
              }} /><span>{t("с")}</span></label></div><div className="playback-buttons"><button className="tool" title={t("На початок")} onClick={() => seek(0)}><SkipBack size={16} /></button><button className="tool" title={t("Кадр назад (←)")} onClick={() => seek(time - 1 / project.fps)}><ChevronLeft size={20} /></button><button className="play-button" title={playing ? t("Пауза (Space)") : t("Відтворити (Space)")} onClick={() => void togglePlay()} disabled={!duration}>{playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}</button><button className="tool" title={t("Кадр уперед (→)")} onClick={() => seek(time + 1 / project.fps)}><ChevronRight size={20} /></button><button className="tool" title={t("У кінець")} onClick={() => seek(duration)}><SkipForward size={16} /></button></div><div className="preview-tools"><span className="preview-scale">{t("Вмістити")}</span><span className="separator" /><Headphones size={15} /><span className="local-playback">{t("Локально")}</span></div></div>
 <div className="sequence-info"><span><Layers size={13} /> {t("Послідовність 01")}</span><button onClick={openSync}><WandSparkles size={13} />{t("Синхронізувати звук")}</button><button className="mobile-inspector-button" onClick={() => setInspectorOpen(true)}><Settings2 size={14} />{t("Інспектор")}</button><span className="sequence-demo">{assets.some(a => a.demo) ? t("Демонстраційний фотомонтаж") : t("Локальна монтажна студія")}</span></div>
 </main><button className="inspector-shade" aria-label={t("Закрити інспектор")} onClick={() => setInspectorOpen(false)} /><button className="inspector-mobile-close tool" title={t("Закрити інспектор")} onClick={() => setInspectorOpen(false)}><X size={19} /></button><Inspector clip={clip} asset={asset} subtitle={subtitle} project={project} time={time} onClipChange={next => change({
        ...project,
        clips: project.clips.map(c => c.id === next.id ? next : c)
      })} onProjectChange={change} onCaptureNoise={noise} onSync={openSync} onDelete={remove} />
 <div className="timeline-wrap"><Timeline project={project} assets={assets} time={time} selected={selected} onSelect={setSelected} onSeek={seek} onScrubStart={() => {
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
              notify(errorText(e));
            });
          }
          scrubWasPlaying.current = false;
        }} onChange={change} onSplit={split} onDelete={remove} onUndo={undo} onRedo={redo} canUndo={!!history.length} canRedo={!!future.length} onDrop={addAsset} /></div></div>
 {!loaded && <div className="startup-overlay" role="status"><LoaderCircle size={24} className="spin" /><strong>{t("Відновлюємо вашу студію…")}</strong><span>{t("Читаємо локальний проєкт і матеріали")}</span></div>}{busy && <div className="busy-banner" role="status"><LoaderCircle size={16} className="spin" />{t(busy)}</div>}{toast && <div className="toast" role="status"><Check size={17} /><span>{t(toast)}</span><button className="tool" title={t("Закрити повідомлення")} onClick={() => setToast("")}><X size={15} /></button></div>}
 {modal && <div className="modal-overlay" onMouseDown={e => {
      if (e.target === e.currentTarget && progress === null) setModal(null);
    }}><section className={`modal ${modal === "help" ? "help-modal" : ""}`} role="dialog" aria-modal="true" aria-label={modal === "export" ? t("Експорт відео") : modal === "sync" ? t("Синхронізація") : modal === "new" ? t("Новий проєкт") : t("Довідка")}><button className="modal-close tool" title={t("Закрити")} onClick={() => {
          if (progress !== null) abort.current?.abort();else setModal(null);
        }}><X size={20} /></button>
 {modal === "export" && <><div className="modal-icon"><ArrowDownToLine size={25} /></div><h2>{t("Історія готова до перегляду.")}</h2><p>{t("Експортуйте монтаж у відеофайл на свій пристрій.")}</p><div className="export-summary"><div className="export-thumbnail" style={{
              backgroundImage: `url('${assets.find(a => a.thumbnail)?.thumbnail || ""}')`
            }}><Play size={24} /></div><div><strong>{project.name}</strong><span>{timecode(duration)} · {project.fps} fps · {project.clips.length} {t("кліпів")}</span></div></div><div className="modal-fields"><label>{t("Роздільність")}<select value={exportSize} disabled={progress !== null} onChange={e => setExportSize(e.target.value)}><option value="1080">1080p · Full HD</option><option value="720">720p · HD</option><option value="480">{t("480p · компактний файл")}</option></select></label><label>{t("Формат")}<select value={exportFormat || formats[0]?.mimeType || ""} disabled={progress !== null} onChange={e => setExportFormat(e.target.value)}>{formats.map(f => <option key={f.mimeType} value={f.mimeType}>{f.label}</option>)}</select></label></div>{!formats.length && <p className="error-message">{t("Браузер не підтримує відеоекспорт. Відкрийте CutSync в актуальному Chrome, Edge або Safari.")}</p>}{assets.some(a => !a.url) && <p className="error-message">{t("Є втрачені медіафайли. Імпортуйте оригінали перед експортом.")}</p>}<div className="export-notice"><Clock3 size={17} /><p>{t("Обробка відбувається в реальному часі.")}<span>{t("Не закривайте та не приховуйте цю вкладку до завершення. Доступні формати залежать від браузера.")}</span></p></div>{progress !== null ? <><div className="export-progress"><span>{t("Створюємо ваше відео")}<strong>{Math.round(progress * 100)}%</strong></span><progress max="1" value={progress} /></div><button className="secondary-button full-width" onClick={() => abort.current?.abort()}>{t("Скасувати експорт")}</button></> : <button className="primary-button full-width" disabled={!formats.length || !duration || assets.some(a => !a.url)} onClick={() => void doExport()}><Download size={17} />{t("Експортувати відео")}</button>}<div className="modal-private"><ShieldCheck size={13} />{t("Без сервера. Без завантаження ваших файлів.")}</div></>}
 {modal === "sync" && <><div className="modal-icon"><Activity size={26} /></div><h2>{t("Один момент. Різні ракурси.")}</h2><p>{t("Зіставте спільний звук у двох записах, щоб автоматично вирівняти кліпи.")}</p>{audioClips.length < 2 ? <div className="empty-sync"><AudioLines size={30} /><p>{t("Додайте на шкалу щонайменше два кліпи зі звуком — наприклад, відео з камери та запис рекордера.")}</p></div> : <><div className="modal-fields single"><label>{t("Еталонний запис")}<select value={syncRef} onChange={e => setSyncRef(e.target.value)}><option value="">{t("Оберіть кліп")}</option>{audioClips.map(c => <option key={c.id} value={c.id}>{c.name} ({c.trackId.toUpperCase()})</option>)}</select></label><label>{t("Кліп для вирівнювання")}<select value={syncTarget} onChange={e => setSyncTarget(e.target.value)}><option value="">{t("Оберіть кліп")}</option>{audioClips.map(c => <option key={c.id} value={c.id}>{c.name} ({c.trackId.toUpperCase()})</option>)}</select></label></div><p className="panel-hint">{t("Порівнюємо звукові хвилі локально. Найкращий результат дають записи зі спільною мовою, музикою або оплесками.")}</p><button className="primary-button full-width" disabled={!!busy || !syncRef || !syncTarget || syncRef === syncTarget} onClick={() => void sync()}>{busy ? <LoaderCircle size={17} className="spin" /> : <WandSparkles size={17} />}{t("Знайти та синхронізувати")}</button>{syncResult && <div className="sync-result" role="status">{t(syncResult)}</div>}</>}</>}
 {modal === "new" && <><div className="modal-icon"><Clapperboard size={26} /></div><h2>{t("Нова історія починається тут.")}</h2><p>{t("Поточний проєкт буде замінено. Збережіть його у файл, щоб повернутися до монтажу пізніше.")}</p><button className="secondary-button full-width" onClick={() => downloadProject(project, assets)}><Download size={16} />{t("Завантажити поточний проєкт")}</button><div className="new-options"><button onClick={() => newProject()}><Plus size={26} /><strong>{t("Чистий проєкт")}</strong><span>{t("Почати зі своїх матеріалів")}</span></button><button onClick={() => newProject(true)}><Film size={26} /><strong>{t("Відкрити демо")}</strong><span>{t("Спробувати інструменти")}</span></button></div></>}
 {modal === "help" && <><div className="modal-icon"><CircleHelp size={26} /></div><h2>{t("Монтуйте у своєму ритмі.")}</h2><p>{t("CutSync — ваша локальна монтажна студія.")}</p><div className="help-steps"><div><b>01</b><p><strong>{t("Додайте матеріали")}</strong><span>{t("Імпортуйте відео, звук і фото. Додайте на шкалу кнопкою +, подвійним кліком або перетягуванням.")}</span></p></div><div><b>02</b><p><strong>{t("Зберіть свою історію")}</strong><span>{t("Переміщуйте кліпи, тягніть за краї для обрізання, розрізайте в позиції курсора. V2 перекриває V1. Звук обох доріжок змішується.")}</span></p></div><div><b>03</b><p><strong>{t("Доведіть до досконалості")}</strong><span>{t("Виберіть кліп і налаштуйте колір та звук праворуч. Для очищення поставте курсор на ділянку лише з шумом і зніміть взірець.")}</span></p></div></div><div className="shortcuts">{[[t("Відтворення / пауза"), "Space"], [t("Розрізати кліп"), "S"], [t("Видалити вибране"), "Delete"], [t("Кадр назад / уперед"), "← / →"], [t("Скасувати / повторити"), "⌘ Z / ⌘ ⇧ Z"], [t("Зберегти проєкт у файл"), "⌘ S"]].map(([label, key]) => <div key={label}><span>{label}</span><kbd>{key}</kbd></div>)}</div><p className="help-privacy"><ShieldCheck size={17} />{t("Файли та зміни зберігаються у цьому браузері. JSON проєкту містить монтаж і назви файлів; збережіть оригінали окремо. Для відео зі звуком потрібен кодек, який браузер може декодувати. Автоматичної транскрипції немає; субтитри вводяться вручну або імпортуються з SRT / VTT.")}</p></>}
 </section></div>}
 </div>;
}
