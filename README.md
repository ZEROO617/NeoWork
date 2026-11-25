# NeoWork MVP

Korean collaboration messenger based on NeoWork PRD v0.1.

## Run the shared app

Requires Python 3.10+; no dependencies or paid services required.

```sh
python3 server/app.py
```

Open http://localhost:3000. Other users on the same reachable network can open the server's address on port 3000. Enter different names with the top-right name button. Messages and rooms are persisted in SQLite; clients refresh shared data every two seconds. This is lightweight name-based access, not verified account authentication. Use a trusted network for the class demo.

The first run seeds example conversations. Data lives in `server/neowork.sqlite3` (ignored by Git). Set `NEOWORK_DB` to another writable path for isolated demos. Deleting the database resets the demo; back it up first if it contains wanted messages.

## Optional Gemini

Set `GEMINI_API_KEY` in the server process environment, then run the server. Do not place secrets in browser code. The server calls Gemini 2.5 Flash for natural-language questions, restricts context to the selected room, validates cited message IDs, and stores query history. Without a key or on API errors, the app uses a conservative local rule-based search. The local Python mode uses deterministic summary/task extraction. The hosted Worker additionally supports OpenAI summaries as described below.

## Hosted browser storage

`npm run build` creates a dependency-free Cloudflare Worker in `dist/server/index.js` with embedded frontend assets. Messages remain in localStorage and do not synchronize across devices. AI uses local rules until the server-side OpenAI secret is configured. See the OpenAI section below.

## Features

- Name entry and a single focused project chat
- Shared messages with author/time, persistent SQLite, two-second polling on local server
- Browser-only fallback with localStorage
- Summary with core discussion, explicit decisions, remaining work
- Natural-language questions with source-message navigation
- Rule-based task extraction with assignee, deadline, and status
- Three states: 완료 / 진행 중 / 확인 불가; no completion without explicit evidence
- One question search field with cited answers
- Right-aligned navy bubbles for the current user; bordered white bubbles for other participants
- Figma-derived white/navy design with IBM Plex Sans KR, Space Grotesk, 2px borders and hard shadows
- A single summary, decisions, and tasks panel
- Keyboard composer, accessible forms, responsive layout

## Structure

`public/app.js` handles UI and interactions; `data.js` supplies sample records; `analysis.js` contains conservative analysis logic; `style.css` styles the responsive app. `server/app.py` handles shared persistence and optional Gemini requests. `server/seed.json` is the initial shared dataset. This MVP uses vanilla ES modules and Python/SQLite instead of the PRD's suggested Next.js/Supabase/Vercel stack, so the demo works without third-party credentials.

## Checks

```sh
npm test
python3 -m unittest discover -s tests -p '*_test.py'
npm run build
```

## Limits

The hosted browser-storage version is not a multiuser chat server. Polling is used instead of WebSockets. Name entry is not secure authentication. Task extraction is conservative and limited to common Korean assignment/completion phrases; arbitrary natural language needs Gemini and further evaluation. Gemini is used for search questions only. No files, notifications, organization administration, or vector database are included, matching the PRD exclusions.

## OpenAI hosted server (new)

The Sites deployment now builds a Cloudflare Worker with the frontend embedded. The Worker serves `/api/config`, `/api/summary`, and `/api/ai`. Set `OPENAI_API_KEY` as a Sites **secret** through the approved OpenAI Developers key setup flow. `OPENAI_MODEL` is optional (default `gpt-4.1-mini`). No key is stored in source, build output, or browser storage.

Until a key is configured and a new environment revision is deployed, the app continues its explicit rule-based mode. With a key, only the explicit conversation refresh button generates or updates the conversation document; questions use OpenAI answers with cited messages. Opening the app, switching panels, and receiving messages never generate summaries automatically. Messages themselves remain in browser localStorage on the hosted version. Only the selected room's last 80 messages are sent per request; OpenAI response storage is disabled with `store: false` (this does not override provider retention policies). API calls have separate usage costs.

Paid endpoints require Sites-injected visitor identity and same-origin JSON requests. Context sizes, message counts, and output tokens are bounded. Burst limiting is per Worker isolate and is not a global spending cap; configure project budgets separately. Search failures use clearly labeled conservative local results. Document refresh failures preserve the previous document and all edits. Source IDs are validated, uncited claims are removed, and explicit completion evidence is checked.

The Python shared server remains a separate local demo using SQLite and optional Gemini; it does not use the hosted Worker secret.

Build before running Worker tests: `npm run build && npm test`. Worker and OpenAI tests mock provider responses and do not spend API credits.

## Manual OpenAI key entry

