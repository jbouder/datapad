# Datapad

A private project tracker for an engineering leader: projects, tasks, notes,
meetings, milestones and people in one place, with cross-project views, search and
summaries that run on your own device. Built for daily use on a laptop and a
phone.

Datapad is a sibling of [Holocron](https://github.com/jbouder/holocron): the
same stack, look, motion and quality bar. The difference is that Datapad
keeps your data, and only you can reach it.

## Status

Under construction. Milestone progress is tracked in the
[roadmap issue](https://github.com/jbouder/datapad/issues/46).

| Milestone | What lands                                                               |
| --------- | ------------------------------------------------------------------------ |
| M0        | Scaffold, CI and deploy, Cloudflare Access, themes and motion foundation |
| M1        | Data model, sync, import and export                                      |
| M2        | App shell, Projects, Tasks                                               |
| M3        | Notes and mentions                                                       |
| M4        | Meetings, with prep and debrief notes                                    |
| M5        | Focus, People, ⌘K search                                                 |
| M6        | On-device summaries, backups, polish                                     |
| M7        | Health, blocked, decisions (since retired), orgs, digest, templates      |
| M8        | Quality, security, accessibility and docs pass                           |
| M9        | Spaces                                                                   |
| M10       | Meetings and milestones                                                  |

## Privacy

- Cloudflare Access stands in front of the app, and the Worker checks the
  Access token again on every request. Without a valid sign-in nothing is
  served, not even the page shell.
- Your data lives in one Durable Object in your own Cloudflare account,
  named by your verified email, plus a nightly backup in your own R2 bucket.
- Summaries run in your browser on a local model. Only the model's weights
  are downloaded, after you agree; your projects and notes never leave the
  device for them.
- This repository is public and contains no data.

## Run it yourself

You need a Cloudflare account with Zero Trust (the free plan is enough).
[docs/self-hosting.md](docs/self-hosting.md) walks from zero to a signed-in
deployment.

For local development:

```bash
bun install
cp .dev.vars.example .dev.vars
npm run dev
```

## Docs

- [SPEC](docs/SPEC.md): what the product does
- [PLAN](docs/PLAN.md): how it is built, and where it departs from the spec
- [Architecture](docs/architecture.md)
- [Data](docs/data.md): what is stored where, export, backups, deleting
- [Design](docs/design.md): tokens, density and copy rules
- [Security](docs/security.md): threat model and headers
- [Self-hosting](docs/self-hosting.md)
- [AGENTS.md](AGENTS.md): working in this repository

## License

[MIT](LICENSE)
