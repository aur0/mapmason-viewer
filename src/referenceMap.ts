import type { Map, LayerSpecification, StyleSpecification } from 'maplibre-gl';
import nightScannerStyle from './reference-map.json';

// Snapshot of Night Scanner's basemap. Exclude its location-sharing overlay.
const style = nightScannerStyle as unknown as StyleSpecification;
const layers = style.layers.filter(layer => layer.type === 'background' || ('source' in layer && layer.source === 'openmaptiles'));

export const referenceGlyphs = style.glyphs;

export function addReferenceMap(map: Map, beforeId?: string) {
  map.addSource('openmaptiles', style.sources.openmaptiles);
  for (const layer of layers) {
    map.addLayer({ ...layer, id: `reference-${layer.id}` } as LayerSpecification, beforeId);
  }
}

export function updateReferenceMap(map: Map, visible: boolean, mode: '2d' | '3d') {
  for (const layer of layers) {
    const enabled = layer.id === 'buildings-flat' ? mode === '2d'
      : layer.id === 'buildings-3d' ? mode === '3d'
      : layer.layout?.visibility !== 'none';
    map.setLayoutProperty(`reference-${layer.id}`, 'visibility', visible && enabled ? 'visible' : 'none');
  }
}
