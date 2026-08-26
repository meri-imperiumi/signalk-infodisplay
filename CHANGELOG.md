# Changelog
## [Unreleased]
### Changed
- Switched the notification overlay from the old HSL hue ramp to the
  brighter Grafana dark-theme palette that `../signalk-status-tiles`
  now uses (green `#73bf69`, amber `#ffaa00`, red `#f2495c`), so the
  two displays never disagree on color meaning. `alert` keeps its own
  rung between green and amber as a blend of the two. Notification
  message text is now plain white (state color lives in the border,
  glow, and severity tag), and panels use a slightly brighter tinted
  fill and glow, matching the status-tiles tile treatment.

## [1.3.0] - 2026-08-24
### Added
- Configurable notification denylist: a list of Signal K notification
  paths (with `*`/`**` glob wildcards) to suppress from the on-screen
  overlay. Use this to hide alerts that are already surfaced by a
  status-tiles tile on the displayed dashboard, so the overlay isn't
  showing the same alert twice. `*` matches within one dot-segment;
  `**` spans segments.

### Changed
- Restyled the on-screen notifications to match the HUD aesthetic of
  `../signalk-status-tiles`: dark hue-tinted emissive panels with angular
  corners, a condensed uppercase severity tag, and a fixed bottom-right
  stack. Notification states now map onto the same green/amber/red hue
  ramp as the status tiles (the old blue default is gone), and only
  warn/alarm/emergency pulse — alert/normal/nominal stay steady.
  Each Signal K notification state (alert, warn, alarm, emergency) now
  has its own distinct color and tag word, rather than alert and warn
  both rendering as amber "WARN".
- Hiding the unnecessary _Watching_ notification from Hoeken's Anchor Alarm

## [1.2.8] - 2026-06-16
### Changed
- Better app icon

## [1.2.7] - 2026-06-16
### Changed
- Improvements for Signal K app store

## [1.2.6] - 2026-01-26
### Changed
- _Value is within normal range_ notifications are not shown
- Notifications are cleared when reconnecting to Signal K

## [1.2.5] - 2025-11-03
### Changed
- Notification elements take a little bit less space now

## [1.2.4] - 2025-10-06
### Changed
- Actually remove the notification elments instead of hiding them

## [1.2.3] - 2025-09-30
### Added
- Added colors for notification types of `warning` and `nominal`

### Changed
- Hiding all "nominal" notifications until Signal K allows not having "visual" set

## [1.2.2] - 2025-09-25
### Fixed
- Added safety for notifications with empty payload

## [1.2.1] - 2025-08-31
### Changed
- Hiding non-visual notifications of state "nominal"

## [1.2.0] - 2025-03-30
### Changed
- Hiding the persistent but not useful _Anchor Alarm - Normal_ visual notification when anchored

### Fixed
- Safety for incorrectly formatted notifications

## [1.1.0] - 2024-12-10
### Added
- Show Signal K notifications visually on screen

## [1.0.1] - 2024-12-09
### Fixed
- Fixed unnecessary reloads when same state message is received again

## [1.0.0] - 2024-12-09
### Added
- Initial release

