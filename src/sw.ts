/// <reference lib="webworker" />

import { clientsClaim } from "workbox-core";
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ revision: string | null; url: string }>;
};

type DownloadEntry = {
  controller: ReadableStreamDefaultController<Uint8Array> | null;
  done: boolean;
  error: Error | null;
  filename: string;
  id: string;
  mimeType: string;
  queue: Uint8Array[];
};

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();

const downloads = new Map<string, DownloadEntry>();

const encodeFilename = (filename: string) =>
  encodeURIComponent(filename).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

const flush = (entry: DownloadEntry) => {
  if (!entry.controller) {
    return;
  }

  while (entry.queue.length) {
    entry.controller.enqueue(entry.queue.shift()!);
  }

  if (entry.error) {
    entry.controller.error(entry.error);
    downloads.delete(entry.id);
    return;
  }

  if (entry.done) {
    entry.controller.close();
    downloads.delete(entry.id);
  }
};

self.addEventListener("message", (event) => {
  const message = event.data || {};
  if (message.type !== "REGISTER_DOWNLOAD" || !event.ports?.length) {
    return;
  }

  const port = event.ports[0];
  const entry: DownloadEntry = {
    id: message.id,
    filename: message.filename || "loopcut",
    mimeType: message.mimeType || "application/octet-stream",
    queue: [],
    controller: null,
    done: false,
    error: null
  };

  downloads.set(entry.id, entry);

  port.onmessage = (portEvent) => {
    const data = portEvent.data || {};
    if (data.type === "CHUNK" && data.chunk) {
      entry.queue.push(new Uint8Array(data.chunk));
      flush(entry);
    } else if (data.type === "END") {
      entry.done = true;
      flush(entry);
    } else if (data.type === "ERROR") {
      entry.error = new Error(data.message || "Download stream failed.");
      flush(entry);
    }
  };

  port.postMessage({ type: "READY" });
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const match = /\/stream-download\/([^/]+)/.exec(url.pathname);
  if (!match) {
    return;
  }

  const id = decodeURIComponent(match[1]);
  const entry = downloads.get(id);
  if (!entry) {
    event.respondWith(new Response("Download stream not found.", { status: 404 }));
    return;
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      entry.controller = controller;
      flush(entry);
    },
    cancel() {
      downloads.delete(id);
    }
  });

  event.respondWith(
    new Response(stream, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename=\"${entry.filename.replace(/"/g, "")}\"; filename*=UTF-8''${encodeFilename(
          entry.filename
        )}`,
        "Content-Type": entry.mimeType
      }
    })
  );
});

precacheAndRoute(self.__WB_MANIFEST);