The private site owner can enter a manually issued key at `/settings`. The owner must explicitly consent before saving. The endpoint accepts only same-origin authenticated owner requests and never returns stored keys. Keys are encrypted with AES-GCM and stored in the site's R2 binding `SECRETS_BUCKET`; the encryption secret lives in the separate Sites secret `KEY_ENCRYPTION_SECRET`. `SITE_OWNER_ID` restricts writes to the selected site owner. Never replace the encryption secret while saved keys exist unless intentionally rotating and re-entering the API key. `OPENAI_API_KEY`, if set as a Sites environment secret, takes priority over a manually stored key.

The settings page does not store keys in browser storage or send them to chat. Connection verification is a separate explicit button because it makes a small billable API request. A successful save confirms storage, not that the key has credit or model access.

## Right-side panels

The conversation header has separate `대화 정리` (summary, decisions, tasks) and `AI 검색` (question input, answers, evidence) buttons. Selecting an active header button closes the panel; the internal panel tabs switch views without closing. The close button and Escape also collapse the panel. Switching views keeps both views mounted, preserving query drafts, answers, summaries and independent scroll positions. The mobile panel overlays the conversation and closes when jumping to a source message. The desktop team sidebar displays members derived from actual conversation authors and the selected local name; it does not imply live presence.


## Persistent conversation document

The `대화 정리` panel keeps its last saved result until the owner clicks `최신 대화 반영`. Pending chat is indicated without an API request. No-op refreshes do not call OpenAI. Document records are stored per room in browser localStorage (`nw-documents-v1`), alongside the existing browser-only chat records; this does not introduce cross-device synchronization.

Each summary, decision, and task can be added, edited, or deleted through a save/cancel form. Tasks expose title, assignee, deadline, and the three original status values. User-edited notes are labeled and never modify the original chat. Subsequent explicit chat can supersede a manual edit, but older pending messages cannot silently undo a correction or restore a deleted item. Deleted-item records are retained for this purpose.

Decision cancellation removes the decision from the active list and archives it in the collapsed history with its reason and source messages. Cancellation does not imply the opposite decision. Replacement decisions keep stable item IDs and archive the previous version.

`POST /api/summary` remains compatible with the previous full-summary request. New callers send `mode: update`, a previous document, at most 80 new messages, and their chronological offset. The response contains validated item operations with stable IDs, actions, and message citations. The browser processes all pending messages in byte-bounded batches, stages all changes in memory, then saves only after every batch succeeds. Messages arriving during refresh remain pending. Rate-limited batches wait and retry at most twice. Oversized or failed updates leave saved records untouched.

`POST /api/ai` accepts the current document as additional context and returns separate `manualSources` IDs for manually entered notes. User edits are labeled independently from chat evidence. Only later explicit messages override those notes. Summary helpers reside in `public/document.js`; incremental API validation and instructions reside in `worker/updates.js`. The model and key handling are unchanged.

## Grouped evidence and task cards

Each summary, decision, task, history record, or search answer shows one evidence button with the deduplicated count instead of a separate link for every message. Manually edited items retain the `기존 근거` label. Evidence IDs are resolved against the original chat and ordered by message time, with original chat order breaking ties; missing references are skipped.

Clicking evidence opens a source dialog with the original author, timestamp, complete message, previous/next controls and a jump-to-chat button. Task metadata appears only when a linked task exists. Jumping starts local in-chat navigation above the composer: previous, position/total, next, return, and close. Only the selected message is highlighted. Bounds do not wrap. Return restores the originating panel, scroll position, history expansion when applicable, and item; mobile navigation collapses the panel until return. Incoming chat does not auto-scroll away from evidence. Sending a new message exits navigation. Search references to manually entered notes remain separate from chat citations. Navigation makes no AI calls and changes no persisted data.

Tasks use separate bordered white cards with a full wrapping title, status, labeled assignee/deadline metadata, and a compact evidence/edit footer.

## Figma interface

The interface adapts the supplied NeoWork Navy Brutalism prototype: a split name-entry screen, 72px application header, 208px team sidebar, flexible conversation and 432px assistant. The assistant contains summary, decision and compact task cards, an explicit refresh action, suggested search questions, distinct question/answer blocks and grouped evidence dialogs. Mobile layouts hide the team sidebar and present the assistant as a dismissible overlay. Existing messages, documents, editing, API routes and credential storage remain compatible. First-time visitors choose a local display name; saved names bypass entry.

Figma vector downloads returned HTTP 403 in the implementation environment. Icons could not be copied verbatim; text controls and the existing close glyph are used. Font families are loaded through Google Fonts with Korean system fallbacks. The managed preview relay was unavailable, so browser layout/screenshot comparison remains unverified. Node regression checks and a temporary jsdom interaction harness cover entry, composing, panel state, manual edits, grouped evidence, jump/return and explicit AI request wiring; the harness uses mocked AI responses and no real keys.
