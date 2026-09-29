"use client";

export type AppTab = "viewer" | "analysis" | "arrange";

interface Props {
  active: AppTab;
  onChange: (tab: AppTab) => void;
  hasTile: boolean;
}

export default function TabNav({ active, onChange, hasTile }: Props) {
  const tabs: { id: AppTab; label: string }[] = [
    { id: "viewer", label: "01  Viewer" },
    { id: "analysis", label: "02  Analysis" },
    { id: "arrange", label: "03  Arrange" },
  ];
  return (
    <nav className="flex h-11 shrink-0 items-stretch border-b border-line">
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        const disabled = (tab.id === "analysis" || tab.id === "arrange") && !hasTile;
        return (
          <button
            key={tab.id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(tab.id)}
            className={`px-5 text-xs uppercase tracking-widest2 transition-colors ${
              isActive
                ? "bg-accent text-ink"
                : disabled
                  ? "text-muted/40 cursor-not-allowed"
                  : "text-foam hover:bg-panel"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
