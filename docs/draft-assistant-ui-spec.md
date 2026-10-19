# Draft Assistant: UI/UX Spec

Status: Implemented (`draft-view.js`, `draft-ui.js`) · Owner: Andrej Marsic · Last updated: 2026-10-19
Companion to [`draft-assistant-spec.md`](draft-assistant-spec.md), which covers rules, scoring and the engine. This document
covers layout, components, interactions and states. It builds on the second design mockup (three columns, Graph / Draft tabs)
and the review of it.

## 1. Design principles

1. **One core loop:** see suggestions → preview the effect → pick. Everything on screen supports this loop or stays out of its way.
2. **Show the reasoning:** every score and chip comes from an engine reason (§9). The UI never writes its own explanations.
3. **Settings are separate from results:** what you set (band, facing, excluded, filters) and what is computed (balance,
   score, threats) are in different places.
4. **Solo and two-player look the same:** solo is the two-player layout with the opponent row filled in by hand.
5. **Each icon means one thing:** an icon or colour has a single meaning everywhere in the tool.

## 2. Navigation

- The header has the site title and two tabs: **Graph | Draft**. There's no "Draft Assistant" subtitle, since the active tab
  already says it.
- The Draft tab keeps its state when you switch to Graph and back.
- **"View band in graph"** switches to the Graph tab with the band, the opponents and the synergy lines between them
  highlighted (`synergyArcs` with a focus set). A "Back to draft" link appears in the graph's detail panel.
- The URL keeps the tab (`#draft`) so it can be bookmarked and survives a reload. Draft state is kept in `localStorage`.

## 3. Layout (desktop, ≥ 1280 px)

```
┌───────────────────────────────────────────────────────────────────────────────────────────┐
│ ◎ BESTIARY OF SIGILLUM                                              GRAPH  |  DRAFT        │
├──────────────────┬─────────────────────────────────────────────┬─────────────────────────┤
│ HERO POOL        │ [ Build my band ] [ Two-player draft ]      │ BAND ANALYSIS           │
│ Search…          │                                             │                         │
│ Attr: All S A I  │ YOUR BAND                   ↶ Undo  Reset   │ Team balance            │
│ Role: C A S      │ [1 Ferrarius] [2 Ballistarius] [ 3 + ]      │  Controller  ✓          │
│ ☐ Fills missing  │                                             │  Attacker    ✓          │
│   role           │ AGAINST (facing)              + Add enemy   │  Supporter   ○ missing  │
│ ☐ Show unavail.  │ [Saxum] [Illesebra] [Magnus]                │                         │
│ Excluded: chips  │                                             │ Best reachable: Top 3%  │
│ ┌──┐┌──┐┌──┐     │ NEXT PICK                     All 31 →      │ Threats from Against    │
│ │  ││  ││  │     │ 1 Fidea   Top 1%   [chips]   [Add] ›        │ Synergy in band         │
│ └──┘└──┘└──┘     │ 2 …                                         │                         │
│ …                │ 3 …                                         │ [View band in graph →]  │
│                  │ (COMPLETE YOUR BAND: only if ≥ 2 slots empty)│                         │
└──────────────────┴─────────────────────────────────────────────┴─────────────────────────┘
```

| Column | Purpose | Contents |
|---|---|---|
| Left: **Hero pool** | Browse and filter the pool | Search, attribute filter, role filter, "Fills missing role" toggle, "Show unavailable" toggle, **Excluded** chips, hero grid |
| Middle: **Draft** | Settings plus the core loop | Mode switch, **Your band** with Undo/Reset, **Against** row, suggestions, completions |
| Right: **Band analysis** | Results only | Team balance, best-reachable score, threats, synergy in band, View band in graph |

Changes from the mockup:
- **Facing** moves from the right column to the middle column as the **Against** row under Your Band.
- **Excluded** moves to the pool's filter area, because it's a filter on the pool.
- **Undo/Reset** move next to Your Band.

## 4. Components

### 4.1 Hero card (pool)

- **Shows:** portrait, name, an attribute banner (one of 3 colours with the attribute icon) and up to 3 battle-role pills.
  Size (Small / Medium / Big) appears on every card or on none; the choice is made in §12.
- **One primary action:** a click or Enter adds the hero to the band (or to the current step in two-player mode).
  The corner shows **+** only when the hero can be picked.
