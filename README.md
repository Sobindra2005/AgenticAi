# Agentic AI Playground

A small Node.js + TypeScript server for practicing your own AI or backend workflows.

## Setup

```powershell
npm install
Copy-Item .env.example .env
```

Add model provider keys to `.env` when you are ready to connect a real model. The starter examples run without an API key.

## Run the server

```powershell
npm run dev
```

Open these URLs in a browser:

- `http://localhost:3000/` opens the input and output practice view.
- `http://localhost:3000/api/run?input=hello` returns the workflow result as JSON.

## Add your custom functionality

Open `src/workflow.ts` and edit `runWorkflow(input)`.

It receives the text from the Input panel and must return an object with an `input` and `output` field. You can call your own functions, database, API, model, or agent there. The returned object is automatically displayed in the Output panel.

```ts
export async function runWorkflow(input: string) {
	const output = await myCustomFunction(input);
	return { input, output };
}
```

Run `npm run typecheck` after changing it.

## Folder map

- `src/server.ts`: HTTP entry point.
- `src/workflow.ts`: your custom logic entry point.
- `src/server.ts`: Express HTTP entry point.
- `views/`: EJS page and layout.
- `public/`: browser styling.
