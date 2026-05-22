import { CircleAlert, Download, Loader2 } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { EXPORT_FPS_PRESETS, EXPORT_HEIGHT_PRESETS, MAX_EXPORT_SPEED, MIN_EXPORT_SPEED } from "../../constants";
import { clamp } from "../../lib/math";
import type { ExportFormat } from "../../types";
import { ExportButton } from "../ui/Buttons";
import { Field } from "../ui/Field";
import { PanelGroup } from "../ui/PanelGroup";
import { ProgressBar } from "../ui/ProgressBar";
import { SegmentedControl } from "../ui/SegmentedControl";

const SPEED_SLIDER_RANGE = 2;

type ExportPanelProps = {
  exportFormat: ExportFormat;
  exportFps: number;
  exportProgress: number;
  exportQuality: number;
  exportResultFormat: ExportFormat | null;
  exportSpeed: number;
  exportStatus: string;
  exportTimeline: () => void;
  exportUrl: string | null;
  exportHeight: number;
  hasFile: boolean;
  isExporting: boolean;
  segmentsCount: number;
  setExportFormat: (format: ExportFormat) => void;
  setExportFps: Dispatch<SetStateAction<number>>;
  setExportHeight: Dispatch<SetStateAction<number>>;
  setExportQuality: Dispatch<SetStateAction<number>>;
  setExportSpeed: Dispatch<SetStateAction<number>>;
};

export function ExportPanel({
  exportFormat,
  exportFps,
  exportProgress,
  exportQuality,
  exportResultFormat,
  exportSpeed,
  exportStatus,
  exportTimeline,
  exportUrl,
  exportHeight,
  hasFile,
  isExporting,
  segmentsCount,
  setExportFormat,
  setExportFps,
  setExportHeight,
  setExportQuality,
  setExportSpeed
}: ExportPanelProps) {
  const shouldShowProgress = isExporting && exportProgress > 0;
  const shouldShowStatus = isExporting && Boolean(exportStatus);
  const shouldShowErrorNote = !isExporting && Boolean(exportStatus) && exportStatus !== "Ready";
  const downloadUrl = exportResultFormat === exportFormat ? exportUrl : null;
  const speedSliderValue = clamp((Math.log2(exportSpeed) / SPEED_SLIDER_RANGE) * 100, -100, 100);

  return (
    <PanelGroup title="Export">
      <SegmentedControl
        disabled={isExporting}
        onChange={setExportFormat}
        options={[
          { label: "WebP", value: "webp" },
          { label: "GIF", value: "gif" }
        ]}
        value={exportFormat}
      />
      <Field label="FPS">
        <select disabled={isExporting} onChange={(event) => setExportFps(Number(event.target.value))} value={exportFps}>
          {EXPORT_FPS_PRESETS.map((fps) => (
            <option key={fps} value={fps}>
              {fps}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Height">
        <select disabled={isExporting} onChange={(event) => setExportHeight(Number(event.target.value))} value={exportHeight}>
          {EXPORT_HEIGHT_PRESETS.map((height) => (
            <option key={height} value={height}>
              {height}p
            </option>
          ))}
        </select>
      </Field>
      <Field label="Quality">
        <input
          disabled={exportFormat === "gif" || isExporting}
          max={100}
          min={10}
          onChange={(event) => setExportQuality(clamp(Number(event.target.value) || 76, 10, 100))}
          type="range"
          value={exportQuality}
        />
      </Field>
      <Field label="Speed">
        <div className="rangeValue">
          <input
            disabled={isExporting}
            max={100}
            min={-100}
            onChange={(event) =>
              setExportSpeed(
                clamp(
                  2 ** ((Number(event.target.value) / 100) * SPEED_SLIDER_RANGE),
                  MIN_EXPORT_SPEED,
                  MAX_EXPORT_SPEED
                )
              )
            }
            step={5}
            type="range"
            value={speedSliderValue}
          />
          <span>{exportSpeed.toFixed(2).replace(/\.?0+$/, "")}x</span>
        </div>
      </Field>
      <ExportButton disabled={!hasFile || !segmentsCount || isExporting} onClick={exportTimeline}>
        {isExporting ? <Loader2 className="spin" size={17} /> : <Download size={17} />}
        <span>Render</span>
      </ExportButton>
      {shouldShowProgress ? <ProgressBar value={exportProgress} /> : null}
      {shouldShowStatus ? <div className="exportStatus">{exportStatus}</div> : null}
      {shouldShowErrorNote ? (
        <div className="exportNote" role="alert">
          <div className="exportNoteHeader">
            <CircleAlert size={16} />
            <span>Error</span>
          </div>
          <div className="exportNoteBody">{exportStatus}</div>
        </div>
      ) : null}
      {downloadUrl ? (
        <a className="downloadLink" download={`loopcut.${exportFormat}`} href={downloadUrl}>
          <Download size={16} />
          <span>Download {exportFormat.toUpperCase()}</span>
        </a>
      ) : null}
    </PanelGroup>
  );
}
