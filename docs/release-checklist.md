# Release checklist

Use this checklist for alpha/beta/RC/stable release qualification. A pre-release
may deliberately leave later gates open, but the release notes must say so.

## Repository boundary

- [ ] Intended release commit is identified and the working tree is understood.
- [ ] No unrelated concurrent dirty files are staged.
- [ ] Version/tag/changelog agree.
- [ ] Source/build input revisions are recorded.
- [ ] Generated layer schema versions are compatible.

## Data integrity

- [ ] Place/route validator passes.
- [ ] Tree validator passes when trees ship.
- [ ] Bench validator passes when benches ship.
- [ ] Semantic validator passes when semantic entities ship.
- [ ] Path-topology validator passes when topology ships.
- [ ] Content DE/EN parity/source-reference checks pass.
- [ ] Combined graph counts equal the validated input-layer counts.
- [ ] No release build silently replaces a valid layer with an empty placeholder.
- [ ] Stable IDs and aliases are valid and unique.
- [ ] Every semantic relation endpoint resolves.

## Provenance and accuracy

- [ ] Every coordinate-bearing shipped layer has source provenance.
- [ ] Unknown horizontal/vertical accuracy is represented as unknown, not guessed.
- [ ] Representative points are not described as entrances unless sourced as entrances.
- [ ] Terrain elevation is not confused with physical object/specimen height.
- [ ] Derived route metrics document their source inputs/algorithm.
- [ ] Volatile visitor facts have source and verification date.
- [ ] Media licensing/source metadata is sufficient for the way media is displayed.

## Routing/accessibility

- [ ] Directed route reverse semantics are validated.
- [ ] Step/surface/grade/access evidence remains directional where required.
- [ ] Unknown endpoint/access evidence is not promoted into a positive accessibility claim.
- [ ] Private/no-foot source ways are excluded unless an explicit pedestrian exception applies.
- [ ] If multi-hop routing ships, route topology integrity and route-result tests pass.

## Runtime

- [ ] Node test suite passes.
- [ ] Vite production build passes.
- [ ] Every visitor-facing data layer is copied into the build artifact.
- [ ] Runtime rejects or safely disables incompatible optional data layers.
- [ ] Deep links for shipped entity/view types resolve.
- [ ] Manual browsing works with GPS disabled/denied.

## Offline/PWA

- [ ] Service worker registers on the production path.
- [ ] Application shell/assets are usable after an offline reload once cached.
- [ ] Shipped runtime JSON remains available offline as intended.
- [ ] Upgrade from the previous deployed cache/data version has been smoke-tested.
- [ ] Cross-origin tile-cache behavior has been verified in target browsers.
- [ ] Tile caching remains bounded and visitor-driven; no bulk third-party tile prefetch occurs.

## Accessibility/browser QA

- [ ] Keyboard navigation covers primary map-independent flows.
- [ ] Focus order and visible focus are usable.
- [ ] Screen-reader labels for navigation and controls are meaningful.
- [ ] Reduced-motion behavior is acceptable where animated map movement exists.
- [ ] Automated accessibility checks have no unreviewed serious findings.
- [ ] Current Chromium qualification passes.
- [ ] Firefox qualification passes for beta/stable.
- [ ] iOS Safari/WebKit qualification passes for beta/stable.

## Performance

- [ ] Initial JS/CSS size is recorded against the current budget.
- [ ] Map startup and first interaction are acceptable on representative mobile hardware.
- [ ] Large tree/bench layers use clustering/LOD or another bounded rendering strategy.
- [ ] Repeated route/layer changes do not show unbounded memory growth in smoke testing.

## Deployment

- [ ] GitHub Pages build uses the complete repository verification gate.
- [ ] Pages artifact contains expected application/data files only.
- [ ] Custom domain resolves and HTTPS is valid.
- [ ] Production home page returns successfully.
- [ ] Production deep link, route interaction and language switch smoke tests pass.
- [ ] Installability/offline behavior is checked against the deployed origin.

## Documentation/release evidence

- [ ] README matches current capabilities.
- [ ] ROADMAP reflects completed/incomplete phases.
- [ ] CHANGELOG lists user-visible changes and known limitations.
- [ ] `docs/implementation-review.md` P0/P1 findings have been reviewed for release impact.
- [ ] Known data limitations are stated without overstating precision/completeness.
- [ ] Release/tag/deployment evidence is durable.

## Stable-only gate

- [ ] No known P0/P1 integrity issue remains open.
- [ ] Clean checkout can validate the preserved release data without external network access.
- [ ] Public schema/data migration policy is documented.
- [ ] Privacy behavior is documented and matches the application.
- [ ] Release candidate has completed a regression period without a blocking issue.
