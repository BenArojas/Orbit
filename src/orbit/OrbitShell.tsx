/**
 * OrbitShell — top-level route table for Orbit.
 *   /              -> OrbitLauncher (combined auth + launcher)
 *   /parallax/*    -> existing Parallax app
 *   /moonmarket/*  -> MoonMarket (stub for now)
 *   /inflect/*     -> Inflect (trading journal)
 *
 * `orbitRoutes` is exported separately so tests can mount it with a memory router.
 */
import { createBrowserRouter, type RouteObject } from "react-router-dom";
import { OrbitLauncher } from "./OrbitLauncher";
import { ParallaxModule } from "@/modules/parallax/ParallaxModule";
import { MoonMarketModule } from "@/modules/moonmarket/MoonMarketModule";
import { InflectModule } from "@/modules/inflect/InflectModule";

export const orbitRoutes: RouteObject[] = [
  { path: "/", element: <OrbitLauncher /> },
  { path: "/parallax/*", element: <ParallaxModule /> },
  { path: "/moonmarket/*", element: <MoonMarketModule /> },
  { path: "/inflect/*", element: <InflectModule /> },
];

export const orbitRouter = createBrowserRouter(orbitRoutes);
