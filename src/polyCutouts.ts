import type {PolyPart,PolyTriangle} from './polyModel';

type Vertex={p:number[];colour:number[];alpha:number;uv:number[]};
type Plane={n:number[];d:number};
const dot=(a:number[],b:number[])=>a.reduce((sum,value,index)=>sum+value*b[index],0);
function clip(polygon:Vertex[],plane:Plane,inside:boolean):Vertex[]{
  if(!inside&&polygon.every(vertex=>Math.abs(dot(vertex.p,plane.n)-plane.d)<1e-8))return [];
  const result:Vertex[]=[];
  for(let index=0;index<polygon.length;index++){
    const a=polygon[index],b=polygon[(index+1)%polygon.length],da=dot(a.p,plane.n)-plane.d,db=dot(b.p,plane.n)-plane.d;
    const keepA=inside?da<=1e-8:da>=-1e-8,keepB=inside?db<=1e-8:db>=-1e-8;
    if(keepA)result.push(a);
    if(keepA!==keepB){const t=da/(da-db),mix=(first:number[],last:number[])=>first.map((value,axis)=>value+(last[axis]-value)*t);result.push({p:mix(a.p,b.p),colour:mix(a.colour,b.colour),alpha:a.alpha+(b.alpha-a.alpha)*t,uv:mix(a.uv,b.uv)});}
  }
  return result;
}

/** Subtract oriented boxes from targeted surface triangles; no new interior caps. */
export function applyPolyCutouts(triangles:PolyTriangle[],parts:PolyPart[],showHelpers:boolean):PolyTriangle[]{
  const cutters=parts.flatMap((part,index)=>{
    if(part.shape!=='cutout')return [];
    const mesh=triangles.filter(triangle=>triangle.partIndex===index),center=[0,0,0];let count=0;
    for(const triangle of mesh)for(const at of [0,3,6]){for(let axis=0;axis<3;axis++)center[axis]+=triangle.positions[at+axis];count++;}
    if(!count)return [];
    for(let axis=0;axis<3;axis++)center[axis]/=count;
    const planes:Plane[]=[],seen=new Set<number>();
    for(const triangle of mesh){if(seen.has(triangle.surfaceIndex!))continue;seen.add(triangle.surfaceIndex!);const p=triangle.positions,a=p.slice(0,3),u=p.slice(3,6).map((value,axis)=>value-a[axis]),v=p.slice(6,9).map((value,axis)=>value-a[axis]);let n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];const length=Math.hypot(...n);if(!length)continue;n=n.map(value=>value/length);if(dot(n,a.map((value,axis)=>value-center[axis]))<0)n=n.map(value=>-value);planes.push({n,d:dot(n,a)});}
    return [{index,targets:new Set(part.cutoutTargets??[]),surface:part.cutoutSurface,planes}];
  });
  if(!cutters.length)return triangles;
  const output:PolyTriangle[]=[];
  for(const triangle of triangles){
    if(triangle.cutout){if(showHelpers)output.push(triangle);continue;}
    const applicable=cutters.filter(cutter=>cutter.targets.has(triangle.partIndex!)&&(cutter.surface===undefined||cutter.surface===triangle.surfaceIndex));
    if(!applicable.length){output.push(triangle);continue;}
    let polygons:Vertex[][]=[[0,1,2].map(index=>({p:triangle.positions.slice(index*3,index*3+3),colour:triangle.vertexColors?.[index]??triangle.color,alpha:triangle.vertexOpacity?.[index]??triangle.opacity,uv:triangle.uv?.slice(index*2,index*2+2)??[0,0]}))];
    for(const cutter of applicable){
      const kept:Vertex[][]=[];
      for(const polygon of polygons){
        let remaining=polygon;
        for(const plane of cutter.planes){if(remaining.length<3)break;const outside=clip(remaining,plane,false);if(outside.length>=3)kept.push(outside);remaining=clip(remaining,plane,true);}

      }
      polygons=kept;
    }
    for(const polygon of polygons)for(let index=1;index<polygon.length-1;index++){
      const vertices=[polygon[0],polygon[index],polygon[index+1]],u=vertices[1].p.map((v,a)=>v-vertices[0].p[a]),v=vertices[2].p.map((v,a)=>v-vertices[0].p[a]);
      if(Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])<1e-12)continue;
      output.push({...triangle,positions:vertices.flatMap(vertex=>vertex.p),vertexColors:vertices.map(vertex=>vertex.colour) as [number[],number[],number[]],vertexOpacity:vertices.map(vertex=>vertex.alpha) as [number,number,number],uv:triangle.uv?vertices.flatMap(vertex=>vertex.uv):undefined});
    }
  }
  return output;
}

export function removePolyParts(parts:PolyPart[],removed:Set<number>):PolyPart[]{
  const indices=new Map<number,number>();parts.forEach((_,index)=>{if(!removed.has(index))indices.set(index,indices.size);});
  return parts.flatMap((part,index)=>removed.has(index)?[]:[part.cutoutTargets?{...part,cutoutTargets:part.cutoutTargets.filter(target=>indices.has(target)).map(target=>indices.get(target)!)}:part]);
}
