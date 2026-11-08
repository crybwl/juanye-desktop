import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter";
import "katex/dist/katex.min.css";
import "./index.css";
import App from "./App";
import { initializeAppearance } from "./appearance";
import "./integrated-surfaces.css";
import "./design-system.css";
import "./aura.css";

initializeAppearance();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
