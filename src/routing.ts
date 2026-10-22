import { bridgePaths, pathProfile, pathSections, type Coord, type EventProject } from './model';
type Edge = { to: number; length: number; width: number; wheelchairAccessible: boolean; isBridge: boolean };
type Segment = { a: number; b: number; length: number; width: number; wheelchairAccessible: boolean; isBridge: boolean };
export type PathNetwork = { points: Coord[]; heights:number[];xy: Coord[]; edges: Edge[][]; segments: Segment[]; inaccessiblePoints:Set<number>; origin: Coord; scale: number };
export type WalkingRoute = { points: Coord[];heights?:number[]; access: Coord[][]; distance: number; accessDistance: number; usesBridge:boolean };
const distance = (a: Coord, b: Coord) => Math.hypot(a[0]-b[0], a[1]-b[1]);
const projectPoint = (n: Pick<PathNetwork,'origin'|'scale'>, p: Coord): Coord => [(p[0]-n.origin[0])*n.scale, (p[1]-n.origin[1])*111195];

export function createPathNetwork(project: EventProject): PathNetwork {
  const network: PathNetwork = { points: [],heights:[], xy: [], edges: [], segments: [], inaccessiblePoints:new Set(), origin: project.center, scale: 111195*Math.cos(project.center[1]*Math.PI/180) };
  const shapePoints:{id:string;point:Coord;node:number;height:number;width:number}[]=[];
  const ids = new Map<string, number>();
  const coordinateKey=(point:Coord)=>`${point[0].toFixed(9)},${point[1].toFixed(9)}`;
  const underpassJunctions=new Set<string>();
  for(const path of [...project.paths,...bridgePaths(project.bridges)])for(const section of pathSections(path))if(section.type==='underpass')for(const point of section.path.points.slice(1,-1))underpassJunctions.add(coordinateKey(point));
  const blockedPointKeys=new Set<string>();
  const coveredBridgeSegments=new Set<string>(),blockedBridgeSegments=new Set<string>();
  for(const bridge of project.bridges??[]){
    const sourceKeys=new Set((bridge.sourcePoints??[]).map(coordinateKey));
    for(const path of project.paths){
      const indices=path.points.flatMap((point,index)=>sourceKeys.has(coordinateKey(point))?[index]:[]);
      if(indices.length<2)continue;
      for(let index=Math.min(...indices);index<Math.max(...indices);index++){
        const key=`${path.id}:${index}`;coveredBridgeSegments.add(key);
        if(!bridge.wheelchairAccessible)blockedBridgeSegments.add(key);
      }
    }
  }
  const node = (p: Coord,level:number,height:number,physical:boolean) => {
    const key = `${p[0].toFixed(9)},${p[1].toFixed(9)},${physical||level===0?'height:'+height.toFixed(3):'type:'+level}`;
    if (ids.has(key)) return ids.get(key)!;
    const id = network.points.length; ids.set(key,id); network.points.push(p);network.heights.push(height); network.xy.push(projectPoint(network,p)); network.edges.push([]); return id;
  };
  for (const path of [...project.paths,...bridgePaths(project.bridges)]) {
    path.pointAccess?.forEach((access,index)=>{if(access==='notStepFree')blockedPointKeys.add(coordinateKey(path.points[index]));});
    for(const section of pathSections(path)){
    const samples=pathProfile(section.path),points=samples.map(sample=>sample.position),level=section.type==='bridge'?1:section.type==='underpass'?-1:0;
    const legacyPath=project.paths.some(candidate=>candidate.id===path.id);
    for (let i=1;i<points.length;i++) {
      const pathSegment=section.start+Math.min(samples[i-1].segment,samples[i].segment);
      const access=path.segmentAccess?.[section.start];
      const isBridge=section.type==='bridge'||(legacyPath&&coveredBridgeSegments.has(`${path.id}:${pathSegment}`));
      const restrictedPoint=path.pointAccess?.[pathSegment]==='notStepFree'||path.pointAccess?.[pathSegment+1]==='notStepFree';
      const wheelchairAccessible=(section.type!=='bridge'||access==='stepFree')&&!restrictedPoint&&!(legacyPath&&blockedBridgeSegments.has(`${path.id}:${pathSegment}`));
      const physical=path.heights?.some(height=>height>0)??false;
      const startLevel=i===1?(underpassJunctions.has(coordinateKey(points[i-1]))?-1:0):level,endLevel=i===points.length-1?(underpassJunctions.has(coordinateKey(points[i]))?-1:0):level;
      const a=node(points[i-1],startLevel,samples[i-1].height,physical), b=node(points[i],endLevel,samples[i].height,physical), length=Math.hypot(distance(network.xy[a],network.xy[b]),samples[i].height-samples[i-1].height);
      shapePoints.push({id:path.id,point:points[i-1],node:a,height:samples[i-1].height,width:path.width},{id:path.id,point:points[i],node:b,height:samples[i].height,width:path.width});
      if (length < .001) continue;
      network.segments.push({a,b,length,width:path.width,wheelchairAccessible,isBridge}); network.edges[a].push({to:b,length,width:path.width,wheelchairAccessible,isBridge}); network.edges[b].push({to:a,length,width:path.width,wheelchairAccessible,isBridge});
    }
    }
  }
  const pointsByCoordinate=new Map<string,typeof shapePoints>(),linkedPointPairs=new Set<string>();
  for(const point of shapePoints){
    const key=coordinateKey(point.point),coincident=pointsByCoordinate.get(key)??[];
    for(const other of coincident){
      if(other.id===point.id||Math.abs(other.height-point.height)>.001||other.node===point.node)continue;
      const pair=other.node<point.node?`${other.node}:${point.node}`:`${point.node}:${other.node}`;if(linkedPointPairs.has(pair))continue;linkedPointPairs.add(pair);
      const width=Math.max(.5,other.width,point.width);
      network.edges[point.node].push({to:other.node,length:0,width,wheelchairAccessible:true,isBridge:false});
      network.edges[other.node].push({to:point.node,length:0,width,wheelchairAccessible:true,isBridge:false});
    }
    coincident.push(point);pointsByCoordinate.set(key,coincident);
  }
  network.points.forEach((point,index)=>{if(blockedPointKeys.has(coordinateKey(point)))network.inaccessiblePoints.add(index);});
  return network;
}

