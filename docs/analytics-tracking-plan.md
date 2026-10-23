# Analytics tracking plan (PostHog)

Goal: know what people click in the graph, which heroes they draft and which bands they finish, and which
features get used at all (synergy lines, All names, legend filters, the links in the hero panel, …).

Project: PostHog EU Cloud, project `317993` (https://eu.posthog.com/project/317993), loaded in `index.html`.
Until October 2026 the events went to Google Analytics 4 (property `G-GQ4HDYYETG`); that data stays in GA.

**Status:** every event in §3 is built (`analytics.js`, wired into `script.js` / `draft-ui.js`; see §5).
`analytics.js` `EVENTS` is the source of truth for what is sent. `tests/analytics.test.js` fails if the §3 tables and
`EVENTS` list different events, or if a param is missing here. Param values and descriptions are kept up to date by hand.
§1 describes the tracking as it was before this work.

Some events reuse a shared param instead of adding their own (a leftover of GA4's 50-dimension limit, kept so the
property list stays short).
`control` is "which button or option" within its event: popover and menu actions, `history_nav`'s back / forward,
the zoom gesture, and `draft_side_change`'s `enemy_add` / `exclude_remove` / `carry_over_add` / …. Also:
`surface` says where (`draft_random`'s pool / slot / against dice), `target_type` is the kind of pool suggestion
(hero, trait, role, range, attribute, size), and `error` carries `draft_blocked`'s rule message.

## 1. Before this work: what was tracked, and what was wrong with it

| Event | Where | Problem |
|---|---|---|
| `app_loaded`, `app_error` | `script.js` init | Fine. `app_loaded` doesn't say how the visit started (plain visit, `?hero=` link, shared draft). |
| `node_selected` | `selectNode` | Source and name go into one label (`"graph: Saxum"`), so GA can't split them. No node type. |
| `synergy_toggle`, `graph_control` | toolbar | Doesn't record whether a button or a keyboard shortcut (`S`, `F`, `+`) was used. |
| `search_used` | graph search `input` | **Sends an event on every keystroke** from the 3rd character on (`arc`, `arch`, `archi`, …). |
| `category_filter`, `legend_filter`, `filter_cleared` | chips / legend | Clicking a filter off also counts as using it. The legend's four filter groups share one label string. |

Applies to all of them: they send Universal-Analytics-style `event_category` / `event_label` / `value`. GA4 keeps these
only as custom parameters. They don't show in reports until registered, and `value` is always null.

Not tracked at all: **the whole Draft tab** (`draft-ui.js` has no tracking calls), edge and arc clicks (they only show
up as `node_selected` with source `edge` / `arc`), the All names / Opponent / Legend buttons, the hero-panel links,
hover tooltips, the intro dialog, tab switches, history back/forward, share links and outbound links.

Probably being sent without you knowing: with Enhanced Measurement's "page changes based on browser history
events" switched on (the default), every graph selection (`history.pushState` to `?hero=…`) and every tab switch
(`replaceState`) may send its own `page_view`.

## 2. Conventions

- Event names: `snake_case`, object first then verb (`draft_pick`, `edge_click`), 40 characters max. Never start a
  name with `$` (PostHog's own events and properties).
- Parameters (PostHog event properties): `snake_case`, from the fixed set in the §3 tables. Booleans and numbers are
  sent as they are, so insights can filter on `top_suggestion = true` or `pick_number = 1`.
- **Bands are sent as one key: the hero names sorted alphabetically and joined with commas** (`AQUS,BREWUS,SAXUM`),
  so the same band always gives the same string no matter what order it was picked in. Names are as in the data
  (upper case, e.g. `AQUS,BREWUS,SAXUM`). 36 heroes give at most 7,140 three-hero bands.
- "How often is each hero in a finished band" gets **one event per hero** (`draft_complete_hero`) in addition to the
  band event, so a plain trends breakdown by `hero` answers it without SQL.
- Toggles always send `state: on|off`. Filters send `state: on|off` too, so turning a filter off can be counted
  separately from turning it on.
- `method` says how something was triggered, e.g. `button | click | keyboard | drag | menu | picker | chip | tap |
  long_press | right_click | link | history`. Each event's table row lists its own values.
- Hovers are noisy. A tooltip counts as viewed only after it stays open **≥ 700 ms**, and each target (hero, edge
  or arc) is sent **once per page load**.

## 3. Event catalogue

Priority: **P1** answers the questions you asked; **P2** covers the rest of the features; **P3** is nice to have.

### 3.1 Graph tab

#### Selection and clicks

| Event | P | When | Parameters |
|---|---|---|---|
| `node_select` *(replaces `node_selected`)* | P1 | `selectNode` | `node_type` (hero/trait), `node_name`, `source` (graph, keyboard, search, panel, edge, arc, draft; `link` when the page opened on it, `history` for back / forward) |
| `edge_click` | P1 | `selectEdge` | `hero`, `trait`, `edge_role` (has/inflicts/grants/…) |
| `arc_click` | P1 | `selectArc` | `hero_a`, `hero_b` (sorted), `synergy_category`, `hero_selected` (true if a hero was already selected) |
| `selection_clear` | P3 | background click / Esc | `method` |
| `node_drag` | P3 | the first node drag of the page load | `node_type` |
| `graph_zoom_gesture` | P3 | the first user zoom and the first pan of the page load (not fit / centre) | `control` (zoom/pan), `method` (wheel, touch, mouse) |
| `history_nav` | P2 | ↶ / ↷ buttons, browser back/forward on a graph selection | `control` (back/forward), `method` (button/browser) |

#### Hover discovery (do people find the tooltips?)

| Event | P | When | Parameters |
|---|---|---|---|
| `node_tooltip_view` | P2 | `showTooltip` held ≥ 700 ms | `node_type`, `node_name` |
| `edge_tooltip_view` | P1 | `showLinkTooltip` held ≥ 700 ms | `hero`, `trait`, `edge_role` |
| `arc_tooltip_view` | P1 | `showArcTooltip` held ≥ 700 ms | `hero_a`, `hero_b`, `synergy_category` |

#### View buttons

| Event | P | When | Parameters |
|---|---|---|---|
| `synergy_toggle` | P1 | button or `S` | `state`, `method`, `hero_selected` |
| `names_toggle` ("All names") | P1 | `#namesToggle` | `state` |
| `opponent_toggle` | P2 | `#opponentToggle` (band view only) | `state` |
| `graph_control` | P2 | zoom-in / zoom-out / fit / center | `control`, `method` (button/keyboard) |

#### Legend

| Event | P | When | Parameters |
|---|---|---|---|
| `legend_filter` | P1 | any `.legend-filter` | `filter_type` (attribute, trait_group, edge_role, synergy), `filter_value`, `state` |
| `legend_panel_toggle` | P1 | the "Legend" button (narrow screens) and the panel's collapse heading | `state` (open/closed), `control` (legend_button/collapse) |

Whether people read the static legend sections (Highlight, Edges, Trait size) can't be measured directly. The
`legend_panel_toggle` opens on narrow screens are the best proxy.

#### Search and trait chips

| Event | P | When | Parameters |
|---|---|---|---|
| `search` *(replaces `search_used`)* | P2 | once the user stops typing for 1 s, or the box loses focus; send only if the term changed since the last send | `search_term`, `result_count`, `surface: graph` |
| `search_suggestion_select` | P2 | `chooseSuggestion` | `surface`, `search_term`, `node_type`, `node_name`, `position` (1-based) |
| `search_no_results` | P2 | the debounced `search` came back with 0 matches | `surface`, `search_term` |
| `category_filter` | P2 | category chips (radio-like, so no `state`) | `filter_value` |
| `filter_clear` | P3 | Clear Filters / Esc, only when something was active | `method` |

#### Details panel (the links inside a hero's card)

| Event | P | When | Parameters |
|---|---|---|---|
| `panel_link_click` | P1 | the delegated `.details-body [data-node]` click in `script.js` | `link_kind` (hero_link, hero_chip, trait_chip, pair_side_head), `from_node`, `target_type`, `target_name`, `panel_section`: `ability` (an ability box), `synergy_pair` (a clicked synergy line), else the heading above the link as a slug (`card_traits`, `helped_by`, `helps`, `careful_with`, `counters`, `countered_by`, `self_combo`, a trait's edge role …) |
| `graph_add_to_draft` | P1 | `#addToDraft` | `hero`, `draft_action` (pick/ban) |

### 3.2 Draft tab

#### Tabs, setup and lifecycle

| Event | P | When | Parameters |
|---|---|---|---|
| `tab_view` | P1 | `setTab`, only when the tab changes (not on page load) | `tab`, `method` (click, keyboard, link, history, intro, view_in_graph, back_to_draft (the graph's "← Back to draft"), graph_add, card_menu) |
| `draft_mode_change` | P1 | `.mode-switch` | `mode` (two-player/solo) |
| `draft_format_change` | P1 | the format radio cards | `format` |
| `draft_start` | P1 | the first pick/ban on an empty state | `format` |
| `draft_complete` | **P1, key event** | a pick / ban / fill completes the draft (`Draft.isComplete`), once per band per page load; see the note below | `format`, `band`, `opponent_band`, `bans_mine`, `bans_theirs`, `band_top_percent` (the band's "Top N%", lower is better), `score_label`, `roles_covered`, `duration_sec` (since the first pick / ban). How many picks were the #1 suggestion comes from `draft_pick.top_suggestion` |
| `draft_complete_hero` | P1 | once per hero in each finished band | `hero`, `side` (mine/opponent), `format`, `pick_number` |
| `draft_reset` | P2 | `doReset` | `format`, `picks_made` |
| `draft_undo` | P2 | `doUndo` | `method` (button, keyboard, toast) |

**When a draft counts as finished:** two-player drafts finish once the sequence is done. A solo band "finishes" every
time it reaches 3 heroes, so remove-and-replace would send one finish per variant. Send `draft_complete` once for
each different band key in a page load. Stronger signs that the user meant it are `cards_open` with
`source: complete_button` and `share`.

#### Picks and bans

| Event | P | When | Parameters |
|---|---|---|---|
| `draft_pick` / `draft_ban` | P1 | `primaryAction` succeeds | `hero`, `format`, `player` (1/2), `pick_number`, `method` (tile, popover, menu, drag, random, graph, picker), `pool_sort`, `pool_rank` (position in the recommended order), `top_suggestion` (true/false), `filters_active` (true/false) |
| `draft_fill_band` | P2 | `fillBand` | `hero`, `band` |
| `draft_random` | P2 | `rollRandom` | `surface` (pool/slot/against), `hero` |
| `draft_remove` | P2 | removing from a slot | `hero`, `format` |
| `draft_reorder` | P3 | `moveSlot` / slot drag | `method` (button, keyboard, drag) |
| `draft_side_change` | P2 | add/remove an enemy, exclusion or carry-over ban | `control` (`enemy_add`, `enemy_remove`, `exclude_add`, `exclude_remove`, `carry_over_add`, `carry_over_remove`), `hero`, `method` (menu, picker, drag, chip) |
| `draft_blocked` | P2 | `attempt` catches a rule violation | `error` (the rule message, trimmed to 100 characters) |

#### Hero pool

| Event | P | When | Parameters |
|---|---|---|---|
| `search` | P2 | pool search, sent the same way as the graph search | `search_term`, `result_count`, `surface: pool` |
| `search_suggestion_select` | P2 | `choosePoolSuggestion` | `surface: pool`, `search_term`, `target_type` (hero, trait, role, range, attribute, size), `node_name`, `position` |
| `pool_filter` | P2 | attribute, role, "Fills a missing role", "Show unavailable", removing a search pill, "clear filters" | `filter_type` (attribute, role, fills_missing_role, show_unavailable, pill, clear_all), `filter_value`, `state` |
| `pool_sort` | P2 | `.sort-switch` | `pool_sort` |
| `pool_filters_toggle` | P3 | `#filtersToggle` (narrow screens) | `state` |

#### Explanations (do people read why a hero is recommended?)

| Event | P | When | Parameters |
|---|---|---|---|
| `hero_popover_view` | P1 | the tile popover stays open ≥ 700 ms, or is pinned or opened as a sheet; once per hero and mode per page load | `hero`, `popover_mode` (hover/pinned/sheet), `pool_rank` |
| `popover_action` | P2 | a `[data-pop]` button in the popover | `control` (primary, fill, card, close), `hero` |
| `card_menu_open` | P2 | `openMenu` | `method` (button, tap, right_click, long_press), `hero` |
| `card_menu_action` | P2 | a `[data-menu]` item | `control` (primary, fill, inspect, enemy, exclude, unface, unexclude, card, graph), `hero` |
| `analysis_inspect` | P1 | an analysis section or line, or a popover `[data-inspect]` | `section`, `line_index`, `source` (analysis/popover) |
| `score_factor_open` | P1 | `#scoreBreakdown` | `factor` |
| `score_info_open` | P2 | the (i) button | |
| `role_help_open` | P2 | `toggle` event on `<details id="roleHelp">` ("what do the roles mean") | |
| `analysis_more` | P3 | `[data-more]` | `section`, `state` |
| `analysis_focus_switch` | P3 | `#focusSwitch` | `player` |
| `analysis_sheet_toggle` | P3 | `#draftBar` (phone) | `state` |
| `inspect_card_text` | P3 | a click on a "Card text" summary in the inspector (a single item starts open, so its first click is `closed`) | `state` |
| `view_in_graph` | P1 | `#viewInGraph`, `#inspectInGraph`, `#cardInGraph`, card menu "graph" | `source` |

#### Reference cards and sharing

| Event | P | When | Parameters |
|---|---|---|---|
| `cards_open` | P1 | `openCards` | `source` (complete_button, band_slot, popover, menu, inspect, shared_link), `hero` (empty for the whole band) |
| `cards_side_switch` | P3 | `#cardsSwitch` | `side` |
| `cards_only` | P3 | `#cardsOnly` | |
| `share` | **P1, key event** | `#shareLink` | `method` (native, clipboard, fallback), `content_type: draft`, `format`, `band` |
| `shared_link_open` | P1 | `openSharedLink` | `result` (ok/error), `format`, `band`, `error` |

### 3.3 Whole site

| Event | P | When | Parameters |
|---|---|---|---|
| `app_loaded` | P1 | keep as is | `entry` (direct, hero_link, trait_link, band_link, draft_tab, draft_share), `hero_count` |
| `tutorial_begin` | P2 | the intro dialog opens | `method` (auto_first_visit, help_button) |
| `intro_tab` | P3 | `[data-intro-tab]` in the intro | `tab` |
| `tutorial_complete` | P2 | the intro closes | `open_sec` (how long it was open) |
| `app_error` / `draft_load_error` | P2 | the graph's / the Draft tab's load failing (the catch blocks in `init`) | `error` |

## 4. PostHog setup

### 4.1 Project settings

Nothing has to be registered: PostHog shows every event and property as soon as it arrives.

1. **What `index.html` turns on:** `$pageview` for the landing page only (`capture_pageview: true`), so graph selections
   and tab switches don't each count as a page view; `$pageleave`; and `person_profiles: 'identified_only'` (anonymous
   events, the cheapest kind). **Autocapture is off**: `analytics.js` sends everything. Outbound links (Steam guide,
   BGG, Intaglyph) are not tracked; GA4 used to record them by itself.
2. **Session replay, heatmaps, surveys:** leave them off in Project settings unless you want them. Replay records
   what visitors do on screen, which needs a mention in a privacy notice.
3. **Check the events arrive:** open the live site, then **Activity** (Live events) in PostHog. Each action should
   show once with its properties. To see the events without PostHog, open any page with `?analytics_debug`, e.g.
   `http://localhost:8000/?analytics_debug`; each event is logged to the console as `[analytics] name {params}` and
   nothing is sent. A local server sends nothing at all (`index.html` doesn't start PostHog there).
4. **Key events:** PostHog has no key-event flag. Put `draft_complete` and `share` on the dashboard (§4.2) instead.
5. **Retention:** the free plan keeps a year of data.

### 4.2 Insights (one dashboard)

Make a dashboard ("Bestiary") and add each insight to it, so they all sit on one page (also in a phone browser).

- **Feature adoption** (Trends): one series per event (synergy toggle, `names_toggle`, `legend_filter`,
  `panel_link_click`, `edge_tooltip_view`, …), measured as **Unique users**, shown as a table. Add a `$pageview`
  unique-users series and a formula (`A / Z * 100`) for "x % of visitors used it". Break down by `state` to see how
  many turn a toggle back off.
- **Graph interest** (Trends, total count, table): `node_select` broken down by `node_type` then `node_name`;
  `edge_click` by `hero` and `trait`; `arc_click` by `synergy_category`.
- **Draft funnel** (Funnels): `tab_view` (filter `tab = draft`) → `draft_start` → `draft_complete` → `cards_open` →
  `share`. Break down by `format` with the breakdown attribution set to the `draft_start` step (`tab_view` has no
  `format`).
- **Hero meta** (Trends, total count, table): `draft_pick`, `draft_ban` and `draft_complete_hero` (filter
  `side = mine`) as three series, broken down by `hero`.
- **Do the recommendations help?** `draft_pick` broken down by `top_suggestion`, and by `pool_rank` (numeric breakdowns
  can be binned). A funnel `hero_popover_view` → `draft_complete` against `tab_view` → `draft_complete` compares
  people who read the explanations with everyone.
- **User paths** starting at `app_loaded` to see what people do first.

### 4.3 SQL (SQL insight)

```sql
-- Most common finished bands (last 30 days)
SELECT properties.band AS band, properties.format AS format,
       count() AS drafts, count(DISTINCT distinct_id) AS users
FROM events
WHERE event = 'draft_complete' AND timestamp > now() - INTERVAL 30 DAY
GROUP BY band, format ORDER BY drafts DESC LIMIT 50

-- Hero pairs that end up in the same band
SELECT tupleElement(pair, 1) AS hero_a, tupleElement(pair, 2) AS hero_b, count() AS bands
FROM (
    SELECT arrayJoin(arrayFlatten(arrayMap(x -> arrayMap(y -> (x, y), h), h))) AS pair
    FROM (SELECT splitByChar(',', toString(properties.band)) AS h FROM events WHERE event = 'draft_complete')
)
WHERE hero_a < hero_b
GROUP BY hero_a, hero_b ORDER BY bands DESC
```

## 5. Implementation (as built)

1. **`analytics.js`**: pure and unit-tested (`tests/analytics.test.js`), loaded before `script.js`.
   - `EVENTS` (event → allowed params). `payload` refuses unknown events and params and drops empty values.
     `createTracker` reports a bad call to the console instead of breaking the UI.
   - `pageTracker()` is the one tracker both tabs share. `trackingMode` sends to `posthog.capture` on the live site,
     logs to the console with `?analytics_debug`, and is off on localhost.
   - Helpers: `bandKey` (sorted and comma-joined), `once(key)` (first time per page load), `createDelay` (700 ms
     tooltip / popover dwell), `createSettledSearch` (a term is sent 1 s after typing stops or on blur, never
     twice in a row), `entryOf` (how the visit started).
   - `draftEvents(before, after, extra)` turns one user action into `draft_start` / `draft_pick` / `draft_ban`, and
     nothing for undo, reset or a new format. `completionEvents` / `completionKey` give the finished band plus one
     event per hero, sent once per band per page load.
   - Tests check names (snake_case, ≤ 40 characters, no `$`) and that this document lists every event and param.
2. **`script.js`**: graph events at their handlers. `method` comes through `runAction` / `toggleSynergies` /
   `clearAll`, and `applyRoute` passes `link` (opened with the page) or `history` (back / forward) as the source.
3. **`draft-ui.js`**: `primaryAction(name, { method })` and `fillBand` compare the state before and after the action
   (`trackDraft`), so a pick is tracked the same way whatever started it. `setTab(tab, { via })`,
   `openCards({ source })` and the popover dwell were added.
4. **`index.html`**: the PostHog loader, `posthog.init` (skipped on localhost), then `analytics.js`.
5. P2 / P3 helpers: `draftChanges(before, after, { method })` (in `attempt` and `setCarryOver`) turns side changes,
   removals and reorders into events, `navDirection` gives back / forward, and `gestureOf` names a d3-zoom gesture.
