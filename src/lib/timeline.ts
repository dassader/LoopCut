import type { Segment, TimelineHit } from "../types";
import { TIMELINE_CLIP_GAP, TIMELINE_PADDING_X } from "../constants";
import { clamp } from "./math";

export const segmentDuration = (segment: Segment) => Math.max(0, segment.sourceEnd - segment.sourceStart);

export const timelineDuration = (segments: Segment[]) =>
  segments.reduce((total, segment) => total + segmentDuration(segment), 0);

export function findTimelineHit(segments: Segment[], outputTime: number): TimelineHit | null {
  if (!segments.length) {
    return null;
  }

  let cursor = 0;
  const total = timelineDuration(segments);
  const clamped = clamp(outputTime, 0, total);

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const duration = segmentDuration(segment);
    const isLast = index === segments.length - 1;

    if (clamped < cursor + duration || isLast) {
      const offset = clamp(clamped - cursor, 0, duration);

      return {
        segment,
        index,
        clipStart: cursor,
        offset,
        sourceTime: segment.sourceStart + offset
      };
    }

    cursor += duration;
  }

  return null;
}

export const timelineVisualWidth = (segments: Segment[], zoom: number) =>
  TIMELINE_PADDING_X * 2 +
  timelineDuration(segments) * zoom +
  Math.max(0, segments.length - 1) * TIMELINE_CLIP_GAP;

export function outputTimeToTimelineX(segments: Segment[], outputTime: number, zoom: number) {
  const hit = findTimelineHit(segments, outputTime);
  if (!hit) {
    return TIMELINE_PADDING_X;
  }

  let x = TIMELINE_PADDING_X + hit.index * TIMELINE_CLIP_GAP;
  for (let index = 0; index < hit.index; index += 1) {
    x += segmentDuration(segments[index]) * zoom;
  }

  return x + hit.offset * zoom;
}

export function timelineXToOutputTime(segments: Segment[], x: number, zoom: number) {
  if (!segments.length) {
    return 0;
  }

  const localX = x - TIMELINE_PADDING_X;
  if (localX <= 0) {
    return 0;
  }

  let cursorX = 0;
  let cursorTime = 0;

  for (let index = 0; index < segments.length; index += 1) {
    const duration = segmentDuration(segments[index]);
    const clipWidth = duration * zoom;
    const clipEndX = cursorX + clipWidth;

    if (localX <= clipEndX) {
      return clamp(cursorTime + (localX - cursorX) / zoom, 0, timelineDuration(segments));
    }

    cursorTime += duration;

    const gapEndX = clipEndX + TIMELINE_CLIP_GAP;
    if (localX < gapEndX) {
      return cursorTime;
    }

    cursorX = gapEndX;
  }

  return timelineDuration(segments);
}
