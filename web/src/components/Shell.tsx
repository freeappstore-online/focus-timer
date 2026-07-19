import type { ReactNode } from "react";

interface NavItem {
  id: string;
  label: string;
  icon: string;
}

interface ShellProps {
  children: ReactNode;
  navItems?: NavItem[];
  activeNav?: string;
  onNavChange?: (id: string) => void;
  appName?: string;
}

export function Shell({ children, navItems = [], activeNav, onNavChange, appName = "Focus" }: ShellProps) {
  return (
    <>
      {/* Desktop */}
      <div className="hidden md:flex h-screen">
        <aside
          className="flex flex-col border-r h-full shrink-0"
          style={{ width: "17rem", borderColor: "var(--line)", background: "var(--panel)" }}
        >
          <div className="p-6 font-bold text-xl" style={{ fontFamily: "Fraunces, serif" }}>
            {appName}
          </div>
          <nav className="flex-1 px-4 flex flex-col gap-1">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => onNavChange?.(item.id)}
                className="flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium w-full text-left transition-colors"
                style={{
                  background: activeNav === item.id ? "var(--accent)" : "transparent",
                  color: activeNav === item.id ? "#fff" : "var(--ink)",
                }}
              >
                <span className="text-lg">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </nav>
          <div className="p-4 text-xs" style={{ color: "var(--muted)" }}>
            <a
              href="https://freeappstore.online"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline"
              style={{ color: "var(--muted)" }}
            >
              Part of FreeAppStore — free forever
            </a>
          </div>
        </aside>
        <main className="flex-1 overflow-auto p-8">{children}</main>
      </div>

      {/* Mobile */}
      <div className="flex flex-col h-screen md:hidden">
        <header
          className="flex items-center px-4 h-14 border-b shrink-0"
          style={{ borderColor: "var(--line)", background: "var(--panel)" }}
        >
          <span className="font-bold text-lg" style={{ fontFamily: "Fraunces, serif" }}>
            {appName}
          </span>
        </header>
        <main className="flex-1 overflow-auto p-4">{children}</main>
        {navItems.length > 0 && (
          <nav
            className="flex items-center justify-around h-16 border-t shrink-0"
            style={{ borderColor: "var(--line)", background: "var(--dock)" }}
          >
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => onNavChange?.(item.id)}
                className="flex flex-col items-center gap-0.5 px-3 py-1 text-xs font-medium transition-colors"
                style={{ color: activeNav === item.id ? "var(--accent)" : "var(--muted)" }}
              >
                <span className="text-xl">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </nav>
        )}
      </div>
    </>
  );
}
