import type { ReactNode } from "react";

type PanelGroupProps = {
  title: string;
  children: ReactNode;
};

export function PanelGroup({ title, children }: PanelGroupProps) {
  return (
    <div className="panelGroup">
      <div className="groupTitle">{title}</div>
      {children}
    </div>
  );
}

