# MotionDesk — Conversational Video & Motion

Generic director workspace for the **Gemini Omni Flash** challenge.

**Pipeline:** NB2 Lite seed stills → Gemini 3 Flash motion prompt → Omni Flash video → Omni Flash multi-turn edits.

Theme is intentionally generic (`src/lib/theme.ts`). Swap branding later for **AI Kitchen** without rewriting orchestration.

## Models

| Role | Model ID | Job |
| --- | --- | --- |
| Seed / keyframe | `gemini-3.1-flash-lite-image` | Fast stills |
| Motion prompt | `gemini-3.5-flash` | Draft Omni animation prompt from the seed brief |
| Generate + edit video | `gemini-omni-flash-preview` | Animate + conversational edits via Interactions API |

**Edit channel:** text instructions (and optional reference images for swaps). **Audio input is not supported** on the Omni Flash Gemini API yet — do not build voice-edit as a required path.

## Stack

- Next.js 15 (App Router) + TypeScript + Tailwind
- `@google/genai` (Interactions API for Omni; `generateContent` for NB2 Lite)
- In-memory sessions (demo) — replace later for production

## Quick start

```bash
cp .env.local.example .env.local
# set GEMINI_API_KEY=...

npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Architecture

```text
src/
├── app/
│   ├── page.tsx                 # Director UI
│   └── api/
│       ├── session/route.ts     # Create session
│       ├── seed/route.ts        # NB2 Lite still
│       ├── video/route.ts       # Omni generate (turn 1)
│       └── edit/route.ts        # Omni edit (turn 2+)
├── components/
│   ├── DirectorWorkspace.tsx    # Main client UI
│   ├── DirectorChat.tsx         # Multi-turn chat
│   └── VideoStage.tsx           # Seed / video preview
└── lib/
    ├── theme.ts                 # Swap for AI Kitchen later
    ├── types.ts
    ├── gemini.ts                # Model clients
    ├── orchestrator.ts          # seed → generate → edit
    └── session.ts               # In-memory session + interaction ids
```

### Flow

1. **Seed** — `/api/seed` → NB2 Lite image **and** Gemini 3 Flash motion prompt **in parallel** → stored on session  
2. **Generate** — `/api/video` → Omni with `background=false`, `stream=false`, `store=true`, `duration=5s`, `delivery=uri`, `<FIRST_FRAME>` tagging  
3. **Edit** — `/api/edit` with `previousInteractionId` → short edit + “Keep everything else the same.”  

Conversational state is server-side on Gemini via `previous_interaction_id` (`store` must stay enabled).

### Multi-shot editor

Open **/editor** (or **Sequence editor** in the director header) after you have generates/edits:

- Browse recent Omni takes from the session
- Continue conversational edit from any take’s `interactionId`
- Build an ordered multi-shot timeline, play back-to-back, export shot files

**Note:** Omni Flash cannot merge/reason across multiple videos in one API call ([docs limitations](https://ai.google.dev/gemini-api/docs/omni)). The editor sequences takes for narrative review; true single-file mux still belongs in an NLE / ffmpeg.

### Speed notes (Omni docs)

- Generation time is dominated by the model; longer/higher-res clips take longer.
- We keep `store=true` so multi-turn edits work (`store=false` is faster but disables `previous_interaction_id`).
- Override clip length with `OMNI_VIDEO_DURATION` (default `5s`).
- Docs: https://ai.google.dev/gemini-api/docs/omni

## Theming later (AI Kitchen)

Edit only `src/lib/theme.ts` (name, starter prompts, example edits). Orchestrator and APIs stay the same.

## Docs

- [Architecture notes](docs/conversational-video-architecture.md)
- Omni Flash: https://ai.google.dev/gemini-api/docs/omni
- Interactions API: https://ai.google.dev/gemini-api/docs/interactions/interactions-overview
