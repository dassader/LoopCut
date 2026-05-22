import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
};

export function ToolButton({ children, className = "", ...props }: ButtonProps) {
  return (
    <button className={`toolButton ${className}`.trim()} type="button" {...props}>
      {children}
    </button>
  );
}

export function IconButton({ children, className = "", ...props }: ButtonProps) {
  return (
    <button className={`iconButton ${className}`.trim()} type="button" {...props}>
      {children}
    </button>
  );
}

export function PrimaryButton({ children, className = "", ...props }: ButtonProps) {
  return (
    <button className={`primaryButton ${className}`.trim()} type="button" {...props}>
      {children}
    </button>
  );
}

export function ExportButton({ children, className = "", ...props }: ButtonProps) {
  return (
    <button className={`exportButton ${className}`.trim()} type="button" {...props}>
      {children}
    </button>
  );
}

