/**
 * OrbitLauncher — route "/". Combined auth + launcher.
 *
 * Slim top bar (ORBIT wordmark + GatewayStatusPill) over three hero app tiles.
 * Tiles gray/disabled until IBKR is authenticated, then colorize and navigate
 * into their modules. The IBKR connect flow lives in the pill's popover
 * (auto-opens until authenticated).
 */
import { useNavigate } from "react-router-dom";
import { useGatewayContext } from "@/context/GatewayContext";
import { orbitModules } from "./moduleEntry";
import { AppIcon } from "./AppIcon";
import { GatewayStatusPill } from "./GatewayStatusPill";

export function OrbitLauncher() {
  const navigate = useNavigate();
  const { isAuthenticated } = useGatewayContext();

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
              enabled={isAuthenticated}
              onOpen={() => navigate(module.path)}
            />
          ))}
        </div>
        {!isAuthenticated && (
          <p className="text-[11px] text-[var(--text-3)]">
            Connect IBKR to open your apps.
          </p>
        )}
      </main>
    </div>
  );
}
