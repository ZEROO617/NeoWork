# NeoWork

A shared Korean team messenger with nickname/password accounts, room selection, cited AI summaries and natural-language search. The UI retains the white/sky-blue messenger design, right-aligned own messages and independent collapsible summary/search panels.

## Joining and sharing

Open the website and register with a unique nickname and a password of 8–128 characters, or log in to an existing account. The same account is used in every room. Nicknames are NFC-normalized and case-insensitive for uniqueness. Changing a nickname updates all memberships belonging to that account and the displayed author names of historical messages; another account's nickname cannot be claimed, even if that account has not joined a room. The lobby includes an empty team room and a separate demo room.

A stable, account-owned principal links room memberships across devices and login sessions, so logging out and signing in again preserves member IDs and own-message alignment. Credentials are never sent as chat messages. Passwords are salted independently and hashed with PBKDF2-SHA-256 (100,000 iterations); only hashes are stored. Random 256-bit login tokens live in a Secure, HttpOnly, SameSite=Lax cookie for 30 days; only their SHA-256 hashes are stored. Logout revokes the current login session without logging out other devices. Login, registration, and nickname changes have database-backed rate limits.

Existing anonymous history can be linked during registration in the browser that still holds its original guest cookie. A nickname match alone never grants ownership of old messages. Anonymous membership nicknames remain reserved to avoid impersonating existing authors; register from the original browser to retain them. Existing message text and shared documents are preserved by the additive account-table migration. Password recovery is not implemented in this MVP.

Create a room with `새 채팅방`. Use `초대 링크` inside a room to copy its URL. The invited room appears first in the lobby. `채팅방 목록` returns to room selection. A browser can retain membership in several rooms, while its messages and drafts remain scoped to the selected room.

Messages and conversation documents are stored in Cloudflare D1 and shared across devices. Active clients poll every three seconds, fetching messages after their last cursor in pages of 200. Retried sends use a client UUID and a database uniqueness constraint, preventing duplicate messages. Server-assigned member IDs determine own-message alignment; clients cannot select the author of a message.

Existing browser-local conversations and documents are not uploaded, erased or made public. When earlier local messages exist, `이 브라우저의 이전 대화 보기` opens them separately. New shared rooms start empty; the demo room alone receives sample messages. The previous Python/SQLite server remains in `server/` as a legacy reference and is not used by the hosted service.

## Conversation documents and AI

The summary panel contains one darker blue-gray overview box, separate decision cards that grow with their text, and assignee-grouped task cards with visible assignee, deadline, status, edit and evidence controls. Completion requires explicit evidence. Grouped evidence opens the original chat with previous/next navigation and return to the originating item. Direct user edits are attributed separately from chat facts.

`최신 대화 반영` is explicit: no background AI calls occur on entry, polling, typing or panel switching. Shared summaries run on the server against stored room messages, not client-supplied context. New messages are processed in bounded batches; failures retain the last saved document. Concurrent summary generation obtains a database lease, and document updates use revision checks. A competing edit receives a conflict instead of overwriting the earlier save. All participants in a room can see the updated document and use manual editing. Joining returns the existing shared document immediately and opens the summary panel, including for late arrivals; no AI call is triggered by joining. An ungenerated document is clearly identified and can be generated explicitly from the full stored conversation.

Independent decisions are separate records with their own citations. Existing combined AI records can be split during one explicit format refresh. Stable IDs, cancellation history, manual cursors and deletion protections are retained. The provider's ID enum permits only existing/deleted IDs or the empty ID used for new locally assigned UUIDs.

Shared search uses the latest 80 stored messages and the shared document, including cited history and clearly attributed manual notes. Unknown information is not invented. The configured provider is OpenAI Responses API, `gpt-4.1-mini` by default; `OPENAI_MODEL` can override it. Requests use structured output and `store: false`.

## Storage and account access

`.openai/hosting.json` declares the D1 binding `DB` and the existing encrypted-credential R2 binding `SECRETS_BUCKET`. Schema-only Drizzle migrations are in `drizzle/`; demo seeding is a separate bounded, idempotent server operation. The default rooms are `team` and `demo`.

Account authentication and room membership checks protect room lists, messages, documents, and AI requests. Registered users can join open rooms; rooms are not invitation-only. The server validates same-origin JSON writes, globally unique nicknames, message lengths, and room boundaries. Chat member identity always comes from the authenticated account, never client-submitted author fields.

Database-backed rate limits apply to joins, session creation, new rooms, messages, edits and AI requests. AI allows three calls per member per minute and 100 calls across the site per UTC day; current unchanged summaries do not consume a call. These MVP limits are defined in `worker/rooms.js`. Settings writes remain restricted to the site's authenticated owner, even while the chat service is public. Legacy AI endpoints for browser-local records are owner-only when the shared DB is enabled.

The API key remains server-side. `OPENAI_API_KEY` takes priority over the manually stored key. `/settings` encrypts manually entered keys with AES-GCM in R2 using `KEY_ENCRYPTION_SECRET`; `SITE_OWNER_ID` controls owner writes. There is no endpoint to retrieve a stored key. Never replace the encryption secret without intentionally rotating/re-entering the saved key. No key is placed in browser storage, source, request logs, or chat.

## Development

Requires Node.js 22.13 or newer; Vercel uses Node.js 22.

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

## Vercel hosting

Vercel serves the frontend and a same-origin Node API gateway (`api/proxy.js`). The existing Sites Worker remains the authoritative chat/AI backend, retaining its Cloudflare D1 records and encrypted OpenAI key. Keep that backend published: this deployment does not migrate D1 or remove the Sites dependency. Browser sessions are separate between the two hostnames; rooms and messages are shared.

Import this repository into Vercel using the Other framework preset. `vercel.json` sets `npm run build:vercel` and the `vercel-public` output directory. Set these server-only Vercel environment variables before deployment:

- `NEOWORK_BACKEND_TOKEN`: the official Sites service-access bearer for this project. Store as a sensitive/encrypted variable; never prefix it with `NEXT_PUBLIC_` or put it in Git.
- `NEOWORK_API_ORIGIN`: optional backend origin; defaults to the current published Sites URL.

The gateway permits only the account and chat API routes, validates same-origin JSON writes, bounds request sizes, and forwards only the application session cookie. It does not forward browser identity or arbitrary authorization headers. The OpenAI credential stays on the existing backend. Owner settings redirect to the authenticated Sites settings page.

Run `npm run build:vercel` and `npm test` before deploying. `.vercelignore` excludes local secrets and development state; `.gitignore` excludes both `.env.local` and generated Vercel output. Connect the GitHub repository to the Vercel project to enable deployments on future pushes.

## Resetting a room

Send `/리셋 <password>` in a shared room to delete that room's messages and all conversation document content, including evidence and edit history. Memberships, nicknames, room metadata, and other rooms remain intact. The backend checks the Sites-only secret `ROOM_RESET_PASSWORD`, limits attempts per session, and never stores the command as a message. Successful resets invalidate in-flight summary saves; a persistent reset ID clears cached messages and search answers on other clients at their next poll. State reads and reset writes use atomic D1 batches. Demo messages are not re-seeded after a reset.
