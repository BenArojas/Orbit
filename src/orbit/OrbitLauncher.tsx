/**
 * OrbitLauncher — route "/". Combined auth + launcher (skeleton).
 *
 * Reads IBKR auth from the shared gateway context. While unauthenticated it
 * renders Parallax's existing ConnectionPage (the proven login flow) and shows
 * the app icons grayed/disabled. Once authenticated the Parallax and MoonMarket
 * icons colorize and navigate into their modules. Inflect stays "Coming soon".
 */
import { useNavigate } from "react-router-dom";
import { Activity, Briefcase, NotebookPen } from "lucide-react";
import { useGatewayContext } from "@/context/GatewayContext";
import ConnectionPage from "@/pages/ConnectionPage";
import { AppIcon } from "./AppIcon";

export function OrbitLauncher() {
  const navigate = useNavigate();
  const { isAuthenticated } = useGatewayContext();

  return (
    <div className="flex h-screen flex-col overflow-y-auto bg-[var(--bg-1)]">
      <header className="px-6 pt-8 text-center">
        <h1 className="text-[22px] font-extrabold tracking-[4px] text-gradient-brand">
          ORBIT
        </h1>
      </header>

      {!isAuthenticated && (
        <section className="mx-auto w-full max-w-2xl px-6 py-6">
          <ConnectionPage />
        </section>
      )}

      <section className="flex flex-wrap items-center justify-center gap-6 px-6 py-10">
        <AppIcon
          label="Parallax"
          icon={Activity}
          enabled={isAuthenticated}
          onOpen={() => navigate("/parallax")}
        />
        <AppIcon
          label="MoonMarket"
          icon={Briefcase}
          enabled={isAuthenticated}
          onOpen={() => navigate("/moonmarket")}
        />
        <AppIcon
          label="Inflect"
          icon={NotebookPen}
          enabled={false}
          badge="Coming soon"
        />
      </section>
    </div>
  );
}
