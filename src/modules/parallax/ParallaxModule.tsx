/**
 * ParallaxModule — mounts the existing Parallax app shell under /parallax/*.
 * Providers are supplied by OrbitProviders, so this just renders the shell.
 */
import ParallaxApp from "@/App";

export function ParallaxModule() {
  return <ParallaxApp />;
}
