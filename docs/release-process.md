# Release process

From merged code to a build on users' Homeys.

---

## 1. Channels

```
homey app publish  ──►  Draft  ──►  Test   (https://homey.app/a/<id>/test, not reviewed)
                             └──►  Certification (Athom review, up to 2 weeks)  ──►  Live
```

- An app's first release must be certified.
- Test builds are not reviewed. Use Test for fixes that users in the forum topic can try first.
- Homey never downgrades. To undo a bad release, publish the old code with a **higher** version.
- Every new version must be higher than the current Live version.
- **Patching Live while a newer Test exists:** publish a version lower than the Test version but higher than Live (Live 1.4.0, Test 1.5.0 → hotfix 1.4.1). It replaces the Test build. Afterwards, release the Test line again with a version higher than any released before (1.5.1).
- Apps that add a **permission** don't auto-update on users' Homeys. Call that out in the changelog and the forum.

## 2. Versioning

- Semver, no pre-release suffixes (`1.2.0-rc.1` is rejected).
  - **patch:** fixes, translations, internal changes.
  - **minor:** new devices, capabilities, Flow cards, settings. Must be backwards compatible.
  - **major:** only for a big change users need to know about. Breaking changes are still not allowed.
- The version lives in three committed places that must match: `.homeycompose/app.json`, `package.json` and `package-lock.json`. The generated `app.json` (gitignored) follows from compose. `homey app version` updates `.homeycompose/app.json` and the changelog; don't pass `--commit`, because it tries to stage the ignored `app.json`. Update `package.json` with `npm version --no-git-tag-version <x.y.z>`.

## 3. Changelog

`.homeychangelog.json`:

```json
{
  "1.5.0": {
    "en": "Adds support for coffee machines. Fixes a crash when the appliance disconnects during a program.",
    "nl": "Ondersteuning voor koffiemachines toegevoegd. Een crash opgelost wanneer het apparaat tijdens een programma de verbinding verliest.",
    "de": "…"
  }
}
```

Rules:

- **Every supported language**, translated, not English copied into other keys.
- **Plain text.** No markdown, bullets or URLs. Separate paragraphs with `\n\n` when needed.
- **User-facing.** What users notice: new devices, fixed behaviour, changed behaviour. No refactors, CI or dependency bumps, unless they change behaviour.
- **Only changes since the previous Live version.** Don't mention changes made because of review feedback.
- Don't copy the previous entry. Each version gets its own text, even when it is a one-line fix.
- No em-dashes.
- If the app has a user-facing changelog in `docs/` (GitBook), update it in the same release commit, or replace it with a link to the store.

## 4. Release steps

On a branch `chore/release-x.y.z`:

1. Check that `main` is green and everything for this release is merged.
2. Bump the version:

   ```bash
   npx homey app version minor --changelog.en "…"   # then add the other languages to .homeychangelog.json
   npm version --no-git-tag-version $(node -p "require('./.homeycompose/app.json').version")
   ```

3. Write the changelog for every language.
4. Run `npm run typecheck && npm run lint && npm test && npm run check-locales && npm run homey-validate`.
5. Run `npm run homey-review -- --type update` and handle the findings.
6. Commit `chore: release vX.Y.Z` (only version files and changelog), open a PR, merge.
7. Tag the merge commit with `git tag -m "vX.Y.Z" vX.Y.Z <sha>` (annotated, so signing works), push the tag, and create the GitHub release: What's new, Fixes, Requirements (minimum Homey version when it changed), Under the hood, and the list of commits since the previous tag.
8. Publish: run the **Publish** GitHub workflow (`workflow_dispatch`). Fallback when the workflow isn't set up or fails: `npm run homey-manifest && npx homey app publish` locally, logged in with `homey login`. Both upload a Draft.
9. In Developer Tools (or through the Developer MCP when the maintainer asks): release to Test, or submit for certification. Anything that could only be tested against fakes (discovery, pairing views, real devices) is checked on Test with a real Homey before Live.
10. Draft the forum post for the release (`docs/community-and-support.md`). The maintainer posts it or approves it.

Agents do steps 1–7 when asked to prepare a release. Steps 8–10 change public state: an agent does them only when the maintainer asks for that specific step.

## 5. Publish workflow (recommended) and manual fallback

`.github/workflows/publish.yml` is the suggested way to publish. It validates and uploads a Draft on manual dispatch, refuses a version without a tag, and runs the same way for every maintainer. It needs the repository secret `HOMEY_PAT`, a Personal Access Token from https://tools.developer.homey.app/me, and the environment `homey-app-store`.

It deliberately doesn't bump versions or push commits. The version bump is a reviewed PR (step 6), so the workflow needs no write permissions on the repo.

**Manual fallback:** an app may skip the workflow (no publish token in GitHub) or fall back to it when the workflow fails. Then publish from the maintainer's machine with `npm run homey-manifest && npx homey app publish` (logged in with `homey login`), and release to Test or Live in Developer Tools or through the Homey Developer MCP. When an app skips the workflow, delete `publish.yml` and say so in this section of the app's copy.

## 6. After the release

- Watch the build: `get_build_status` (Developer MCP) shows state, reviewer comments and the AI review. `/loop` in Claude Code can poll it during a session. App Insights for Developers can notify by Flow.
- Watch crashes for the new build over the following days: `get_crashes` with that build.
- Close the issues fixed in the release with a comment naming the version and channel.

## 7. Hotfix on Live

1. Branch from the tag of the Live version: `git switch -c fix/x v1.4.0`.
2. Fix with a regression test, bump to `1.4.1`, publish, and submit for certification.
3. Merge the fix into `main` as well.
4. If a Test build (1.5.0) existed, it has been replaced. Release the next Test version as 1.5.1 or higher.
