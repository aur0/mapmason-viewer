import type { Map, StyleSpecification } from 'maplibre-gl';

export type ReferenceMapStyle = 'light' | 'dark';

const styleUrls: Record<ReferenceMapStyle, string> = {
  light: 'https://tiles.openfreemap.org/styles/bright',
  dark: 'https://tiles.openfreemap.org/styles/dark',
};

export const referenceGlyphs = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';

export function addReferenceMap(map: Map, style: ReferenceMapStyle, onReady: () => void) {
  map.once('style.load', onReady);
  map.setStyle(styleUrls[style], {
    diff: true,
    transformStyle: (previous, next) => {
      const applicationLayers = previous?.layers ?? [];
      const background = applicationLayers.find(layer => layer.id === 'mapmason-background' || layer.id === 'background');
      const overlays = applicationLayers.filter(layer => layer.id !== 'mapmason-background' && layer.id !== 'background' && !layer.id.startsWith('reference-'));
      const referenceLayers = next.layers.map(layer => {
        const copy = { ...layer, id: `reference-${layer.id}`, metadata: { ...(typeof layer.metadata === 'object' && layer.metadata ? layer.metadata : {}), mapmasonVisible: layer.layout?.visibility !== 'none' } } as typeof layer & { ref?: string };
        if (copy.ref) copy.ref = `reference-${copy.ref}`;
        return copy;
      });
      return {
        ...next,
        terrain: previous?.terrain ?? next.terrain,
        sources: { ...(previous?.sources ?? {}), ...next.sources },
        layers: [
          ...(background ? [{ ...background, id: 'mapmason-background' } as typeof background] : []),
          ...referenceLayers,
          ...overlays,
        ],
      } as StyleSpecification;
    },
  });
}

export function updateReferenceMap(map: Map, visible: boolean, mode: '2d' | '3d') {
  for (const layer of map.getStyle().layers) {
    if (!layer.id.startsWith('reference-') || !map.getLayer(layer.id)) continue;
    const sourceVisible = (layer.metadata as { mapmasonVisible?: boolean } | undefined)?.mapmasonVisible !== false;
    const buildingLayer = layer.id.toLowerCase().includes('building') && (layer.type === 'fill' || layer.type === 'fill-extrusion');
    const modeVisible = !buildingLayer || (layer.type === 'fill-extrusion' ? mode === '3d' : mode === '2d');
    map.setLayoutProperty(layer.id, 'visibility', visible && sourceVisible && modeVisible ? 'visible' : 'none');
  }
}