export function shortestRoute(network: PathNetwork, from: Coord, to: Coord, avoidReverse?: [Coord,Coord], wheelchairAccessibleOnly=false, avoidBridges=false): WalkingRoute {
  const routableSegments=network.segments.filter(segment=>(!wheelchairAccessibleOnly||segment.wheelchairAccessible)&&(!avoidBridges||!segment.isBridge));
  if (!routableSegments.length) throw new Error(avoidBridges?'No route is available without bridges.':wheelchairAccessibleOnly?'No wheelchair-accessible route is available. Check the path and bridge access markings.':'This map has no paths to route along yet.');
  const snap = (p: Coord) => {
    const xy=projectPoint(network,p); let best: {segment:Segment;index:number;t:number;gap:number;at:Coord}|undefined;
    routableSegments.forEach((segment,index) => {
      const a=network.xy[segment.a],b=network.xy[segment.b],dx=b[0]-a[0],dy=b[1]-a[1];
      const t=Math.max(0,Math.min(1,((xy[0]-a[0])*dx+(xy[1]-a[1])*dy)/(dx*dx+dy*dy)));
      const gap=distance(xy,[a[0]+dx*t,a[1]+dy*t]);
      if (!best || gap<best.gap-1e-6 || (Math.abs(gap-best.gap)<=1e-6 && segment.width>best.segment.width)) { const ca=network.points[segment.a],cb=network.points[segment.b]; best={segment,index,t,gap,at:[ca[0]+(cb[0]-ca[0])*t,ca[1]+(cb[1]-ca[1])*t]}; }
    });
    if (!best) throw new Error('This map has no paths to route along yet.');
    return best;
  };
  const start=snap(from), end=snap(to), startId=network.points.length,endId=startId+1;
  const coordinate=(id:number)=>id===startId?start.at:id===endId?end.at:network.points[id];
  const reverseBlocked=(a:number,b:number)=>{
    if(!avoidReverse)return false;
    const p=projectPoint(network,avoidReverse[0]),q=projectPoint(network,avoidReverse[1]),u=projectPoint(network,coordinate(a)),v=projectPoint(network,coordinate(b));
    const dx=q[0]-p[0],dy=q[1]-p[1],length=Math.hypot(dx,dy);if(length<.001)return false;
    const ex=v[0]-u[0],ey=v[1]-u[1],edgeLength=Math.hypot(ex,ey);if(edgeLength<.001||dx*ex+dy*ey>=0)return false;
    if(Math.abs(dx*ey-dy*ex)/(length*edgeLength)>.00001||Math.abs((u[0]-p[0])*dy-(u[1]-p[1])*dx)/length>.05)return false;
    const first=((u[0]-p[0])*dx+(u[1]-p[1])*dy)/length,last=((v[0]-p[0])*dx+(v[1]-p[1])*dy)/length;
    return Math.min(length,Math.max(first,last))-Math.max(0,Math.min(first,last))>.01;
  };
  const extras=new Map<number,Edge[]>();
  const link=(a:number,b:number,length:number,width:number,wheelchairAccessible:boolean,isBridge:boolean) => { extras.set(a,[...(extras.get(a)??[]),{to:b,length,width,wheelchairAccessible,isBridge}]); extras.set(b,[...(extras.get(b)??[]),{to:a,length,width,wheelchairAccessible,isBridge}]); };
  for (const [id,s] of [[startId,start],[endId,end]] as const) { link(id,s.segment.a,s.t*s.segment.length,s.segment.width,s.segment.wheelchairAccessible,s.segment.isBridge); link(id,s.segment.b,(1-s.t)*s.segment.length,s.segment.width,s.segment.wheelchairAccessible,s.segment.isBridge); }
  if (start.index===end.index) link(startId,endId,Math.abs(start.t-end.t)*start.segment.length,start.segment.width,start.segment.wheelchairAccessible,start.segment.isBridge);
  // Distance is primary. Among equal lengths, minimise distance / width.
  // This prefers consistently wider paths without taking a longer detour.
  type Cost={cost:number;narrowness:number};
  const better=(a:Cost,b:Cost)=>a.cost<b.cost-1e-6||(Math.abs(a.cost-b.cost)<=1e-6&&a.narrowness<b.narrowness-1e-9);
  const costs=new Map<number,Cost>([[startId,{cost:0,narrowness:0}]]),previous=new Map<number,number>(),previousBridge=new Map<number,boolean>();
  const heap:({id:number}&Cost)[]=[];
  const push=(item:typeof heap[number])=>{let i=heap.length;heap.push(item);while(i>0){const parent=(i-1)>>1;if(!better(item,heap[parent]))break;heap[i]=heap[parent];i=parent;}heap[i]=item;};
  const pop=()=>{const first=heap[0],last=heap.pop()!;if(heap.length){let i=0;while(i*2+1<heap.length){let child=i*2+1;if(child+1<heap.length&&better(heap[child+1],heap[child]))child++;if(!better(heap[child],last))break;heap[i]=heap[child];i=child;}heap[i]=last;}return first;};
  push({id:startId,cost:0,narrowness:0});
  while(heap.length){
    const current=pop(),known=costs.get(current.id);
    if(current.cost!==known?.cost||current.narrowness!==known.narrowness)continue;
    if(current.id===endId)break;
    for(const edge of [...(network.edges[current.id]??[]),...(extras.get(current.id)??[])]){
      if(wheelchairAccessibleOnly&&(network.inaccessiblePoints.has(current.id)||network.inaccessiblePoints.has(edge.to)))continue;
      if((wheelchairAccessibleOnly&&!edge.wheelchairAccessible)||(avoidBridges&&edge.isBridge))continue;
      if(reverseBlocked(current.id,edge.to))continue;
      const next={cost:current.cost+edge.length,narrowness:current.narrowness+edge.length/Math.max(.5,edge.width)};
      if(better(next,costs.get(edge.to)??{cost:Infinity,narrowness:Infinity})){
        costs.set(edge.to,next);previous.set(edge.to,current.id);previousBridge.set(edge.to,edge.isBridge);push({id:edge.to,...next});
      }
    }
  }
  const total=costs.get(endId)?.cost;
  if(total===undefined){
    if(wheelchairAccessibleOnly)throw new Error('No wheelchair-accessible route connects these places. Please ask event staff for help finding an alternative.');
    if(avoidBridges)throw new Error('No route connects these places without bridges.');
    throw new Error('These paths are not connected. Join them in the designer before routing between these places.');
  }
  const ids=[endId];while(ids[0]!==startId)ids.unshift(previous.get(ids[0])!);
  const points=ids.map(id=>id===startId?start.at:id===endId?end.at:network.points[id]);
  const height=(snap:typeof start)=>network.heights[snap.segment.a]+(network.heights[snap.segment.b]-network.heights[snap.segment.a])*snap.t;
  const heights=ids.map(id=>id===startId?height(start):id===endId?height(end):network.heights[id]);
  return { points,heights, distance: total, accessDistance:start.gap+end.gap, access:[[from,start.at],[end.at,to]],usesBridge:ids.slice(1).some(id=>previousBridge.get(id)===true) };
}
