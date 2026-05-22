import type { ReactNode } from "react";

type SidePanelProps = {
  children: ReactNode;
};

export function SidePanel({ children }: SidePanelProps) {
  return <aside className="sidePanel">{children}</aside>;
}

