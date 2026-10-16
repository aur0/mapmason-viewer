import { pathCenterline, type Coord, type EventProject } from './model';
type Edge = { to: number; length: number; width: number };
type Segment = { a: number; b: number; length: number; width: number };
export type PathNetwork = { points: Coord[]; xy: Coord[]; edges: Edge[][]; segments: Segment[]; origin: Coord; scale: number };
export type WalkingRoute = { points: Coord[]; access: Coord[][]; distance: number; accessDistance: number };
const distance = (a: Coord, b: Coord) => Math.hypot(a[0]-b[0], a[1]-b[1]);
const projectPoint = (n: Pick<PathNetwork,'origin'|'scale'>, p: Coord): Coord => [(p[0]-n.origin[0])*n.scale, (p[1]-n.origin[1])*111195];

export function createPathNetwork(project: EventProject): PathNetwork {
  const network: PathNetwork = { points: [], xy: [], edges: [], segments: [], origin: project.center, scale: 111195*Math.cos(project.center[1]*Math.PI/180) };
  const ids = new Map<string, number>();
  const node = (p: Coord) => {
    const key = `${p[0].toFixed(9)},${p[1].toFixed(9)}`;
    if (ids.has(key)) return ids.get(key)!;
    const id = network.points.length; ids.set(key,id); network.points.push(p); network.xy.push(projectPoint(network,p)); network.edges.push([]); return id;
  };
  for (const path of project.paths) {
    const points = pathCenterline(path);
    for (let i=1;i<points.length;i++) {
      const a=node(points[i-1]), b=node(points[i]), length=distance(network.xy[a],network.xy[b]);
      if (length < .001) continue;
      network.segments.push({a,b,length,width:path.width}); network.edges[a].push({to:b,length,width:path.width}); network.edges[b].push({to:a,length,width:path.width});
    }
  }
  return network;
}

export function shortestRoute(network: PathNetwork, from: Coord, to: Coord, avoidReverse?: [Coord,Coord]): WalkingRoute {
  if (!network.segments.length) throw new Error('This map has no paths to route along yet.');
  const snap = (p: Coord) => {
    const xy=projectPoint(network,p); let best: {segment:Segment;index:number;t:number;gap:number;at:Coord}|undefined;
    network.segments.forEach((segment,index) => {
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
  const link=(a:number,b:number,length:number,width:number) => { extras.set(a,[...(extras.get(a)??[]),{to:b,length,width}]); extras.set(b,[...(extras.get(b)??[]),{to:a,length,width}]); };
  for (const [id,s] of [[startId,start],[endId,end]] as const) { link(id,s.segment.a,s.t*s.segment.length,s.segment.width); link(id,s.segment.b,(1-s.t)*s.segment.length,s.segment.width); }
  if (start.index===end.index) link(startId,endId,Math.abs(start.t-end.t)*start.segment.length,start.segment.width);
  // Distance is primary. Among equal lengths, minimise distance / width.
  // This prefers consistently wider paths without taking a longer detour.
  type Cost={cost:number;narrowness:number};
  const better=(a:Cost,b:Cost)=>a.cost<b.cost-1e-6||(Math.abs(a.cost-b.cost)<=1e-6&&a.narrowness<b.narrowness-1e-9);
  const costs=new Map<number,Cost>([[startId,{cost:0,narrowness:0}]]),previous=new Map<number,number>();
  const heap:({id:number}&Cost)[]=[];
  const push=(item:typeof heap[number])=>{let i=heap.length;heap.push(item);while(i>0){const parent=(i-1)>>1;if(!better(item,heap[parent]))break;heap[i]=heap[parent];i=parent;}heap[i]=item;};
  const pop=()=>{const first=heap[0],last=heap.pop()!;if(heap.length){let i=0;while(i*2+1<heap.length){let child=i*2+1;if(child+1<heap.length&&better(heap[child+1],heap[child]))child++;if(!better(heap[child],last))break;heap[i]=heap[child];i=child;}heap[i]=last;}return first;};
  push({id:startId,cost:0,narrowness:0});
  while(heap.length){
    const current=pop(),known=costs.get(current.id);
    if(current.cost!==known?.cost||current.narrowness!==known.narrowness)continue;
    if(current.id===endId)break;
    for(const edge of [...(network.edges[current.id]??[]),...(extras.get(current.id)??[])]){
      if(reverseBlocked(current.id,edge.to))continue;
      const next={cost:current.cost+edge.length,narrowness:current.narrowness+edge.length/Math.max(.5,edge.width)};
      if(better(next,costs.get(edge.to)??{cost:Infinity,narrowness:Infinity})){
        costs.set(edge.to,next);previous.set(edge.to,current.id);push({id:edge.to,...next});
      }
    }
  }
  const total=costs.get(endId)?.cost;if(total===undefined)throw new Error('These paths are not connected. Join them in the designer before routing between these places.');
  const ids=[endId];while(ids[0]!==startId)ids.unshift(previous.get(ids[0])!);
  const points=ids.map(id=>id===startId?start.at:id===endId?end.at:network.points[id]);
  return { points, distance: total, accessDistance:start.gap+end.gap, access:[[from,start.at],[end.at,to]] };
}
