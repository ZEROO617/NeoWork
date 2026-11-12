# NeoWork MVP

Korean collaboration messenger based on NeoWork PRD v0.1.

## Run the shared app

Requires Python 3.10+; no dependencies or paid services required.

```sh
python3 server/app.py
```

Open http://localhost:3000. Other users on the same reachable network can open the server's address on port 3000. Enter different names with the bottom-left profile. Messages and rooms are persisted in SQLite; clients refresh shared data every two seconds. This is lightweight name-based access, not verified account authentication. Use a trusted network for the class demo.

The first run seeds example conversations. Data lives in `server/neowork.sqlite3` (ignored by Git). Set `NEOWORK_DB` to another writable path for isolated demos. Deleting the database resets the demo; back it up first if it contains wanted messages.

## Optional Gemini

Set `GEMINI_API_KEY` in the server process environment, then run the server. Do not place secrets in browser code. The server calls Gemini 2.5 Flash for natural-language questions, restricts context to the selected room, validates cited message IDs, and stores query history. Without a key or on API errors, the app uses a conservative local rule-based search. Summary and task extraction currently use deterministic rules in all modes; they are not LLM summaries.

## Hosted browser demo

`npm run build` creates dependency-free static output in `dist/`. The hosted Sites version is a **browser-local demo**: messages and rooms are stored in localStorage, and no AI API is called. It does not synchronize between devices. The UI explicitly distinguishes this mode from a shared server connection. Example team members are sample profiles, not online presence indicators.

## Features

- Name entry, room creation and switching
- Shared messages with author/time, persistent SQLite, two-second polling on local server
- Browser-only fallback with localStorage
- Summary with core discussion, explicit decisions, remaining work
- Natural-language questions with source-message navigation
- Rule-based task extraction, assignee/deadline/status, personal task filter
- Three states: 완료 / 진행 중 / 확인 불가; no completion without explicit evidence
- Saved messages and keyword search
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

The hosted static demo is not a multiuser server. Polling is used instead of WebSockets. Name entry is not secure authentication. Task extraction is conservative and limited to common Korean assignment/completion phrases; arbitrary natural language needs Gemini and further evaluation. Gemini is used for search questions only. No files, notifications, organization administration, or vector database are included, matching the PRD exclusions.
