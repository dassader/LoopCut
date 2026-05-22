import { clamp } from "../../lib/math";
import { segmentDuration } from "../../lib/timeline";
import type { Segment, Thumbnail } from "../../types";

type ClipFilmstripProps = {
  segment: Segment;
  thumbnails: Thumbnail[];
};

export function ClipFilmstrip({ segment, thumbnails }: ClipFilmstripProps) {
  const durationInClip = segmentDuration(segment);
  const visible = thumbnails.filter(
    (thumbnail) => thumbnail.time >= segment.sourceStart && thumbnail.time <= segment.sourceEnd
  );
  const fallback = thumbnails.length ? [thumbnails[Math.floor(thumbnails.length / 2)]] : [];
  const strip = visible.length ? visible : fallback;

  return (
    <div className="clipFilmstrip">
      {strip.map((thumbnail) => {
        const left = clamp(
          ((thumbnail.time - segment.sourceStart) / Math.max(durationInClip, 0.001)) * 100,
          0,
          100
        );

        return (
          <img
            alt=""
            className="clipThumb"
            key={`${segment.id}-${thumbnail.time}`}
            src={thumbnail.url}
            style={{ left: `${left}%` }}
          />
        );
      })}
    </div>
  );
}

