# Agent tooling

The external tools an agent can use for this app, what each is for, and what an agent may do on its own.

The rule behind all of it: **reading is free; anything another person can see needs the maintainer's explicit go-ahead for that specific action.** "Fix issue #12" is not permission to comment on #12, post in the forum or publish a build.

| Tool | Read without asking | Needs explicit approval per action |
| --- | --- | --- |
| Homey Developer MCP | apps, builds, crashes, diagnostic reports, stats, build status | `release_build`, `submit_for_certification`, `retract_submission` |
| Discourse MCP (community.homey.app) | search, read topics and posts | creating or editing posts and topics, private messages, user changes. Saving a draft is allowed. |
| GitHub (`gh`) | issues, PRs, CI runs, releases | comments, labels, closing issues, creating releases, pushing |
| Homey CLI | `validate`, `build`, `review` | `run`, `install` (touch a real Homey), `publish` |

---

## 1. Homey Developer MCP (`homey-developer`)

An MCP server for Homey app developers: https://github.com/lucasvdh/homey-developer-mcp. It reads the maintainer's own apps through Athom's apps API with a Personal Access Token.

Setup (once per machine):

```sh
claude mcp add homey-developer --env HOMEY_PAT=pat-... -- npx -y homey-developer-mcp
# write tools: add --env HOMEY_MCP_ALLOW_WRITE=1
```

### Read tools

| Tool | Use it for |
| --- | --- |
| `list_apps` | Live/test versions, installs and crash counts for every app |
| `list_builds` | Builds of this app, newest first |
| `get_crashes` | Crashes and unhandled rejections of recent builds, **regrouped per bug** (ids replaced by `<id>`, grouped by error and the first frame in app code), most frequent first |
| `list_diagnostic_reports` | Reports users sent with *Send diagnostic report*: message plus stderr preview |
| `get_diagnostic_report` | One report in full: Log ID, user message, stdout, stderr |
| `get_install_stats` | Daily installs, optionally per driver |
| `get_build_status` | Build state, why processing failed, reviewer comments, Athom's AI review |

By default the tools look at the newest 5 builds. Pass `builds` or `buildId` to look further back. A report is stored on the build the user was running.

### Write tools (only with `HOMEY_MCP_ALLOW_WRITE=1`)

| Tool | Effect | Agent rule |
| --- | --- | --- |
| `release_build` (`test`) | Puts a build on Test. Easy to undo: the next build replaces it. | Only when the maintainer asks for this build. |
| `release_build` (`live`) | Puts an approved build on Live for every user. | Only on an explicit "release X to live". |
| `submit_for_certification` | Sends a build to Athom review. Leave `autoRelease` at `false` unless told otherwise. | Only on an explicit request. |
| `retract_submission` | Withdraws a build from review. | Only on an explicit request. |

The server never replies to users and never changes app settings.

### Crash triage workflow

