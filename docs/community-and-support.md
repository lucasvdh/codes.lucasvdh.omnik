# Community and support

How users reach this app, how reports get triaged, and the templates for replies and release posts. Who may post what: `docs/agent-tooling.md`.

---

## 1. Channels

| Channel | For | Notes |
| --- | --- | --- |
| Forum app topic (`homeyCommunityTopicId`) | Most user reports, release announcements, test links | One topic per app in the **Apps** category |
| GitHub issues (`bugs.url`) | Reproducible bugs and feature requests | Issue template asks for version, device model and a diagnostic report Log ID |
| Diagnostic reports | Logs from the user's Homey | Read through the Developer MCP; refer to them by Log ID |
| Crashes | Automatic | Developer MCP `get_crashes`, or Developer Tools |

## 2. Forum topic conventions

These are observed community conventions, not written rules.

- **Title:** `[APP][Pro] <App name> - <tagline>`. Variants: `[APP][Pro][Cloud]`, `[APP][Pro][TEST]` while only on Test. Some maintainers add the current versions: `(Live 1.4.0, Test 1.5.0)`.
- **First post:** what the app does; Live and Test links (`https://homey.app/a/<id>` and `/test`); the GitHub link; supported devices; setup steps; known limitations; how to report a problem (diagnostic report steps plus GitHub issues).
- **Second post (optional):** version history, kept up to date.
- **Releases:** one reply per release (template below).
- Logs and code in fenced code blocks.
- Point users to the existing topic instead of new threads.

## 3. Triage

For every new report (forum, GitHub, diagnostic report, crash group):

1. **Version and channel**: is the user on the latest Live or Test build?
2. **Already known?** Search GitHub issues, the topic and crash groups.
3. **Evidence**: is there a Log ID? If not, ask for a diagnostic report.
4. **Classify**: bug, device/firmware limitation, configuration or network problem, feature request, or question.
5. **Next step**: fix (regression test first), ask for information, document in the FAQ, or decline with a reason.

Labels on GitHub: `bug`, `crash`, `enhancement`, `needs-info`, `device-support`, `wontfix`. Reference the forum post in the issue and the issue in the forum reply.

## 4. Reply templates

Drafts for the maintainer to approve. Adapt them; don't paste them verbatim every time. Keep them short. Write in the language of the thread (usually English, sometimes Dutch).

### Asking for a diagnostic report

```
Thanks for reporting. Could you reproduce the problem, then send a diagnostic report right after?
Homey app > More > Apps > <App name> > settings (cog) > Send diagnostic report.
Put your forum name in the message and post the Log ID here.
```

### Acknowledging a bug

```
Thanks, I can see what's going on in your report: <one-line cause in user terms>.
I'm tracking it in <GitHub issue link>. I'll post here when a fix is on the Test channel.
```

### Fix available on Test

```
v<x.y.z> is on the Test channel with a fix for this: <test link>
It <what changed for the user>. Let me know if it works for you; if it does, it goes to Live with the next release.
```

### Not a bug / limitation

```
This comes from the <device/firmware/service>, not the app: <short explanation>.
<Workaround if there is one.> I've added it to the FAQ.
```

### Feature request

```
Good idea. I've added it as <GitHub issue link>. No promises on timing; a PR is welcome too.
```

## 5. Release post template

```
**v<x.y.z> - <Test|Live>**

<One sentence on the main change, if any.>

- Added: …
- Fixed: …
- Changed: …

<Test link if Test.> If something isn't right, please send a diagnostic report and post the Log ID here.
```

- Keep it short: a few bullets, then one line per person to mention. Users skim forum posts; a long post reads like release notes nobody asked for.
- Mention only people whose report this release actually fixes, and say honestly what changed for them ("hidden because HTTP can't provide it", not "fixed"). Ask the ones who reported something you couldn't reproduce to try again.
- The bullets come from the changelog. Leave out internal changes.
- Mention new permissions (no auto-update) and anything users must do (re-pair, repair, adjust a Flow).
- When a release fixes reports from the topic, quote or mention those posts so the reporters get notified.

## 6. Tone

- Friendly, direct, short. The maintainer's own voice: first person, no corporate "we".
- No em-dashes, no filler ("Great question!", "I hope this helps"), no headings in short replies.
- The community moderates unchecked AI-generated content (https://community.homey.app/t/157628). Every post is read and approved by the maintainer before it goes out.

## 7. GitHub templates

- `.github/ISSUE_TEMPLATE/bug_report.yml`: app version and channel, Homey model and firmware, device model and firmware, what happened vs. expected, steps, diagnostic report Log ID.
- `.github/ISSUE_TEMPLATE/config.yml`: links to the forum topic for questions.
- `.github/pull_request_template.md`: what and why, tests, store-visible changes.
