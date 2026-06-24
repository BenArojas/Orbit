import type { ReactElement } from "react";
import type { LucideIcon } from "lucide-react";
import { Activity, Briefcase, NotebookPen } from "lucide-react";
import { GatewaySetup } from "@/components/gateway/GatewaySetup";
import { useGatewayContext } from "@/context/GatewayContext";
import { InflectModule } from "@/modules/inflect/InflectModule";
import { MoonMarketModule } from "@/modules/moonmarket/MoonMarketModule";
import { ParallaxModule } from "@/modules/parallax/ParallaxModule";

export type OrbitModuleId = "parallax" | "moonmarket" | "inflect";

type OrbitModuleDefinition = {
  id: OrbitModuleId;
  label: string;
  description: string;
  path: string;
  icon: LucideIcon;
  requiresAuth: boolean;
  render: () => ReactElement;
};

export const orbitModules: Record<OrbitModuleId, OrbitModuleDefinition> = {
  parallax: {
    id: "parallax",
    label: "Parallax",
    description: "Technical analysis",
    path: "/parallax",
    icon: Activity,
    requiresAuth: true,
    render: () => <ParallaxModule />,
  },
  moonmarket: {
    id: "moonmarket",
    label: "MoonMarket",
    description: "Portfolio and trading",
    path: "/moonmarket",
    icon: Briefcase,
    requiresAuth: true,
    render: () => <MoonMarketModule />,
  },
  inflect: {
    id: "inflect",
    label: "Inflect",
    description: "Trading journal",
    path: "/inflect",
    icon: NotebookPen,
    requiresAuth: true,
    render: () => <InflectModule />,
  },
};

function ModuleLockedState({ module }: { module: OrbitModuleDefinition }) {
  return (
    <div className="flex min-h-screen bg-[var(--bg-1)] text-foreground">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10 lg:flex-row lg:items-start">
        <section className="flex-1 space-y-4 pt-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-[var(--text-3)]">
            Orbit Module Locked
          </p>
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold text-foreground">
              {module.label} is locked
            </h1>
            <p className="max-w-xl text-sm leading-6 text-[var(--text-2)]">
              Connect IBKR to open {module.label}. Orbit keeps you on this route so the
              reason is visible before the module mounts.
            </p>
          </div>
          <div className="rounded-lg border border-border bg-[var(--bg-2)]/70 px-4 py-3 text-[12px] text-[var(--text-2)]">
            Requested route: <span className="font-mono text-[var(--text-1)]">{module.path}</span>
            <br />
            Module: {module.description}
          </div>
        </section>

        <aside className="w-full max-w-xl rounded-xl border border-border bg-[var(--bg-2)] p-4 shadow-[0_0_32px_rgba(0,0,0,0.2)]">
          <GatewaySetup hideLogout />
        </aside>
      </div>
    </div>
  );
}

export function OrbitModuleEntry({ moduleId }: { moduleId: OrbitModuleId }) {
  const { isAuthenticated } = useGatewayContext();
  const module = orbitModules[moduleId];

  if (module.requiresAuth && !isAuthenticated) {
    return <ModuleLockedState module={module} />;
  }

  return module.render();
}
