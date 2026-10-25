import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter";
import "katex/dist/katex.min.css";
import "./index.css";
import App from "./App";
import { initializeAppearance } from "./appearance";

initializeAppearance();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
