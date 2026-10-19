import * as maplibregl from 'maplibre-gl';
import workerSource from 'maplibre-gl/dist/maplibre-gl-worker.mjs?raw';

const workerUrl=URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'}));
maplibregl.setWorkerUrl(workerUrl);
