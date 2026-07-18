import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent
} from "react";
import type { VideoMedia } from "../types";

export interface VideoPlayerProps {
  media: VideoMedia;
  className?: string;
  title?: string;
}

const CONTROL_HIDE_DELAY = 2200;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${minutes}:${String(rest).padStart(2, "0")}`;
}

function PlayGlyph({ paused }: { paused: boolean }) {
  return paused ? (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.8 5.6v12.8L18 12 7.8 5.6Z" fill="currentColor" /></svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5.5h3.5v13H7v-13Zm6.5 0H17v13h-3.5v-13Z" fill="currentColor" /></svg>
  );
}

function VolumeGlyph({ muted, volume }: { muted: boolean; volume: number }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9.1h3.1l4-3.3v12.4l-4-3.3H4V9.1Z" fill="currentColor" />
      {!muted && volume > 0 && <path d="M14 9.1a4 4 0 0 1 0 5.8M16.7 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />}
      {(muted || volume === 0) && <path d="m15.2 9.3 4.6 5.4m0-5.4-4.6 5.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}
    </svg>
  );
}

function PictureInPictureGlyph() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.2" y="5" width="17.6" height="14" rx="1.8" fill="none" stroke="currentColor" strokeWidth="1.6" /><rect x="11.2" y="11" width="7.1" height="5.4" rx=".8" fill="currentColor" /></svg>;
}

function FullscreenGlyph() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.7 4.5H4.5v4.2M15.3 4.5h4.2v4.2M8.7 19.5H4.5v-4.2m10.8 4.2h4.2v-4.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function VideoPlayer({ media, className = "", title = "帖子视频" }: VideoPlayerProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hideTimerRef = useRef<number | undefined>(undefined);
  const [paused, setPaused] = useState(true);
  const [waiting, setWaiting] = useState(false);
  const [failed, setFailed] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(media.duration ?? 0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [pictureInPictureAvailable, setPictureInPictureAvailable] = useState(false);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current !== undefined) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = undefined;
    }
  }, []);

  const revealControls = useCallback(() => {
    clearHideTimer();
    setControlsVisible(true);
    const activeElement = document.activeElement;
    const controlHasFocus = Boolean(
      activeElement
      && activeElement !== frameRef.current
      && activeElement !== videoRef.current
      && frameRef.current?.contains(activeElement)
    );
    if (!videoRef.current?.paused && !controlHasFocus) {
      hideTimerRef.current = window.setTimeout(() => setControlsVisible(false), CONTROL_HIDE_DELAY);
    }
  }, [clearHideTimer]);

  const pause = useCallback(() => {
    videoRef.current?.pause();
    clearHideTimer();
    setControlsVisible(true);
  }, [clearHideTimer]);

  const togglePlayback = useCallback(async () => {
    const video = videoRef.current;
    if (!video || failed) return;
    if (!video.paused) {
      pause();
      return;
    }

    document.querySelectorAll("video").forEach((candidate) => {
      if (candidate !== video) candidate.pause();
    });
    try {
      await video.play();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setFailed(true);
    }
  }, [failed, pause]);

  useEffect(() => {
    setFailed(false);
    setPaused(true);
    setWaiting(false);
    setCurrentTime(0);
    setDuration(media.duration ?? 0);
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.currentTime = 0;
      video.load();
    }
  }, [media.duration, media.url]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setPictureInPictureAvailable(Boolean(document.pictureInPictureEnabled && video.requestPictureInPicture));

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") pause();
    };
    const onPageHide = () => pause();
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      clearHideTimer();
      video.pause();
      if (document.pictureInPictureElement === video) {
        void document.exitPictureInPicture().catch(() => undefined);
      }
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [clearHideTimer, pause]);

  const durationLabel = useMemo(
    () => media.durationLabel || formatTime(duration || media.duration || 0),
    [duration, media.duration, media.durationLabel]
  );

  function handleProgress(event: ChangeEvent<HTMLInputElement>) {
    const video = videoRef.current;
    if (!video) return;
    const next = Number(event.currentTarget.value);
    video.currentTime = next;
    setCurrentTime(next);
  }

  function handleVolume(event: ChangeEvent<HTMLInputElement>) {
    const video = videoRef.current;
    if (!video) return;
    const next = Number(event.currentTarget.value);
    video.volume = next;
    video.muted = next === 0;
    setVolume(next);
    setMuted(next === 0);
  }

  function toggleMuted() {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
  }

  function changePlaybackRate(event: ChangeEvent<HTMLSelectElement>) {
    const next = Number(event.currentTarget.value);
    if (videoRef.current) videoRef.current.playbackRate = next;
    setPlaybackRate(next);
  }

  async function togglePictureInPicture() {
    const video = videoRef.current;
    if (!video || !pictureInPictureAvailable) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch {
      // Browsers may reject PiP while the video is not ready; playback stays usable.
    }
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await frameRef.current?.requestFullscreen();
    } catch {
      // Fullscreen is optional and can be blocked by the host browser.
    }
  }

  function handleKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    const video = videoRef.current;
    if (!video || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLButtonElement) return;
    if (event.key === " " || event.key === "k") {
      event.preventDefault();
      void togglePlayback();
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const delta = event.key === "ArrowRight" ? 5 : -5;
      video.currentTime = Math.max(0, Math.min(duration || video.duration, video.currentTime + delta));
    } else if (event.key.toLowerCase() === "m") {
      toggleMuted();
    } else if (event.key.toLowerCase() === "f") {
      void toggleFullscreen();
    }
  }

  return (
    <div
      ref={frameRef}
      className={`video-player ${paused ? "is-paused" : "is-playing"} ${waiting ? "is-waiting" : ""} ${controlsVisible ? "are-controls-visible" : "are-controls-hidden"} ${className}`.trim()}
      tabIndex={0}
      role="region"
      aria-label={title}
      onKeyDown={handleKeyboard}
      onPointerMove={revealControls}
      onPointerLeave={() => {
        const activeElement = document.activeElement;
        const controlHasFocus = Boolean(
          activeElement
          && activeElement !== frameRef.current
          && activeElement !== videoRef.current
          && frameRef.current?.contains(activeElement)
        );
        if (!paused && !controlHasFocus) setControlsVisible(false);
      }}
      onFocusCapture={revealControls}
    >
      <video
        ref={videoRef}
        className="video-player__media"
        src={media.url}
        poster={media.poster || undefined}
        preload="metadata"
        playsInline
        disablePictureInPicture={!pictureInPictureAvailable}
        aria-label={title}
        onClick={() => void togglePlayback()}
        onPlay={() => { setPaused(false); setFailed(false); revealControls(); }}
        onPause={() => { setPaused(true); clearHideTimer(); setControlsVisible(true); }}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => { setWaiting(false); setPaused(false); revealControls(); }}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onDurationChange={(event) => {
          if (Number.isFinite(event.currentTarget.duration)) setDuration(event.currentTarget.duration);
        }}
        onVolumeChange={(event) => {
          setMuted(event.currentTarget.muted);
          setVolume(event.currentTarget.volume);
        }}
        onEnded={() => { setPaused(true); setControlsVisible(true); }}
        onError={() => { setFailed(true); setWaiting(false); setPaused(true); }}
      />

      {failed ? (
        <div className="video-player__error" role="alert">
          <strong>视频暂时无法播放</strong>
          <span>播放地址可能已失效，请重新打开帖子再试。</span>
        </div>
      ) : paused ? (
        <button className="video-player__center-play" type="button" aria-label="播放视频" onClick={() => void togglePlayback()}>
          <PlayGlyph paused />
        </button>
      ) : null}

      {waiting && <span className="video-player__spinner" role="status" aria-label="视频缓冲中" />}

      {!failed && <div className="video-player__controls">
        <label className="video-player__progress">
          <span className="sr-only">视频进度</span>
          <input
            type="range"
            min="0"
            max={Math.max(duration || media.duration || 0, 0.1)}
            step="0.05"
            value={Math.min(currentTime, duration || media.duration || currentTime)}
            onChange={handleProgress}
            aria-label="视频进度"
          />
        </label>

        <div className="video-player__control-row">
          <button type="button" onClick={() => void togglePlayback()} aria-label={paused ? "播放" : "暂停"}><PlayGlyph paused={paused} /></button>
          <span className="video-player__time"><time>{formatTime(currentTime)}</time><i>/</i><time>{durationLabel}</time></span>
          <div className="video-player__spacer" />
          <div className="video-player__volume">
            <button type="button" onClick={toggleMuted} aria-label={muted ? "取消静音" : "静音"}><VolumeGlyph muted={muted} volume={volume} /></button>
            <label><span className="sr-only">音量</span><input type="range" min="0" max="1" step="0.05" value={muted ? 0 : volume} onChange={handleVolume} aria-label="音量" /></label>
          </div>
          <label className="video-player__rate">
            <span className="sr-only">播放速度</span>
            <select value={playbackRate} onChange={changePlaybackRate} aria-label="播放速度">
              {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => <option key={rate} value={rate}>{rate === 1 ? "倍速" : `${rate}×`}</option>)}
            </select>
          </label>
          {pictureInPictureAvailable && <button type="button" onClick={() => void togglePictureInPicture()} aria-label="画中画"><PictureInPictureGlyph /></button>}
          <button type="button" onClick={() => void toggleFullscreen()} aria-label="全屏"><FullscreenGlyph /></button>
        </div>
      </div>}
    </div>
  );
}
