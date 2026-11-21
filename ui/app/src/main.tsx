import React from "react";
import ReactDOM from "react-dom/client";
import { cloudHost } from "./cloud/host";
import App from "./App";
import { PlanGate } from "./components/PlanGate";
import "./i18n";
import "./styles.css";
import { startTheme } from "./theme";

// The cached look first, so nothing paints in the wrong one (sign-in included).
startTheme();

// Sign in first (this may leave for the sign-in page and come back); then, on the hosted
// service, Billing alone until the person has a plan (components/PlanGate.tsx).
void cloudHost.start().then(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <PlanGate>
        <App />
      </PlanGate>
    </React.StrictMode>,
  );
});
