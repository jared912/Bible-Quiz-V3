# Bible Quiz V4

What Bible character are you? A narrative choose-your-own-adventure personality quiz.

## Run it locally

- Open `index.html` in your browser.

## Flow map (all scenes & paths)

Visual reference for every scene, full story text, and branch progression:

- **`docs/quiz-flow-map.html`** — open in a browser (graph + path timeline)
- **`docs/quiz-flow-paths.md`** — linear write-up per path
- **`docs/quiz-flow-overview.mmd`** — Mermaid structure diagram
- **`docs/FIGMA-FIGJAM-GUIDE.md`** — how to import into FigJam if needed

Regenerate after editing `BIBLE-CHARACTER-QUIZ.md`:

```bash
node tools/generate_flow_map.mjs
```

## How it works (short version)

- Each choice contributes to 5 personality dimensions.
- At the end, your score selects a shortlist of plausible character matches; the same choices always produce the same result.
- Results are gender-filtered (you choose Man/Woman at the start).

## Attribution

This project is a conversion of the original quiz:
- Source: `sophie006liu/vegetal`
- Original demo: `https://sophie006liu.github.io/vegetal/`

License: see `LICENSE`.
