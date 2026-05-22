import { useEffect, useState } from "react";
import { createThumbnails } from "../lib/video";
import type { Thumbnail } from "../types";

export function useThumbnails(videoUrl: string | null, duration: number) {
  const [thumbnails, setThumbnails] = useState<Thumbnail[]>([]);
  const [thumbnailsLoading, setThumbnailsLoading] = useState(false);

  useEffect(() => {
    if (!videoUrl || !duration) {
      setThumbnails([]);
      return;
    }

    const controller = new AbortController();
    setThumbnailsLoading(true);

    createThumbnails(videoUrl, duration, controller.signal)
      .then((nextThumbnails) => {
        if (!controller.signal.aborted) {
          setThumbnails(nextThumbnails);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setThumbnails([]);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setThumbnailsLoading(false);
        }
      });

    return () => controller.abort();
  }, [duration, videoUrl]);

  return { thumbnails, thumbnailsLoading };
}

