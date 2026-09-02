# Mobile guidance surface

Status: design authority for the first navigation-oriented chrome tranche.

## Product intent

The map is the primary visitor surface. Permanent branding must not consume scarce mobile map area after it has done its introductory job. The top surface should therefore change role over time:

1. **Welcome** — briefly orient a first-time visitor with Bergpark/UNESCO identity.
2. **Compact map chrome** — retain essential controls while giving the map back most of the viewport.
3. **Context/guidance** — expand again only when it has useful, current information: selected target, active route, location state, navigation instruction, or important recovery message.

The large top surface is not a static header. It is a reusable, state-driven visitor guidance surface.

## Mobile states

### Welcome

Shown on a fresh session before a meaningful interaction.

Content:
- UNESCO/Bergpark identity
- product name
- renderer/language/location controls

The welcome state collapses after the first meaningful interaction (map selection, location activation, route start, navigation view change, or explicit collapse). It must not repeatedly expand on ordinary rerenders.

### Compact

Default map state after the welcome has been acknowledged.

Content:
- one-line Bergpark identity
- renderer, language, location controls
- optional expand affordance

Target height: about one 44 px control row plus safe-area/padding, rather than the current two-line brand card.

### Target

A place/tree/visitor feature is the current map target but no active route/location combination exists.

Content:
- short context kicker (for example `Ziel` / `Destination`)
- target name
- concise next action, not duplicate descriptive prose

The detail sheet remains the home for long-form content.

### Route

An active route exists but there is no usable position yet.

Content:
- destination name
- route distance and walking estimate when known
- prompt to enable location or set a position

This is useful context, so the surface may remain expanded.

### Navigation

An active route and a distinct current position exist.

Content priority:
1. immediate instruction
2. destination
3. remaining route distance / ETA
4. off-route or location-quality note when materially relevant

The first tranche may use a conservative `Follow route` instruction and accurate remaining-along-polyline progress. Turn-by-turn maneuver text is a successor feature and must not be fabricated from route geometry without an explicit maneuver derivation contract.

### Recovery

Renderer/location/navigation failures may temporarily expand the surface with a short actionable message. Transient notices should not permanently pin the surface open.

## Desktop: simulated visitor position

Desktop use should be able to exercise the same navigation state without spoofing the browser geolocation API.

Add an explicit `Set position` tool. When armed:
- map cursor changes to a crosshair;
- the next non-feature map click becomes a simulated visitor position;
- the position is rendered through the same spatial-controller `setUserPosition` path as GPS;
- guidance/navigation consumes the same position state as mobile GPS;
- the UI labels the source as simulated;
- a subsequent pick replaces the simulated position;
- starting real GPS clears the simulation authority.

The location source belongs above the renderers. Leaflet and MapLibre should only report map coordinates and render the resulting position.

## Guidance state model

The view model should be derived from explicit product state rather than DOM inspection:

- current selection / target
- current route
- current position
- position source (`gps` or `simulated`)
- route progress
- welcome acknowledged state
- current transient recovery notice

A pure guidance module should compute display state and route progress so it can be unit-tested without a browser.

## Route progress contract

For an active route with a position:
- project the current point onto the closest route segment;
- compute cumulative route distance to that projection;
- report remaining distance along the route, not straight-line distance to the destination;
- report perpendicular distance to the route separately;
- do not decrease remaining distance by projecting onto a non-nearest semantic branch if the route geometry self-intersects; successor work may add continuity/hysteresis using previous progress.

The first tranche should expose progress conservatively and flag materially off-route positions rather than generating a turn instruction.

## Responsive rules

- Mobile (`<760px`): guidance surface can collapse and expand; brand text is hidden in compact mode.
- Desktop (`>=760px`): keep a stable compact control/header card and expose `Set position`; route/navigation context may use the same card without covering a large fraction of the map.
- Respect safe-area insets.
- No automatic animated expansion/collapse when `prefers-reduced-motion` is set.
- Do not obscure the bottom navigation or primary map controls.

## Acceptance criteria — tranche 1

- Fresh mobile session shows the welcome header.
- First meaningful interaction collapses the header when no richer context is active.
- Target/route/navigation state can expand the same surface with useful content.
- Active route + position displays remaining distance along the route.
- Desktop can arm `Set position`, click either renderer, and render a simulated user position.
- Simulated position is consumed by the same guidance state as GPS.
- A route/position state survives Leaflet ↔ terrain renderer switching through the existing restoration seam.
- E2E covers mobile collapse, route guidance, desktop position picking, and renderer preservation.
