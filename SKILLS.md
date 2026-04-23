# README authoring skills

A reusable style and layout guide distilled from building the README in this repo. Use it as a reference when writing or updating READMEs for engineering, research, and portfolio projects.

The guide itself is written in the same style it teaches, so it doubles as a worked example.

---

## Table of contents

- [Document structure](#document-structure)
- [Writing style](#writing-style)
- [Punctuation rules](#punctuation-rules)
- [Proper names that stay hyphenated](#proper-names-that-stay-hyphenated)
- [Image layout](#image-layout)
- [Captions](#captions)
- [Flow diagrams and code blocks](#flow-diagrams-and-code-blocks)
- [File link style](#file-link-style)
- [Pre publish checklist](#pre-publish-checklist)

---

## Document structure

A predictable skeleton helps a reader orient in seconds. Use this order:

1. **H1 title.** Short and literal. No subtitle, no tagline.
2. **Two line intro paragraph.** One sentence stating what the project is and where it came from. A second sentence stating your role and what the repository actually contains.
3. **Hero image row.** One or two images that summarize the project visually. See [Image layout](#image-layout).
4. **Horizontal rule `---`.**
5. **Table of contents.** Bulleted list of anchor links. Helpful once the doc is longer than one screen.
6. **Horizontal rule.**
7. **Why this exists.** Two or three sentences of motivation and constraints. Explain what was happening in the world that made this project necessary.
8. **Horizontal rule.**
9. **Main content sections.** One H2 per major component or version. Within each, use H3 for subsystems and H4 for individual files or scripts.
10. **Horizontal rule.**
11. **Repository layout.** A tree diagram inside a fenced code block, with short end of line comments pointing to notable files.
12. **Horizontal rule.**
13. **Tech stack.** Grouped bullet list (Vision and ML, 3D, Infrastructure, etc.).
14. **Horizontal rule.**
15. **Get in touch.** One line with an email `mailto:` link.

Put a horizontal rule (`---`) before and after the table of contents and between each H2 section. It gives the rendered page quiet breathing room without needing any CSS.

---

## Writing style

The target voice is **scientific, engineering oriented, and easily readable**. Concretely:

- **Short declarative sentences.** One idea per sentence. Break compound sentences with a period rather than a comma or dash.
- **Neutral tone.** State facts, trade offs, and outcomes. Skip adjectives that evaluate your own work (`amazing`, `clean`, `robust`, `powerful`).
- **No marketing language.** Avoid `giant`, `massive`, `blazing fast`, `state of the art`, `cutting edge`, `world class`, `seamless`, `leverage`.
- **No casual asides.** Cut `I'd love to`, `feel free to`, `as you can see`, `obviously`, `simply`, `just`.
- **No contractions in prose.** `did not` instead of `didn't`, `does not` instead of `doesn't`. Exception: contractions are fine inside literal quotes.
- **Prefer passive voice when the actor does not matter.** `The detection stage was replaced with a Faster R-CNN model.` is better than `I replaced the detection stage with a Faster R-CNN model.` Use first person only where authorship or judgment is the point (`We chose SfM because...`).
- **State trade offs.** When a design choice has a downside, name it. Readers trust documents that acknowledge constraints.
- **Explain motivation before mechanism.** Why before what. A section about a pipeline should open with the problem it solves, then describe the steps.

### Before and after

| Avoid | Prefer |
|---|---|
| We built giant offshore kelp farms. | We grew offshore kelp farms along the coast of Maine. |
| The pipeline is blazing fast and handles everything. | The pipeline processes N images per minute on a single GPU. |
| I'd love to chat about this! | For questions, please reach out: `email@example.com`. |
| This is a time capsule of the scripts. | This repository contains the scripts. |
| Clean masking matters — feature matching degrades when... | Feature matching degrades when the background contains repeating or moving texture, so everything outside the subject is set to zero. |

---

## Punctuation rules

### No em dashes in prose

Em dashes (`—`) read as a stylistic flourish. Replace them with:

- **A period.** When the clause that followed the dash is a full sentence.
- **A colon.** When the clause that followed the dash is a label or definition.
- **Parentheses.** When the clause is a genuine aside.
- **A comma.** When the clause is a short extension.

Example rewrites:

```
Before:  V1 gave per-blade 2D stats — good, but kelp blades are not flat.
After:   V1 produced per blade 2D statistics. Kelp blades are not flat.

Before:  Reprojection error — the per-point error when a 3D point is re-projected.
After:   Reprojection error: the per point error in pixels when a 3D point is reprojected.

Before:  The subject (a single kelp blade) hangs from a fixture, with —
After:   A single blade hangs from a fixture, with:
```

### No hyphens in prose compounds

Hyphens in compound adjectives read as dense and academic. Drop them or rephrase:

- `high-resolution images` → `high resolution images`
- `end-to-end pipeline` → `end to end pipeline`
- `real-world units` → `real world units`
- `per-blade metrics` → `per blade metrics`, or `metrics per blade`
- `color-card correction` → `color card correction`
- `non-rigid background` → `background that moves between frames`
- `feature-poor regions` → `regions with few detectable features`

Two exceptions where dropping the hyphen reads worse: rephrase the sentence instead.

### No em dashes in headings

Use a colon.

```
Before:  ## Photobooth V2 — "Polar Bear"
After:   ## Photobooth V2: Polar Bear
```

### Commas, not colons, inside parenthetical lists

Inside parens, commas keep the list visually calm.

```
Good:  (blade count, length, width, volume)
Bad:   (blade count / length / width / volume)
```

Use slashes only for real unit pairs (`cm / cm³`) or filesystem style keywords.

---

## Proper names that stay hyphenated

Do **not** strip hyphens from:

- **Model names**: `Faster R-CNN`, `ResNet-101`, `YOLO-v8`, `BERT-base`.
- **Package names that are literally hyphenated**: `scikit-image`, `scikit-learn`, `dash-core-components`.
- **Product model numbers**: camera serials, chip part numbers (`TRI162S-C`, `RTX-4090`).
- **File and directory paths**: `Photobooth-V1/`, `my-repo-name/src/`.
- **URL slugs in Markdown anchors**: `[Why this exists](#why-this-exists)` — anchors are lowercased with hyphens by Markdown convention.

Rule of thumb: if it is a proper name, a path, or a URL fragment, keep the hyphen. If it is descriptive prose, drop it.

---

## Image layout

Two patterns cover almost every case.

### Single centered image

Use a plain `<p align="center">` wrapper with a percent width. The caption goes in a second `<p>` with a `<sub>` tag.

```html
<p align="center">
  <img src="imgs/example.png" width="40%" alt="Descriptive alt text for accessibility">
</p>
<p align="center"><sub>Caption in small type. One or two sentences describing what is in the image and why it matters.</sub></p>
```

Width choices that work well: `35%` to `55%` for wide images, `25%` to `40%` for tall or square images.

### Two or three image aligned row

Use an HTML `<table align="center">`. Fix the **height** of every image in the row so they share a baseline regardless of aspect ratio. Put captions in a second row with `valign="top"`.

```html
<table align="center">
  <tr>
    <td align="center" valign="middle"><img src="imgs/a.png" height="280" alt="..."></td>
    <td align="center" valign="middle"><img src="imgs/b.png" height="280" alt="..."></td>
  </tr>
  <tr>
    <td align="center" valign="top"><sub><b>Label A</b>: short caption.</sub></td>
    <td align="center" valign="top"><sub><b>Label B</b>: short caption.</sub></td>
  </tr>
</table>
```

Why a table, not two inline `<img>` tags with `&nbsp;` between them:

- A percent width does not account for aspect ratio differences, so two `48%` images can render at very different rendered heights and misalign vertically.
- A table forces both cells onto the same baseline and lets you pin a shared height.

### Three image row

Same pattern, three cells. Use a shorter fixed height because three images compete for horizontal space.

```html
<table align="center">
  <tr>
    <td align="center" valign="middle"><img src="imgs/a.png" height="170" alt="..."></td>
    <td align="center" valign="middle"><img src="imgs/b.png" height="170" alt="..."></td>
    <td align="center" valign="middle"><img src="imgs/c.png" height="170" alt="..."></td>
  </tr>
  <tr>
    <td align="center" valign="top"><sub><b>A</b>: caption.</sub></td>
    <td align="center" valign="top"><sub><b>B</b>: caption.</sub></td>
    <td align="center" valign="top"><sub><b>C</b>: caption.</sub></td>
  </tr>
</table>
```

### Mixing a narrow and a wide image in one row

Add explicit `width="X%"` on the `<td>` cells so the narrow image does not stretch to fill.

```html
<table align="center">
  <tr>
    <td align="center" valign="middle" width="25%"><img src="imgs/small_square.png" height="200" alt="..."></td>
    <td align="center" valign="middle" width="75%"><img src="imgs/wide_panorama.png" height="200" alt="..."></td>
  </tr>
</table>
```

### Picking heights

Before writing the HTML, measure every image in the row.

```bash
python3 -c "
from PIL import Image
import os
d = 'imgs'
for fn in sorted(os.listdir(d)):
    if fn.endswith(('.png', '.jpg', '.jpeg')):
        im = Image.open(os.path.join(d, fn))
        w, h = im.size
        print(f'{fn:40s} {w}x{h}  ratio {w/h:.2f}')
"
```

Rules of thumb for `height`:

| Row content | Suggested `height` |
|---|---|
| Hero row, one or two wide images | `280` to `320` |
| Two tall images (portrait) | `400` to `450` |
| Three images in a row | `160` to `200` |
| Square tag next to wide scene | `200` (shared) |

If two images in a row have wildly different aspect ratios, pin the height and accept that the rendered widths will differ. That is fine. Vertical alignment matters more than equal width.

### BGR vs RGB

Images saved by `cv2.imwrite` without a `cv2.cvtColor(img, cv2.COLOR_BGR2RGB)` call render with blue and red channels swapped. If skin tones look cyan or kelp looks blue, swap the channels:

```python
from PIL import Image
import numpy as np
im = Image.open(path)
arr = np.array(im)
arr[:, :, [0, 2]] = arr[:, :, [2, 0]]
Image.fromarray(arr).save(path)
```

---

## Captions

- Wrap captions in `<sub>` tags. They render at roughly 85 percent size, which visually subordinates them to the image without getting unreadable.
- Open with a **bold label** followed by a colon. Labels should mirror the role of the image (`Input`, `Output`, `Raw frame`, `Detected bounding box`, `Skeleton`).
- Describe **what is in the image**, then **what it demonstrates**. Skip commentary like `This is a great example of...`.
- Keep captions to one or two short sentences. If a caption needs a paragraph, promote it to body prose above the image.
- Use `<code>` tags inside `<sub>` for inline code references in captions (function names, tag values).

```html
<sub><b>Detected bounding box</b>: computed with multilevel Otsu thresholding and contour filtering. The box is the input to the <code>crop</code> stage.</sub>
```

---

## Flow diagrams and code blocks

For pipelines, use a fenced code block with unicode arrows (`→`). It renders in monospace, preserves alignment, and reads faster than a numbered list.

```
raw capture
  → preprocess (denoise, color correct)
  → segment foreground
  → extract features
  → aggregate per sample
  → metrics.csv
```

Tips:

- Align the arrows in the same column so the vertical flow is visible at a glance.
- Put filenames or function names in parentheses on the right of a step when the mapping is useful (`→ feature extraction   (run_polar_bear.py)`).
- Use `├──` and `└──` for branches inside a flow.
- Inside flow diagrams, commas and `and` read better than slashes.

For shell commands, use a normal fenced block with a language tag (` ```bash `).

For package or model lists, prefer a bulleted list grouped by theme over a single run on paragraph.

---

## File link style

Every filename you mention in prose should be a Markdown link to the file on disk, using a relative path:

```markdown
See [Photobooth-V2/run_polar_bear.py](Photobooth-V2/run_polar_bear.py) for the CLI entry point.
```

Why: GitHub renders these as clickable, and anyone reading the README on a local clone in VS Code can jump straight to the file.

For filenames with spaces, URL encode the space as `%20` only inside the link target:

```markdown
[photobooth-v2_process frames.ipynb](Photobooth-V2/photobooth-v2_process%20frames.ipynb)
```

For a long table of notebooks, use a two column Markdown table with `File` and `Purpose` headers rather than a bulleted list. It scans faster.

---

## Pre publish checklist

Run through this list before committing or pushing a README.

**Content**
- [ ] H1 is literal and short. No subtitle.
- [ ] Intro paragraph is two sentences.
- [ ] Hero image row is present and alt text is descriptive.
- [ ] Every H2 section is separated from its neighbors by `---` horizontal rules.
- [ ] Repository layout tree reflects the current directory structure.
- [ ] Get in touch section has a working `mailto:` link.

**Prose**
- [ ] No em dashes (`—`) anywhere in prose or captions. Search the file for `—`.
- [ ] No hyphens in compound adjectives (`high-resolution`, `per-blade`, `end-to-end`, `real-world`). Rephrase.
- [ ] No contractions (`didn't`, `we're`, `it's`).
- [ ] No marketing adjectives (`giant`, `blazing`, `seamless`, `world class`).
- [ ] No casual asides (`I'd love to`, `feel free to`, `obviously`).
- [ ] Proper names that must keep their hyphen are intact (`Faster R-CNN`, `scikit-image`, camera model numbers).

**Images**
- [ ] Every image row is either a single `<p align="center">` block or a `<table align="center">` with matching heights.
- [ ] No `&nbsp;` spacers between inline images. Use a table instead.
- [ ] Every `<img>` has descriptive `alt` text.
- [ ] Captions are wrapped in `<sub>` and start with a bold label and colon.
- [ ] Images look correct in color (no BGR/RGB mix up).
- [ ] All image paths resolve to files that actually exist in `imgs/`.

**Links and paths**
- [ ] Every filename mentioned in prose is a Markdown link to the file.
- [ ] Anchor links in the table of contents match the rendered H2 slugs.
- [ ] No absolute paths from your local machine leaked into the doc.

**Security**
- [ ] No API keys, service account JSON, private key material, or license files committed.
- [ ] `.gitignore` excludes credentials, large binary assets, and nested `.git` directories.

---

## Get in touch

For questions or feedback on this guide: **[heng.franklin@gmail.com](mailto:heng.franklin@gmail.com)**.
