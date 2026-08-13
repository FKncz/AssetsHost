# AssetsHost

[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org)
[![deploy](https://img.shields.io/badge/deploy-Vercel-black)](https://vercel.com)

A self-hosted asset CDN. Log in with one password, upload files, get permanent
public URLs, and manage everything from a dashboard. Built on Next.js 16, Vercel
Blob, and Postgres, with a public gallery for the files you choose to list.

```
https://cdn.example.com/f/sunset-gradient.jpg
https://cdn.example.com/f/invoice-2026.pdf
https://cdn.example.com/f/demo-clip.mp4
```

- **Upload** through a drag-and-drop dashboard, with progress and category
  filtering.
- **Serve** from permanent public URLs. Anyone with the URL can view a file, no
  auth needed, that's the point of a CDN.
- **Manage** everything: browse, search, filter by category, rename to a vanity
  alias, soft-delete.
- **List selectively.** Reachable-by-URL and shown-in-the-gallery are separate
  concerns; a file is public only when you list it.
- **Protect** the dashboard behind a single shared password and a signed session
  cookie. No user database to run.
- **Try it first.** A zero-dependency demo mode runs the whole app with no
  Postgres, Blob, or secrets, seeded with sample files.

Uploaded bytes live in Vercel Blob as **private** blobs. The only way to read
them is through this app's CDN route, which is what makes deletes actually stick
and lets the app own caching and headers.

## Installation

```bash
pnpm install
```

Requires Node.js 22 (see `engines` in `package.json`), and pnpm.

## Quick start

Copy the example environment file and fill it in:

```bash
cp .env.example .env
```

| Variable | Required | What it is |
|---|---|---|
| `DATABASE_URL` | ✅ | Postgres connection string |
| `BLOB_READ_WRITE_TOKEN` | ✅ | Vercel Blob API token (auto-injected when you create a Blob store on Vercel) |
| `SESSION_SECRET` | ✅ | Random 32+ char string used to sign login sessions |
| `AUTH_PASSWORD` | ✅ | The password you type to reach the dashboard |
| `CDN_HOST` | – | Custom domain for serving files (e.g. `cdn.example.com`). Unset in dev, `/f/:name` is used instead |
| `NEXT_PUBLIC_CDN_HOST` | – | Same value, exposed to the browser for building public URLs |
| `DEMO_MODE` | – | Set to `true` to run the zero-dependency showcase (see [Demo mode](#demo-mode)) |
| `NEXT_PUBLIC_DEMO_MODE` | – | Same value, exposed to the browser |

Generate a `SESSION_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

The filename search uses a trigram index, which needs the Postgres `pg_trgm`
extension. Enable it once before pushing the schema:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

Then push the schema and start the dev server:

```bash
pnpm db:push
pnpm dev
```

Open http://localhost:5000. The landing page has two doors: the public
**gallery**, and the **control panel** (`/control-panel`), which prompts for your
`AUTH_PASSWORD`.

## How auth works

There's no user database, just one shared password (`AUTH_PASSWORD`).

When you log in with the right password, the server signs a small token with
`SESSION_SECRET` and hands it to your browser as a cookie. On every later request
the server re-signs the token and checks the signatures match: if they do you're
in; if the token was tampered with they diverge and it's rejected.

The important part: **`SESSION_SECRET` never leaves the server.** Only the signed
token travels to the browser. That's why the secret has to stay private and never
gets committed, anyone who has it could mint valid login tokens. Think of it as
the ink in a rubber stamp locked in the office: the stamped receipt (the token)
goes out into the world, the stamp stays put.

The token is *signed*, not *encrypted*, its contents (just an expiry time) are
readable, but only your server can produce a valid signature for them.

## Public access and the "listed" model

Every uploaded file gets a permanent public URL, and anyone with that URL can
view the file. That's what a CDN is for.

Browsing (a public gallery of files) is a separate concern from access (having
the URL). A file being reachable by URL does not mean it shows up in any public
listing, a file appears in the gallery only when you toggle it on. This keeps
"share this one link" and "put this on the public wall" as two different actions.

## Demo mode

For an open-source showcase you can run the entire app with **no external
services**: no Postgres, no Blob store, no secrets. Set both flags:

```bash
DEMO_MODE=true NEXT_PUBLIC_DEMO_MODE=true pnpm dev
```

In demo mode:

- **Login accepts the fixed password `outofmemory`.** `AUTH_PASSWORD` isn't
  needed, and the field is prefilled on the login page.
- **The dashboard and gallery come pre-seeded** with the bundled sample files
  under `public/demo`, served as static assets through the same `/f/:name` URLs.
- **Renames, gallery toggles, and deletes are illusion.** They appear to work but
  never persist, everything resets on reload.
- **Uploads fake success.** The file shows up and is interactive through an
  in-browser `blob:` URL, carries a "showcase only" disclaimer, and vanishes on
  reload.

Default behavior (both flags unset) is completely unchanged. Every demo branch is
gated, so self-hosters get the normal app with zero overhead.

## Project layout

```
src/
├── middleware.ts                 ← auth guard + /f/ public file alias
├── app/
│   ├── page.tsx                  ← public landing (gallery + control-panel links)
│   ├── login/page.tsx            ← password login
│   ├── gallery/page.tsx          ← public gallery of "listed" files
│   ├── control-panel/            ← dashboard: stats + upload + file browser (auth)
│   ├── api/
│   │   ├── auth/…               ← session management
│   │   ├── upload/…             ← reserve → upload → complete flow
│   │   ├── files/…             ← list (paginated/search/filter), delete, rename, list toggle
│   │   ├── gallery/route.ts     ← public listing of "listed" files
│   │   └── stats/route.ts       ← total files + storage used
│   └── cdn/[...path]/route.ts    ← public file serving (no auth)
├── components/files/…            ← upload dropzone, file grid/card, gallery card, stats bar
├── server/
│   ├── services/                 ← files.service.ts, storage.service.ts (Blob boundary)
│   ├── demo/                     ← in-memory dataset used only in demo mode
│   ├── db/schema.ts              ← Drizzle schema
│   └── auth/…                   ← session tokens + password verification
└── lib/…                        ← upload client, filename/mime helpers, formatters
```

## Deploying to Vercel

1. Push this repo to GitHub.
2. Import it into Vercel (Next.js is auto-detected).
3. Create a **Vercel Blob store**, which auto-injects `BLOB_READ_WRITE_TOKEN`.
4. Add the rest of the environment variables (see the table above).
5. Deploy.
6. Run `pnpm db:push` locally, pointed at your production `DATABASE_URL`, to push
   the schema. Remember to `CREATE EXTENSION IF NOT EXISTS pg_trgm;` on the
   production database first.

Pushes to `main` auto-deploy. For a public showcase, deploy a second project off
the same repo with `DEMO_MODE=true` and `NEXT_PUBLIC_DEMO_MODE=true`; it needs no
`DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`, or `AUTH_PASSWORD`.

## Scripts

```bash
pnpm dev        # start the dev server on port 5000
pnpm build      # production build
pnpm start      # serve the production build
pnpm typecheck  # type-check without emitting
pnpm db:push    # push the Drizzle schema to your database
```

## Contributing

Contributions are welcome, see [CONTRIBUTING.md](./CONTRIBUTING.md) for how to get
set up and what to check before opening a pull request.

## License

[MIT](./LICENSE) © revxshafi
