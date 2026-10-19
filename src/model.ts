import type { Feature, FeatureCollection, Polygon, LineString } from 'geojson';
import polygonClipping from 'polygon-clipping';
import {parsePolyModel,type PolyModel} from './polyModel';

export type Coord = [number, number]; // longitude, latitude, WGS84
export const kinds = {
  stage: { name: 'Stage', color: '#ef927e', width: 26, depth: 16, height: 7, icon: 'music' },
  toilets: { name: 'Toilets', color: '#236985', width: 9, depth: 5, height: 2.6, icon: 'toilet' },
  food: { name: 'Food', color: '#e5ba6f', width: 10, depth: 6, height: 3, icon: 'utensils' },
  water: { name: 'Water', color: '#75b7c1', width: 3, depth: 3, height: 1.5, icon: 'droplet' },
  waterArea: { name: 'Water area', color: '#69afcf', width: 40, depth: 25, height: 0, icon: 'waves' },
  tent: { name: 'Tent', color: '#b8abd5', width: 12, depth: 10, height: 4, icon: 'tent' },
  tree: { name: 'Tree', color: '#63894e', width: 7, depth: 7, height: 9, icon: 'tree' },
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
  custom: { name: 'Custom model', color: '#8c9fc7', width: 3, depth: 3, height: 3, icon: 'box' },
  scenery: { name: 'Scenery', color: '#63894e', width: 3, depth: 3, height: 3, icon: 'trees' },
  start: { name: 'Start', color: '#9ed6a0', width: 6, depth: 2, height: .2, icon: 'flag' },
  finish: { name: 'Finish', color: '#e3c185', width: 6, depth: 2, height: .2, icon: 'flag' },
  shaping: { name: 'Shaping point', color: '#c9b7e8', width: 1, depth: 1, height: 0, icon: 'route' },
  checkpoint: { name: 'Checkpoint', color: '#9fcbd2', width: 3, depth: 3, height: .2, icon: 'flag' },
} as const;
export type Kind = keyof typeof kinds;
export const areaKinds=['camping','parking','restricted','waterArea'] as const;
export type AreaKind=typeof areaKinds[number];
export function isAreaKind(kind:string):kind is AreaKind{return areaKinds.some(area=>area===kind);}
export function isBoundaryTool(tool:string):boolean{return tool==='ground'||isAreaKind(tool);}
export type SiteObject = { id: string; kind: Kind; name: string; position: Coord; width: number; depth: number; height: number; rotation: number; treeStyle?:number; hasDefib?: boolean; outline?: Coord[];customModelId?:string;customModel?:PolyModel }; // outline: normalized local XY, not GPS
export const pathTypes={standard:'Standard path',bridge:'Bridge / raised walkway',underpass:'Underpass'} as const;
export type PathType=keyof typeof pathTypes;
export const bridgePresets={simple:'Simple deck',railed:'Bridge with railings'} as const;
export type BridgeDesign=keyof typeof bridgePresets;
export const pathAccess={unknown:'Not specified',stepFree:'Step-free access',notStepFree:'Not step-free'} as const;
export type PathAccess=keyof typeof pathAccess;
export type SitePath = { generatedBy?: 'road-trace'; id: string; name: string; width: number; points: Coord[]; curves?: number[];segmentTypes?:PathType[];bridgeDesigns?:BridgeDesign[];heights?:number[];segmentAccess?:PathAccess[];pointAccess?:PathAccess[] };
export function pathSections(path:SitePath):{path:SitePath;type:PathType;start:number;end:number}[]{
  const sections:{path:SitePath;type:PathType;start:number;end:number}[]=[];
  const accessAt=(index:number):PathAccess=>path.segmentTypes?.[index]==='bridge'?(path.segmentAccess?.[index]??'unknown'):(path.pointAccess?.[index]==='notStepFree'&&path.pointAccess?.[index+1]==='notStepFree'?'notStepFree':'unknown');
  for(let start=0;start<path.points.length-1;){
    const type=path.segmentTypes?.[start]??'standard';let end=start+1;
    while(end<path.points.length-1&&(path.segmentTypes?.[end]??'standard')===type&&accessAt(end)===accessAt(start))end++;
    sections.push({type,start,end,path:{...path,segmentTypes:undefined,segmentAccess:undefined,pointAccess:undefined,heights:path.heights?.slice(start,end+1),points:path.points.slice(start,end+1),curves:path.curves?.slice(start,end+1).map((amount,index)=>index===0||index===end-start?0:amount)}});
    start=end;
  }
  return sections;
}
export function pathVertexLevel(path:SitePath,index:number):number{
  if(index===0||index===path.points.length-1)return 0;
  const before=path.segmentTypes?.[index-1]??'standard',after=path.segmentTypes?.[index]??'standard';
  return before!==after?0:before==='bridge'?1:before==='underpass'?-1:0;
}
export function pathVertexKey(path:SitePath,index:number):string{
  if(path.heights?.some(height=>height>0))return `height:${path.heights[index].toFixed(3)}`;
  const level=pathVertexLevel(path,index);
  return level===0?'height:0.000':`type:${level}`;
}
export function setPathPointHeight(project:EventProject,id:string,index:number,height:number):EventProject{
  if(!Number.isFinite(height)||height<0||height>100)throw new Error('Path height must be between 0 and 100 metres.');
  const source=project.paths.find(path=>path.id===id);if(!source?.points[index])return project;
  const at=source.points[index],key=pathVertexKey(source,index);
  return {...project,paths:project.paths.map(path=>{
    const matches=path.points.map((point,pointIndex)=>point[0]===at[0]&&point[1]===at[1]&&pathVertexKey(path,pointIndex)===key);
    return matches.some(Boolean)?{...path,heights:path.points.map((_,point)=>matches[point]?height:path.heights?.[point]??0)}:path;
  })};
}
export type SiteArea = { id: string; name: string; rings: Coord[][]; height: number };
export type SiteBridge = { id:string; name:string; width:number; height:number; rampLength?:number; wheelchairAccessible?:boolean; sourcePoints?:Coord[]; points:Coord[]; heights:number[]; design:BridgeDesign };
export function bridgePaths(bridges:SiteBridge[]=[]):SitePath[]{return bridges.map(bridge=>({id:bridge.id,name:bridge.name,width:bridge.width,points:bridge.points,heights:bridge.heights,segmentTypes:bridge.points.slice(1).map(()=>'bridge'),bridgeDesigns:bridge.points.slice(1).map(()=>bridge.design),segmentAccess:bridge.points.slice(1).map(()=>bridge.wheelchairAccessible?'stepFree':'notStepFree')}));}
export function bridgePathLength(points:Coord[]):number{
  if(points.length<2)return 0;
  const origin=points[0],cos=Math.cos(origin[1]*Math.PI/180),distance=(a:Coord,b:Coord)=>Math.hypot((b[0]-a[0])*R*Math.PI/180*cos,(b[1]-a[1])*R*Math.PI/180);
  return points.slice(1).reduce((sum,point,index)=>sum+distance(points[index],point),0);
}
export function bridgeRampProfile(sourcePoints:Coord[],height:number,rampLength:number):{points:Coord[];heights:number[]} {
  if(sourcePoints.length<2)return {points:sourcePoints,heights:sourcePoints.map(()=>0)};
  const origin=sourcePoints[0],cos=Math.cos(origin[1]*Math.PI/180),distance=(a:Coord,b:Coord)=>Math.hypot((b[0]-a[0])*R*Math.PI/180*cos,(b[1]-a[1])*R*Math.PI/180);
  const lengths=sourcePoints.slice(1).map((point,index)=>distance(sourcePoints[index],point)),total=lengths.reduce((sum,length)=>sum+length,0),rampDistance=Math.min(total*.45,Math.max(total*.02,rampLength));
  const cumulative:number[]=[0];lengths.forEach(length=>cumulative.push(cumulative.at(-1)!+length));
  const at=(target:number):Coord=>{let index=0;while(index<lengths.length-1&&cumulative[index+1]<target)index++;const segment=Math.max(.001,lengths[index]),fraction=Math.max(0,Math.min(1,(target-cumulative[index])/segment)),a=sourcePoints[index],b=sourcePoints[index+1];return [a[0]+(b[0]-a[0])*fraction,a[1]+(b[1]-a[1])*fraction];};
  const samples=sourcePoints.length<199?[{point:sourcePoints[0],along:0},{point:at(rampDistance),along:rampDistance},...sourcePoints.slice(1,-1).map((point,index)=>({point,along:cumulative[index+1]})),{point:at(total-rampDistance),along:total-rampDistance},{point:sourcePoints.at(-1)!,along:total}]:sourcePoints.map((point,index)=>({point,along:cumulative[index]}));
  samples.sort((a,b)=>a.along-b.along);
  const unique=samples.filter((sample,index)=>index===0||sample.along-samples[index-1].along>.01);
  return {points:unique.map(sample=>sample.point),heights:unique.map(({along})=>height*Math.max(0,Math.min(1,along/rampDistance,(total-along)/rampDistance)))};
}export type MapLayout = 'site' | 'route' | 'blank';
export type SiteGround={width:number;depth:number;rotation:number;position?:Coord;outline?:Coord[];curves?:number[]};
export type ReferenceLayer = { id:string;name:string;visible:boolean;opacity:number;points:{name:string;position:Coord}[];lines:{name:string;points:Coord[]}[];polygons:{name:string;rings:Coord[][]}[] };
export type EventProject = { format: 'fieldwork-event'; version: 1; layout?: MapLayout; name: string; center: Coord; site: SiteGround; objects: SiteObject[]; paths: SitePath[]; areas: SiteArea[]; bridges?:SiteBridge[];referenceLayers?:ReferenceLayer[] };
export function newMapProject(layout:MapLayout,name:string,center:Coord):EventProject {
  return parseProject({format:'fieldwork-event',version:1,layout,name,center,site:{width:260,depth:220,rotation:0},objects:[],paths:[],areas:[],bridges:[]});
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
export function objectRing(o:Pick<SiteObject,'position'|'width'|'depth'|'rotation'|'outline'> & {kind?:Kind}):Coord[] {
  if(o.kind==='tree'){
    const angle=o.rotation*Math.PI/180;
    const ring=Array.from({length:16},(_,index)=>{const phase=index/16*Math.PI*2,east=Math.cos(phase)*o.width/2,north=Math.sin(phase)*o.depth/2;return offset(o.position,east*Math.cos(angle)+north*Math.sin(angle),-east*Math.sin(angle)+north*Math.cos(angle));});
    return [...ring,ring[0]];
  }
  if(!o.outline)return rectangle(o.position,o.width,o.depth,o.rotation);
  const a=o.rotation*Math.PI/180;
  let outline=o.outline;
  if(o.kind==='waterArea'){
    const local=outline.map(([east,north])=>[east*o.width,north*o.depth] as Coord);
    outline=local.flatMap((point,index)=>{
      const previous=local[(index+local.length-1)%local.length],next=local[(index+1)%local.length];
      const before=Math.hypot(previous[0]-point[0],previous[1]-point[1]),after=Math.hypot(next[0]-point[0],next[1]-point[1]);
      if(before<.001||after<.001)return [[point[0]/o.width,point[1]/o.depth] as Coord];
      const trim=Math.min(before,after)*.35;
      const entry=[point[0]+(previous[0]-point[0])*trim/before,point[1]+(previous[1]-point[1])*trim/before];
      const exit=[point[0]+(next[0]-point[0])*trim/after,point[1]+(next[1]-point[1])*trim/after];
      const steps=Math.max(6,Math.min(24,Math.ceil(Math.sqrt(trim/.05))));
      return Array.from({length:steps+1},(_,step)=>{const amount=step/steps,inverse=1-amount;return [(inverse*inverse*entry[0]+2*inverse*amount*point[0]+amount*amount*exit[0])/o.width,(inverse*inverse*entry[1]+2*inverse*amount*point[1]+amount*amount*exit[1])/o.depth] as Coord;});
    });
  }
  const ring=outline.map(([u,v])=>{const x=u*o.width,y=v*o.depth;return offset(o.position,x*Math.cos(a)+y*Math.sin(a),-x*Math.sin(a)+y*Math.cos(a));});
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
  const features:Feature<Polygon>[]=[];
  for(const object of project.objects){
    const properties={id:object.id,kind:object.kind,color:kinds[object.kind].color,height:object.height,base:0,selected:object.id===selected,customModel:!!object.customModel};
    if(object.kind==='tree'){
      features.push({type:'Feature',id:object.id+'-trunk',properties:{...properties,color:'#866344',height:object.height*.6},geometry:{type:'Polygon',coordinates:[objectRing({...object,width:object.width*.12,depth:object.depth*.12})]}});
      const lobes=[{east:-.18,north:.06,width:.62,depth:.7,bottom:.4,top:.88,color:'#597d43'},{east:.18,north:.08,width:.62,depth:.62,bottom:.44,top:.93,color:'#6c914f'},{east:.02,north:-.19,width:.7,depth:.6,bottom:.36,top:.87,color:'#63894e'},{east:-.02,north:.03,width:.68,depth:.66,bottom:.52,top:1,color:'#7a9b58'}];
      const angle=object.rotation*Math.PI/180;
      lobes.forEach((lobe,index)=>{
        const east=lobe.east*object.width,north=lobe.north*object.depth;
        const position=offset(object.position,east*Math.cos(angle)+north*Math.sin(angle),-east*Math.sin(angle)+north*Math.cos(angle));
        for(let band=0;band<8;band++){
          const scale=Math.sqrt(1-Math.pow((band+.5)/8*2-1,2));
          const ring=objectRing({...object,position,width:object.width*lobe.width*scale,depth:object.depth*lobe.depth*scale}).filter((_,point)=>point%2===0);
          features.push({type:'Feature',id:`${object.id}-canopy-${index}-${band}`,properties:{...properties,color:lobe.color,base:object.height*(lobe.bottom+(lobe.top-lobe.bottom)*band/8),height:object.height*(lobe.bottom+(lobe.top-lobe.bottom)*(band+1)/8)},geometry:{type:'Polygon',coordinates:[ring]}});
        }
      });
    }else features.push({type:'Feature',id:object.id,properties,geometry:{type:'Polygon',coordinates:[objectRing(object)]}});
  }
  return {type:'FeatureCollection',features};
}
/** Rounded quadratic bends trim at most 45% of either neighbouring segment. */
export function pathCenterline(path: SitePath): Coord[] {
  return pathProfile(path).map(point=>point.position);
}
export function pathProfile(path:SitePath):{position:Coord;height:number;segment:number}[]{
  if (!path.curves?.some(v => v > 0) || path.points.length < 3) return path.points.map((position,index)=>({position,height:path.heights?.[index]??0,segment:Math.min(index,path.points.length-2)}));
  const origin = path.points[0];
  const local = path.points.map(([lon, lat]) => [(lon-origin[0])*Math.PI/180*R*Math.cos(origin[1]*Math.PI/180), (lat-origin[1])*Math.PI/180*R] as Coord);
  const line: Coord[] = [local[0]];
  const heights=[path.heights?.[0]??0],segments=[0];
  for (let i = 1; i < local.length-1; i++) {
    const a = local[i-1], p = local[i], b = local[i+1], amount = path.curves[i] ?? 0;
    const before = Math.hypot(a[0]-p[0],a[1]-p[1]), after = Math.hypot(b[0]-p[0],b[1]-p[1]);
    if (amount <= 0 || before < .01 || after < .01) {line.push(p);heights.push(path.heights?.[i]??0);segments.push(i);continue;}
    const trim = Math.min(before,after)*.45*amount;
    const entry: Coord = [p[0]+(a[0]-p[0])*trim/before,p[1]+(a[1]-p[1])*trim/before];
    const exit: Coord = [p[0]+(b[0]-p[0])*trim/after,p[1]+(b[1]-p[1])*trim/after];
    line.push(entry);
    const centerHeight=path.heights?.[i]??0,entryHeight=centerHeight+((path.heights?.[i-1]??0)-centerHeight)*trim/before,exitHeight=centerHeight+((path.heights?.[i+1]??0)-centerHeight)*trim/after;
    heights.push(entryHeight);segments.push(i-1);
    const steps = Math.max(4,Math.min(16,Math.ceil(Math.sqrt(trim/.15))));
    for(let j=1;j<=steps;j++){const t=j/steps,s=1-t;line.push([s*s*entry[0]+2*s*t*p[0]+t*t*exit[0],s*s*entry[1]+2*s*t*p[1]+t*t*exit[1]]);heights.push(s*s*entryHeight+2*s*t*centerHeight+t*t*exitHeight);segments.push(t<.5?i-1:i);}
  }
  line.push(local.at(-1)!);
  heights.push(path.heights?.at(-1)??0);segments.push(path.points.length-2);
  return line.map(([x,y],index)=>({position:offset(origin,x,y),height:heights[index],segment:segments[index]}));
}
export function bridgeSpanPath(selectedPoints:Coord[]):{points:Coord[];heights:number[];rampLength:number;sourcePoints:Coord[]} {
  const sourcePoints=selectedPoints,total=bridgePathLength(sourcePoints);
  if(sourcePoints.length<2)throw new Error('Select at least two points on the path.');
  if(total<1)throw new Error('The selected span is too short to create a bridge.');
  const height=Math.max(.2,Math.min(3,total*.04)),rampLength=Math.round(total*.1*10)/10,profile=bridgeRampProfile(sourcePoints,height,rampLength);
  return {...profile,rampLength,sourcePoints};
}export function insertPathVertex(path: SitePath,index: number,at: Coord,type?:PathType): SitePath {
  if(!Number.isInteger(index) || index<0 || index>path.points.length || path.points.length>=200)throw new Error('Cannot add another point here.');
  const points=[...path.points.slice(0,index),at,...path.points.slice(index)];
  const types=path.segmentTypes??path.points.slice(1).map(()=>'standard' as PathType),split=Math.max(0,index-1);
  const segmentTypes=index===0?[type??types[0],...types]:index===path.points.length?[...types,type??types.at(-1)!]:[...types.slice(0,split),types[split],...types.slice(split)];
  let heights=path.heights;
  if(heights){const start=path.points[Math.max(0,index-1)],end=path.points[Math.min(index,path.points.length-1)],horizontal=(end[0]-start[0])*Math.cos(start[1]*Math.PI/180),vertical=end[1]-start[1],ratio=Math.max(0,Math.min(1,((at[0]-start[0])*Math.cos(start[1]*Math.PI/180)*horizontal+(at[1]-start[1])*vertical)/(horizontal*horizontal+vertical*vertical||1)));const height=index===0?heights[0]:index===path.points.length?heights.at(-1)!:heights[index-1]+(heights[index]-heights[index-1])*ratio;heights=[...heights.slice(0,index),height,...heights.slice(index)];}
  const access=path.segmentAccess,segmentAccess=access?(index===0?[access[0],...access]:index===path.points.length?[...access,access.at(-1)!]:[...access.slice(0,split),access[split],...access.slice(split)]):undefined;
  const pointAccess=path.pointAccess?[...path.pointAccess.slice(0,index),'unknown' as PathAccess,...path.pointAccess.slice(index)]:undefined;
  const designs=path.bridgeDesigns,bridgeDesigns=designs?(index===0?[designs[0],...designs]:index===path.points.length?[...designs,designs.at(-1)!]:[...designs.slice(0,split),designs[split],...designs.slice(split)]):undefined;
  return {...path,points,...(heights?{heights}:{}),...(segmentAccess?{segmentAccess}:{}),...(pointAccess?{pointAccess}:{}),...(bridgeDesigns?{bridgeDesigns}:{}),...(path.segmentTypes||type?{segmentTypes}:{}),...(path.curves?{curves:[...path.curves.slice(0,index),0,...path.curves.slice(index)]}:{})};
}
export function removePathVertex(path: SitePath,index: number): SitePath {
  if(path.points.length<=2 || !Number.isInteger(index) || index<0 || index>=path.points.length)throw new Error('A path needs at least two points.');
  const points=path.points.filter((_,i)=>i!==index);
  const curves=path.curves?.filter((_,i)=>i!==index).map((v,i)=>i===0 || i===points.length-1?0:v);
  const segmentTypes=path.segmentTypes?.filter((_,segment)=>segment!==Math.min(index,path.points.length-2));
  const segmentAccess=path.segmentAccess?.filter((_,segment)=>segment!==Math.min(index,path.points.length-2));
  const pointAccess=path.pointAccess?.filter((_,point)=>point!==index);
  const bridgeDesigns=path.bridgeDesigns?.filter((_,segment)=>segment!==Math.min(index,path.points.length-2));
  return {...path,points,...(path.heights?{heights:path.heights.filter((_,point)=>point!==index)}:{}),...(segmentAccess?{segmentAccess}:{}),...(pointAccess?{pointAccess}:{}),...(segmentTypes?{segmentTypes}:{}),...(bridgeDesigns?{bridgeDesigns}:{}),...(curves?{curves}:{})};
}
/** Exactly coincident control points form editable geometric junctions. */
export function moveConnectedPathVertex(project:EventProject,id:string,index:number,at:Coord):EventProject {
  const sourcePath=project.paths.find(p=>p.id===id),source=sourcePath?.points[index];if(!source||!sourcePath)return project;
  const level=pathVertexKey(sourcePath,index);
  return {...project,paths:project.paths.map(path=>{
    if(!path.points.some(p=>p[0]===source[0] && p[1]===source[1]))return path;
    return {...path,points:path.points.map((p,point)=>p[0]===source[0] && p[1]===source[1]&&pathVertexKey(path,point)===level?at:p)};
  })};
}
export function pathFeatures(project: EventProject, selected: string | null,squareEnds=false): FeatureCollection<Polygon> {
  // Union metre-scale segments and round joins before converting back to GPS.
  // A single outline avoids both corner gaps and internal segment-border seams.
  const features: Feature<Polygon>[] = [];
  const linked = connectedPathIds(project, selected);
  for (const p of project.paths) {
    if (p.points.length < 2) continue;
    if(p.segmentTypes?.some(type=>type!=='standard')||p.segmentAccess||p.pointAccess){
      for(const section of pathSections(p)){
        const data=pathFeatures({...project,paths:[section.path]},linked.has(p.id)?p.id:null,section.type==='bridge');
        const access=p.segmentTypes?.[section.start]==='bridge'?(p.segmentAccess?.[section.start]??'unknown'):(p.pointAccess?.[section.start]==='notStepFree'&&p.pointAccess?.[section.start+1]==='notStepFree'?'notStepFree':'unknown');
        features.push(...data.features.map(feature=>({...feature,properties:{...feature.properties,elevated:p.heights?.some(height=>height>0)??false,segmentType:section.type,segmentStart:section.start,access}})));
      }
      continue;
    }
    const origin = p.points[0], radius = p.width / 2;
    const points = pathCenterline(p).map(([lon, lat]) => [(lon - origin[0]) * Math.PI / 180 * R * Math.cos(origin[1] * Math.PI / 180), (lat - origin[1]) * Math.PI / 180 * R] as Coord)
      .filter((point, i, all) => i === 0 || Math.hypot(point[0] - all[i - 1][0], point[1] - all[i - 1][1]) > .001);
    if (points.length < 2) continue;
    const closed=JSON.stringify(p.points[0])===JSON.stringify(p.points.at(-1));
    const pieces: polygonClipping.Polygon[] = points.filter((_,index)=>!squareEnds||closed||(index>0&&index<points.length-1)).map(([x, y]) => {
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
    for (const polygon of joined) features.push({ type: 'Feature', properties: { id: p.id, selected: linked.has(p.id),segmentType:'standard',access:'unknown',elevated:p.heights?.some(height=>height>0)??false }, geometry: { type: 'Polygon', coordinates: polygon.map(ring => ring.map(([x, y]) => offset(origin, x, y))) } });
  }
  return { type: 'FeatureCollection', features:features.sort((a,b)=>({underpass:-1,standard:0,bridge:1}[a.properties!.segmentType as PathType])-({underpass:-1,standard:0,bridge:1}[b.properties!.segmentType as PathType])) };
}
export function connectedPathIds(project: EventProject, selected: string | null): Set<string> {
  const byPoint = new Map<string, string[]>();
  for (const path of project.paths) for (const [index,point] of path.points.entries()) {
    const key = JSON.stringify([point,pathVertexKey(path,index)]);
    byPoint.set(key, [...(byPoint.get(key) ?? []), path.id]);
  }
  const linked = new Set<string>(), pending = selected ? [selected] : [];
  const paths = new Map(project.paths.map(path => [path.id, path]));
  while (pending.length) {
    const id = pending.pop()!, path = paths.get(id);
    if (!path || linked.has(id)) continue;
    linked.add(id);
    for (const [index,point] of path.points.entries()) for (const other of byPoint.get(JSON.stringify([point,pathVertexKey(path,index)])) ?? []) {
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
      let outline:Coord[]|undefined;if(o.outline!=null){if(!isAreaKind(String(o.kind)) || !Array.isArray(o.outline))fail('Custom boundaries are supported for camping, parking, restricted and water areas.');outline=(o.outline as unknown[]).map(p=>{if(!Array.isArray(p) || p.length!==2)fail('Invalid area boundary point.');return [num((p as unknown[])[0],-.5,.5),num((p as unknown[])[1],-.5,.5)] as Coord;});validateOutline(outline);}
      if(o.hasDefib!==undefined && typeof o.hasDefib!=='boolean')fail('Defibrillator availability must be true or false.');
      if(o.hasDefib===true && o.kind!=='medical')fail('Defibrillator availability is only supported on first aid points.');
      if(o.treeStyle!==undefined&&(o.kind!=='tree'||typeof o.treeStyle!=='number'||!Number.isInteger(o.treeStyle)||o.treeStyle<1||o.treeStyle>5))fail('Tree style must be a whole number from 1 to 5 on a tree.');
      const height=num(o.height,0,100),max=isAreaKind(String(o.kind))?2000:500,customModel=o.customModel==null?undefined:parsePolyModel(o.customModel),customModelId=o.customModelId==null?undefined:text(o.customModelId);if(customModelId&&!customModel)fail('Custom map models must include the model data.');return { id: text(o.id), name: text(o.name), kind: o.kind as Kind, position: coord(o.position), width: num(o.width, .5, max), depth: num(o.depth, .5, max), height: customModel?height:isAreaKind(String(o.kind))?0:height, rotation: num(o.rotation, -360, 360),...(outline?{outline}:{}),...(o.kind==='tree'&&o.treeStyle!==undefined?{treeStyle:o.treeStyle as number}:{}),...(o.kind==='medical' && o.hasDefib!==undefined?{hasDefib:o.hasDefib as boolean}:{}),...(customModel?{customModel,customModelId:customModelId??customModel.name}:{}) }; }),
    paths: (p.paths as unknown[]).map(v => { const path = obj(v); if (!Array.isArray(path.points) || path.points.length < 2 || path.points.length > 200) fail('Paths need 2–200 points.');
      const points=(path.points as unknown[]).map(coord);let curves: number[] | undefined;
      if(path.curves!==undefined){if(!Array.isArray(path.curves) || path.curves.length!==points.length)fail('Curve settings must match the path points.');curves=(path.curves as unknown[]).map(v=>num(v,0,1));if(curves[0]!==0 || curves.at(-1)!==0)fail('Only interior path points can be curved.');}
      if(path.generatedBy!==undefined && path.generatedBy!=='road-trace')fail('Unknown generated path source.');
      let segmentTypes:PathType[]|undefined;
      if(path.segmentTypes!==undefined){if(!Array.isArray(path.segmentTypes)||path.segmentTypes.length!==points.length-1||path.segmentTypes.some(type=>typeof type!=='string'||!Object.hasOwn(pathTypes,type)))fail('Path section types must match the sections between points.');segmentTypes=path.segmentTypes as PathType[];}
      let bridgeDesigns:BridgeDesign[]|undefined;
      if(path.bridgeDesigns!==undefined){if(!Array.isArray(path.bridgeDesigns)||path.bridgeDesigns.length!==points.length-1||path.bridgeDesigns.some(design=>typeof design!=='string'||!Object.hasOwn(bridgePresets,design)))fail('Bridge designs must match the sections between points.');bridgeDesigns=path.bridgeDesigns as BridgeDesign[];}
      let heights:number[]|undefined,segmentAccess:PathAccess[]|undefined,pointAccess:PathAccess[]|undefined;
      if(path.heights!==undefined){if(!Array.isArray(path.heights)||path.heights.length!==points.length)fail('Path heights must match its points.');heights=(path.heights as unknown[]).map(height=>num(height,0,100));if(JSON.stringify(points[0])===JSON.stringify(points.at(-1))&&heights[0]!==heights.at(-1))fail('A closed path must have matching start and end heights.');}
      if(path.segmentAccess!==undefined){if(!Array.isArray(path.segmentAccess)||path.segmentAccess.length!==points.length-1||path.segmentAccess.some(access=>typeof access!=='string'||!Object.hasOwn(pathAccess,access)))fail('Path accessibility must match its sections.');segmentAccess=path.segmentAccess as PathAccess[];}
      if(path.pointAccess!==undefined){if(!Array.isArray(path.pointAccess)||path.pointAccess.length!==points.length||path.pointAccess.some(access=>typeof access!=='string'||!Object.hasOwn(pathAccess,access)))fail('Path point accessibility must match its points.');pointAccess=path.pointAccess as PathAccess[];}
      return { ...(path.generatedBy==='road-trace'?{generatedBy:'road-trace' as const}:{}), id: text(path.id), name: text(path.name), width: num(path.width, .5, 30), points,...(heights?{heights}:{}),...(segmentAccess?{segmentAccess}:{}),...(pointAccess?{pointAccess}:{}),...(segmentTypes?{segmentTypes}:{}),...(bridgeDesigns?{bridgeDesigns}:{}),...(curves?{curves}:{}) }; }),
    areas: [], bridges: [] };
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
  if(p.bridges!==undefined){
    if(!Array.isArray(p.bridges)||p.bridges.length>200)fail('Maximum 200 bridges per event.');
    result.bridges=(p.bridges as unknown[]).map(v=>{const bridge=obj(v);if(!Array.isArray(bridge.points)||bridge.points.length<2||bridge.points.length>200)fail('Bridges need 2–200 points.');const points=(bridge.points as unknown[]).map(coord);if(!Array.isArray(bridge.heights)||bridge.heights.length!==points.length)fail('Bridge heights must match its points.');if(typeof bridge.design!=='string'||!Object.hasOwn(bridgePresets,bridge.design))fail('Unknown bridge design.');if(bridge.wheelchairAccessible!==undefined&&typeof bridge.wheelchairAccessible!=='boolean')fail('Bridge accessibility must be true or false.');const heights=(bridge.heights as unknown[]).map(height=>num(height,0,100));if(!heights.some(height=>height>0))fail('Bridges must rise above the ground.');return{id:text(bridge.id),name:text(bridge.name),width:num(bridge.width,.5,30),height:bridge.height===undefined?Math.max(...heights):num(bridge.height,.2,20),rampLength:bridge.rampLength===undefined ? Math.round(bridgePathLength(points)*.1*10)/10 : num(bridge.rampLength,.1,10000),wheelchairAccessible:bridge.wheelchairAccessible===true,...(Array.isArray(bridge.sourcePoints)?{sourcePoints:(bridge.sourcePoints as unknown[]).map(coord)}:{}),points,heights,design:bridge.design as BridgeDesign};});
  }
  if(p.referenceLayers!==undefined){
    if(!Array.isArray(p.referenceLayers)||p.referenceLayers.length>5)fail('Maximum five reference layers per map.');
    let vertices=0;
    const referenceCoord=(v:unknown)=>{if(++vertices>40000)fail('Maximum 40,000 reference coordinates per map.');return coord(v);};
    const list=(v:unknown):unknown[]=>Array.isArray(v)&&v.length<=2000?v:fail('Invalid reference geometry.');
    result.referenceLayers=(p.referenceLayers as unknown[]).map(v=>{
      const layer=obj(v);if(typeof layer.visible!=='boolean')fail('Reference visibility must be true or false.');
      return {id:text(layer.id),name:text(layer.name),visible:layer.visible as boolean,opacity:num(layer.opacity,0,1),
        points:list(layer.points).map(v=>{const point=obj(v);return {name:text(point.name),position:referenceCoord(point.position)};}),
        lines:list(layer.lines).map(v=>{const line=obj(v);if(!Array.isArray(line.points)||line.points.length<2||line.points.length>40000)fail('Reference lines need at least two coordinates.');return {name:text(line.name),points:(line.points as unknown[]).map(referenceCoord)};}),
        polygons:list(layer.polygons).map(v=>{const polygon=obj(v);const rings=list(polygon.rings).map(v=>{const ring=list(v).map(referenceCoord);if(ring.length<4||ring[0][0]!==ring.at(-1)![0]||ring[0][1]!==ring.at(-1)![1])fail('Reference polygons need closed rings.');return ring;});if(!rings.length)fail('Reference polygons need an outer ring.');return {name:text(polygon.name),rings};})};
    });
  }
  const ids = [...result.objects, ...result.paths, ...result.areas,...(result.bridges??[]),...(result.referenceLayers??[])].map(o => o.id); if (new Set(ids).size !== ids.length) fail('Object, area, path, bridge and reference IDs must be unique.');
  return result;
}
export function relocate(project: EventProject, center: Coord): EventProject {
  const move = (c: Coord): Coord => offset(center, (c[0] - project.center[0]) * Math.PI / 180 * R * Math.cos(project.center[1] * Math.PI / 180), (c[1] - project.center[1]) * Math.PI / 180 * R);
  return { ...project, center, site:{...project.site,...(project.site.position?{position:move(project.site.position)}:{})}, objects: project.objects.map(o => ({ ...o, position: move(o.position) })), paths: project.paths.map(p => ({ ...p, points: p.points.map(move) })), bridges:(project.bridges??[]).map(b=>({...b,points:b.points.map(move)})), areas: project.areas.map(a => ({ ...a, rings: a.rings.map(ring => ring.map(move)) })) };
}
