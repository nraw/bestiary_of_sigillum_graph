# Analytics tracking plan (GA4)

Goal: know what people click in the graph, which heroes they draft and which bands they finish, and which
features get used at all (synergy lines, All names, legend filters, the links in the hero panel, …).

Property: `G-GQ4HDYYETG` (gtag.js in `index.html`).

**Status:** the P1 events are built (`analytics.js`, wired into `script.js` / `draft-ui.js`; see §5). So are the old
events rewritten in the new form (`graph_control`, `category_filter`, `filter_clear`, `search`) and a few cheap P2
events (`node_tooltip_view`, `opponent_toggle`, `score_factor_open`, `view_in_graph`). The rest of P2 / P3 is still a plan.
`analytics.js` `EVENTS` is the source of truth for what is sent. §1 describes the tracking as it was before this work.

## 1. What is tracked today, and what's wrong with it

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
(`replaceState`) may send its own `page_view`. Check this in DebugView (§4.1).

## 2. Conventions

- Event names: `snake_case`, object first then verb (`draft_pick`, `edge_click`), 40 characters max. Use GA4's
  recommended names where one fits (`search`, `share`, `tutorial_begin`).
- Parameters: stick to a fixed set (§3.3) so the custom-dimension list stays under GA4's free limit of 50
  event-scoped dimensions. Values are capped at 100 characters, and an event can carry at most 25 parameters.
- **Bands are sent as one key: the hero names sorted alphabetically and joined with commas** (`aqus,brewus,saxum`),
  so the same band always gives the same string no matter what order it was picked in. 36 heroes give at most 7,140
  three-hero bands, which GA4 can report on without lumping rows into "(other)" as long as the date range is sensible.
- GA4 can't split one event into several rows, so "how often is each hero in a finished band" gets **one event per
  hero** (`draft_complete_hero`) in addition to the band event.
- Toggles always send `state: on|off`. Filters send `state: on|off` too, so turning a filter off can be counted
  separately from turning it on.
- `method` says how something was triggered: `click | keyboard | drag | long_press | right_click | url | history`.
- Hovers are noisy. A tooltip counts as viewed only after it stays open **≥ 700 ms**, and each target (hero, edge
  or arc) is sent **once per page load**.

## 3. Event catalogue

Priority: **P1** answers the questions you asked; **P2** covers the rest of the features; **P3** is nice to have.

### 3.1 Graph tab

#### Selection and clicks

| Event | P | When | Parameters |
|---|---|---|---|
| `node_select` *(replaces `node_selected`)* | P1 | `selectNode` | `node_type` (hero/trait), `node_name`, `source` (graph, keyboard, search, panel, edge, arc, url, history, draft) |
| `edge_click` | P1 | `selectEdge` | `hero`, `trait`, `edge_role` (has/inflicts/grants/…) |
| `arc_click` | P1 | `selectArc` | `hero_a`, `hero_b` (sorted), `synergy_category`, `hero_selected` (true if a hero was already selected) |
| `selection_clear` | P3 | background click / Esc | `method` |
| `node_drag` | P3 | `dragended`, once per page load | `node_type` |
| `graph_zoom_gesture` | P3 | the first wheel / pinch zoom or pan of the page load | `gesture` (zoom/pan) |
| `history_nav` | P2 | ↶ / ↷ buttons, browser back/forward on a graph selection | `direction`, `method` (button/browser) |

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
| `search_suggestion_select` | P2 | `chooseSuggestion` | `surface`, `search_term`, `node_type`, `node_name`, `position` |
| `search_no_results` | P2 | the debounced `search` came back with 0 matches | `surface`, `search_term` |
| `category_filter` | P2 | category chips (radio-like, so no `state`) | `filter_value` |
| `filter_clear` | P3 | Clear Filters / Esc, only when something was active | `method` |

#### Details panel (the links inside a hero's card)

| Event | P | When | Parameters |
|---|---|---|---|
| `panel_link_click` | P1 | the delegated `.details-body [data-node]` click in `script.js` | `link_kind` (hero_link, hero_chip, trait_chip, pair_side_head), `from_node`, `target_type`, `target_name`, `panel_section` (traits, synergy, counters, arc_pair, …, from the closest section heading) |
| `graph_add_to_draft` | P1 | `#addToDraft` | `hero`, `draft_action` (pick/ban) |
| `back_to_draft` | P2 | `#backToDraft` | |

