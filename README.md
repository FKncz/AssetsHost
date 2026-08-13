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

## Deploy your own

No local setup needed beyond one schema push, this runs on Vercel's free tier.

1. **Fork [Creative-Softworks/AssetsHost](https://github.com/Creative-Softworks/AssetsHost)**
   with the Fork button at the top of the page.
2. Open [vercel.com/new](https://vercel.com/new) and import your fork. Next.js is
   auto-detected, so leave the build settings alone.
3. In the project's **Storage** tab, create a **Blob store**. Vercel injects
   `BLOB_READ_WRITE_TOKEN` for you.
4. Still in **Storage**, add a **Postgres** database (or bring your own from Neon,
   Supabase, etc.) and make sure `DATABASE_URL` is set.
5. Under **Settings → Environment Variables**, add `SESSION_SECRET` and
   `AUTH_PASSWORD` (see the table below).
6. **Deploy.**
7. Create the schema. This is the one step that needs the code locally, clone your
   fork and run it against the production database:

   ```bash
   psql "$DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"
   DATABASE_URL="…" pnpm db:push
   ```

Log in with the `AUTH_PASSWORD` you chose and start uploading. Pushes to `main`
auto-deploy from then on, and you can pull upstream changes into your fork with
GitHub's **Sync fork** button.

Want to see it before committing to any of that? Deploy with `DEMO_MODE=true` and
`NEXT_PUBLIC_DEMO_MODE=true` as the *only* env vars, no database, Blob store, or
secrets needed. See [Demo mode](#demo-mode).

## Configuration

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

## Running locally

Only needed if you want to hack on the code, deploying doesn't require it.
Requires Node.js 22 (see `engines` in `package.json`), and pnpm.

```bash
git clone https://github.com/YOUR-USERNAME/AssetsHost
cd AssetsHost
pnpm install
cp .env.example .env   # then fill it in
pnpm db:push
pnpm dev
```

Open http://localhost:5000. The landing page has two doors: the public
**gallery**, and the **control panel** (`/control-panel`), which prompts for your
`AUTH_PASSWORD`.

For a look around with no database or Blob store at all, put `DEMO_MODE=true` and
`NEXT_PUBLIC_DEMO_MODE=true` in `.env` and skip straight to `pnpm dev`.

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

## Serving from your own domain

Point a subdomain like `cdn.example.com` at the Vercel project, then set both
`CDN_HOST` and `NEXT_PUBLIC_CDN_HOST` to it. Public URLs become
`https://cdn.example.com/f/:name` instead of falling back to the deployment URL.
The CDN route is host agnostic, so the dashboard keeps working on either host.

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

## A note from the dev

When I made this project, I smoked 3 kg of ganja, so I have no idea what I made. After finishing it, I ran React Doctor, and it showed 370+ errors of all kinds, so I gave up and handed the project to Claude, which overnight rewrote 60% of the website and added new UI and features. Now everything works. I tested it all out, found nothing bad, and I'm not going to use this project that often anyway, so why not make it open source?

Now here we are. You can use it, do whatever you want with it, just don't share so-called illegal files with it. 👍

## License

[MIT](./LICENSE) © revxshafi
