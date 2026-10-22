import type { Feature, FeatureCollection } from 'geojson';
import { isBoundaryTool, type Coord,type PathType } from './model';

export const DRAFT_PATH_ID='__unfinished_path__';
export function connectDraftPath(points:Coord[],heights:number[],types:PathType[],at:Coord,segment:number,nextType:PathType){
  const next=[...points],levels=points.map((_,index)=>heights[index]??0),sections=points.slice(1).map((_,index)=>types[index]??'standard');
  let junction=next.findIndex(point=>point[0]===at[0]&&point[1]===at[1]);
  if(junction<0){
    const index=Math.max(0,Math.min(next.length-2,segment)),a=next[index],b=next[index+1],cos=Math.cos(at[1]*Math.PI/180),dx=(b[0]-a[0])*cos,dy=b[1]-a[1],length=dx*dx+dy*dy,t=length?Math.max(0,Math.min(1,((at[0]-a[0])*cos*dx+(at[1]-a[1])*dy)/length)):0;
    junction=index+1;next.splice(junction,0,at);levels.splice(junction,0,levels[index]+(levels[index+1]-levels[index])*t);sections.splice(index,0,sections[index]);
  }
  if(junction!==next.length-1){next.push(next[junction]);levels.push(levels[junction]);sections.push(nextType);}
  if(next.length>200)throw new Error('A path can have at most 200 points, including its junctions.');
  return {points:next,heights:levels,types:sections};
}

export function segmentLengthLabel(a:Coord,b:Coord):string{
  const radians=Math.PI/180,dLat=(b[1]-a[1])*radians,dLon=(b[0]-a[0])*radians;
  const h=Math.sin(dLat/2)**2+Math.cos(a[1]*radians)*Math.cos(b[1]*radians)*Math.sin(dLon/2)**2;
  const metres=2*6371000*Math.asin(Math.sqrt(Math.min(1,Math.max(0,h))));
  return metres>=1000?`${(metres/1000).toFixed(2)} km`:`${Number(metres.toFixed(1))} m`;
}

export function drawingPreview(tool:string,points:Coord[],cursor:Coord|null,extensionOrigin?:Coord,types?:PathType[],nextType:PathType='standard'):{draft:FeatureCollection;preview:FeatureCollection}{
  const draft:Feature[]=[],preview:Feature[]=[],boundary=isBoundaryTool(tool);
  if(tool!=='path'&&tool!=='wall'&&tool!=='bridge'&&tool!=='underpass'&&!boundary&&!tool.startsWith('extend-'))return {draft:{type:'FeatureCollection',features:[]},preview:{type:'FeatureCollection',features:[]}};
  const same=(a:Coord,b:Coord)=>a[0]===b[0]&&a[1]===b[1];
  const origin=extensionOrigin??points.at(-1);
  if(origin&&cursor&&!same(origin,cursor))preview.push({type:'Feature',properties:{segmentType:tool==='wall'?'wall':tool==='bridge'?'bridge':tool==='underpass'?'underpass':nextType},geometry:{type:'LineString',coordinates:[origin,cursor]}});
  if(points.length>1){
    if(tool==='wall')draft.push({type:'Feature',properties:{segmentType:'wall'},geometry:{type:'LineString',coordinates:points}});
    else if(tool==='bridge'||tool==='underpass')for(let index=1;index<points.length;index++)draft.push({type:'Feature',properties:{segmentType:tool},geometry:{type:'LineString',coordinates:[points[index-1],points[index]]}});
    else if(tool==='path'&&types?.some(type=>type!=='standard'))for(let index=1;index<points.length;index++)draft.push({type:'Feature',properties:{segmentType:types[index-1]??'standard'},geometry:{type:'LineString',coordinates:[points[index-1],points[index]]}});
    else draft.push({type:'Feature',properties:{},geometry:{type:'LineString',coordinates:points}});
  }
  if(boundary&&points.length>=2){
    const outline=cursor&&!same(cursor,points[0])&&!same(cursor,points.at(-1)!)?[...points,cursor]:points;
    if(outline.length>=3){
      draft.push({type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[[...outline,outline[0]]]}});
      const end=cursor??points.at(-1)!;
      if(!same(end,points[0]))preview.push({type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[end,points[0]]}});
    }
  }
  for(const point of points)draft.push({type:'Feature',properties:{},geometry:{type:'Point',coordinates:point}});
  return {draft:{type:'FeatureCollection',features:draft},preview:{type:'FeatureCollection',features:preview}};
}
