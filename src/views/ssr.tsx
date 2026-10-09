import React from "react";
import { renderToString } from "react-dom/server";
import { Layout } from "./Layout.js";
import { App, AppProps } from "./App.js";

/**
 * Server-Side Renders the React App into a complete HTML document string.
 */
export function renderAppPage(props: AppProps = {}): string {
  const fullHtml = renderToString(
    <Layout title={props.title} initialData={props}>
      <App {...props} />
    </Layout>
  );
  return "<!doctype html>\n" + fullHtml;
}
