import React from "react";

interface LayoutProps {
  title?: string;
  initialData?: any;
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({
  title = "Agentic AI - Iterative Research Studio",
  initialData,
  children,
}) => {
  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{title}</title>
        <link rel="stylesheet" href="/styles.css" />
        <script src="https://cdn.jsdelivr.net/npm/markdown-it@14.1.0/dist/markdown-it.min.js"></script>
      </head>
      <body>
        <main className="shell">
          <div id="root">{children}</div>
        </main>
        {initialData && (
          <script
            id="__INITIAL_DATA__"
            type="application/json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify(initialData).replace(/</g, "\\u003c"),
            }}
          />
        )}
        <script type="module" src="/client.js"></script>
      </body>
    </html>
  );
};
