import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { OrbitProviders } from "@/orbit/OrbitProviders";
import { orbitRouter } from "@/orbit/OrbitShell";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <OrbitProviders>
      <RouterProvider router={orbitRouter} />
    </OrbitProviders>
  </React.StrictMode>,
);
