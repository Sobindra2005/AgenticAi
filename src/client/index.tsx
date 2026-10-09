import React from "react";
import { hydrateRoot } from "react-dom/client";
import { App } from "../views/App.js";

const initialDataEl = document.getElementById("__INITIAL_DATA__");
let initialData = {};
if (initialDataEl && initialDataEl.textContent) {
  try {
    initialData = JSON.parse(initialDataEl.textContent);
  } catch (e) {
    console.error("Failed to parse initial data:", e);
  }
}

const rootElement = document.getElementById("root");
if (rootElement) {
  hydrateRoot(rootElement, <App {...initialData} />);
}
