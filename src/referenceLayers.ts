import type { ReferenceLayer } from './model';
export function referenceFeatures(layers:ReferenceLayer[]=[]):GeoJSON.FeatureCollection{
  return {type:'FeatureCollection',features:layers.filter(l=>l.visible).flatMap(layer=>{
    const properties={opacity:layer.opacity,layerName:layer.name};
    return [
      ...layer.points.map(p=>({type:'Feature' as const,properties:{...properties,name:p.name},geometry:{type:'Point' as const,coordinates:p.position}})),
      ...layer.lines.map(p=>({type:'Feature' as const,properties:{...properties,name:p.name},geometry:{type:'LineString' as const,coordinates:p.points}})),
      ...layer.polygons.map(p=>({type:'Feature' as const,properties:{...properties,name:p.name},geometry:{type:'Polygon' as const,coordinates:p.rings}}))
    ] as GeoJSON.Feature[];
  })};
}
