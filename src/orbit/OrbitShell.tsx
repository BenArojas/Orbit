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
import { OrbitModuleEntry } from "./moduleEntry";

export const orbitRoutes: RouteObject[] = [
  { path: "/", element: <OrbitLauncher /> },
  { path: "/parallax/*", element: <OrbitModuleEntry moduleId="parallax" /> },
  { path: "/moonmarket/*", element: <OrbitModuleEntry moduleId="moonmarket" /> },
  { path: "/inflect/*", element: <OrbitModuleEntry moduleId="inflect" /> },
];

export const orbitRouter = createBrowserRouter(orbitRoutes);
