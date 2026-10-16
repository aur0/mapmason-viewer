import type { Feature, FeatureCollection, Polygon, LineString } from 'geojson';
import polygonClipping from 'polygon-clipping';

export type Coord = [number, number]; // longitude, latitude, WGS84
export const kinds = {
  stage: { name: 'Stage', color: '#ef927e', width: 26, depth: 16, height: 7, icon: 'music' },
  toilets: { name: 'Toilets', color: '#236985', width: 9, depth: 5, height: 2.6, icon: 'toilet' },
  food: { name: 'Food', color: '#e5ba6f', width: 10, depth: 6, height: 3, icon: 'utensils' },
  water: { name: 'Water', color: '#75b7c1', width: 3, depth: 3, height: 1.5, icon: 'droplet' },
  tent: { name: 'Tent', color: '#b8abd5', width: 12, depth: 10, height: 4, icon: 'tent' },
  medical: { name: 'Medical tent', color: '#b32235', width: 9, depth: 7, height: 3, icon: 'medical' },
  defib: { name: 'Defibrillator (AED)', color: '#087440', width: 1, depth: 1, height: 1.2, icon: 'heart-pulse' },
  camping: { name: 'Camping area', color: '#91b886', width: 80, depth: 60, height: 0, icon: 'camping' },
  parking: { name: 'Parking area', color: '#91b9d2', width: 80, depth: 60, height: 0, icon: 'parking' },
  restricted: { name: 'Restricted area', color: '#df9691', width: 60, depth: 40, height: 0, icon: 'restricted' },
  barrier: { name: 'Gate / barrier', color: '#dfac77', width: 6, depth: .5, height: 1.1, icon: 'barrier' },
  information: { name: 'Information point', color: '#91bed5', width: 3, depth: 3, height: 1.8, icon: 'information' },
  waste: { name: 'Waste / recycling', color: '#acb983', width: 3, depth: 2, height: 1.2, icon: 'waste' },
  showers: { name: 'Shower block', color: '#92c9cf', width: 12, depth: 5, height: 2.8, icon: 'showers' },
  entrance: { name: 'Entrance', color: '#94b9a0', width: 12, depth: 3, height: 4, icon: 'door' },
  marker: { name: 'Place', color: '#b6c792', width: 3, depth: 3, height: .2, icon: 'pin' },
  start: { name: 'Start', color: '#9ed6a0', width: 6, depth: 2, height: .2, icon: 'flag' },
  finish: { name: 'Finish', color: '#e3c185', width: 6, depth: 2, height: .2, icon: 'flag' },
  shaping: { name: 'Shaping point', color: '#c9b7e8', width: 1, depth: 1, height: 0, icon: 'route' },
  checkpoint: { name: 'Checkpoint', color: '#9fcbd2', width: 3, depth: 3, height: .2, icon: 'flag' },
} as const;
export type Kind = keyof typeof kinds;
export const areaKinds=['camping','parking','restricted'] as const;
export type AreaKind=typeof areaKinds[number];
export function isAreaKind(kind:string):kind is AreaKind{return areaKinds.some(area=>area===kind);}
export function isBoundaryTool(tool:string):boolean{return tool==='ground'||isAreaKind(tool);}
export type SiteObject = { id: string; kind: Kind; name: string; position: Coord; width: number; depth: number; height: number; rotation: number; hasDefib?: boolean; outline?: Coord[] }; // outline: normalized local XY, not GPS
export type SitePath = { generatedBy?: 'road-trace'; id: string; name: string; width: number; points: Coord[]; curves?: number[] };
export type SiteArea = { id: string; name: string; rings: Coord[][]; height: number };
export type MapLayout = 'site' | 'route' | 'blank';
export type SiteGround={width:number;depth:number;rotation:number;position?:Coord;outline?:Coord[];curves?:number[]};
export type EventProject = { format: 'fieldwork-event'; version: 1; layout?: MapLayout; name: string; center: Coord; site: SiteGround; objects: SiteObject[]; paths: SitePath[]; areas: SiteArea[] };
export function newMapProject(layout:MapLayout,name:string,center:Coord):EventProject {
  return parseProject({format:'fieldwork-event',version:1,layout,name,center,site:{width:260,depth:220,rotation:0},objects:[],paths:[],areas:[]});
}
const R = 6371000;
export function offset(origin: Coord, east: number, north: number): Coord {
  const lat = origin[1] + north / R * 180 / Math.PI;
  const lon = origin[0] + east / (R * Math.cos(origin[1] * Math.PI / 180)) * 180 / Math.PI;
  return [((lon + 540) % 360) - 180, lat];
}
export function rectangle(center: Coord, width: number, depth: number, rotation: number): Coord[] {
  const a = rotation * Math.PI / 180;
  const points = [[-width / 2, -depth / 2], [width / 2, -depth / 2], [width / 2, depth / 2], [-width / 2, depth / 2]].map(([x, y]) => offset(center, x * Math.cos(a) + y * Math.sin(a), -x * Math.sin(a) + y * Math.cos(a)));
  return [...points, points[0]];
}
export function objectTypeLabel(o: Pick<SiteObject,'kind'|'hasDefib'>): string {
  return o.kind==='medical'&&o.hasDefib?'First aid + AED / defibrillator':kinds[o.kind].name;
}
export function newObject(kind: Kind, position: Coord): SiteObject {
  const def = kinds[kind]; return { id: crypto.randomUUID(), kind, name: def.name, position, width: def.width, depth: def.depth, height: def.height, rotation: 0 };
}
function validateOutline(points: Coord[]) {
  if(points.length<3 || points.length>200 || points.some(p=>!Array.isArray(p) || p.length!==2 || p.some(v=>typeof v!=='number' || !Number.isFinite(v) || Math.abs(v)>.500001)))throw new Error('Area boundaries need 3–200 normalized points.');
  const cross=(a:Coord,b:Coord,c:Coord)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const on=(a:Coord,b:Coord,c:Coord)=>Math.abs(cross(a,b,c))<1e-10 && c[0]>=Math.min(a[0],b[0])-1e-10 && c[0]<=Math.max(a[0],b[0])+1e-10 && c[1]>=Math.min(a[1],b[1])-1e-10 && c[1]<=Math.max(a[1],b[1])+1e-10;
  let area=0;
  for(let i=0;i<points.length;i++) {
    const a=points[i],b=points[(i+1)%points.length];if(Math.hypot(a[0]-b[0],a[1]-b[1])<1e-8)throw new Error('Area boundary points must be distinct.');area+=a[0]*b[1]-a[1]*b[0];
    for(let j=i+1;j<points.length;j++) {
      if(j===i+1 || (i===0 && j===points.length-1))continue;
      const c=points[j],d=points[(j+1)%points.length];
      if((cross(a,b,c)*cross(a,b,d)<0 && cross(c,d,a)*cross(c,d,b)<0) || on(a,b,c) || on(a,b,d) || on(c,d,a) || on(c,d,b))throw new Error('Area boundary edges must not cross.');
    }
  }
  if(Math.abs(area)<1e-6)throw new Error('Draw an area with a visible interior.');
}
export function objectRing(o:Pick<SiteObject,'position'|'width'|'depth'|'rotation'|'outline'>):Coord[] {
  if(!o.outline)return rectangle(o.position,o.width,o.depth,o.rotation);
  const a=o.rotation*Math.PI/180;
  const ring=o.outline.map(([u,v])=>{const x=u*o.width,y=v*o.depth;return offset(o.position,x*Math.cos(a)+y*Math.sin(a),-x*Math.sin(a)+y*Math.cos(a));});
  return [...ring,ring[0]];
}
export function groundControlRing(project:EventProject):Coord[]{return objectRing({...project.site,position:project.site.position??project.center});}
export function groundRing(project:EventProject):Coord[]{
  const controls=groundControlRing(project);if(!project.site.curves?.some(n=>n>0))return controls;
  const origin=project.site.position??project.center,scaleX=Math.PI/180*R*Math.cos(origin[1]*Math.PI/180),scaleY=Math.PI/180*R;
  const points=controls.slice(0,-1).map(([lon,lat])=>[(lon-origin[0])*scaleX,(lat-origin[1])*scaleY] as Coord),ring:Coord[]=[];
  points.forEach((p,i)=>{
    const a=points[(i+points.length-1)%points.length],b=points[(i+1)%points.length],amount=project.site.curves?.[i]??0;
    const before=Math.hypot(a[0]-p[0],a[1]-p[1]),after=Math.hypot(b[0]-p[0],b[1]-p[1]);
    if(amount<=0||before<.01||after<.01){ring.push(p);return;}
    const trim=Math.min(before,after)*.45*amount,entry:Coord=[p[0]+(a[0]-p[0])*trim/before,p[1]+(a[1]-p[1])*trim/before],exit:Coord=[p[0]+(b[0]-p[0])*trim/after,p[1]+(b[1]-p[1])*trim/after];
    ring.push(entry);const steps=Math.max(4,Math.min(16,Math.ceil(Math.sqrt(trim/.15))));
    for(let j=1;j<=steps;j++){const t=j/steps,s=1-t;ring.push([s*s*entry[0]+2*s*t*p[0]+t*t*exit[0],s*s*entry[1]+2*s*t*p[1]+t*t*exit[1]]);}
  });
  const result=ring.map(([x,y])=>offset(origin,x,y));return [...result,result[0]];
}
export function groundFromPoints(points:Coord[],curves?:number[]):SiteGround{
  const area=areaFromPoints(points,'camping');
  if(curves && (curves.length!==area.outline!.length || curves.some(n=>!Number.isFinite(n)||n<0||n>1)))throw Error('Ground curve settings must match the boundary points and be between 0 and 1.');
  return {position:area.position,width:area.width,depth:area.depth,rotation:0,outline:area.outline,...(curves?{curves}:{})};
}
export function campingFromPoints(points:Coord[]):SiteObject {return areaFromPoints(points,'camping');}
export function areaFromPoints(points:Coord[],kind:AreaKind):SiteObject {
  if(points.length<3 || points.length>200)throw new Error('Click at least three boundary points (maximum 200).');
  const origin=points[0],local=points.map(([lon,lat])=>[(lon-origin[0])*Math.PI/180*R*Math.cos(origin[1]*Math.PI/180),(lat-origin[1])*Math.PI/180*R] as Coord);
  if(local.length>3 && Math.hypot(...local.at(-1)!)<.05)local.pop();
  const xs=local.map(p=>p[0]),ys=local.map(p=>p[1]),west=Math.min(...xs),east=Math.max(...xs),south=Math.min(...ys),north=Math.max(...ys),width=east-west,depth=north-south;
  if(width<.5 || depth<.5 || width>2000 || depth>2000)throw new Error('Areas must span between 0.5 m and 2 km in each direction.');
  const cx=(west+east)/2,cy=(south+north)/2;
  const outline=local.map(([x,y])=>[Math.max(-.5,Math.min(.5,(x-cx)/width)),Math.max(-.5,Math.min(.5,(y-cy)/depth))] as Coord);validateOutline(outline);
  return {...newObject(kind,offset(origin,cx,cy)),width,depth,outline};
}
export function objectFeatures(project: EventProject, selected: string | null): FeatureCollection<Polygon> {
  return { type: 'FeatureCollection', features: project.objects.map(o => ({ type: 'Feature', id: o.id, properties: { id: o.id, kind: o.kind, color: kinds[o.kind].color, height: o.height, selected: o.id === selected }, geometry: { type: 'Polygon', coordinates: [objectRing(o)] } })) };
}
/** Rounded quadratic bends trim at most 45% of either neighbouring segment. */
export function pathCenterline(path: SitePath): Coord[] {
  if (!path.curves?.some(v => v > 0) || path.points.length < 3) return path.points;
  const origin = path.points[0];
  const local = path.points.map(([lon, lat]) => [(lon-origin[0])*Math.PI/180*R*Math.cos(origin[1]*Math.PI/180), (lat-origin[1])*Math.PI/180*R] as Coord);
  const line: Coord[] = [local[0]];
  for (let i = 1; i < local.length-1; i++) {
    const a = local[i-1], p = local[i], b = local[i+1], amount = path.curves[i] ?? 0;
    const before = Math.hypot(a[0]-p[0],a[1]-p[1]), after = Math.hypot(b[0]-p[0],b[1]-p[1]);
    if (amount <= 0 || before < .01 || after < .01) {line.push(p);continue;}
    const trim = Math.min(before,after)*.45*amount;
    const entry: Coord = [p[0]+(a[0]-p[0])*trim/before,p[1]+(a[1]-p[1])*trim/before];
    const exit: Coord = [p[0]+(b[0]-p[0])*trim/after,p[1]+(b[1]-p[1])*trim/after];
    line.push(entry);
    const steps = Math.max(4,Math.min(16,Math.ceil(Math.sqrt(trim/.15))));
    for(let j=1;j<=steps;j++){const t=j/steps,s=1-t;line.push([s*s*entry[0]+2*s*t*p[0]+t*t*exit[0],s*s*entry[1]+2*s*t*p[1]+t*t*exit[1]]);}
  }
  line.push(local.at(-1)!);
  return line.map(([x,y])=>offset(origin,x,y));
}
export function insertPathVertex(path: SitePath,index: number,at: Coord): SitePath {
  if(!Number.isInteger(index) || index<0 || index>path.points.length || path.points.length>=200)throw new Error('Cannot add another point here.');
  const points=[...path.points.slice(0,index),at,...path.points.slice(index)];
  return {...path,points,...(path.curves?{curves:[...path.curves.slice(0,index),0,...path.curves.slice(index)]}:{})};
}
export function removePathVertex(path: SitePath,index: number): SitePath {
  if(path.points.length<=2 || !Number.isInteger(index) || index<0 || index>=path.points.length)throw new Error('A path needs at least two points.');
  const points=path.points.filter((_,i)=>i!==index);
  const curves=path.curves?.filter((_,i)=>i!==index).map((v,i)=>i===0 || i===points.length-1?0:v);
  return {...path,points,...(curves?{curves}:{})};
}
/** Exactly coincident control points form editable geometric junctions. */
export function moveConnectedPathVertex(project:EventProject,id:string,index:number,at:Coord):EventProject {
  const source=project.paths.find(p=>p.id===id)?.points[index];if(!source)return project;
  return {...project,paths:project.paths.map(path=>{
    if(!path.points.some(p=>p[0]===source[0] && p[1]===source[1]))return path;
    return {...path,points:path.points.map(p=>p[0]===source[0] && p[1]===source[1]?at:p)};
  })};
}
export function pathFeatures(project: EventProject, selected: string | null): FeatureCollection<Polygon> {
  // Union metre-scale segments and round joins before converting back to GPS.
  // A single outline avoids both corner gaps and internal segment-border seams.
  const features: Feature<Polygon>[] = [];
  const linked = connectedPathIds(project, selected);
  for (const p of project.paths) {
    if (p.points.length < 2) continue;
    const origin = p.points[0], radius = p.width / 2;
    const points = pathCenterline(p).map(([lon, lat]) => [(lon - origin[0]) * Math.PI / 180 * R * Math.cos(origin[1] * Math.PI / 180), (lat - origin[1]) * Math.PI / 180 * R] as Coord)
      .filter((point, i, all) => i === 0 || Math.hypot(point[0] - all[i - 1][0], point[1] - all[i - 1][1]) > .001);
    if (points.length < 2) continue;
    const pieces: polygonClipping.Polygon[] = points.map(([x, y]) => {
      const ring: Coord[] = Array.from({ length: 24 }, (_, i) => [x + radius * Math.cos(i * Math.PI / 12), y + radius * Math.sin(i * Math.PI / 12)]);
      return [[...ring, ring[0]]];
    });
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
      const x = -dy / length * radius, y = dx / length * radius;
      const ring: Coord[] = [[a[0] + x, a[1] + y], [b[0] + x, b[1] + y], [b[0] - x, b[1] - y], [a[0] - x, a[1] - y], [a[0] + x, a[1] + y]];
      pieces.push([ring]);
    }
    // Snap sub-millimetre trig noise so tangent circle/rectangle edges match.
    const snapped = pieces.map(polygon => polygon.map(ring => ring.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000] as Coord)));
    const joined = polygonClipping.union(snapped[0], ...snapped.slice(1));
    for (const polygon of joined) features.push({ type: 'Feature', properties: { id: p.id, selected: linked.has(p.id) }, geometry: { type: 'Polygon', coordinates: polygon.map(ring => ring.map(([x, y]) => offset(origin, x, y))) } });
  }
  return { type: 'FeatureCollection', features };
}
export function connectedPathIds(project: EventProject, selected: string | null): Set<string> {
  const byPoint = new Map<string, string[]>();
  for (const path of project.paths) for (const point of path.points) {
    const key = JSON.stringify(point);
    byPoint.set(key, [...(byPoint.get(key) ?? []), path.id]);
  }
  const linked = new Set<string>(), pending = selected ? [selected] : [];
  const paths = new Map(project.paths.map(path => [path.id, path]));
  while (pending.length) {
    const id = pending.pop()!, path = paths.get(id);
    if (!path || linked.has(id)) continue;
    linked.add(id);
    for (const point of path.points) for (const other of byPoint.get(JSON.stringify(point)) ?? []) {
      if (!linked.has(other)) pending.push(other);
    }
  }
  return linked;
}
// Draw the outer border of the combined footprints, while retaining individual
// path features for hit testing and editing the clicked section.
export function pathOutlineFeatures(data: FeatureCollection<Polygon>): FeatureCollection<Polygon> {
  if (!data.features.length) return { type: 'FeatureCollection', features: [] };
  const origin = data.features[0].geometry.coordinates[0][0] as Coord;
  const scaleX = Math.PI / 180 * R * Math.cos(origin[1] * Math.PI / 180), scaleY = Math.PI / 180 * R;
  const polygons = data.features.map(f => f.geometry.coordinates.map(ring => ring.map(([lon, lat]) => [
    Math.round((lon - origin[0]) * scaleX * 1000) / 1000,
    Math.round((lat - origin[1]) * scaleY * 1000) / 1000,
  ] as Coord)));
  const joined = polygonClipping.union(polygons[0], ...polygons.slice(1));
  return { type: 'FeatureCollection', features: joined.map(polygon => ({
    type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: polygon.map(ring => ring.map(([x, y]) => offset(origin, x, y))) },
  })) };
}
export function gridFeatures(project: EventProject): FeatureCollection<LineString> {
  const scaleX=Math.PI/180*R*Math.cos(project.center[1]*Math.PI/180),scaleY=Math.PI/180*R;
  const ring=groundRing(project).slice(0,-1).map(([lon,lat])=>[(lon-project.center[0])*scaleX,(lat-project.center[1])*scaleY] as Coord);
  const features:Feature<LineString>[]=[];
  const contains=([x,y]:Coord)=>{
    let inside=false;
    for(let i=0,j=ring.length-1;i<ring.length;j=i++){
      const a=ring[j],b=ring[i],cross=(b[0]-a[0])*(y-a[1])-(b[1]-a[1])*(x-a[0]);
      if(Math.abs(cross)<1e-6 && x>=Math.min(a[0],b[0])-1e-7 && x<=Math.max(a[0],b[0])+1e-7 && y>=Math.min(a[1],b[1])-1e-7 && y<=Math.max(a[1],b[1])+1e-7)return true;
      if((a[1]>y)!==(b[1]>y) && x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;
    }
    return inside;
  };
  for(const axis of [0,1] as const){
    const other=axis===0?1:0,values=ring.map(p=>p[axis]);
    for(let fixed=Math.ceil((Math.min(...values)-1e-7)/10)*10;fixed<=Math.max(...values)+1e-7;fixed+=10){
      const intersections:number[]=[];
      for(let i=0;i<ring.length;i++){
        const a=ring[i],b=ring[(i+1)%ring.length],delta=b[axis]-a[axis];
        if(Math.abs(delta)<1e-9){if(Math.abs(fixed-a[axis])<1e-7)intersections.push(a[other],b[other]);continue;}
        const t=(fixed-a[axis])/delta;if(t>=-1e-9 && t<=1+1e-9)intersections.push(a[other]+Math.max(0,Math.min(1,t))*(b[other]-a[other]));
      }
      const cuts=intersections.sort((a,b)=>a-b).filter((n,i,all)=>i===0||Math.abs(n-all[i-1])>1e-7);
      const point=(n:number):Coord=>axis===0?[fixed,n]:[n,fixed];
      for(let i=1;i<cuts.length;i++){
        if(cuts[i]-cuts[i-1]<1e-7 || !contains(point((cuts[i]+cuts[i-1])/2)))continue;
        features.push({type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[point(cuts[i-1]),point(cuts[i])].map(([x,y])=>offset(project.center,x,y))}});
      }
    }
  }
  return {type:'FeatureCollection',features};
}
export function sampleProject(): EventProject {
  const center: Coord = [-2.6403, 51.4492];
  const item = (kind: Kind, name: string, x: number, y: number, extra: Partial<SiteObject> = {}) => ({ ...newObject(kind, offset(center, x, y)), name, ...extra });
  return { format: 'fieldwork-event', version: 1, name: 'Meadow Sessions', center, site: { width: 260, depth: 220, rotation: 0 }, areas: [], objects: [
    item('stage', 'Meadow stage', 0, 65, { width: 34, depth: 20, height: 8 }),
    item('tent', 'The little tent', -78, 30, { width: 22, depth: 18, height: 6, rotation: 20 }),
    item('food', 'Good food', 73, 15, { width: 16, depth: 8, rotation: -90 }),
    item('toilets', 'Toilets', 80, -45, { rotation: -90 }),
    item('water', 'Drinking water', 55, -35),
    item('medical', 'First aid', -65, -43),
    item('entrance', 'South entrance', 0, -92, { width: 18, depth: 4, height: 4 }),
  ], paths: [{ id: crypto.randomUUID(), name: 'Main walkway', width: 6, points: [offset(center, 0, -92), offset(center, 0, 0), offset(center, 0, 50)] }, { id: crypto.randomUUID(), name: 'Cross-site path', width: 4, points: [offset(center, -78, 10), offset(center, 0, 0), offset(center, 70, -15), offset(center, 80, -45)] }] };
}
export function parseProject(value: unknown): EventProject {
  const fail = (message: string): never => { throw new Error(message); };
  const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : fail('Expected a project object.');
  const num = (v: unknown, min: number, max: number): number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fail(`Expected a number between ${min} and ${max}.`);
  const text = (v: unknown): string => typeof v === 'string' && v.trim().length > 0 && v.length <= 100 && !/[\x00-\x1f]/.test(v) ? v : fail('Names must contain 1–100 printable characters.');
  const coord = (v: unknown): Coord => Array.isArray(v) && v.length === 2 ? [num(v[0], -180, 180), num(v[1], -80, 80)] : fail('Invalid GPS coordinates.');
  const p = obj(value);
  if (p.format !== 'fieldwork-event' || p.version !== 1) fail('Choose a MapMason event JSON file (version 1).');
  if (!Array.isArray(p.objects) || p.objects.length > 500 || !Array.isArray(p.paths) || p.paths.length > 200) fail('Maximum 500 objects and 200 paths per event.');
  const site = obj(p.site);
  const result: EventProject = { format: 'fieldwork-event', version: 1, name: text(p.name), center: coord(p.center), site: { width: num(site.width, site.outline!=null?.5:10, 2000), depth: num(site.depth, site.outline!=null?.5:10, 2000), rotation: num(site.rotation, -360, 360) },
    objects: (p.objects as unknown[]).map(v => { const o = obj(v); if (typeof o.kind !== 'string' || !Object.hasOwn(kinds, o.kind)) fail('Unknown object type.');
      let outline:Coord[]|undefined;if(o.outline!=null){if(!isAreaKind(String(o.kind)) || !Array.isArray(o.outline))fail('Custom boundaries are supported for camping, parking and restricted areas.');outline=(o.outline as unknown[]).map(p=>{if(!Array.isArray(p) || p.length!==2)fail('Invalid area boundary point.');return [num((p as unknown[])[0],-.5,.5),num((p as unknown[])[1],-.5,.5)] as Coord;});validateOutline(outline);}
      if(o.hasDefib!==undefined && typeof o.hasDefib!=='boolean')fail('Defibrillator availability must be true or false.');
      if(o.hasDefib===true && o.kind!=='medical')fail('Defibrillator availability is only supported on first aid points.');
      const height=num(o.height,0,100),max=isAreaKind(String(o.kind))?2000:500;return { id: text(o.id), name: text(o.name), kind: o.kind as Kind, position: coord(o.position), width: num(o.width, .5, max), depth: num(o.depth, .5, max), height: isAreaKind(String(o.kind))?0:height, rotation: num(o.rotation, -360, 360),...(outline?{outline}:{}),...(o.kind==='medical' && o.hasDefib!==undefined?{hasDefib:o.hasDefib as boolean}:{}) }; }),
    paths: (p.paths as unknown[]).map(v => { const path = obj(v); if (!Array.isArray(path.points) || path.points.length < 2 || path.points.length > 200) fail('Paths need 2–200 points.');
      const points=(path.points as unknown[]).map(coord);let curves: number[] | undefined;
      if(path.curves!==undefined){if(!Array.isArray(path.curves) || path.curves.length!==points.length)fail('Curve settings must match the path points.');curves=(path.curves as unknown[]).map(v=>num(v,0,1));if(curves[0]!==0 || curves.at(-1)!==0)fail('Only interior path points can be curved.');}
      if(path.generatedBy!==undefined && path.generatedBy!=='road-trace')fail('Unknown generated path source.');
      return { ...(path.generatedBy==='road-trace'?{generatedBy:'road-trace' as const}:{}), id: text(path.id), name: text(path.name), width: num(path.width, .5, 30), points,...(curves?{curves}:{}) }; }),
    areas: [] };
  if(site.position!=null)result.site.position=coord(site.position);
  if(site.outline!=null){if(!Array.isArray(site.outline))fail('Invalid ground boundary.');const outline=(site.outline as unknown[]).map(p=>{if(!Array.isArray(p)||p.length!==2)fail('Invalid ground boundary point.');return [num((p as unknown[])[0],-.5,.5),num((p as unknown[])[1],-.5,.5)] as Coord;});validateOutline(outline);result.site.outline=outline;}
  if(site.curves!=null){if(!Array.isArray(site.curves)||site.curves.length!==(result.site.outline?.length??4))fail('Ground curve settings must match the boundary points.');result.site.curves=(site.curves as unknown[]).map(n=>num(n,0,1));}
  if(p.layout!==undefined){if(typeof p.layout!=='string' || !['site','route','blank'].includes(p.layout))fail('Unknown map layout.');result.layout=p.layout as MapLayout;}
  if (p.areas !== undefined && (!Array.isArray(p.areas) || p.areas.length > 200)) fail('Maximum 200 imported areas.');
  result.areas = ((p.areas ?? []) as unknown[]).map(v => {
    const a = obj(v); if (!Array.isArray(a.rings) || !a.rings.length || a.rings.length > 50) fail('An area needs an outer ring and optional holes.');
    let vertices = 0;
    const rings = (a.rings as unknown[]).map(r => { if (!Array.isArray(r) || r.length < 4) fail('Area rings must contain at least four coordinates.'); const ring = (r as unknown[]).map(coord); vertices += ring.length; if (vertices > 2000) fail('Maximum 2,000 points per area.'); if (ring[0][0] !== ring.at(-1)![0] || ring[0][1] !== ring.at(-1)![1]) fail('Area rings must be closed.'); return ring; });
    return { id: text(a.id), name: text(a.name), height: num(a.height, 0, 100), rings };
  });
  const ids = [...result.objects, ...result.paths, ...result.areas].map(o => o.id); if (new Set(ids).size !== ids.length) fail('Object, area and path IDs must be unique.');
  return result;
}
export function relocate(project: EventProject, center: Coord): EventProject {
  const move = (c: Coord): Coord => offset(center, (c[0] - project.center[0]) * Math.PI / 180 * R * Math.cos(project.center[1] * Math.PI / 180), (c[1] - project.center[1]) * Math.PI / 180 * R);
  return { ...project, center, site:{...project.site,...(project.site.position?{position:move(project.site.position)}:{})}, objects: project.objects.map(o => ({ ...o, position: move(o.position) })), paths: project.paths.map(p => ({ ...p, points: p.points.map(move) })), areas: project.areas.map(a => ({ ...a, rings: a.rings.map(ring => ring.map(move)) })) };
}
