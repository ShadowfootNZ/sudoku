# Lightweight analytics usage

`js/analytics.js` records two different kinds of request:

1. **App hit** — sent once when the analytics module loads. It has no `event` field.
2. **Feature event** — sent when an app calls `trackAppFeature()`. It has an `event` field.

These must be counted separately. A request containing `event` is a feature event and must **not**
also increment the app-hit total.

## Using analytics.js in an app

Copy `js/analytics.js` into the app and load it near the end of the page:

```html
<script type="module" src="js/analytics.js"></script>
```

That is sufficient for ordinary app-use reporting. The app ID is derived from the URL path.

To record selected feature use, call the global function with a fixed event name:

```js
globalThis.trackAppFeature?.('export_opened');
```

Use lowercase names separated with underscores. Keep a short documented list for each app. Do not
construct event names from user input and never send filenames, image details, search text, puzzle
contents, account information, or other user data.

Optional chaining is intentional: analytics being unavailable must never stop the app.

Localhost and private-network use is not reported.

## Request contract

An app hit has the existing shape:

```json
{
  "app_id": "sudoku",
  "referrer": "",
  "viewport_width": 1024
}
```

A feature event adds one field:

```json
{
  "app_id": "sudoku",
  "referrer": "",
  "viewport_width": 1024,
  "event": "photo_import_opened"
}
```

For Sudoku, the current events are:

- `photo_import_opened`
- `photo_import_confirmed`
- `photo_import_cancelled`

Confirmed and cancelled are emitted only after a scan has populated the custom-entry grid.

## track.php handling

Treat the presence of a valid, non-empty `event` string as the request type discriminator:

```php
$event = $payload['event'] ?? null;
$event = is_string($event) ? trim($event) : null;
$isFeatureEvent = $event !== null && $event !== '';

if ($isFeatureEvent) {
    // Store one feature event. Do not increment/store an app hit here.
} else {
    // Store one ordinary app hit.
}
```

Validate event names before storage. A suitable conservative rule is:

```php
if ($isFeatureEvent && !preg_match('/^[a-z][a-z0-9_]{0,63}$/', $event)) {
    http_response_code(400);
    exit;
}
```

Continue applying the existing token validation, request-size limit, JSON validation, app-ID
validation, rate limiting, and error handling before either branch.

### Storage option A: one table

If all analytics requests share a table, add a nullable `event_name` column:

```sql
ALTER TABLE analytics_hits
  ADD COLUMN event_name VARCHAR(64) NULL;

CREATE INDEX analytics_hits_event_lookup
  ON analytics_hits (app_id, event_name, created_at);
```

Store `NULL` for app hits and the validated name for feature events. The request is still one row,
but reporting decides which population it belongs to:

```text
event_name IS NULL      -> app hit
event_name IS NOT NULL  -> feature event
```

Do not store an event row and then separately insert an app-hit row for the same request.

### Storage option B: separate tables

Existing app-hit storage can remain untouched, with feature requests written to a separate table:

```sql
CREATE TABLE analytics_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  app_id VARCHAR(255) NOT NULL,
  event_name VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  viewport_width INT NULL,
  referrer TEXT NULL,
  INDEX analytics_events_lookup (app_id, event_name, created_at)
);
```

This is the safest choice when the existing hit table or reporting code assumes every stored row is
an app hit. In `track.php`, branch before the existing app-hit insert.

## Reporting

With the single-table design, app hits must explicitly exclude feature events:

```sql
SELECT app_id, COUNT(*) AS app_hits
FROM analytics_hits
WHERE event_name IS NULL
  AND created_at >= :from_date
  AND created_at < :to_date
GROUP BY app_id
ORDER BY app_hits DESC;
```

Report feature events separately:

```sql
SELECT app_id, event_name, COUNT(*) AS event_count
FROM analytics_hits
WHERE event_name IS NOT NULL
  AND created_at >= :from_date
  AND created_at < :to_date
GROUP BY app_id, event_name
ORDER BY app_id, event_count DESC;
```

The separate-table design uses the existing app-hit query unchanged and runs the feature query
against `analytics_events`.

For the Sudoku photo-import funnel, a useful report is:

| Event | Meaning |
| --- | --- |
| `photo_import_opened` | User opened the image chooser |
| `photo_import_confirmed` | A scanned grid was corrected/accepted and started |
| `photo_import_cancelled` | A populated scanned grid was abandoned |

These are interaction counts, not unique-user counts. One person can open photo import more than
once, and no persistent user identifier is collected. Useful derived figures include:

```text
confirmation rate = confirmed / opened
abandonment rate  = cancelled / opened
```

Interpret these cautiously because closing the page, failed scans, and cancelling before a scan
populates the grid do not emit `photo_import_cancelled`.

## Deployment checklist

- Back up the analytics database before changing its schema.
- Update `track.php` to validate and classify the optional `event` field.
- Ensure the feature-event branch does not execute the app-hit insert.
- Update app-hit reports to exclude event rows if using one table.
- Add a separate feature-event report grouped by app and event name.
- Deploy `track.php` before deploying apps that send feature events.
- Verify one page load increases app hits by one.
- Verify one feature action increases only its feature count, not app hits.
- Verify malformed event names are rejected.
- Verify old copies of `analytics.js` still report ordinary app hits correctly.