- **A "⋯" menu** (it also opens on right-click or long-press) holds: **Pick**, **Add to Against**, **Exclude**, **View in graph**.
  This is the only way to add heroes to Against or Excluded from the pool. The other way is dragging (§5.4).
- **Unavailable heroes** are dimmed and carry a badge that says why: **Picked**, **Facing** or **Excluded**. There's no ✕ icon
  on these cards (see §8). They're hidden unless "Show unavailable" is on, and the pool count says "31 available · 5 unavailable".
- **Hover or focus** triggers the preview (§5.2).

### 4.2 Band slot

| State | Look | Actions |
|---|---|---|
| Filled | Parchment card, number, portrait, name, role pills. Slot 1 is labelled "1st pick · Starts on Castle" | ✕ remove, drag handle, ◀ ▶ move buttons (shown on focus) |
| Empty | Dashed outline, "+ Choose hero" | Click: focuses the suggestion list (or opens the pool on small screens) |
| Preview | The hovered hero at 50% opacity with a "Preview" ribbon | None. Disappears when the hover ends |

There are drag handles on filled slots only. An "ⓘ" next to the heading explains why pick order matters in the game.

### 4.3 Against row (Facing heroes)

- Up to 3 enemy cards in the same layout as band slots, with a **red enemy frame** and a crossed-swords marker.
  They're visibly the opposing side.
- "+ Add enemy" opens a hero picker. ✕ removes.
- When it's empty, it shows one line: "Add heroes you expect to face to get counter-picks." The row stays visible so people find
  the feature.
- In two-player mode, this row becomes the **opponent's band**, filled by the draft. It looks the same.

### 4.4 Excluded chips (pool filters)

Compact chips (name + ✕) in the filter area, with "+ Exclude hero". Excluded heroes are greyed and struck through wherever
they appear. They never have the red enemy frame.

### 4.5 Suggestion row

```
 ①  [portrait]  FIDEA         Top 1%        ✦ Fills Supporter role   ⚔ Counters Saxum      [ Add ]  ›
                 ⊕ Supporter   ▓▓▓▓▓▓▓▓░     ✦ Synergy: Ballistarius
```

- Shows the rank, portrait, name, role pills, **percentile** (no raw score), a bar for the percentile, up to 3 chips (with "+2 more"
  if there are more), an **Add** button and **›** to expand.
- **Add** puts the hero in the first empty slot. **›** expands the row in place to show every reason, including the
  zero-value factors ("No internal conflicts"). Only one row is expanded at a time. There's no separate detail card.
- There's no "Why this pick?" heading, because the chips explain it.
- Hovering the row triggers the preview (§5.2).
- "All N →" opens the full ranked list of available heroes, where every hero shows its "why not".

### 4.6 Reason chip

| Kind | Colour | Icon | Example |
|---|---|---|---|
| Role and synergy | Gold | ✦ | "Fills Supporter role", "Synergy: Ballistarius" |
| Counter (good vs Against) | Teal | ⚔ | "Counters Saxum" |
| Warning | Red | ⚠ | "Conflicts with Ferrarius", "Weak vs Illesebra" |

Chips aren't links. Clicking one expands the row and highlights that reason. Warnings always come after positive chips, and if
a hero has any warning, at least one warning chip is always shown, even if the "+N more" limit is reached.

### 4.7 Completion card

Only shown when **2 or more band slots are empty**. With one empty slot, a completion is the same as a suggestion.
- Shows the 3 mini-portraits, with the heroes already in your band outlined, and the percentile. There's no separate
  "Best fit / Strong" label.
- Clicking a card fills the empty slots in the card's order. Hovering previews the whole band.

### 4.8 Band analysis (right column)

