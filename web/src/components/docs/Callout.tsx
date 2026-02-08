import { clsx } from "clsx";

const styles = {
  info: {
    border: "border-blue/30",
    bg: "bg-blue/5",
    icon: "text-blue",
    iconChar: "i",
  },
  warning: {
    border: "border-yellow/30",
    bg: "bg-yellow/5",
    icon: "text-yellow",
    iconChar: "!",
  },
  danger: {
    border: "border-red/30",
    bg: "bg-red/5",
    icon: "text-red",
    iconChar: "!",
  },
};

export function Callout({
  type = "info",
  children,
}: {
  type?: "info" | "warning" | "danger";
  children: React.ReactNode;
}) {
  const s = styles[type];
  return (
    <div
      className={clsx(
        "my-6 rounded-xl border p-4",
        s.border,
        s.bg
      )}
    >
      <div className="flex gap-3">
        <div
          className={clsx(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold",
            s.icon,
            "border",
            s.border
          )}
        >
          {s.iconChar}
        </div>
        <div className="prose-sm text-text-secondary [&>p]:my-0">
          {children}
        </div>
      </div>
    </div>
  );
}
