import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import "./styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Dashboard root element was not found.");
}

createRoot(rootElement).render(
  <StrictMode>
    <App publicMode={import.meta.env.VITE_PUBLIC_MODE === "true"} />
  </StrictMode>,
);
