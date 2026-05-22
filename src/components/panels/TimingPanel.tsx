import type { Dispatch, SetStateAction } from "react";
import { DEFAULT_FPS } from "../../constants";
import { clamp } from "../../lib/math";
import { Field } from "../ui/Field";
import { NumberInput } from "../ui/NumberInput";
import { PanelGroup } from "../ui/PanelGroup";

type TimingPanelProps = {
  fps: number;
  setFps: Dispatch<SetStateAction<number>>;
};

export function TimingPanel({ fps, setFps }: TimingPanelProps) {
  return (
    <PanelGroup title="Timing">
      <Field label="FPS step">
        <NumberInput
          max={120}
          min={1}
          normalize={(value) => clamp(value || DEFAULT_FPS, 1, 120)}
          onCommit={setFps}
          step="0.001"
          value={fps}
        />
      </Field>
    </PanelGroup>
  );
}