### 3.2 Draft tab

#### Tabs, setup and lifecycle

| Event | P | When | Parameters |
|---|---|---|---|
| `tab_view` | P1 | `setTab` (skip calls that don't change the tab) | `tab`, `method` (click, keyboard, url, view_in_graph, back_to_draft, card_menu, …) |
| `draft_mode_change` | P1 | `.mode-switch` | `mode` (two-player/solo) |
| `draft_format_change` | P1 | the format radio cards | `format` |
| `draft_start` | P1 | the first pick/ban on an empty state | `format` |
| `draft_complete` | **P1, key event** | the first time a state becomes complete (`Draft.isComplete`, or 3 heroes in the solo band); see the note below | `format`, `band`, `opponent_band`, `bans_mine`, `bans_theirs`, `band_top_percent` (the band's "Top N%", lower is better), `score_label`, `roles_covered`, `duration_sec` (since the first pick / ban). How many picks were the #1 suggestion comes from `draft_pick.top_suggestion` |
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
| `draft_random` | P2 | `rollRandom` | `target` (pool/slot/against), `hero` |
| `draft_remove` | P2 | removing from a slot | `hero` |
| `draft_reorder` | P3 | `moveSlot` / slot drag | `method` |
| `draft_side_change` | P2 | add/remove an enemy, exclusion or carry-over ban | `list` (enemies/excluded/carry_over), `op` (add/remove), `hero`, `method` (menu, picker, drag, chip) |
| `draft_blocked` | P2 | `attempt` catches a rule violation | `reason` (the error message, trimmed to 100 characters) |

#### Hero pool

| Event | P | When | Parameters |
|---|---|---|---|
| `search` | P2 | pool search, sent the same way as the graph search | `search_term`, `result_count`, `surface: pool` |
| `search_suggestion_select` | P2 | `choosePoolSuggestion` | `surface: pool`, `pill_type` (hero, trait, role, attribute), `node_name` |
| `pool_filter` | P2 | attribute, role, "Fills a missing role", "Show unavailable" | `filter_type`, `filter_value`, `state` |
| `pool_sort` | P2 | `.sort-switch` | `pool_sort` |
| `pool_filters_toggle` | P3 | `#filtersToggle` (narrow screens) | `state` |

#### Explanations (do people read why a hero is recommended?)

| Event | P | When | Parameters |
|---|---|---|---|
| `hero_popover_view` | P1 | the tile popover stays open ≥ 700 ms, or is pinned or opened as a sheet; once per hero per page load | `hero`, `popover_mode` (hover/pinned/sheet), `pool_rank` |
| `popover_action` | P2 | a `[data-pop]` button in the popover | `popover_action` (primary, fill, card), `hero` |
| `card_menu_open` | P2 | `openMenu` | `method` (button, right_click, long_press), `hero` |
| `card_menu_action` | P2 | a `[data-menu]` item | `menu_action`, `hero` |
| `analysis_inspect` | P1 | an analysis section or line, or a popover `[data-inspect]` | `section`, `line_index`, `source` (analysis/popover) |
| `score_factor_open` | P1 | `#scoreBreakdown` | `factor` |
| `score_info_open` | P2 | the (i) button | |
| `role_help_open` | P2 | `toggle` event on `<details id="roleHelp">` ("what do the roles mean") | |
| `analysis_more` | P3 | `[data-more]` | `section`, `state` |
| `analysis_focus_switch` | P3 | `#focusSwitch` | `player` |
| `analysis_sheet_toggle` | P3 | `#draftBar` (phone) | `state` |
| `inspect_card_text` | P3 | `toggle` on `details.inspect-cards` | `state` |
| `view_in_graph` | P1 | `#viewInGraph`, `#inspectInGraph`, `#cardInGraph`, card menu "graph" | `source` |

#### Reference cards and sharing

| Event | P | When | Parameters |
|---|---|---|---|
| `cards_open` | P1 | `openCards` | `source` (complete_button, band_slot, popover, menu, inspect, shared_link), `hero` (empty for the whole band) |
| `cards_side_switch` | P3 | `#cardsSwitch` | `side` |
| `cards_only` | P3 | `#cardsOnly` | |
| `share` *(GA4 recommended)* | **P1, key event** | `#shareLink` | `method` (native, clipboard, fallback), `content_type: draft`, `format`, `band` |
| `shared_link_open` | P1 | `openSharedLink` | `result` (ok/error), `format`, `band`, `error` |

### 3.3 Whole site

| Event | P | When | Parameters |
|---|---|---|---|
| `app_loaded` | P1 | keep as is | `entry` (direct, hero_link, trait_link, band_link, draft_tab, draft_share), `hero_count` |
| `tutorial_begin` *(GA4 recommended)* | P2 | the intro dialog opens | `method` (auto_first_visit, help_button) |
| `intro_tab` | P3 | `[data-intro-tab]` in the intro | `tab` |
| `tutorial_complete` | P2 | the intro closes | `open_sec` (how long it was open) |
| `click` (outbound) | P2 | automatic with Enhanced Measurement (Steam guide, BGG, Intaglyph) | built in: `link_url`, `link_domain`, `outbound` |
| `app_error` / `draft_load_error` | P2 | the existing catch blocks (`draft-ui.js` currently only logs to the console) | `error` |

**Parameters to register now** (the events that are built; `analytics.js` `DIMENSIONS` / `METRICS`, and a test
keeps this list in step with the code):

- Custom dimensions (event-scoped, 43 of the 50 allowed): `entry, error, node_type, node_name, source, hero, trait,
  edge_role, hero_a, hero_b, synergy_category, hero_selected, state, method, control, filter_type, filter_value,
  surface, link_kind, from_node, target_type, target_name, panel_section, draft_action, tab, mode, format, player,
  pool_sort, top_suggestion, filters_active, band, opponent_band, bans_mine, bans_theirs, score_label, side,
  popover_mode, section, line_index, factor, content_type, result`
- Custom metrics: `hero_count, result_count, pick_number, pool_rank, band_top_percent, roles_covered, duration_sec`
- `search_term` is built in.

The P2 / P3 events would add `popover_action, menu_action, list, op, reason` (48 of 50 dimensions) and
`position, open_sec` as metrics. If the dimensions run out, low-value ones (`line_index`, `from_node`) can go.

Custom dimensions only fill in **from the day they are registered** and never retroactively, so register them
before the release goes out.

## 4. GA4 setup

### 4.1 Admin

1. **Data retention → 14 months** (Admin › Data collection › Data retention). The default is 2 months, and
   Explorations can't go back further than that.
2. **Enhanced Measurement**
   - Page views: on, but **turn off "page changes based on browser history events"**. Otherwise every
     `?hero=` push and tab `replaceState` sends a `page_view`, which double-counts what `node_select` and
     `tab_view` already record. The first page view still records landing pages such as `?hero=saxum` coming
     from search engines.
   - Outbound clicks: on. Scrolls: off (the app is one screen, so scroll depth means nothing). Site search: off
     (there's no query parameter). Form interactions: **off** (the dialogs' `<form method="dialog">` close
     buttons would fire `form_submit`). Video and file downloads: off.
   - After changing these, open the live site with DebugView (Admin › DebugView, e.g. with the Google Analytics
     Debugger extension) and check that each event arrives exactly once. To see the events without GA, open any
     page with `?analytics_debug`, e.g. `http://localhost:8000/?analytics_debug`; each event is logged to the
     console as `[analytics] name {params}` and nothing is sent.
3. **Key events**: mark `draft_complete` and `share` (and optionally `cards_open`) as key events.
4. **Internal traffic**: localhost is handled already, since `index.html` skips `gtag('config')` there and
   `analytics.js` sends nothing. To leave out your visits to the live site too, add an internal-traffic rule for
   your IP (Admin › Data streams › Configure tag settings › Define internal traffic) and activate the filter.
5. **Custom definitions**: register the dimensions and metrics listed in §3.3.
6. **BigQuery export** (Admin › Product links › BigQuery, free on the daily export): recommended for the band
   analysis. GA4's interface struggles with "most common bands" or "who is picked with whom", but in SQL each is
   a few lines (§4.3).

### 4.2 Reports to build (Explore)

- **Feature adoption** (Free form): rows = Event name, values = Total users. Divide by Active users over the same
  range to get "x % of users touched the synergy toggle / All names / a legend filter / a panel link / an edge
  tooltip". Add a `state` breakdown to see how many turn the toggle back off.
- **Graph interest** (Free form): `node_select` by `node_type` × `node_name`; `edge_click` by `hero` × `trait`;
  `arc_click` by `synergy_category`.
- **Draft funnel** (Funnel exploration, open funnel):
  `tab_view (tab=draft)` → `draft_start` → `draft_pick (pick_number=1)` → `draft_complete` → `cards_open` → `share`,
  broken down by `format`.
- **Hero meta**: `draft_complete_hero` by `hero` (how often each hero ends up in a band), next to `draft_pick` by
  `hero` and `draft_ban` by `hero` (pick and ban rates). Filter `side=mine`.
- **Do the recommendations help?** `draft_pick` by `top_suggestion` and `pool_rank`; `hero_popover_view` /
  `analysis_inspect` users vs `draft_complete` users.
- **Path exploration** from `app_loaded` to see what people do first.
- A **Looker Studio** dashboard on the BigQuery export if you want a permanent view.

### 4.3 BigQuery examples

```sql
-- Most common finished bands (last 30 days)
SELECT
  (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'band')   AS band,
  (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'format') AS format,
  COUNT(*) AS drafts, COUNT(DISTINCT user_pseudo_id) AS users
FROM `PROJECT.analytics_XXXX.events_*`
WHERE event_name = 'draft_complete'
  AND _TABLE_SUFFIX >= FORMAT_DATE('%Y%m%d', DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY))
GROUP BY band, format ORDER BY drafts DESC LIMIT 50;

-- Hero pairs that end up in the same band
WITH b AS (
  SELECT SPLIT((SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'band'), ',') AS heroes
  FROM `PROJECT.analytics_XXXX.events_*` WHERE event_name = 'draft_complete')
SELECT x AS hero_a, y AS hero_b, COUNT(*) AS bands
FROM b, UNNEST(heroes) x, UNNEST(heroes) y WHERE x < y
GROUP BY 1, 2 ORDER BY bands DESC;
```

## 5. Implementation (as built)

1. **`analytics.js`**: pure and unit-tested (`tests/analytics.test.js`), loaded before `script.js`.
   - `EVENTS` (event → allowed params), `DIMENSIONS` / `METRICS` (what to register in GA4). `payload` refuses
     unknown events and params, drops empty values, turns booleans into `'true'` / `'false'` and caps strings at 100
     characters. `createTracker` reports a bad call to the console instead of breaking the UI.
   - `pageTracker()` is the one tracker both tabs share. `trackingMode` sends to gtag on the live site, logs to
     the console with `?analytics_debug`, and is off on localhost.
   - Helpers: `bandKey` (sorted and comma-joined), `once(key)` (first time per page load), `createDelay` (700 ms
     tooltip / popover dwell), `createSettledSearch` (a term is sent 1 s after typing stops or on blur, never
     twice in a row), `entryOf` (how the visit started).
   - `draftEvents(before, after, extra)` turns one user action into `draft_start` / `draft_pick` / `draft_ban`, and
     nothing for undo, reset or a new format. `completionEvents` / `completionKey` give the finished band plus one
     event per hero, sent once per band per page load.
   - Tests check names (snake_case, ≤ 40 characters), ≤ 25 params, that every param is registered and every
     registered param is used, and that this document lists them all.
2. **`script.js`**: graph events at their handlers. `method` comes through `runAction` / `toggleSynergies` /
   `clearAll`, and `applyRoute` passes `link` (opened with the page) or `history` (back / forward) as the source.
3. **`draft-ui.js`**: `primaryAction(name, { method })` and `fillBand` compare the state before and after the action
   (`trackDraft`), so a pick is tracked the same way whatever started it. `setTab(tab, { via })`,
   `openCards({ source })` and the popover dwell were added.
4. **`index.html`**: loads `analytics.js` and skips `gtag('config')` on localhost.
5. Before deploying: register the dimensions and metrics above, set retention to 14 months, mark the key events and
   turn off history-based page views (§4.1). Then add P2 / P3 once the first numbers come in.
