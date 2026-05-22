import { Download, Loader2 } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { DEFAULT_FPS, MIN_EXPORT_WIDTH } from "../../constants";
import { clamp } from "../../lib/math";
import type { ExportFormat } from "../../types";
import { ExportButton } from "../ui/Buttons";
import { Field } from "../ui/Field";
import { PanelGroup } from "../ui/PanelGroup";
import { ProgressBar } from "../ui/ProgressBar";
import { SegmentedControl } from "../ui/SegmentedControl";

type ExportPanelProps = {
  exportFormat: ExportFormat;
  exportFps: number;
  exportProgress: number;
  exportQuality: number;
  exportResultFormat: ExportFormat | null;
  exportStatus: string;
  exportTimeline: () => void;
  exportUrl: string | null;
  exportWidth: number;
  hasFile: boolean;
  isExporting: boolean;
  segmentsCount: number;
  setExportFormat: (format: ExportFormat) => void;
  setExportFps: Dispatch<SetStateAction<number>>;
  setExportQuality: Dispatch<SetStateAction<number>>;
  setExportWidth: Dispatch<SetStateAction<number>>;
};

export function ExportPanel({
  exportFormat,
  exportFps,
  exportProgress,
  exportQuality,
  exportResultFormat,
  exportStatus,
  exportTimeline,
  exportUrl,
  exportWidth,
  hasFile,
  isExporting,
  segmentsCount,
  setExportFormat,
  setExportFps,
  setExportQuality,
  setExportWidth
}: ExportPanelProps) {
  const shouldShowProgress = isExporting && exportProgress > 0;
  const shouldShowStatus = isExporting || (Boolean(exportStatus) && exportStatus !== "Ready");
  const downloadUrl = exportResultFormat === exportFormat ? exportUrl : null;

  return (
    <PanelGroup title="Export">
      <SegmentedControl
        onChange={setExportFormat}
        options={[
          { label: "WebP", value: "webp" },
          { label: "GIF", value: "gif" }
        ]}
        value={exportFormat}
      />
      <Field label="FPS">
        <input
          max={120}
          min={4}
          onChange={(event) => setExportFps(clamp(Number(event.target.value) || DEFAULT_FPS, 4, 120))}
          step="0.001"
          type="number"
          value={exportFps}
        />
      </Field>
      <Field label="Width">
        <input
          min={MIN_EXPORT_WIDTH}
          onChange={(event) =>
            setExportWidth(Math.max(MIN_EXPORT_WIDTH, Math.round(Number(event.target.value) || 720)))
          }
          step={2}
          type="number"
          value={exportWidth}
        />
      </Field>
      <Field label="Quality">
        <input
          disabled={exportFormat === "gif"}
          max={100}
          min={10}
          onChange={(event) => setExportQuality(clamp(Number(event.target.value) || 76, 10, 100))}
          type="range"
          value={exportQuality}
        />
      </Field>
      <ExportButton disabled={!hasFile || !segmentsCount || isExporting} onClick={exportTimeline}>
        {isExporting ? <Loader2 className="spin" size={17} /> : <Download size={17} />}
        <span>Render</span>
      </ExportButton>
      {shouldShowProgress ? <ProgressBar value={exportProgress} /> : null}
      {shouldShowStatus ? <div className="exportStatus">{exportStatus}</div> : null}
      {downloadUrl ? (
        <a className="downloadLink" download={`loopcut.${exportFormat}`} href={downloadUrl}>
          <Download size={16} />
          <span>Download {exportFormat.toUpperCase()}</span>
        </a>
      ) : null}
    </PanelGroup>
  );
}
