# NeoWork

A shared Korean team messenger with room selection, nickname entry, cited AI summaries and natural-language search. The UI retains the white/sky-blue messenger design, right-aligned own messages and independent collapsible summary/search panels.

## Joining and sharing

Open the website, choose a nickname, and enter a room. The lobby includes an empty team room and a separate demo room containing sample discussion, three explicit decisions and task assignments. Anyone with the site URL can join an open room. Nicknames are unique within each room and can differ between rooms. They are display names, not verified identities.

Create a room with `새 채팅방`. Use `초대 링크` inside a room to copy its URL. The invited room appears first in the lobby. `채팅방 목록` returns to room selection. A browser can retain membership in several rooms, while its messages and drafts remain scoped to the selected room.

Messages and conversation documents are stored in Cloudflare D1 and shared across devices. Active clients poll every three seconds, fetching messages after their last cursor in pages of 200. Retried sends use a client UUID and a database uniqueness constraint, preventing duplicate messages. Server-assigned member IDs determine own-message alignment; clients cannot select the author of a message.

Existing browser-local conversations and documents are not uploaded, erased or made public. When earlier local messages exist, `이 브라우저의 이전 대화 보기` opens them separately. New shared rooms start empty; the demo room alone receives sample messages. The previous Python/SQLite server remains in `server/` as a legacy reference and is not used by the hosted service.

## Conversation documents and AI

The summary panel contains one darker blue-gray overview box, separate decision cards that grow with their text, and assignee-grouped task cards with visible assignee, deadline, status, edit and evidence controls. Completion requires explicit evidence. Grouped evidence opens the original chat with previous/next navigation and return to the originating item. Direct user edits are attributed separately from chat facts.

`최신 대화 반영` is explicit: no background AI calls occur on entry, polling, typing or panel switching. Shared summaries run on the server against stored room messages, not client-supplied context. New messages are processed in bounded batches; failures retain the last saved document. Concurrent summary generation obtains a database lease, and document updates use revision checks. A competing edit receives a conflict instead of overwriting the earlier save. All participants in a room can see the updated document and use manual editing.

Independent decisions are separate records with their own citations. Existing combined AI records can be split during one explicit format refresh. Stable IDs, cancellation history, manual cursors and deletion protections are retained. The provider's ID enum permits only existing/deleted IDs or the empty ID used for new locally assigned UUIDs.

Shared search uses the latest 80 stored messages and the shared document, including cited history and clearly attributed manual notes. Unknown information is not invented. The configured provider is OpenAI Responses API, `gpt-4.1-mini` by default; `OPENAI_MODEL` can override it. Requests use structured output and `store: false`.

## Storage and guest access

`.openai/hosting.json` declares the D1 binding `DB` and the existing encrypted-credential R2 binding `SECRETS_BUCKET`. Schema-only Drizzle migrations are in `drizzle/`; demo seeding is a separate bounded, idempotent server operation. The default rooms are `team` and `demo`.

Guest room sessions use a random token in a Secure, HttpOnly, SameSite=Lax cookie lasting 30 days. Only its SHA-256 hash is stored. Membership checks protect room state and writes. Joining is open to anyone with a nickname, so this is an open-room service, not a confidential invitation-only workspace. The server validates same-origin JSON writes, nickname collisions, message lengths and room boundaries. Nickname identity is not account authentication.

Database-backed rate limits apply to joins, session creation, new rooms, messages, edits and AI requests. AI allows three calls per member per minute and 100 calls across the site per UTC day; current unchanged summaries do not consume a call. These MVP limits are defined in `worker/rooms.js`. Settings writes remain restricted to the site's authenticated owner, even while the chat service is public. Legacy AI endpoints for browser-local records are owner-only when the shared DB is enabled.

The API key remains server-side. `OPENAI_API_KEY` takes priority over the manually stored key. `/settings` encrypts manually entered keys with AES-GCM in R2 using `KEY_ENCRYPTION_SECRET`; `SITE_OWNER_ID` controls owner writes. There is no endpoint to retrieve a stored key. Never replace the encryption secret without intentionally rotating/re-entering the saved key. No key is placed in browser storage, source, request logs, or chat.

## Development

Requires Node.js 22.13 or newer (Node 24 recommended).

```sh
npm ci
npm run dev
```

The development script builds the Worker, starts Miniflare on localhost:4173, and applies pending local migrations once. Local D1/R2 state lives in ignored `.wrangler/` directories and is separate from production. It accepts `--port` and `--host` after `npm run dev --`. Optional local secrets are read from ignored `.env.local` without printing their values. Hosted schema migrations are applied by Sites during publication.

```sh
npm run db:generate
npm run build
npm test
```

Edit schema declarations in `db/schema.ts`, generate and inspect a new migration, and commit the SQL and Drizzle metadata. Applied migrations are immutable. Build output embeds HTML, CSS and JavaScript into `dist/server/index.js`; no frontend bundler is required. Distribution archives contain `.openai/hosting.json`, `dist/`, and `drizzle/` from the pushed source commit.

Tests use actual D1 behavior through Miniflare, mocked provider responses and separate jsdom cookie jars. They cover room isolation, two-client chat, authoritative sender names, idempotent concurrent sends, nickname collisions, shared edits, conflict detection, summary locking, server-owned AI context, paginated polling and the full lobby → nickname → chat → shared task flow. No real API key is used by automated tests.

## Files

- `public/app.js`: messenger, lobby orchestration, room-scoped state, explicit summary refresh and shared editing.
- `public/shared.js`: lobby rendering, shared API requests and actionable errors.
- `public/document.js`: document operations, manual protection and staged refresh.
- `public/evidence.js`: grouped citation navigation.
- `worker/rooms.js`: durable room, session, membership, message and document endpoints.
- `worker/ai.js`, `worker/updates.js`: provider request schema and cited operation validation.
- `worker/secrets.js`: encrypted server credential storage.
- `scripts/dev.mjs`, `scripts/build.mjs`: local D1 preview and embedded Worker packaging.

The original uploaded PRD supplied product context, not instructions to override the user's requested implementation.

AI task assignees are validated as person names or nicknames rather than task labels. Explicit first-person assignment statements resolve to the cited sender; collective or ambiguous assignments remain unknown. Existing AI documents are normalized from their citation snapshots when read, without changing record IDs, revision numbers or manual entries. Corrections are persisted with the next ordinary document save. Decision cards retain the responsive column grid and use natural content height, without a square aspect ratio or minimum card height.