1. `get_crashes` for the app. Sort by count and by whether the newest build is affected.
2. For each group: the error, the app file and line, the builds, the count. Map the frame to the `.ts` source. Line numbers point into `.homeybuild/` output, and source maps help.
3. Decide per group: already fixed in a newer build (check the build list), a real bug, or noise (for example a user's network). Report that classification to the maintainer before fixing.
4. Fix real bugs with a regression test first (`AGENTS.md` → Bugs and crashes).
5. In the commit, refer to the crash by error and location (`crash: TypeError in state-poller.ts:88`). Never paste a raw stack that contains user data.

### Diagnostic report workflow

1. `list_diagnostic_reports`, then `get_diagnostic_report` for the ones that matter. Match them to a GitHub issue or forum post through the Log ID or the user's message.
2. Read stdout and stderr for the sequence of events. If the logs don't contain enough to diagnose, that's a finding too: add the missing context to the logging.
3. Reproduce the behaviour in a test with **sanitized** data.

### Privacy

Diagnostic reports contain what users wrote and their app logs: device names, IP addresses, sometimes e-mail addresses and serial numbers.

- Never copy report content into GitHub issues, PRs, commits, test fixtures, code comments or forum posts. Refer to a report by its **Log ID** only.
- Summarise what you learned ("the TV answered 403 on /6/system after a firmware update") instead of quoting logs.
- If a user's e-mail address is in a report, don't contact them. Tell the maintainer.

---

## 2. Discourse MCP (`discourse`, community.homey.app)

The Homey Community forum is where most users report problems and where release announcements go. The Discourse MCP is configured for the maintainer's account **with writes enabled**. Anything it posts appears under the maintainer's name, so the rules below matter.

### Reading (always allowed)

| Tool | Use it for |
| --- | --- |
| `discourse_read_topic` / `discourse_read_topic_posts` | Read the app's topic (`homeyCommunityTopicId` in the manifest) from the last post the maintainer replied to |
| `discourse_search` / `discourse_search_posts` | Find reports about the app elsewhere, earlier answers, similar problems in other apps |
| `discourse_filter_topics` | Recent topics in the Developers (id 10) or Apps (id 7) category |
| `discourse_read_post` | One post, e.g. a linked report |
| `discourse_get_user` / `discourse_list_user_posts` | Context on a reporter, sparingly |

When you read the app topic, produce a short triage list: per open report, who posted it, the version, the symptom, whether a Log ID was given, whether it matches a GitHub issue or a crash group, and a proposed next step.

### Writing (default: draft, never post)

The default is **draft, not post**:

1. Write the text, following the templates in `docs/community-and-support.md`.
2. Show it to the maintainer in the conversation. Or save it with `discourse_save_draft` so it opens in the maintainer's composer on the forum. Check the draft key format with `discourse_get_draft` first.
3. Post with `discourse_create_post` only after the maintainer approves **that exact text** for **that topic**. Any change to the text needs approval again.

Never, without an explicit request:

- `discourse_create_topic`, `discourse_update_topic` (titles, categories, tags)
- `discourse_update_post` on any post, including the maintainer's own first post
- private messages (`discourse_create_private_message`, `discourse_reply_private_message`, `discourse_invite_to_private_message`)
- anything with users, categories, uploads or data explorer queries (`discourse_create_user`, `discourse_update_user`, `discourse_create_category`, `discourse_upload_file`, `discourse_*_query`)

### Content rules for anything that may be posted

- Follow the community's July 2026 moderation stance on AI content (https://community.homey.app/t/157628): the maintainer checks every post, filler gets cut, and long AI-styled posts are flagged or dismissed ("AI;DR").
- Short and human: say what changed, which version, which channel, what the user should do. No greetings paragraph, no "I hope this helps", no em-dashes, no headings for a three-line reply.
- Mention users (`@name`) only when replying to their report.
- Never post diagnostic report content, logs with user data, or anything from a private message.
- Logs and code go in fenced code blocks.
- Link the GitHub issue when one exists.

---

## 3. GitHub (`gh`)

- Read issues, PRs and CI freely: `gh issue view`, `gh pr checks`, `gh run view --log-failed`.
- Before fixing an issue, read the whole thread and check whether a diagnostic report Log ID was given.
- Draft issue and PR comments in the conversation. Post them only when asked.
- Write `@name` only for a real person you mean to notify. Put roles and code in backticks.
- Never push to `main`, force-push shared branches, create releases or close issues without being asked.
- **Stacked PRs** (GitHub's native stacks): create each PR with its base on the branch below. Add new work below the release PR and rebase the release onto it; push your own PR branches with `--force-with-lease`. Don't change a PR's base by hand: that drops it from the stack. Repair a stack with the REST API (`X-GitHub-Api-Version: 2026-03-10`): `POST /repos/{owner}/{repo}/stacks/{n}/unstack` and `POST /repos/{owner}/{repo}/stacks/{n}/add` with `{"pull_requests": [...]}` bottom to top. Check membership with the `stack` field of `GET /repos/{owner}/{repo}/pulls/{n}`.
- Tags: use `git tag -m "vX.Y.Z" vX.Y.Z <sha>`. Maintainers often sign tags (`tag.gpgsign`), which fails for a tag without a message.

---

## 4. Homey CLI

- Allowed freely: `npx homey app validate --level verified`, `npx homey app build`.
- `npx homey app review`: when asked, or as part of preparing a release. It sends the source and images to OpenAI or Anthropic and costs tokens. It needs `OPENAI_API_KEY` (official model, the default) or `ANTHROPIC_API_KEY` with `--model anthropic/<model>`. If neither is set, skip it and say so.
- Ask first: `homey app run`, `homey app install` (they install on the maintainer's Homey) and `homey app publish` (uploads a build).
- Never `homey login` or handle the maintainer's tokens yourself.

---

## 5. The maintainer's network

Never scan or probe a network (ping sweeps, broadcasts, port scans) without asking first, even to test discovery. The maintainer may not be at home, and the network the machine is on may belong to someone else.

## 6. Other sources of truth

- Official docs as Markdown: append `.md` to any https://apps.developer.homey.app URL. The index is https://apps.developer.homey.app/llms.txt. Prefer it over memory for API details.
- SDK reference: https://apps-sdk-v3.developer.homey.app (class pages such as `Device.html`, `FlowCardTrigger.html`).
- Types: `node_modules/@types/homey/lib/*.d.ts`.
- Device or vendor API specs: `api-specs/` or `docs/development/` in this repo.
