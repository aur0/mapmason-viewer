# MapMason Viewer privacy

## Position and orientation

GPS coordinates, accuracy and phone orientation readings are processed in browser memory for the position marker, camera and routing. This viewer does not send those readings to a MapMason endpoint or save them in localStorage, cookies or a database. GPS fixes expire from route selection after 60 seconds without an update. A current fix can remain inside the browser's map control while it is active. Closing the page ends its browser watches. Browser/OS location services have their own behaviour and privacy policies.

The project JSON contains the organiser's published event coordinates, paths and places. Those are map content, not live visitor GPS data.

## Network activity

- A hosted page downloads its HTML, JavaScript, CSS and, for directory exports, map.json from the host. The host can see normal request metadata such as IP address, URL and user agent.
- If backgroundMap is enabled, MapLibre requests tiles and font glyphs from tiles.openfreemap.org. Requests disclose the viewed map area; following GPS can therefore reveal the visitor's approximate area to that provider. Map attribution links lead to their respective providers if clicked.
- If terrain is enabled and the visitor switches to 3D, MapLibre requests elevation tiles from tiles.mapterhorn.com. Requests disclose the viewed map area; Mapterhorn attribution links lead to its source credits.
- GPS routing and place search use the embedded map data locally. The viewer does not call a routing or geocoding API.
- QR codes are generated locally from the current page URL, without a QR service. The viewer does not append GPS readings to the URL. Existing URL query parameters remain part of the shared URL.
- Copying a map link uses the clipboard. Opening the source link visits GitHub; it sends no GPS parameters.
- The viewer has no telemetry, analytics, advertising, location-sharing endpoint or service worker. A hosting site can separately inject code, headers or a service worker; audit the actual deployment as well as this repository.

With backgroundMap:false and terrain:false, event geometry, symbols, labels, routes and QR generation work without external map tile/font requests. A hosted directory still needs its own static files to load. A fully inlined HTML includes those assets.

## Verify rather than assume

Use the committed source, pinned dependencies, build manifest, export verifier and browser Network tools. Published source does not by itself establish that a host serves an unchanged build. See README.md for the scope and limitations of the verification. This document describes this viewer; forks and third-party hosts may behave differently.
