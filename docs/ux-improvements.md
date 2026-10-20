## 1. The score labels don't tell heroes apart (biggest problem)
- **What happens:** at the first pick, **32 of the 36 heroes show "Top 1%"**. At the second pick, 18 still do. Every tile, completion card and "Best reachable" number reads the same, and the hover preview says "Top 1% → Top 1%".
- **Why it matters:** the order is real (#1, #2, #3), but users can't see why #1 beats #12, so the main loop of comparing, previewing and picking stops working.
- **Fix options:**
  - Show the score relative to the best available option, e.g. "−0.8 vs best", or a 5-step strength rating.
  - Or round to one decimal while under 5% ("Top 0.3%").
  - Or label the first two picks by how many good bands each hero keeps open, rather than by the single best band.

## 2. Explanations appear far from where you're looking
- The reasons for a hero only appear when you hover, at the top of the Band Analysis column. That's about 600 px away from the tile.
- They also push Team balance and Band score down, so the column jumps on every hover.
- Pool tiles have no reason chips at all
- **Fix:**
  - Put 1–2 short chips on the top-ranked tiles, e.g. "✦ Fills Supporter" or "⚠ Weak vs Saxum".
  - Give the "why" block a fixed-height spot, or show it as a popover next to the tile.

## 4. A finished draft has no ending
- When the draft completes, the screen just stops: no matchup result, no list of threats, no Copy button.
- The pool stays full-size even though nothing in it can be picked.
- **Fix:** add a summary for the finished draft: who has the edge and why, the threats on each side, who starts on the Castle, and Copy / Share.
- When a draft or band is complete, shrink the pool, or replace it with the swap suggestions.

## 5. Too many repeated synergy lines
In a complete band, "Synergy in band" lists 8 or more lines that partly repeat each other. For example, "Synergy: Toxicum, Equita → Tempus (Abilities on cooldown)" appears alongside "Tempus shortens Toxicum's cooldowns" and "…Equita's cooldowns". I'd group them by pair (Toxicum ↔ Tempus: cooldowns, Swiftness), show the top 3, and collapse the rest behind "+N more".

## 6. Layout and responsiveness
- **Phone (400 px):** the analysis sits below all 36 pool cards, so you can't see your score while picking. The header title and the Graph/Draft tabs also overlap. A sticky compact bar ("2/3 roles · Top 6%") would fix the first problem, and the pool could become a full-screen sheet.
- **Desktop:** "Complete your band" in two-player mode falls below the fold in the left column. The 6-step sequence strip and the 3 empty "Choose hero" slots take a lot of vertical space before you reach anything useful.
- **Empty slots:** "Choose 2nd hero" only moves keyboard focus to the first pool tile. Clicking it gives no visible feedback.

## 7. Smaller things
- **Role pills:** a third of the heroes show all three role icons, so the pills don't help much. Highlighting the role a hero would fill for *this* band would be more useful. Also, color coding them by role would help you scan the pool.
- **Repeated reason:** the chip "Strong pick for Player 2" appears on every ban suggestion, so it tells you nothing.
- **Against row:** in solo mode it's easy to miss. Adding a "Counters" sort option, or a ⚔ marker on tiles, once enemies are added would show it does something.
- **Reset:** There is an undo option in the toast, but it disappears after 6 seconds, which is short for a destructive action. Let's instead make the normal undo action work also for reset.
