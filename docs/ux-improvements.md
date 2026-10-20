# Draft tab: UX improvements

Status per item: **Agreed** (decided), **Proposal** (needs a decision), **Open** (question for the owner),
**Done** (implemented; notes say where it differs from the proposal).
Numbers are kept from the first review so comments can refer to them (#1 and #3 were dropped).

## Implementation status
Done, with these revisions after review:
- **#2:** up to 2 short chips per tile plus "+N"; the popover beside the tile lists the reasons **grouped by type**
  (Roles, Synergy, Support, Themes, Matchup, …) with a marker colour per type, "Best with", the score and **Fill band**
  (solo). Hover previews **only the hovered hero**: no partner outlines, no full-band preview. On desktop the popover is a
  tooltip the mouse passes through: it appears after a short pause, then follows from tile to tile, and opens on the
  side the mouse came from so it never covers the next tile (Fill band is in the ⋯ menu there). The rank badge is gone
  from the tiles (the pool is still sorted by rank) and all tiles are the same height.
- **#4 (revised):** no separate match page. A finished draft shows the "Draft complete · Open reference cards" note and
  greys out the pool. The cards open in a **modal** with only the cards, a Player 1 / Player 2 switch (solo: Your band /
  Against) and **Share link**. A shared link (`draft-share.js`) opens that modal read-only over the visitor's own draft.
  The matchup panel, threats, watch-out, copy and edit actions were dropped.
- **#5:** in-band synergy grouped by the hero who benefits (`synergyGroups`), with the shared "Show N more" list.
- **#6:** phone fixes as proposed; "Complete your band" is removed; compact draft order; an empty slot points at the pool.
- **#7 (revised role pills):** colour-coded by role. A role stays lit when this hero taking it adds a role the band
  lacks, **even if a teammate has to switch roles** (`Draft.fillableRoles`); the others are dimmed. A flexible band
  therefore leaves every role lit for a flexible hero instead of one arbitrary pick. The "Fills a missing role" filter
  uses the same rule. Ban reasons say what they deny; "Counters" sort and ⚔ marker; Reset is an undo step.

## 2. Explanations appear far from where you're looking (Agreed)
- **Problem:** reasons appear only on hover, at the top of the Band Analysis column, about 600 px from the tile. They push
  Team balance and Band score down, so the column jumps on every hover.
- **Decision:** every tile that has reasons shows chips, not only the top-ranked ones.
- **Proposal:**
  - Up to 2 compact chips per tile (icon + short text, e.g. "✦ Fills Supporter", "⚠ Weak vs Saxum"), plus "+N" when there
    are more. A warning chip is never cut (existing `chipsFor` rule).
  - The full list moves to a popover anchored to the hovered or focused tile, so the analysis column no longer shifts. The
    popover shows the full reasons, "Best with: Tempus + Equita" (see #6) and the score.

## 4. A finished draft has no ending (Agreed)
- **Problem:** when the draft completes, the screen just stops: no matchup result, no threats, no copy or share. The pool
  stays full-size but nothing in it can be picked.
- **Decisions:**
  - **Reference cards:** the full hero cards from the graph's details panel, shown full screen, so they can be used during
    play as reference cards for the opponent's hand.
  - **Shareable URL:** opening the link shows the same finished draft right away.
  - **The pool's space is reused** once nothing can be picked.
- **Proposal, Match view** (replaces the three columns once the draft or band is complete):
  - **Top strip:** both bands as mini-portraits, the format, who starts on the Castle, and **Share** / **Copy** /
    **Edit draft**.
  - **Main area:** the reference cards. A toggle switches between **Opponent** (default), **Mine** and **Both**. Each hero
    is a full card (portrait, vitality, features, core and support abilities with range and cooldown). Prev/next arrows and
    swipe move between cards, and Esc or the strip goes back to the draft.
  - **Side panel (where the pool was):** the matchup.
    - Who has the edge, and why (the score both ways from `scoreMatchup`).
    - Threats each way ("Saxum's Stun hinders your Ferrarius").
    - "Watch out for": the opponent abilities that hit your band hardest, linked to their card.
    - Grouped synergy for each side (#5).
  - **Solo:** the same view, with your band's cards, the band summary and the swap suggestions in the side panel.
  - **Implementation note:** the card markup lives inline in `renderDetails` in `script.js`. It needs to move into a shared
    renderer so the graph and the draft both use it.
- **Proposal, share URL:**
  - Encode the format and the ordered picks and bans using hero ids, e.g. `#draft/standard/12.5.33.8.21.2` (bans first in
    sequence order; carry-over bans as `~4.9`). Short, readable, and enough to replay the draft through the engine.
  - Opening a shared link shows the Match view read-only and **does not overwrite** the visitor's own saved draft.
    **Edit draft** copies it into their two-player state, and asks first if they have a draft in progress.
  - Encoding and decoding are pure and unit tested (round trip, unknown ids, illegal sequences rejected with a message).
  - Solo bands use the same scheme (`#draft/solo/12.5.33`, with `vs` and `ex` lists).
- **Resolved:** in the read-only shared view the viewer chooses which side they are (Player 1 by default).

## 5. Too many repeated synergy lines (Agreed)
- **Problem:** a complete band lists 8 or more partly repeating lines ("Synergy: Toxicum, Equita → Tempus (Abilities on
  cooldown)" next to "Tempus shortens Toxicum's cooldowns").
- **Proposal:**
  - Group by the hero who benefits. Each engine reason already names its heroes, so this is a pure grouping in
    `draft-view.js`:
    - **Toxicum** ← Equita (Poison), Tempus (Swiftness, cooldowns)
    - **Equita** ← Tempus (Swiftness, cooldowns)
    - **Tempus** ← Toxicum, Equita (abilities on cooldown)
  - Merge the duplicate wording: the "Synergy: …" line and the matching enabler line become one entry.
- **"+N more", done cleanly:**
  - Show the top 3 groups.
  - Then a single button, "Show N more", that expands in place and becomes "Show fewer".
  - N is the exact hidden count, and the button sets `aria-expanded`.
  - The open or closed state survives re-renders and hover previews, and resets when the band changes.
  - The same component is used for tile chips (#2), threats and synergy.

## 6. Layout and responsiveness (Agreed)
- **Phone fixes (proposal):**
  - **Header:** below 600 px, hide the subtitle and put the title and the Graph | Draft tabs on separate rows (the tabs as
    a full-width segmented control). This removes the overlap.
  - **Sticky draft bar** under the header: step ("Your pick 2 of 3"), the 3 band slots as mini-portraits, roles covered
    and the band score. Tapping it opens Band Analysis as a bottom sheet, so the analysis is never 36 cards away.
  - **Pool:** a compact 3-column grid (portrait, name, rank, 1 chip). Filters collapse behind a "Filters (2)" button. The
    sort switch stays visible.
  - **Tap behaviour:** the first tap opens a bottom sheet with the hero's reasons, the preview effect and a large
    **Select** / **Ban** button. This avoids accidental picks and replaces hover. Long-press opens the ⋯ menu.
  - **Sequence strip:** one horizontally scrolling row that keeps the current step in view.
  - **Order on the page:** draft bar → band (compact) → Against → pool. The mode switch and format setup shrink into a
    single row once the draft has started.
  - **Match view (#4):** the cards become a swipeable full-screen carousel.
- **Desktop:** in two-player mode, "Complete your band" falls below the fold in the left column. The sequence strip and the
  3 empty "Choose hero" slots take a lot of vertical space.
- **Empty slots:** "Choose 2nd hero" only moves keyboard focus to the first pool tile, with no visible feedback.
- **"Complete your band" (proposal: remove the section):**
  - It isn't a copy of the pool's top 3. With no picks, the pool's top 3 is Toxicum, Malleus, Brewus, while the best band
    is Toxicum + Tempus + Equita. Each pool rank is "the best band this hero can be part of", so the top tiles don't
    combine.
  - That gap is the real problem: the section holds the only "these three go together" information, but it looks like a
    repeat of the pool.
  - **Fold it into the pool:**
    - The tile popover (#2) shows "Best with: Tempus + Equita".
    - Hovering a tile also outlines those partners in the pool, and the preview fills all empty slots with that band.
    - In solo mode, the popover gets a **Fill band** button (today's one-click completion).
  - In two-player mode a 3-hero plan is weaker anyway, because the opponent picks in between, so losing the section costs
    little there.

## 7. Smaller things (Agreed)
- **Role pills:** a third of the heroes show all three role icons, so the pills don't help much.
  - Highlight the role a hero would fill for *this* band.
  - Colour-code pills by role to make the pool easier to scan.
- **Repeated reason:** "Strong pick for Player 2" appears on every ban suggestion, so it tells you nothing. Drop it, or
  replace it with what the ban denies ("Denies Player 2: Top band with Malleus").
- **Against row:** easy to miss in solo mode. Once enemies are added, add a "Counters" sort, or a ⚔ marker on the tiles
  that counter them.
- **Reset:** the Undo in the toast disappears after 6 seconds, which is short for a destructive action. Make Reset an
  undoable step, so the normal Undo button and Ctrl/⌘+Z restore it.
