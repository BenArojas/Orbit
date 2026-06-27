/**
 * OrbitLauncher — route "/". Combined auth + launcher.
 *
 * Slim top bar (ORBIT wordmark + GatewayStatusPill) over four hero app tiles.
 * Tile enable/disable is driven by broker session mode from BrokerSessionContext:
 *   none           → TWS Assistant enabled as setup entry; CP modules disabled
 *   client_portal  → Parallax, MoonMarket, Inflect enabled; TWS Assistant disabled
 *   tws            → TWS Assistant enabled; Client Portal modules disabled
 */
import { useNavigate } from "react-router-dom";
import { useBrokerSession } from "@/context/BrokerSessionContext";
import { orbitModules } from "./moduleEntry";
import { AppIcon } from "./AppIcon";
import { GatewayStatusPill } from "./GatewayStatusPill";

export function OrbitLauncher() {
  const navigate = useNavigate();
  const { mode, isModuleAvailable } = useBrokerSession();

  const launcherHint =
    mode === "none"
      ? "Connect Client Portal Web API or open TWS Execution Assistant to connect TWS / IB Gateway."
      : mode === "tws"
        ? "TWS mode active — Client Portal modules are disabled."
        : null;

  return (
    <div className="flex h-screen flex-col bg-[var(--bg-1)]">
      {/* Top bar */}
      <nav className="relative z-10 flex min-h-12 items-center justify-between border-b border-border px-5 py-2">
        <span className="text-[16px] font-extrabold tracking-[4px] text-gradient-brand">
          ORBIT
        </span>
        <GatewayStatusPill />
      </nav>

      {/* Hero tiles */}
      <main className="flex flex-1 flex-col items-center justify-center gap-6">
        <div className="flex flex-wrap items-center justify-center gap-6">
          {Object.values(orbitModules).map((module) => (
            <AppIcon
              key={module.id}
              label={module.label}
              icon={module.icon}
              description={module.description}
              enabled={isModuleAvailable(module.id)}
              onOpen={() => navigate(module.path)}
            />
          ))}
        </div>
        {launcherHint && (
          <p className="text-[11px] text-[var(--text-3)]">{launcherHint}</p>
        )}
      </main>
    </div>
  );
}
