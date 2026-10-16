# MapMason Viewer

The open-source, read-only viewer used by MapMason website exports. It displays event maps in 2D/3D, finds places, calculates routes locally, and optionally uses GPS and phone orientation. Official exports retain **Made with MapMason** branding; the designer currently has no unbranded export option.

## What is open source?

This repository contains the viewer and its shared map renderer, geometry/model helpers, icons, routing and sensor code. The shared renderer also contains editing primitives because the designer uses the same renderer. It does **not** contain the designer screens, project library, export workflow, AI server, deployment configuration or credentials. Those remain in the private designer repository.

Code here is MIT licensed; see LICENSE. Third-party dependencies retain their own licences. The licence permits modification and redistribution, including branding changes. This does not change the branding on official exports. Event content, customer logos and background map data are not relicensed by the software licence.

## Build

Use Node.js **22.23.3** and the committed npm lockfile.

```sh
npm ci --ignore-scripts
npm test
npm run build
```

Output: public/website-template/. index.html expects a neighbouring map.json with { project, accent, backgroundMap }. single.html is the standalone template: replace __FIELDWORK_MAP_DATA__ with that JSON, escaping < as \u003c. The historical fieldwork-event data format remains supported for existing maps.

Development preview: put a sample map.json in viewer/ and run npm run dev. An exported map.json from MapMason works. Do not commit personal or confidential event data. GPS requires a browser secure context (normally HTTPS or localhost).

## Check a hosted/exported build

Every build writes build-manifest.json with a SHA-256 digest of the readable viewer source and hashes of its JavaScript/CSS. The same metadata is embedded in exported HTML as viewer-build-info. The hash covers the viewer source, source file list and build script, with LF-normalized source. It identifies code, not event content.

Check out the corresponding source revision and run a clean build using the pinned dependencies. Then download the hosted single HTML or the full extracted website directory:

```sh
npm run verify -- path/to/downloaded-map.html
npm run verify -- path/to/extracted-website
```

The verifier compares actual JavaScript/CSS with your **local build**, not hashes supplied by the downloaded map. The map name, geometry, logo and colours can differ. For HTML it also checks for exactly one bundled module script. This is an asset comparison, not a complete security audit: inspect host HTML, extra resources, service workers, HTTP headers and network activity separately. Matching self-reported metadata alone is not proof. Builds have been compared locally on Windows; use the same Node version and lockfile when comparing. Other OS/toolchain versions have not been claimed byte-identical.

Open browser developer tools, preserve the Network log, and exercise GPS, sensors, routes, search and sharing. With backgroundMap:false there should be no tile/font requests. With a background enabled, the provider receives requests for the viewed area. See PRIVACY.md.

## Important files

- src/viewer.tsx: viewer UI, GPS state and local route selection.
- src/MapCanvas.tsx: shared rendering engine and browser GPS control.
- src/phoneSensors.ts: browser orientation sensors.
- src/routing.ts: local path graph and routing.
- src/siteGps.ts: site ground boundary check.
- src/referenceMap.ts and reference-map.json: optional OpenFreeMap background.
- src/ShareMap.tsx: locally generated sharing QR code and privacy/source links.
- viewer/source-files.json: exact viewer source file list used for the source digest.

The viewer has no location-sharing backend, analytics or account system. It does not provide emergency dispatch or a guarantee that a route is physically accessible. Site content, facility availability and paths must be maintained by the event organiser.
