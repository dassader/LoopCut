import { ensureServiceWorkerStreamingCapability } from "./capabilities";

export type DownloadWriter = {
  abort: (message: string) => void;
  close: () => void;
  write: (chunk: Uint8Array) => void;
};

export async function createDownloadWriter(filename: string, mimeType: string): Promise<DownloadWriter> {
  const { controller: activeWorker } = await ensureServiceWorkerStreamingCapability();
  const id = crypto.randomUUID();
  const channel = new MessageChannel();

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      channel.port1.onmessage = null;
      channel.port1.close();
      reject(new Error("Download stream did not initialize."));
    }, 8000);
    channel.port1.onmessage = (event) => {
      if (event.data?.type === "READY") {
        window.clearTimeout(timeout);
        channel.port1.onmessage = null;
        resolve();
      }
    };

    activeWorker.postMessage(
      {
        type: "REGISTER_DOWNLOAD",
        id,
        filename,
        mimeType
      },
      [channel.port2]
    );
  });

  const baseUrl = new URL(import.meta.env.BASE_URL || "/", window.location.origin);
  const downloadUrl = new URL(`stream-download/${encodeURIComponent(id)}/${encodeURIComponent(filename)}`, baseUrl);
  const frame = document.createElement("iframe");
  frame.hidden = true;
  frame.src = downloadUrl.toString();
  document.body.append(frame);

  const cleanupFrame = () => window.setTimeout(() => frame.remove(), 30_000);

  let closed = false;
  return {
    abort: (message) => {
      if (closed) {
        return;
      }
      closed = true;
      channel.port1.postMessage({ type: "ERROR", message });
      channel.port1.close();
      cleanupFrame();
    },
    close: () => {
      if (closed) {
        return;
      }
      closed = true;
      channel.port1.postMessage({ type: "END" });
      channel.port1.close();
      cleanupFrame();
    },
    write: (chunk) => {
      if (closed) {
        return;
      }

      const copy = chunk.byteOffset === 0 && chunk.byteLength === chunk.buffer.byteLength ? chunk : chunk.slice();
      channel.port1.postMessage({ type: "CHUNK", chunk: copy.buffer }, [copy.buffer]);
    }
  };
}
