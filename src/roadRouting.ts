import type { Feature, LineString, MultiLineString } from 'geojson';
import { createPathNetwork, shortestRoute } from './routing';
import type { Coord, EventProject, SitePath, SiteObject } from './model';

export function traceRoadRoute(project: EventProject, features: Feature[]): SitePath[] {
  const starts=project.objects.filter(o=>o.kind==='start'), finishes=project.objects.filter(o=>o.kind==='finish');
  if(starts.length!==1 || finishes.length!==1)throw new Error('Place exactly one Start and one Finish first.');
  const stops=[starts[0],finishes[0]];
  const roads:SitePath[]=[];
  for(const feature of features){
    if(['rail','ferry','aerialway'].includes(String(feature.properties?.class)))continue;
    if(!['LineString','MultiLineString'].includes(feature.geometry?.type))continue;
    const geometry=feature.geometry as LineString|MultiLineString;
    const lines=geometry.type==='LineString'?[geometry.coordinates]:geometry.coordinates;
    for(const line of lines)if(line.length>1)roads.push({id:`road-${roads.length}`,name:'Road',width:4,points:line.map(p=>[p[0],p[1]] as Coord)});
  }
  if(!roads.length)throw new Error('No road geometry loaded. Enable the reference map, zoom in, and wait for roads to load.');
  if(roads.reduce((n,p)=>n+p.points.length,0)>100000)throw new Error('Too much road geometry. Zoom in for this simple test.');
  const network=createPathNetwork({...project,paths:roads}),result:SitePath[]=[];
  const cache=new Map<string,ReturnType<typeof shortestRoute>>();
  const between=(a:SiteObject,b:SiteObject)=>{const key=a.id+'>'+b.id;let route=cache.get(key);if(!route){route=shortestRoute(network,a.position,b.position);cache.set(key,route);}return route;};
  const incoming=(points:Coord[]):[Coord,Coord]|undefined=>{const last=points.at(-1)!;for(let i=points.length-2;i>=0;i--)if(Math.hypot(points[i][0]-last[0],points[i][1]-last[1])>1e-10)return [points[i],last];};
  const onward=(from:SiteObject,to:SiteObject,previous:Coord[])=>{try{return shortestRoute(network,from.position,to.position,from.kind==='shaping'?incoming(previous):undefined);}catch{return between(from,to);}};
  const shapes=project.objects.filter(o=>o.kind==='shaping'||o.kind==='checkpoint').sort((a,b)=>a.position[0]-b.position[0]||a.position[1]-b.position[1]||a.id.localeCompare(b.id));
  for(const shape of shapes){
    let best=Infinity,insert=-1;
    for(let i=1;i<stops.length;i++)try{
      const first=between(stops[i-1],shape),second=onward(shape,stops[i],first.points);
      const extra=first.distance+second.distance-between(stops[i-1],stops[i]).distance;
      if(extra<best){best=extra;insert=i;}
    }catch{}
    if(insert<0)throw new Error('Could not connect '+shape.name+' to the loaded road network. Move it closer to a road or load more of the map.');
    stops.splice(insert,0,shape);
  }
  let previousPoints:Coord[]=[];
  for(let leg=1;leg<stops.length;leg++){
    let points:Coord[];
    try { points=onward(stops[leg-1],stops[leg],previousPoints).points; }
    catch {throw new Error(`Could not connect ${stops[leg-1].name} to ${stops[leg].name} using loaded roads. Keep both near roads and zoom/pan to load the whole leg, or draw it manually.`);}
    previousPoints=points;
    // Preserve every road vertex, splitting long results at the editor's size limit.
    for(let start=0;start<points.length-1;start+=199)result.push({id:crypto.randomUUID(),generatedBy:'road-trace',name:`Road route leg ${leg}`,width:4,points:points.slice(start,start+200)});
  }
  if(project.paths.filter(p=>p.generatedBy!=='road-trace').length+result.length>200)throw new Error('The road result exceeds the map path limit. Try a shorter route.');
  return result;
}
