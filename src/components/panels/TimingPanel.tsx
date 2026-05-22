import type { Dispatch, SetStateAction } from "react";
import { DEFAULT_FPS } from "../../constants";
import { clamp } from "../../lib/math";
import { Field } from "../ui/Field";
import { PanelGroup } from "../ui/PanelGroup";

type TimingPanelProps = {
  fps: number;
  setFps: Dispatch<SetStateAction<number>>;
};

export function TimingPanel({ fps, setFps }: TimingPanelProps) {
  return (
    <PanelGroup title="Timing">
      <Field label="FPS step">
        <input
          max={120}
          min={1}
          onChange={(event) => setFps(clamp(Number(event.target.value) || DEFAULT_FPS, 1, 120))}
          step="0.001"
          type="number"
          value={fps}
        />
      </Field>
    </PanelGroup>
  );
}
