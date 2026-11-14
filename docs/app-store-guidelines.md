# Homey App Store guidelines

The official rules (https://apps.developer.homey.app/app-store/guidelines, checked November 2026), plus the unwritten rules that show up in rejections. Reviewers apply these to **every submission, updates included**. Assets that passed years ago can be rejected on the next update.

Run `npm run homey-review` (`homey app review`) before submitting. It checks the manifest, images and code against these guidelines and reads app-specific context from `.homeyreview.md`.

---

## Pre-submission checklist

- [ ] `homey app validate --level verified` passes.
- [ ] `homey app review --type update` (or `new`) returns approve, or every finding has been addressed.
- [ ] Name: brand name, at most 4 words, no "Homey", "Athom" or protocol names.
- [ ] Description: a one-line tagline that doesn't repeat the name and doesn't start with "Adds support for".
- [ ] `README.txt`: 1–2 plain-text paragraphs. No headings, lists of features or Flow cards, URLs, donation links, changelog or credits. Translated into every language the description has.
- [ ] App images 250×175 / 500×350 / 1000×700 (jpg/png), lively, not a logo on a plain background, not AI-generated.
- [ ] Driver images 75×75 / 500×500 / 1000×1000, white background, a photo of the actual device, different from the app image.
- [ ] App icon and driver icons: SVG, transparent, line art, full 960×960 canvas. Driver icons unique per driver.
- [ ] `brandColor` set, dark enough for white icons.
- [ ] All Flow cards, capabilities, settings and pair views translated into every supported language. No typos.
- [ ] Flow card titles: short, no device names, no "When/And/Then", no parentheses. `titleFormatted` where there are arguments.
- [ ] Permissions: none, or each one justified in the submission notes.
- [ ] Changelog: user-facing, every supported language, no mention of review feedback.
- [ ] No breaking changes for existing users (see `docs/architecture-conventions.md#9-migrations`).

---

## 1. Official rules

### 1.1 Name

- Use the brand name, not the company name. At most 4 words.
- No "Homey" or "Athom", and no protocol names (Zigbee, Z-Wave, 433 MHz, Infrared, …).

### 1.2 Description

- A one-line tagline that doesn't repeat the name or the readme. A brand slogan works well.
- Avoid "Adds support for X", "Integrates X with Homey" and "Control your X devices with the X app".

### 1.3 Readme (`README.txt`)

- 1–2 paragraphs, single line spacing, no headers or titles, no extra indentation.
- **Plain text only. No Markdown.**
- **No URLs.** Links go in the manifest (`homepage`, `support`, `source`, `bugs`, `homeyCommunityTopicId`).
- **No changelog.** That's `.homeychangelog.json`.
- Don't list features, capabilities or Flow cards. The store generates those.
- Credit contributors in the manifest, not here.

### 1.4 Images

- `.jpg` or `.png`. Small and large are required, xlarge is optional.
- App image: 250×175, 500×350, 1000×700. Make it lively, ideally lifestyle or brand imagery. Rejected:
  - a flat shape or icon on a plain or transparent background
  - a logo
  - clipart
  - phone-app screenshots only
  - generic or AI-generated illustrations
  - anything showing the Homey logo, name or device
- Driver images: 75×75, 500×500, 1000×1000, on a white background, showing a recognisable photo of the device. Never reuse the app image or icon.

### 1.5 App icon

- SVG on a transparent background, using the full 960×960 canvas.
- No photos, filled illustrations, gradients or background colour.
- Use the brand's icon, not a driver icon.

### 1.6 Driver icons

- Unique per driver. Line-and-shape drawing with the right line width.
- Right-side angle preferred over front-on. Transparent background, full 960×960 canvas.
- Athom draws icons for free on request: https://github.com/athombv/homey-vectors-public/issues.

### 1.7 Brand colour

Required. Icons are rendered white on top of it, so it must not be too bright. The validator checks this.

### 1.8 URLs

In the manifest only.

### 1.9 Flow

- Provide When, And and Then cards where it makes sense.
- Short titles: no device names, no "When/And/Then", no parentheses.
- `titleFormatted` for cards with arguments. A `hint` where the purpose isn't obvious.
- `"highlight": true` on a few cards only.

### 1.10 Widget previews

Light and dark versions, 1024×1024, made with Athom's Figma template. Transparent background, no screenshots or text, few colours.

### 1.11 Language

- English is required. **Typos lead to rejection.**
- No partial translations. If the description is translated, the readme must be translated too, and so must every Flow card, setting and capability.

### 1.12 Dependencies

The core of the app must work on its own. Apps that only add value to other apps are not allowed.

### 1.13 Developer account name

No emojis or special characters. Verified developers use their company name.

### 1.14 SDK

New apps must use SDK v3.

### 1.15 Permissions

Every permission must be justified. `homey:manager:api` is heavily scrutinised and only meant for tool-type apps (HomeyScript, device groups, alarm systems). Apps for branded hardware that request it are rejected.

### 2.1 Duplicates

- Ideally one app per brand or concept. Contact the existing developer and contribute with a PR.
- If you still submit a separate app, explain why in the submission.
- No catch-all apps. Unmaintained apps can be replaced.
- Ask permission before using someone else's code, and credit them in the manifest.

### 2.2 / 2.3 Content and pricing

- No adult content.
- Apps are free; donations are allowed. A paid third-party service is fine when payment happens on the service's side.

### 3.x After submission

- Review takes up to two weeks. **All review feedback must be implemented.**
- Apps without an update for more than two years may be hidden when they are broken or a working alternative exists.
- Verified developers must provide test devices or a demo account.

---

## 2. Unwritten rules and common rejections

These come from forum reports by developers and are not in the official guidelines (links are to community.homey.app).

| Rejection cause | What to do | Source |
| --- | --- | --- |
| Readme lists features, devices or Flow cards. One developer was rejected 5 times. | Two short prose paragraphs about what the app lets you do. Nothing else. | t/154632 |
| Donation link in the readme | Use `contributing.donate` in the manifest. | t/14769/149 |
| App image re-checked on an update: "black shape on a white background, section 1.4.2" | Treat every submission as a new review of every asset. | t/5129/24 |
| "Icons not recognizable": a brand logo copied from a website, or a filled icon with a background | Transparent line art; ask Athom through homey-vectors-public. | t/157193 |
| Duplicate brand app (Frigate, Nissan, Sonoff driver, absence simulator) | Search the store first. Contribute to the existing app, or argue the difference in the submission. Approval of v1 doesn't guarantee v2. | t/155652, t/147954, t/96391, t/157794 |
| App id containing `homey` (e.g. `com.github.homey.qnap`) | Pick the id carefully up front. Changing it later means a new app. | t/53898/15, t/142944 |
| Driver names with underscores | Spaces in the display name. Keep folder ids without spaces (spaces break custom pair views on Pro 2016–2019). | t/130195/11-12 |
| IP-only pairing (2021, soft) | Prefer discovery; keep manual IP as a fallback. | t/53898 |
| App needs external installations, or bypasses security (insecure Z-Wave pairing) | Not allowed. | t/6697/37, t/55597/14 |
| Bright `brandColor` | Use a darker brand shade. | t/115020 |
| Changelog mentions "changes after review" | Only user-relevant changes since the last live version. | official publishing docs |

Other observations:

- **The Test channel is not reviewed.** Test builds are never blocked or rejected, so many apps live in Test for a long time with the test link in the forum topic.
- **Some reviews are partly automated** (an AI review shows up in the build status, which the Developer MCP's `get_build_status` returns). `homey app review` gives you the same view before submitting.
- **[unverified, 2022]** A new Test build couldn't be submitted while another submission was pending review.
- **Moderation of AI-written posts:** see `docs/community-and-support.md`.

---

## 3. `.homeyreview.md`

`homey app review` reads `.homeyreview.md` in the app root for app-specific context. Use it to explain choices a reviewer might question, for example:

- why a permission is needed;
- why manual IP pairing exists next to discovery;
- why this app exists next to another app for the same brand;
- which drivers share an image because the hardware looks identical.

Keep it factual. It steers the local AI review. Whether Athom's reviewers ever see it is not documented, so also put the same arguments in the submission notes.
