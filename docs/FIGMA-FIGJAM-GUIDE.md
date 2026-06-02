# Figma / FigJam flow map guide

This project does **not** ship a native `.fig` file. Figma and FigJam files are cloud/binary formats that cannot be authored reliably from code without the Figma API and a paid workflow.

## Recommended approach (in this repo)

| File | Purpose |
|------|---------|
| **`docs/quiz-flow-map.html`** | **Best for reading everything** — open in any browser. Graph + path timeline + full scene text. |
| **`docs/quiz-flow-paths.md`** | Printable / diff-friendly linear walkthrough of every path. |
| **`docs/quiz-flow-overview.mmd`** | Compact Mermaid diagram (structure only, not full copy). |

Regenerate after quiz edits:

```bash
node tools/generate_flow_map.mjs
```

Also run after markdown changes (or add to your usual generate step):

```bash
node tools/generate_v3_data.mjs
node tools/generate_flow_map.mjs
```

## If you still want FigJam

1. **Mermaid → FigJam**  
   - Open `docs/quiz-flow-overview.mmd` in GitHub (renders automatically) or [mermaid.live](https://mermaid.live).  
   - Export as SVG/PNG, or use a FigJam plugin such as **「Mermaid to FigJam」** to paste the diagram as stickies/shapes.

2. **Import the HTML as reference**  
   - Open `docs/quiz-flow-map.html` beside FigJam and rebuild sections you care about (shared finale, one path per frame).

3. **Figma API (advanced)**  
   - Only worth it if you need a living FigJam board synced to CI. Requires a Figma access token and custom script.

## Why not a single FigJam file in git?

- `.fig` files are not plain text — they do not diff or merge well in git.
- The HTML generator stays **in sync** with `BIBLE-CHARACTER-QUIZ.md`, which is the source of truth.
- You get **all scene text** in one place; FigJam stickies would be painful to maintain by hand for 50+ scenes.

## Quick start

Double-click or open:

```
docs/quiz-flow-map.html
```

Use **Path timeline** for a single-path read-through; use **Graph view** to see branches converge at Scene 19 and the shared finale.
