# SiqyrAI frontend

React + TypeScript + Vite. Mantine provides the components, forms, dialogs and theme;
Tailwind utilities are available for precise layout adjustments without Preflight.

## Run locally

Use Node.js 20.19+ (20.x) or 22.12+.

```bash
cd frontend
npm ci
npm run dev
```

Open http://127.0.0.1:5174. The Docker web service uses http://localhost:5173.

```bash
npm run build
npm run preview -- --port 5176 --strictPort
```

## Current scope

The application includes a meeting index, recording/file intake, editable summary,
transcript and protocol, an assignment register, and local settings. The two supplied
protocol examples contain 60 transcript entries and 16 assignments. Original deadline
wording is retained; deadlines without a full date are not classified as overdue.

Meetings, audio/video blobs, assignments and preferences persist in this browser's
IndexedDB. Restoring examples replaces only their records, preserving local meetings
and settings. Recording requires participant notification and microphone permission.
DOCX export runs in the browser; PDF is available through the browser print dialog.

The frontend does not call the backend API or SSE endpoints yet. Uploading or recording
creates a local record awaiting integration, without simulated transcription or AI results.
`VITE_API_URL`, `VITE_FAKE`, approval and server reminders remain follow-up integration work
against `docs/CONTRACT.md`; that contract and backend schemas are unchanged in this PR.