- **Team balance:** one line per battle role, either ✓ covered (with the hero's name) or ○ missing. The heading says
  "Covers N of 3 roles". There are no fraction bars.
- **Band score:** "Best reachable: Top X%" while the band is incomplete, and "Band: Top X%" when it's complete. It always shows
  the same number as the top suggestion or completion.
- **Threats:** Against heroes that counter your band, with a one-line reason each. Hidden if Against is empty.
- **Synergy in band:** the partner links between your picked heroes.
- **View band in graph →**.

## 5. Interactions

### 5.1 Core loop

1. The suggestions are ranked for the next empty slot.
2. You hover or focus a suggestion, and it's **previewed** (§5.2).
3. **Add**, or click a pool card, and the hero fills the first empty slot. Suggestions, completions and analysis update.

### 5.2 Hover / focus preview

When a candidate is hovered or keyboard-focused (pool card, suggestion row or completion card):
- the first empty slot shows the candidate as a faded preview, and a completion card fills every empty slot;
- Team balance shows the change (Supporter ○ → ✓, coloured as a change);
- Band score shows the change ("Top 9% → Top 1%");
- new threats or conflicts appear in red with "(preview)".

The preview ends when the hover or focus ends. Previews never change the state. On touch screens, the first tap on a suggestion row
previews and a second tap (or **Add**) adds.

### 5.3 Editing the band (solo)

- **Remove:** ✕ on a slot. The other heroes keep their order and the empty slot moves to the end.
- **Reorder:** drag a filled slot, or use ◀ ▶ (keyboard: focus the slot, then Alt+←/→).
- **Undo:** reverses the last change to the band, Against or Excluded. You can undo repeatedly. Shortcut Ctrl/⌘+Z.
- **Reset:** clears the band, Against and Excluded after a confirmation ("Clear band, enemies and exclusions?").
  The confirmation includes an Undo option.

### 5.4 Drag and drop (shortcut, never the only way)

Pool cards can be dragged onto band slots, the Against row or the Excluded chips. Every drag action can also be done with the
⋯ menu or keyboard.

### 5.5 Mode switch

**Build my band** and **Two-player draft** each keep their own state. Switching never discards anything. A small dot on the
inactive mode shows that it has a draft in progress.

## 6. States

| State | Suggestions area | Completions | Analysis |
|---|---|---|---|
| **0 picks** (first visit) | Intro line: "Start with a versatile hero — one that can fill several roles." First-pick suggestions | Top complete bands (shown, since 3 slots are empty) | Empty state: "Pick a hero to see your band's balance" |
| **1 pick** | Suggestions for pick 2 | Completions of your band (2 slots empty) | Partial |
| **2 picks** | Suggestions for pick 3 | Hidden | Partial, with the missing role highlighted |
| **3 picks** (complete) | **Swap suggestions**: "Replace Ballistarius with X → Top 1%" (best replacement for each slot) | Hidden | Full summary: roles, synergy, threats, which hero starts on the Castle. A **Copy band** button copies the band as text |
| **No candidates** (pool empty after filters) | "No heroes match these filters." Clear filters button | – | – |

## 7. Two-player draft mode

Same layout as solo, with these differences:
- **Setup panel** (until the first action): format (`standard` / `ban-first` / `interleaved`), "I am First / Second player",
  and carry-over bans.
- A **sequence tracker** strip above Your Band. Each step is a small pill (Ban / Pick, You / Opponent). The current step is
  highlighted with a text label: "Your pick 2 of 3" or "Opponent ban".
- The **Against row becomes the opponent's band**, filled as the opponent picks. You can't edit it directly; corrections go
  through Undo.
- A **Bans row** sits under each band row, with bans greyed and struck through, like Excluded.
- **On opponent steps:** the suggestions area says "Click the hero your opponent chose." The pool's primary action records
  the opponent's choice, and the hero card's corner shows a red marker instead of **+**. An optional "What would they want?"
  toggle shows suggestions for the opponent.
- **Ban steps:** suggestion rows say "Ban" instead of "Add". Phase 3: ban suggestions.
- **Undo** steps back one draft action. There's no free-form editing; the draft order is fixed.

## 8. Visual rules

- **Attribute colours:** only red (Strength), green (Agility) and blue (Intelligence), always together with the attribute icon,
  so colour isn't the only signal. No other banner colours.
- **Battle-role icons** are used only for battle roles, with the same three icons everywhere (pool, slots, suggestions, Team balance).
  On cards they appear as small pills with text on hover and an `aria-label`.
- **Corner icons:** **+** means you can pick this hero. **✕** is used **only** for "remove from this list". "Unavailable" is shown with a
  badge, not an icon.
- **Warnings** appear only in chips and the analysis column, never among role icons.
- **Chip colours:** as in §4.6. Teal and gold are never used for warnings, and red is never used for good news.
- **Percentiles** are the only score format: "Top 3%" for the stronger half of all bands and "Bottom 4%" for the weaker
  half, so a poor band never reads "Top 100%". The Band score shows a caption ("Best band you can still reach" / "Your band")
  above the large percentage.
- **Typography:** Cinzel for headings, Crimson Text for body text. The minimum size is 13 px for secondary text (card size labels,
  completion names) and 15 px for body text. Dimmed cards keep their name at a contrast of at least 4.5:1.
- The style follows CLAUDE.md's guide (parchment cards, gold and burgundy, existing CSS variables). Effects such as a glowing border on
  the focused suggestion are subtle and are turned off under `prefers-reduced-motion`.

## 9. View model (pure, tested)

The DOM layer renders the output of one pure function. It contains no logic of its own.

`draftView(state, ctx, { preview })` lives in a new file, `draft-view.js` (UMD, like `synergy.js`), and returns:

```js
{
  pool:        [{ name, attribute, size, battleRoles, available, unavailableReason }],   // 'picked' | 'facing' | 'excluded' | 'banned' | null
  slots:       [{ index, hero | null, preview: boolean, startsOnCastle }],
  against:     [{ name, ... }],
  suggestions: [{ name, percentile, chips: [{ kind, text, reasonId }], reasons, action: 'add' | 'ban' | 'record' }],
  completions: [...] | null,            // null unless ≥ 2 empty slots
  swaps:       [...] | null,            // only when the band is full
  analysis:    { roles: [{ role, coveredBy | null, change }], score: { label, percentile, change }, threats, synergy },
  mode:        { current, inactiveHasDraft }
}
```

**Tests** (`tests/draft-view.test.js`, written first):
- `unavailableReason` is correct for picked, facing, excluded and banned heroes. There's no other way for a hero to be unavailable.
- The available + unavailable counts equal 36.
- Every chip has a `reasonId` that appears in the engine's reasons.
- `completions` is `null` when fewer than 2 slots are empty. `swaps` is set only when the band is full.
- The top suggestion's percentile equals `analysis.score.percentile` (best reachable).
- With a preview, `slots` marks the previewed slot and `analysis` has `change` set. Without one, nothing is marked as changed.
- Warnings sort after positive chips, and at least one warning chip is kept even when chips are cut off.
- In two-player mode, the suggestion action matches the current step (`add`, `ban`, or `record` on opponent steps).

## 10. Responsive behaviour

| Width | Layout |
|---|---|
| ≥ 1280 px | Three columns (§3) |
| 900–1279 px | Two columns: Draft and Band analysis, with the pool full-width below them. (A drawer was planned; stacking was simpler and is still usable. Revisit if the page gets too long) |
| < 900 px | One column: band → Against → suggestions → analysis (collapsible). The pool is a full-screen sheet. The preview needs a tap (§5.2) |

## 11. Accessibility

- Everything can be done with the keyboard. There's a visible focus ring, and the tab order is pool → band → Against → suggestions → analysis.
- Every drag action has a button or menu alternative (§5.4).
- Updates to the score and balance are announced through an `aria-live="polite"` region ("Fidea added. Band covers 3 of 3 roles, Top 1%").
- Icons have `aria-label`s. Attribute, role and unavailable state never depend on colour alone.
- Animation is off under `prefers-reduced-motion`.

## 12. Open questions

Decisions taken while building (each can be revisited):
- **Size** is shown on every pool card, in small italic text.
- **3 suggestions** are shown by default, and "All N →" expands the list.
- **Swaps:** the best replacement per slot, listed best first, solo only.
- **Copy band** copies plain text ("Ferrarius, Ballistarius, Fidea (Band: Top 2%)").

Original questions:

1. **Size on cards:** size matters for only a few interactions (for example Catapultus targets Big or Medium heroes). Show it on
   every card, or only in the expanded row and the graph details?
2. **How many suggestions** to show by default: 3 (as in the mockup) or 5 (as in the main spec)?
3. **Swap suggestions** for a full band: one per slot, or just the single best swap?
4. **Copy band** format: plain text, or a shareable URL (`#draft?band=FERRARIUS,BALLISTARIUS,FIDEA`)?
