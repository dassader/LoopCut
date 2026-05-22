import type { Thumbnail } from "../types";
import { clamp } from "./math";

export function waitForVideoEvent(video: HTMLVideoElement, eventName: string) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener(eventName, onEvent);
      video.removeEventListener("error", onError);
    };
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Video frame could not be decoded."));
    };

    video.addEventListener(eventName, onEvent, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

export async function seekVideoFrame(video: HTMLVideoElement, time: number) {
  if (Math.abs(video.currentTime - time) < 0.002 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    return;
  }

  video.currentTime = time;
  await waitForVideoEvent(video, "seeked");
}

export async function createThumbnails(url: string, duration: number, signal: AbortSignal) {
  if (!duration || !Number.isFinite(duration)) {
    return [];
  }

  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "metadata";
  video.src = url;

  await waitForVideoEvent(video, "loadedmetadata");
  if (signal.aborted) {
    return [];
  }

  const canvas = document.createElement("canvas");
  const width = 144;
  const height = 82;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return [];
  }

  const count = clamp(Math.round(duration * 1.4), 14, 76);
  const thumbnails: Thumbnail[] = [];

  for (let index = 0; index < count; index += 1) {
    if (signal.aborted) {
      return [];
    }

    const maxTime = Math.max(0, duration - 0.05);
    const minTime = maxTime > 0.001 ? 0.001 : 0;
    const time = clamp(((index + 0.5) / count) * duration, minTime, maxTime);
    await seekVideoFrame(video, time);

    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(video, 0, 0, width, height);
    thumbnails.push({ time, url: canvas.toDataURL("image/jpeg", 0.62) });
  }

  video.removeAttribute("src");
  video.load();

  return thumbnails;
}

