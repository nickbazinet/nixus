import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"
import { useTheme } from "next-themes"

// One at a time, auto-dismissing, announced politely. A toast must never carry the only copy of an
// error the user has to act on — that goes inline via Alert, because a toast that has already
// dismissed itself leaves the user with a failed action and no record of it.
const Toaster = ({ ...props }: ToasterProps) => {
  const { resolvedTheme } = useTheme()

  return (
    <Sonner
      theme={(resolvedTheme as "light" | "dark") ?? "system"}
      className="toaster group"
      position="bottom-right"
      duration={4000}
      visibleToasts={1}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--card)",
          "--normal-text": "var(--ink)",
          "--normal-border": "var(--line-strong)",
          "--border-radius": "var(--radius-lg)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast:
            "cn-toast rounded-lg border border-line-strong bg-card text-body text-ink shadow-float",
          description: "text-caption text-ink-dim",
          actionButton: "text-label",
          cancelButton: "text-label",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
