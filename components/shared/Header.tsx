import Logo from "./Logo";

export default function Header() {
  return (
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-line px-4">
      <Logo />
      <div className="leading-tight">
        <div className="text-sm font-semibold uppercase tracking-widest2 text-foam">
          Tile Analysis
        </div>
        <div className="text-[10px] uppercase tracking-widest text-muted">
          Proto-Architectural Workspace
        </div>
      </div>
    </header>
  );
}
