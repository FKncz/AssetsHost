# Contributing to AssetsHost

Notes for working on AssetsHost. If you just want to run it, the
[README](./README.md) is the place to be.

This is a small, focused project, a self-hosted asset CDN with a password-guarded
dashboard, so the bar for adding to it is high and changes should stay in scope.
Bug reports, failing reproductions, and fixes are always welcome.

## Getting set up

```bash
pnpm install
cp .env.example .env   # then fill in the values
pnpm db:push           # push the Drizzle schema to your database
pnpm dev               # http://localhost:5000
```

Node.js 22, and pnpm. See the [README](./README.md) for what each
environment variable does. To poke at the app with no database or Blob store,
run it in demo mode:

```bash
DEMO_MODE=true NEXT_PUBLIC_DEMO_MODE=true pnpm dev
```

## The commands

```bash
pnpm dev        # start the dev server on port 5000
pnpm build      # production build
pnpm start      # serve the production build
pnpm typecheck  # tsc --noEmit
pnpm db:push    # push the Drizzle schema to your database
```

Before opening a pull request, `pnpm typecheck && pnpm build` should both pass.

## Design constraints

These are the rules the project is built around. A change that breaks one of them
needs a strong argument.

**Private bytes, one way in.** Uploaded files live in Vercel Blob as private
blobs; the only read path is the app's CDN route. That's what makes deletes stick
and lets the app own caching and headers. A change that hands out a direct blob
URL defeats the whole model.

**Access and listing are separate.** Reachable-by-URL is not the same as
shown-in-the-gallery. A file is public in the gallery only when it's listed. Keep
those two concerns apart.

**The secret never leaves the server.** `SESSION_SECRET` signs the session token;
only the signed token travels to the browser. Nothing should ever serialize the
secret into a response or a client bundle.

**Demo mode costs self-hosters nothing.** Every demo branch is gated behind
`DEMO_MODE` / `NEXT_PUBLIC_DEMO_MODE`. With the flags unset the normal app runs
unchanged, so demo code must never touch the default path.

**Stay in scope.** This is an asset CDN, not a general-purpose file host. New
runtime dependencies and new surface area both need justifying.

## Before opening a pull request

- Run `pnpm typecheck`, it must pass with no errors.
- Run `pnpm build`, the production build must succeed.
- Keep changes focused. One logical change per PR is easier to review.
- If it changes behaviour a user would notice, say so in the description.

## Code style

TypeScript throughout, Tailwind for styling, Drizzle for database access.
Server-only logic lives under `src/server`, browser helpers under `src/lib`. A
few things the tooling can't enforce:

- **Comments explain *why*, not *what*.** If a comment restates the line below it,
  delete it. If a piece of code looks wrong until you know some constraint, that
  constraint is what the comment is for.
- **Match the surrounding file.** Naming, comment density, and idiom should read
  like the code already there.
- **Gate demo behaviour.** Anything demo-specific belongs behind the demo flags,
  never on the default path.

## Commits and pull requests

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
loosely: `feat:`, `fix:`, `perf:`, `docs:`, `chore:`, `ci:`. The subject line
should say what changed and, where it isn't obvious, why.

In a pull request, please include what problem it solves, and whether it changes
behaviour a user would notice.

## Scope

Good fits: bug fixes, accessibility improvements, performance, better docs, small
quality-of-life features around upload, browse, and serve.

Out of scope (for now): multi-user accounts, alternative storage backends, and
anything that turns this into a general-purpose file host. If you want to build on
those, a fork is a great starting point.

## Reporting bugs

Open an issue with a minimal reproduction: the shortest steps that show the
problem, and what you expected instead.

For anything security related, please **don't** open a public issue with exploit
details. Describe the impact and reach out privately first.

## License

Contributions are licensed under [MIT](./LICENSE), the same as the project.
