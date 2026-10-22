import {offset,type Coord} from './model';
import {applyPolyCutouts} from './polyCutouts';

// AI feature reference: ./polyRendererGuide.ts. Update it and the assistant tool
// schema/edit fields whenever validation, shape geometry or materials change.

export type PolyShape='cutout'|'box'|'cylinder'|'roof'|'cone'|'wedge'|'pyramid'|'arch'|'text'|'sphere'|'extrusion'|'surface'|'line'|'tube';
export const polyRoofProfiles=['curved','flat','gabled','hipped','barrel','pyramid'] as const;
export type PolyRoofProfile=typeof polyRoofProfiles[number];
export type PolyPart={brickTexture?:boolean;cutoutSurface?:number;cutoutTargets?:number[];surfaceColors?:Record<string,string>;shape:PolyShape;roofProfile?:PolyRoofProfile;endCaps?:boolean;openingWidth?:number;archRise?:number;crownThickness?:number;x:number;y:number;z:number;width:number;depth:number;height:number;rotation:number;color:string;frontColor?:string;topColor?:string;topRise?:number;topStep?:number;topStepAt?:number;tiltX?:number;tiltY?:number;topWidth?:number;topDepth?:number;rounding?:number;opacity?:number;emissive?:number;shadingStrength?:number;smoothShading?:boolean;group?:string;text?:string;outline?:[number,number][];path?:[number,number][];curve?:[number,number,number][];thickness?:number;radius?:number;endRadius?:number};
export type PolyTransform={pitch:number;roll:number;yaw:number;elevation:number};
export type PolyModel={format:'mapmason-poly';version:1;name:string;parts:PolyPart[];transform?:PolyTransform};
type PolyPoint=[number,number];
function isClosedTube(curve:number[][]){return curve.length>2&&Math.hypot(...curve[0].map((value,axis)=>value-curve.at(-1)![axis]))<1e-5;}
const polyCross=(a:PolyPoint,b:PolyPoint,c:PolyPoint)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function pointBounds(points:number[][]){const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(const point of points)for(let axis=0;axis<3;axis++){min[axis]=Math.min(min[axis],point[axis]);max[axis]=Math.max(max[axis],point[axis]);}return {min,max};}
function triangulatePolygon(points:PolyPoint[]):number[][]{
  const remaining=points.map((_,index)=>index),triangles:number[][]=[];
  while(remaining.length>3){
    let clipped=false;
    for(let at=0;at<remaining.length;at++){
      const previous=remaining[(at+remaining.length-1)%remaining.length],current=remaining[at],next=remaining[(at+1)%remaining.length];
      if(polyCross(points[previous],points[current],points[next])<=1e-9)continue;
      const inside=remaining.some(index=>index!==previous&&index!==current&&index!==next&&polyCross(points[previous],points[current],points[index])>=-1e-9&&polyCross(points[current],points[next],points[index])>=-1e-9&&polyCross(points[next],points[previous],points[index])>=-1e-9);
      if(inside)continue;
      triangles.push([previous,current,next]);remaining.splice(at,1);clipped=true;break;
    }
    if(!clipped)throw Error('Custom extrusion outline cannot be triangulated.');
  }
  triangles.push(remaining);return triangles;
}
export function parsePolyModel(input:unknown):PolyModel{
  if(!input||typeof input!=='object')throw Error('Invalid Poly model.');
  const model=input as Record<string,unknown>;
  if(model.format!=='mapmason-poly'||model.version!==1||typeof model.name!=='string'||!model.name.trim()||model.name.length>100||!Array.isArray(model.parts)||model.parts.length<1||model.parts.length>96)throw Error('Use a named Poly model with 1-96 parts.');
  const number=(value:unknown,min:number,max:number)=>{if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw Error(`Model dimensions must be between ${min} and ${max} metres.`);return value;};
  const parts=model.parts.map(value=>{
    if(!value||typeof value!=='object')throw Error('Invalid model part.');
    const part=value as Record<string,unknown>,shapes:PolyShape[]=['cutout','box','cylinder','roof','cone','wedge','pyramid','arch','text','sphere','extrusion','surface','line','tube'];
    if(!shapes.includes(part.shape as PolyShape)||typeof part.color!=='string'||!/^#[0-9a-f]{6}$/i.test(part.color))throw Error('Model parts need a supported shape and hex colour.');
    const parsed:PolyPart={shape:part.shape as PolyShape,x:number(part.x,-200,200),y:number(part.y,-200,200),z:number(part.z,0,200),width:number(part.width,.01,200),depth:number(part.depth,.01,200),height:number(part.height,part.shape==='surface'||part.shape==='line'?0:.01,200),rotation:number(part.rotation,-360,360),color:part.color};
    if(part.cutoutTargets!==undefined&&part.cutoutTargets!==null){
      if(parsed.shape!=='cutout'||!Array.isArray(part.cutoutTargets)||part.cutoutTargets.length>96||part.cutoutTargets.some(target=>!Number.isInteger(target)||target<0||target>95))throw Error('Cutout targets must be part indices on a cutout box.');
      parsed.cutoutTargets=[...new Set(part.cutoutTargets as number[])];
    }
    if(part.cutoutSurface!==undefined&&part.cutoutSurface!==null){if(parsed.shape!=='cutout'||!Number.isInteger(part.cutoutSurface)||Number(part.cutoutSurface)<0)throw Error('Cutout surface must be a non-negative surface index.');parsed.cutoutSurface=Number(part.cutoutSurface);}
    if(parsed.shape==='cutout'){parsed.opacity=.08;parsed.emissive=0;}
    if(part.roofProfile!==undefined&&part.roofProfile!==null){
      if(parsed.shape!=='roof'||!polyRoofProfiles.includes(part.roofProfile as PolyRoofProfile))throw Error('Roof profile must be curved, flat, gabled, hipped, barrel or pyramid, on a roof part.');
      parsed.roofProfile=part.roofProfile as PolyRoofProfile;
    }
    if(part.endCaps!==undefined&&part.endCaps!==null){
      if(parsed.shape!=='roof'||typeof part.endCaps!=='boolean')throw Error('Roof end caps must be true or false on a roof part.');
      if(part.endCaps&&parsed.roofProfile!=='gabled'&&parsed.roofProfile!=='barrel')throw Error('End caps are supported on gabled and barrel roofs.');
      parsed.endCaps=part.endCaps;
    }
    for(const field of ['openingWidth','archRise','crownThickness'] as const){
      if(part[field]===undefined||part[field]===null)continue;
      if(parsed.shape!=='arch')throw Error('Opening width, arch rise and crown thickness are only supported on arches.');
      parsed[field]=number(part[field],.01,200);
    }
    if(parsed.shape==='arch'){
      if(parsed.openingWidth!==undefined&&parsed.openingWidth>parsed.width-.02)throw Error('Arch opening width must leave at least 0.01 metres of material on each side.');
      const rise=parsed.archRise??parsed.height*.42;
      if(rise>parsed.height)throw Error('Arch rise cannot exceed the total arch height.');
      if(parsed.crownThickness!==undefined&&parsed.crownThickness>rise-.01)throw Error('Arch crown thickness must be at least 0.01 metres smaller than the arch rise to leave an opening.');
    }
    if(part.brickTexture!==undefined&&part.brickTexture!==null){if(parsed.shape!=='box'&&parsed.shape!=='extrusion'||parsed.shape==='box'&&part.rounding!==undefined&&part.rounding!==null||typeof part.brickTexture!=='boolean')throw Error('Brick texture needs a sharp-cornered box or extrusion and a boolean value.');parsed.brickTexture=part.brickTexture;}
    if(part.surfaceColors!==undefined&&part.surfaceColors!==null){
      if(typeof part.surfaceColors!=='object'||Array.isArray(part.surfaceColors)||Object.entries(part.surfaceColors).some(([key,value])=>!/^\d+$/.test(key)||typeof value!=='string'||!/^#[0-9a-f]{6}$/i.test(value)))throw Error('Surface colours must map surface indices to hex colours.');
      parsed.surfaceColors={...part.surfaceColors as Record<string,string>};
    }
    if(part.frontColor!==undefined&&part.frontColor!==null){if(parsed.shape!=='box'||typeof part.frontColor!=='string'||!/^#[0-9a-f]{6}$/i.test(part.frontColor))throw Error('Front colour needs a box and a hex colour.');parsed.frontColor=part.frontColor;}
    if(part.topColor!==undefined&&part.topColor!==null){if(parsed.shape!=='box'||part.rounding===undefined||part.rounding===null||typeof part.topColor!=='string'||!/^#[0-9a-f]{6}$/i.test(part.topColor))throw Error('Top colour needs a box with rounding set and a hex colour.');parsed.topColor=part.topColor;}
    if(part.topRise!==undefined&&part.topRise!==null){if(parsed.shape!=='box'||part.rounding===undefined||part.rounding===null)throw Error('A curved top needs a box with rounding set.');parsed.topRise=number(part.topRise,.01,5);}
    if(part.topStep!==undefined&&part.topStep!==null){if(parsed.shape!=='box'||part.rounding===undefined||part.rounding===null)throw Error('A stepped top needs a box with rounding set.');parsed.topStep=number(part.topStep,.01,5);}
    if(part.topStepAt!==undefined&&part.topStepAt!==null){if(parsed.topStep===undefined)throw Error('A top step position needs a stepped top.');parsed.topStepAt=number(part.topStepAt,-1,1);}
    for(const field of ['tiltX','tiltY'] as const)if(part[field]!==undefined&&part[field]!==null)parsed[field]=number(part[field],-180,180);
    for(const field of ['topWidth','topDepth'] as const)if(part[field]!==undefined&&part[field]!==null)parsed[field]=number(part[field],.01,200);
    if(part.rounding!==undefined&&part.rounding!==null){if(parsed.shape!=='box')throw Error('Only boxes can have rounded edges.');parsed.rounding=number(part.rounding,0,Math.min(parsed.width,parsed.depth,Math.max(parsed.height,.01))/2);}
    if(part.opacity!==undefined&&part.opacity!==null)parsed.opacity=number(part.opacity,0,1);
    if(part.emissive!==undefined&&part.emissive!==null)parsed.emissive=number(part.emissive,0,1);
    if(part.shadingStrength!==undefined&&part.shadingStrength!==null)parsed.shadingStrength=number(part.shadingStrength,0,1);
    if(part.smoothShading!==undefined&&part.smoothShading!==null){
      if(typeof part.smoothShading!=='boolean')throw Error('Smooth shading must be true or false.');
      parsed.smoothShading=part.smoothShading;
    }
    if(part.group!==undefined&&part.group!==null){if(typeof part.group!=='string'||part.group.length>60)throw Error('Part groups must be text up to 60 characters.');parsed.group=part.group.trim();}
    if(part.text!==undefined&&part.text!==null){if(typeof part.text!=='string'||part.text.length>24||!/^[a-z0-9 ]*$/i.test(part.text))throw Error('Sign text must use up to 24 letters, numbers or spaces.');parsed.text=part.text;}
    if(parsed.shape==='text'&&!parsed.text?.trim())throw Error('Text panels need sign text.');
    if(parsed.shape==='extrusion'||parsed.shape==='surface'){
      if(!Array.isArray(part.outline)||part.outline.length<3||part.outline.length>12)throw Error('Custom extrusions need a simple outline with 3-12 points.');
      const outline=part.outline.map(point=>{
        if(!Array.isArray(point)||point.length!==2||point.some(value=>typeof value!=='number'||!Number.isFinite(value)||value< -1||value>1))throw Error('Outline points must be pairs between -1 and 1.');
        return [point[0],point[1]] as [number,number];
      });
      if(new Set(outline.map(point=>point.join(','))).size!==outline.length)throw Error('Outline points must be unique.');
      for(let index=0;index<outline.length;index++)if(Math.abs(polyCross(outline[(index+outline.length-1)%outline.length],outline[index],outline[(index+1)%outline.length]))<1e-7)throw Error('Custom extrusion outlines cannot have collinear points.');
      const intersects=(a:PolyPoint,b:PolyPoint,c:PolyPoint,d:PolyPoint)=>{
        const abC=polyCross(a,b,c),abD=polyCross(a,b,d),cdA=polyCross(c,d,a),cdB=polyCross(c,d,b);
        const on=(p:PolyPoint,q:PolyPoint,r:PolyPoint)=>Math.abs(polyCross(p,q,r))<1e-9&&r[0]>=Math.min(p[0],q[0])-1e-9&&r[0]<=Math.max(p[0],q[0])+1e-9&&r[1]>=Math.min(p[1],q[1])-1e-9&&r[1]<=Math.max(p[1],q[1])+1e-9;
        return abC*abD< -1e-12&&cdA*cdB< -1e-12||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b);
      };
      for(let first=0;first<outline.length;first++)for(let second=first+1;second<outline.length;second++){
        if(second===first+1||first===0&&second===outline.length-1)continue;
        if(intersects(outline[first],outline[(first+1)%outline.length],outline[second],outline[(second+1)%outline.length]))throw Error('Custom extrusion outlines cannot cross themselves.');
      }
      const area=outline.reduce((sum,[x,y],index)=>{const [nextX,nextY]=outline[(index+1)%outline.length];return sum+x*nextY-nextX*y;},0);
      if(Math.abs(area)<1e-6)throw Error('Custom extrusion outlines must enclose an area.');
      parsed.outline=area<0?[...outline].reverse():outline;
      triangulatePolygon(parsed.outline);
    }else if(part.outline!==undefined&&part.outline!==null)throw Error('Only custom polygons and extrusions can have an outline.');
    if(parsed.shape==='line'){
      if(!Array.isArray(part.path)||part.path.length!==2)throw Error('Flat lines need exactly two path points.');
      const path=part.path.map(point=>{
        if(!Array.isArray(point)||point.length!==2||point.some(value=>typeof value!=='number'||!Number.isFinite(value)||value< -1||value>1))throw Error('Line path points must be pairs between -1 and 1.');
        return [point[0],point[1]] as [number,number];
      });
      if(path[0][0]===path[1][0]&&path[0][1]===path[1][1])throw Error('Flat line path points must be different.');
      parsed.path=path;parsed.thickness=number(part.thickness,.01,2);
    }else if(part.path!==undefined&&part.path!==null||part.thickness!==undefined&&part.thickness!==null)throw Error('Only flat lines can have a path or line thickness.');
    if(parsed.shape==='tube'){
      if(!Array.isArray(part.curve)||part.curve.length<3||part.curve.length>16)throw Error('Curved tubes need 3â€“16 path points.');
      const curve=part.curve.map(point=>{if(!Array.isArray(point)||point.length!==3||point.some(value=>typeof value!=='number'||!Number.isFinite(value)||value< -1||value>1))throw Error('Tube path points must be normalized [x, y, z] triples between -1 and 1.');return [point[0],point[1],point[2]] as [number,number,number];});
      if(curve.some((point,index)=>index>0&&Math.hypot(point[0]-curve[index-1][0],point[1]-curve[index-1][1],point[2]-curve[index-1][2])<1e-5))throw Error('Tube path points must not repeat.');
      parsed.curve=curve;parsed.radius=number(part.radius,.01,5);if(part.endRadius!==undefined&&part.endRadius!==null)parsed.endRadius=number(part.endRadius,.01,5);
      if(isClosedTube(curve)){
        if(curve.length<4)throw Error('A closed tube needs at least three distinct control points plus the repeated starting point.');
        if(Math.abs((parsed.endRadius??parsed.radius)-parsed.radius)>1e-9)throw Error('A closed tube must have matching start and end radii.');
      }
    }else if(part.curve!==undefined&&part.curve!==null||part.radius!==undefined&&part.radius!==null||part.endRadius!==undefined&&part.endRadius!==null)throw Error('Only curved tubes can have a curve or radii.');
    if(parsed.z+parsed.height>200)throw Error('The model must fit within 200 metres in height.');
    return parsed;
  });
  for(const part of parts)if(part.cutoutTargets?.some(index=>index>=parts.length||parts[index].shape==='cutout'))throw Error('Cutout targets must refer to existing non-cutout shapes.');
  if(model.transform!==undefined&&model.transform!==null&&(!model.transform||typeof model.transform!=='object'||Array.isArray(model.transform)))throw Error('Model orientation must be an object.');
  const rawTransform=model.transform&&typeof model.transform==='object'?model.transform as Record<string,unknown>:{};
  const transform:PolyTransform={pitch:number(rawTransform.pitch??0,-180,180),roll:number(rawTransform.roll??0,-180,180),yaw:number(rawTransform.yaw??0,-360,360),elevation:number(rawTransform.elevation??0,0,200)};
  return {format:'mapmason-poly',version:1,name:model.name.trim(),parts,...(model.transform!==undefined?{transform}:{})};
}
export const starterModel:PolyModel={format:'mapmason-poly',version:1,name:'Open-air stage',parts:[
  {shape:'box',x:0,y:0,z:0,width:18,depth:10,height:1,rotation:0,color:'#71816f'},
  ...[-8,8].flatMap(x=>[-4,4].map(y=>({shape:'box' as const,x,y,z:1,width:.5,depth:.5,height:6,rotation:0,color:'#34483f'}))),
  {shape:'roof',x:0,y:0,z:7,width:20,depth:12,height:2.5,rotation:0,color:'#bcd891'},
  {shape:'box',x:0,y:3.9,z:1,width:12,depth:.4,height:5,rotation:0,color:'#273b36'}
]};
export type PolyTriangle={cutoutIntersection?:boolean;cutout?:boolean;surfaceIndex?:number;partIndex?:number;positions:number[];color:number[];opacity:number;emissive?:number;vertexOpacity?:[number,number,number];vertexColors?:[number[],number[],number[]];group?:string;shadow?:boolean;text?:{value:string;aspect:number};brick?:boolean;uv?:number[]};
/** Normalized height of a roof surface; omitted profile preserves existing roofs. */
function roofHeight(part:PolyPart,u:number,v:number):number{
  const across=Math.max(0,1-Math.abs(u)),along=Math.max(0,1-Math.abs(v));
  switch(part.roofProfile??'curved'){
    case 'flat':return 1;
    case 'gabled':return across;
    case 'hipped':return Math.min(across*part.width,along*part.depth)/Math.min(part.width,part.depth);
    case 'barrel':return Math.sqrt(Math.max(0,1-u*u));
    case 'pyramid':return Math.min(across,along);
    case 'curved':return Math.pow(Math.max(0,1-u*u),.4)*Math.pow(Math.max(0,1-v*v),.4);
  }
}
const sphereGeometry=(()=>{
  const golden=(1+Math.sqrt(5))/2;
  const normalize=(point:number[])=>{const length=Math.hypot(...point);return point.map(value=>value/length);};
  const vertices=[[-1,golden,0],[1,golden,0],[-1,-golden,0],[1,-golden,0],[0,-1,golden],[0,1,golden],[0,-1,-golden],[0,1,-golden],[golden,0,-1],[golden,0,1],[-golden,0,-1],[-golden,0,1]].map(normalize);
  const faces=[[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]];
  const midpoints=new Map<string,number>();
  const midpoint=(first:number,second:number)=>{
    const key=[first,second].sort((left,right)=>left-right).join(':');
    const existing=midpoints.get(key);if(existing!==undefined)return existing;
    const index=vertices.length;vertices.push(normalize(vertices[first].map((value,axis)=>(value+vertices[second][axis])/2)));midpoints.set(key,index);return index;
  };
  const triangles=faces.flatMap(([first,second,third])=>{
    const firstMid=midpoint(first,second),secondMid=midpoint(second,third),thirdMid=midpoint(third,first);
    return [[first,firstMid,thirdMid],[second,secondMid,firstMid],[third,thirdMid,secondMid],[firstMid,secondMid,thirdMid]];
  });
  return {vertices,faces:triangles};
})();
// Average adjoining face colours at a shared vertex, weighted by corner angle.
// Material boundaries and corners sharper than 45 degrees stay distinct. This
// works with the renderer's baked lighting, including shapes with mixed winding.
function smoothPartTriangles(triangles:PolyTriangle[],materials:Map<PolyTriangle,string>){
  type Corner={normal:number[];color:number[];weight:number};
  const adjacency=new Map<string,Corner[]>(),corners=new Map<PolyTriangle,{key:string;corner:Corner}[]>();
  const dot=(a:number[],b:number[])=>a.reduce((sum,value,i)=>sum+value*b[i],0);
  for(const triangle of triangles){
    const points=[0,3,6].map(at=>triangle.positions.slice(at,at+3)),a=points[1].map((v,i)=>v-points[0][i]),b=points[2].map((v,i)=>v-points[0][i]);
    const cross=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],length=Math.hypot(...cross);
    if(length<1e-12)continue;
    const normal=cross.map(value=>value/length);
    corners.set(triangle,points.map((point,index)=>{
      const first=points[(index+1)%3].map((v,i)=>v-point[i]),second=points[(index+2)%3].map((v,i)=>v-point[i]);
      const weight=Math.acos(Math.max(-1,Math.min(1,dot(first,second)/(Math.hypot(...first)*Math.hypot(...second)))));
      const corner={normal,color:triangle.color,weight},key=point.map(value=>Math.round(value*1e8)).join(',')+'|'+materials.get(triangle);
      if(!adjacency.has(key))adjacency.set(key,[]);adjacency.get(key)!.push(corner);
      return {key,corner};
    }));
  }
  for(const [triangle,vertices] of corners){
    triangle.vertexColors=vertices.map(({key,corner})=>{
      const neighbours=adjacency.get(key)!.filter(other=>Math.abs(dot(other.normal,corner.normal))>=Math.SQRT1_2-1e-8),total=neighbours.reduce((sum,other)=>sum+other.weight,0);
      return [0,1,2].map(channel=>neighbours.reduce((sum,other)=>sum+other.color[channel]*other.weight,0)/total);
    }) as [number[],number[],number[]];
  }
}

export function polyTriangles(model:PolyModel,withShadows=false,showCutouts=false):PolyTriangle[]{
  const triangles:PolyTriangle[]=[],segments=12;
  const lighting=new Map<PolyTriangle,{base:number[];normal:number[];strength:number}>(),smooth:{triangles:PolyTriangle[];materials:Map<PolyTriangle,string>}[]=[];
  const modelAngles=[model.transform?.pitch??0,model.transform?.roll??0,model.transform?.yaw??0].map(value=>value*Math.PI/180);
  const lightNormal=(normal:number[])=>{
    const [pitch,roll,yaw]=modelAngles,[x,y,z]=normal,py=y*Math.cos(pitch)-z*Math.sin(pitch),pz=y*Math.sin(pitch)+z*Math.cos(pitch),rx=x*Math.cos(roll)+pz*Math.sin(roll),rz=-x*Math.sin(roll)+pz*Math.cos(roll);
    return [rx*Math.cos(yaw)-py*Math.sin(yaw),rx*Math.sin(yaw)+py*Math.cos(yaw),rz];
  };
  for(const [partIndex,part] of model.parts.entries()){
    const partStart=triangles.length,materials=new Map<PolyTriangle,string>();
    const angle=part.rotation*Math.PI/180,tiltX=(part.tiltX??0)*Math.PI/180,tiltY=(part.tiltY??0)*Math.PI/180,color=part.color.slice(1).match(/../g)!.map(channel=>parseInt(channel,16)/255),frontColor=part.frontColor?.slice(1).match(/../g)!.map(channel=>parseInt(channel,16)/255),opacity=part.shape==='cutout'?.08:part.opacity??1;
    const transform=(point:number[])=>{let [x,y,z]=point;const y1=y*Math.cos(tiltX)-z*Math.sin(tiltX),z1=y*Math.sin(tiltX)+z*Math.cos(tiltX),x1=x*Math.cos(tiltY)+z1*Math.sin(tiltY),z2=-x*Math.sin(tiltY)+z1*Math.cos(tiltY);return [part.x+x1*Math.cos(angle)+y1*Math.sin(angle),-part.y+x1*Math.sin(angle)-y1*Math.cos(angle),part.z+z2];};
    let surfaceCounter=0;
    const add=(vertices:number[][],face:number[],_shade:number,faceColor=color,surfaceId?:number,brickUV?:number[][])=>{
      const surfaceIndex=surfaceId??surfaceCounter++,override=part.surfaceColors?.[surfaceIndex];
      if(override)faceColor=override.slice(1).match(/../g)!.map(channel=>parseInt(channel,16)/255);
      for(let index=1;index<face.length-1;index++){
        const faceIndices=[face[0],face[index],face[index+1]];const triangle:PolyTriangle={cutout:part.shape==='cutout',partIndex,surfaceIndex,positions:faceIndices.flatMap(vertex=>transform(vertices[vertex])),color:[...faceColor],opacity,emissive:part.emissive??0,group:part.group,...(brickUV?{brick:true,uv:faceIndices.flatMap(vertex=>brickUV[vertex])}:{})};
        const points=[face[0],face[index],face[index+1]].map(at=>vertices[at]),u=points[1].map((value,axis)=>value-points[0][axis]),v=points[2].map((value,axis)=>value-points[0][axis]);
        let normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
        if(['box','cutout','sphere','cylinder','cone','pyramid','wedge','text'].includes(part.shape)){
          const centreZ=part.shape==='box'&&part.rounding!==undefined?0:part.height/2;
          const outward=[0,1,2].map(axis=>points.reduce((sum,point)=>sum+point[axis],0)/3-(axis===2?centreZ:0));
          if(normal.reduce((sum,value,axis)=>sum+value*outward[axis],0)<0)normal=normal.map(value=>-value);
        }else if(part.shape==='roof'){
          const cy=points.reduce((sum,point)=>sum+point[1],0)/3;
          if(Math.abs(normal[2])>1e-10?normal[2]<0:normal[1]*cy<0)normal=normal.map(value=>-value);
        }else if(part.shape==='surface'||part.shape==='line'){
          if(normal[2]<0)normal=normal.map(value=>-value);
        }
        const zero=transform([0,0,0]),worldNormal=transform(normal).map((value,axis)=>value-zero[axis]);
        lighting.set(triangle,{base:[...faceColor],normal:lightNormal(worldNormal),strength:part.shadingStrength??1});
        triangles.push(triangle);if(part.smoothShading)materials.set(triangle,faceColor.join(','));
      }
    };
    const west=-part.width/2,east=part.width/2,front=-part.depth/2,back=part.depth/2,height=part.height,topW=(part.topWidth??part.width)/2,topD=(part.topDepth??part.depth)/2;
    if(part.shape==='tube'){
      const controls=part.curve!.map(([x,y,z])=>[x*part.width/2,y*part.depth/2,(z+1)*part.height/2]);
      const closed=isClosedTube(part.curve!);if(closed)controls.pop();
      const segmentCount=closed?controls.length:controls.length-1;
      const control=(index:number)=>controls[closed?(index+controls.length)%controls.length:Math.max(0,Math.min(controls.length-1,index))];
      const samples:{point:number[];radius:number}[]=[],steps=6;
      const catmull=(p0:number[],p1:number[],p2:number[],p3:number[],t:number)=>p1.map((value,axis)=>.5*((2*value)+(-p0[axis]+p2[axis])*t+(2*p0[axis]-5*value+4*p2[axis]-p3[axis])*t*t+(-p0[axis]+3*value-3*p2[axis]+p3[axis])*t*t*t));
      for(let segment=0;segment<segmentCount;segment++)for(let step=0;step<steps;step++){
        const t=step/steps,p0=control(segment-1),p1=control(segment),p2=control(segment+1),p3=control(segment+2),point=catmull(p0,p1,p2,p3,t),progress=(segment+t)/segmentCount;
        samples.push({point,radius:part.radius!+((part.endRadius??part.radius!)-part.radius!)*progress});
      }
      if(!closed)samples.push({point:controls.at(-1)!,radius:part.endRadius??part.radius!});
      const radialSegments=12,rings:number[][][]=[];
      for(let index=0;index<samples.length;index++){
        const previous=samples[closed?(index+samples.length-1)%samples.length:Math.max(0,index-1)].point,next=samples[closed?(index+1)%samples.length:Math.min(samples.length-1,index+1)].point,tangent=next.map((value,axis)=>value-previous[axis]),length=Math.hypot(...tangent)||1;tangent.forEach((value,axis)=>tangent[axis]=value/length);
        const reference=Math.abs(tangent[2])>.9?[0,1,0]:[0,0,1],cross=(a:number[],b:number[])=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],unit=(value:number[])=>{const size=Math.hypot(...value)||1;return value.map(component=>component/size);},u=unit(cross(tangent,reference)),v=unit(cross(tangent,u));
        rings.push(Array.from({length:radialSegments},(_,side)=>{const angle=side*Math.PI*2/radialSegments;return samples[index].point.map((value,axis)=>value+samples[index].radius*(u[axis]*Math.cos(angle)+v[axis]*Math.sin(angle)));}));
      }
      const vertices=rings.flat();
      if(!closed){
        const baseCenter=vertices.length;vertices.push(samples[0].point);const endCenter=vertices.length;vertices.push(samples.at(-1)!.point);
        add(vertices,[baseCenter,...Array.from({length:radialSegments},(_,side)=>radialSegments-1-side)],.6);
        add(vertices,[endCenter,...Array.from({length:radialSegments},(_,side)=>(rings.length-1)*radialSegments+side)],1);
      }
      for(let ring=0;ring<(closed?rings.length:rings.length-1);ring++)for(let side=0;side<radialSegments;side++){
        const next=(side+1)%radialSegments,nextRing=(ring+1)%rings.length,a=ring*radialSegments+side,b=ring*radialSegments+next,c=nextRing*radialSegments+next,d=nextRing*radialSegments+side;
        add(vertices,[a,b,c,d],.82+.16*Math.cos((side+.5)*Math.PI*2/radialSegments));
      }
    }else if(part.shape==='line'){
      const [start,end]=part.path!,startX=start[0]*part.width/2,startY=start[1]*part.depth/2,endX=end[0]*part.width/2,endY=end[1]*part.depth/2,dx=endX-startX,dy=endY-startY,length=Math.hypot(dx,dy),half=part.thickness!/2,nx=-dy/length*half,ny=dx/length*half;
      add([[startX+nx,startY+ny,0],[startX-nx,startY-ny,0],[endX-nx,endY-ny,0],[endX+nx,endY+ny,0]],[0,1,2,3],1);
    }else if(part.shape==='surface'){
      const outline=part.outline!,vertices=outline.map(([x,y])=>[x*part.width/2,y*part.depth/2,0]);
      for(const triangle of triangulatePolygon(outline))add(vertices,triangle,1);
    }else if(part.shape==='extrusion'){
      const outline=part.outline!,count=outline.length,vertices=[...outline.map(([x,y])=>[x*part.width/2,y*part.depth/2,0]),...outline.map(([x,y])=>[x*part.width/2,y*part.depth/2,height])];
      for(const triangle of triangulatePolygon(outline)){add(vertices,[triangle[0],triangle[2],triangle[1]],.6);add(vertices,triangle.map(index=>count+index),1);}
      for(let index=0;index<count;index++){const next=(index+1)%count,brickUV=part.brickTexture?vertices.map(point=>[point[0],point[2]]):undefined;add(vertices,[index,next,count+next,count+index],.72+.18*Math.cos(index*Math.PI*2/count),color,undefined,brickUV);}
    }else if(part.shape==='sphere'){
      const vertices=sphereGeometry.vertices.map(([east,north,up])=>[east*part.width/2,north*part.depth/2,(up+1)*height/2]);
      for(const face of sphereGeometry.faces){
        const normal=face.map(index=>sphereGeometry.vertices[index]).reduce((sum,point)=>sum.map((value,axis)=>value+point[axis]),[0,0,0]);
        const length=Math.hypot(...normal),shade=.76+.23*(normal[0]*.35-normal[1]*.25+normal[2]*.9)/length;
        add(vertices,face,shade);
      }
    }else if(part.shape==='roof'){
      const steps=16,vertices:number[][]=[];for(let row=0;row<=steps;row++){const y=front+(back-front)*row/steps,v=y/(part.depth/2);for(let column=0;column<=steps;column++){const x=west+(east-west)*column/steps,u=x/(part.width/2);vertices.push([x,y,height*roofHeight(part,u,v)]);}}
      for(let row=0;row<steps;row++)for(let column=0;column<steps;column++){const a=row*(steps+1)+column,b=a+1,d=a+steps+1,c=d+1;add(vertices,[a,b,c,d],1);}
      if(part.endCaps&&(part.roofProfile==='gabled'||part.roofProfile==='barrel')){
        for(const y of [front,back]){
          const cap=[[0,y,0],...Array.from({length:steps+1},(_,index)=>{
            const u=index*2/steps-1;
            return [u*part.width/2,y,height*roofHeight(part,u,0)];
          })];
          for(let index=0;index<steps;index++)add(cap,y===front?[0,index+1,index+2]:[0,index+2,index+1],y===front?.85:.7);
        }
      }
    }else if(part.shape==='cylinder'||part.shape==='cone'){
      const base=Array.from({length:segments},(_,index)=>[Math.cos(index*Math.PI*2/segments)*part.width/2,Math.sin(index*Math.PI*2/segments)*part.depth/2,0]),top=Array.from({length:segments},(_,index)=>[Math.cos(index*Math.PI*2/segments)*topW,Math.sin(index*Math.PI*2/segments)*topD,height]),vertices=[...base,...top];
      add(vertices,Array.from({length:segments},(_,index)=>index),.6);add(vertices,Array.from({length:segments},(_,index)=>index+segments),1);
      for(let index=0;index<segments;index++)add(vertices,[index,(index+1)%segments,(index+1)%segments+segments,index+segments],.7+.2*Math.cos(index*Math.PI*2/segments));
    }else if(part.shape==='pyramid'){
      const vertices=[[west,front,0],[east,front,0],[east,back,0],[west,back,0],[0,0,height]];add(vertices,[0,3,2,1],.6);for(let index=0;index<4;index++)add(vertices,[index,(index+1)%4,4],.75+.07*index);
    }else if(part.shape==='wedge'){
      const vertices=[[west,front,0],[east,front,0],[east,back,0],[west,back,0],[west,front,height],[east,front,height]];
      for(const [face,shade]of [[[0,3,2,1],.6],[[0,1,5,4],.72],[[1,2,5],.85],[[2,3,4,5],.9],[[3,0,4],.78],[[4,5,2,3],1]] as [number[],number][])add(vertices,face,shade);
    }else if(part.shape==='arch'){
      // Matching inner/outer paths share one spring line; feet and curve form
      // one continuous strip, extruded through depth without separate leg boxes.
      const steps=24,rise=part.archRise??height*.42,spring=height-rise,innerW=(part.openingWidth??part.width*.48)/2,crown=part.crownThickness??Math.min(height*.1,rise*.25);
      const arc=(radius:number,rise:number)=>Array.from({length:steps+1},(_,index)=>{
        const angle=Math.PI-index*Math.PI/steps;
        return [Math.cos(angle)*radius,spring+(index===0||index===steps?0:Math.sin(angle)*rise)];
      });
      const outer=spring>0?[[west,0],...arc(part.width/2,rise),[east,0]]:arc(part.width/2,rise);
      const inner=spring>0?[[-innerW,0],...arc(innerW,rise-crown),[innerW,0]]:arc(innerW,rise-crown);
      const count=outer.length,ringSize=count*2,vertices:number[][]=[];
      for(const y of [front,back])for(const path of [outer,inner])for(const [x,z]of path)vertices.push([x,y,z]);
      for(let index=0;index<count-1;index++){
        const a=index,b=index+1,ia=count+a,ib=count+b,ba=ringSize+a,bb=ringSize+b,bia=ringSize+ia,bib=ringSize+ib;
        add(vertices,[a,b,ib,ia],.85);
        add(vertices,[ba,bia,bib,bb],.7);
        add(vertices,[a,ba,bb,b],.75);
        add(vertices,[ia,ib,bib,bia],.9);
      }
      add(vertices,[0,count,ringSize+count,ringSize],.6);
      const last=count-1;add(vertices,[last,ringSize+last,ringSize+count+last,count+last],.6);
    }else if(part.shape==='text'){
      const panelVertices=[[west,front,0],[east,front,0],[east,back,0],[west,back,0],[west,front,height],[east,front,height],[east,back,height],[west,back,height]];
      for(const [face,shade]of [[[0,3,2,1],.6],[[4,5,6,7],1],[[0,1,5,4],.72],[[1,2,6,5],.85],[[2,3,7,6],.9],[[3,0,4,7],.78]] as [number[],number][]){
        const start=triangles.length;add(panelVertices,face,shade);
        if(face[0]===0&&face[1]===1){
          const text={value:(part.text??'').toUpperCase(),aspect:part.width/part.height};
          triangles[start].text=text;triangles[start].uv=[0,0,1,0,1,1];
          triangles[start+1].text=text;triangles[start+1].uv=[0,0,1,1,0,1];
        }
      }
    }else if(part.shape==='box'&&part.rounding!==undefined){
      const halves=[part.width/2,part.depth/2,part.height/2],radius=part.rounding,divisions=part.topColor?48:12;
      const coordinates=halves.map(half=>{
        if(!part.smoothShading)return Array.from({length:divisions+1},(_,index)=>-half+2*half*index/divisions);
        const points=[-half,half],core=half-radius;
        // Concentrate samples within each bevel, including very small radii.
        // Curved tops still need interior samples to describe their silhouette.
        if(part.topRise||part.topColor)for(let index=1;index<divisions;index++)points.push(-half+2*half*index/divisions);
        if(radius>0)for(let index=0;index<=8;index++)for(const sign of [-1,1])points.push(sign*(core+radius*Math.tan(index*Math.PI/32)));
        return [...new Set(points.map(value=>Math.round(value*1e12)/1e12))].sort((a,b)=>a-b);
      });
      const surface=(point:number[],faceAxis:number,faceSign:number)=>{const core=point.map((value,axis)=>Math.max(-halves[axis]+radius,Math.min(halves[axis]-radius,value))),delta=point.map((value,axis)=>value-core[axis]),length=Math.hypot(...delta),position=core.map((value,axis)=>length?value+delta[axis]*radius/length:value),normal=length?delta.map(value=>value/length):[0,0,0];if(!length)normal[faceAxis]=faceSign;if(part.topRise){const blend=radius?Math.max(0,Math.min(1,(point[2]-(halves[2]-radius))/radius)):Number(point[2]>=halves[2]),across=position[0]/halves[0],along=position[1]/halves[1],roofProfile=(1-across*across)*(1-along*along),slopeX=-2*part.topRise*position[0]*(1-along*along)/(halves[0]*halves[0])*blend,slopeY=-2*part.topRise*position[1]*(1-across*across)/(halves[1]*halves[1])*blend,step=part.topStep&&point[1]/halves[1]>= (part.topStepAt??-0.25)?part.topStep:0;position[2]+=(step+part.topRise*roofProfile)*blend;const adjusted=[normal[0]-slopeX*normal[2],normal[1]-slopeY*normal[2],normal[2]],adjustedLength=Math.hypot(...adjusted)||1;for(let axis=0;axis<3;axis++)normal[axis]=adjusted[axis]/adjustedLength;}return {position,normal};};
      for(let axis=0;axis<3;axis++)for(const sign of [-1,1]){
        const surfaceId=axis===0?(sign<0?5:3):axis===1?(sign<0?2:4):(sign<0?0:1);
        const baseFaceColor=axis===1&&sign===-1&&frontColor?frontColor:color;
        const u=(axis+1)%3,v=(axis+2)%3,us=coordinates[u],vs=coordinates[v],grid=vs.map(vValue=>us.map(uValue=>{const point=[0,0,0];point[axis]=sign*halves[axis];point[u]=uValue;point[v]=vValue;return surface(point,axis,sign).position;}));
        for(let row=0;row<vs.length-1;row++)for(let column=0;column<us.length-1;column++){
          const vertices=[grid[row][column],grid[row][column+1],grid[row+1][column+1],grid[row+1][column]];
          const raw=[0,0,0];raw[axis]=sign*halves[axis];raw[u]=(us[column]+us[column+1])/2;raw[v]=(vs[row]+vs[row+1])/2;
          const rounded=surface(raw,axis,sign),shade=1;
          const topColor=part.topColor?.slice(1).match(/../g)!.map(channel=>parseInt(channel,16)/255);
          if(topColor&&part.topRise){
            type BoundaryPoint={position:number[];score:number};
            const boundaryScore=(position:number[])=>position[2]-(halves[2]-radius-part.topRise!*.5-(radius?0:.0001));
            const clip=(keepTop:boolean)=>{
              const polygon:BoundaryPoint[]=[];
              for(let edge=0;edge<vertices.length;edge++){
                const a=vertices[edge],b=vertices[(edge+1)%vertices.length],scoreA=boundaryScore(a),scoreB=boundaryScore(b),insideA=keepTop?scoreA>=0:scoreA<=0,insideB=keepTop?scoreB>=0:scoreB<=0;
                if(insideA)polygon.push({position:a,score:scoreA});
                if(insideA!==insideB){const amount=scoreA/(scoreA-scoreB);polygon.push({position:a.map((value,index)=>value+(b[index]-value)*amount),score:0});}
              }
              return polygon.map(point=>point.position);
            };
            const topPolygon=clip(true),basePolygon=clip(false);
            if(basePolygon.length>=3)add(basePolygon,basePolygon.map((_,index)=>index),shade,baseFaceColor,surfaceId);
            if(topPolygon.length>=3)add(topPolygon,topPolygon.map((_,index)=>index),Math.max(shade,.9),topColor,surfaceId);
          }else{
            const isTopColor=Boolean(topColor&&rounded.position[2]>=halves[2]-radius),faceColor=isTopColor?topColor!:baseFaceColor;
            add(vertices,[0,1,2,3],isTopColor?Math.max(shade,.9):shade,faceColor,surfaceId);
          }
        }
      }
    }else{
      const base=[[-part.width/2,front,0],[part.width/2,front,0],[part.width/2,back,0],[-part.width/2,back,0]],top=[[-topW,-topD,height],[topW,-topD,height],[topW,topD,height],[-topW,topD,height]],vertices=[...base,...top];
      for(const [face,shade]of [[[0,3,2,1],.6],[[4,5,6,7],1],[[0,1,5,4],.72],[[1,2,6,5],.85],[[2,3,7,6],.9],[[3,0,4,7],.78]] as [number[],number][]){const isFrontBack=face[0]===0&&face[1]===1||face[0]===2&&face[1]===3;const brickUV=part.brickTexture&&isFrontBack?vertices.map(point=>[point[0],point[2]]):undefined;add(vertices,face,shade,face[0]===0&&face[1]===1?frontColor:undefined,undefined,brickUV);}
    }
    const partTriangles=triangles.slice(partStart);
    if(part.shape==='arch'||part.shape==='tube'||part.shape==='extrusion'){
      const volume=partTriangles.reduce((sum,triangle)=>{const p=triangle.positions;return sum+p[0]*(p[4]*p[8]-p[5]*p[7])+p[1]*(p[5]*p[6]-p[3]*p[8])+p[2]*(p[3]*p[7]-p[4]*p[6]);},0);
      // The model's coordinate conversion reflects y, reversing mesh winding.
      if(volume>0)for(const triangle of partTriangles){const entry=lighting.get(triangle)!;entry.normal=entry.normal.map(value=>-value);}
    }
    if(part.smoothShading)smooth.push({triangles:partTriangles,materials});
  }
  const transform=model.transform??{pitch:0,roll:0,yaw:0,elevation:0};
  if(transform.pitch||transform.roll||transform.yaw||transform.elevation){
    const solidTriangles=triangles.filter(triangle=>!triangle.cutout),points=(solidTriangles.length?solidTriangles:triangles).flatMap(triangle=>[0,3,6].map(at=>triangle.positions.slice(at,at+3))),bounds=pointBounds(points),pivot=[0,1,2].map(axis=>axis===2?bounds.min[axis]:(bounds.min[axis]+bounds.max[axis])/2);
    const angles=[transform.pitch,transform.roll,transform.yaw].map(value=>value*Math.PI/180),[cp,cr,cy]=angles,[sp,sr,sy]=angles.map(Math.sin),[cosP,cosR,cosY]=[cp,cr,cy].map(Math.cos);
    const rotate=(point:number[])=>{let [x,y,z]=point.map((value,axis)=>value-pivot[axis]);const py=y*cosP-z*sp,pz=y*sp+z*cosP,rx=x*cosR+pz*sr,rz=-x*sr+pz*cosR,ry=py,fx=rx*cosY-ry*sy,fy=rx*sy+ry*cosY;return [fx+pivot[0],fy+pivot[1],rz+pivot[2]];};
    const rotated=points.map(rotate),floor=pointBounds(rotated).min[2];
    for(const triangle of triangles)triangle.positions=triangle.positions.flatMap((_,index,array)=>index%3===0?rotate(array.slice(index,index+3)).map((value,axis)=>axis===2?value-floor+transform.elevation:value):[]);
  }
  // One shared directional light for all geometry; never derive lighting from part names.
  const light=[-.35,.45,.82],lightLength=Math.hypot(...light);
  for(const [triangle,entry] of lighting){
    const length=Math.hypot(...entry.normal),diffuse=length?Math.max(0,entry.normal.reduce((sum,value,axis)=>sum+value*light[axis],0)/(length*lightLength)):1;
    const brightness=1-(1-(.62+.38*diffuse))*entry.strength;
    triangle.color=entry.base.map(value=>value*brightness);
  }
  for(const part of smooth)smoothPartTriangles(part.triangles,part.materials);
  // Omit solid shapes' horizontal ground-contact faces so openings reveal the actual ground.
  // Flat design details such as lines and surfaces live at ground level and must remain visible.
  for(let index=triangles.length-1;index>=0;index--){
    const triangle=triangles[index];
    const part=triangle.partIndex===undefined?undefined:model.parts[triangle.partIndex];
    if(!triangle.cutout&&part?.shape!=='line'&&part?.shape!=='surface'&&[2,5,8].every(at=>Math.abs(triangle.positions[at])<.001))triangles.splice(index,1);
  }
  if(model.parts.some(part=>part.shape==='cutout')){
    const clipped=applyPolyCutouts(triangles,model.parts,showCutouts);triangles.length=0;for(const triangle of clipped)triangles.push(triangle);
  }
  if(withShadows&&triangles.some(triangle=>!triangle.cutout)){
    const points=triangles.filter(triangle=>!triangle.cutout).flatMap(triangle=>[0,3,6].map(at=>triangle.positions.slice(at,at+3))),bounds=pointBounds(points),floor=bounds.min[2],opacity=.17*Math.exp(-Math.max(0,floor)/18),center=[(bounds.min[0]+bounds.max[0])/2,(bounds.min[1]+bounds.max[1])/2],radiusX=Math.max(.2,(bounds.max[0]-bounds.min[0])*.54)*1.35,radiusY=Math.max(.2,(bounds.max[1]-bounds.min[1])*.54)*1.35,rings=8,sides=32,z=.003,color=[.055,.075,.06];
    const shadowPoint=(radius:number,side:number)=>[center[0]+Math.cos(side*Math.PI*2/sides)*radiusX*radius,center[1]+Math.sin(side*Math.PI*2/sides)*radiusY*radius,z],shadowTriangle=(a:number[],b:number[],c:number[],alpha:[number,number,number])=>triangles.push({positions:[...a,...b,...c],color,opacity,vertexOpacity:alpha,shadow:true});
    for(let ring=0;ring<rings;ring++){
      const inner=ring/rings,outer=(ring+1)/rings,innerAlpha=opacity*(1-inner)*(1-inner),outerAlpha=opacity*(1-outer)*(1-outer);
      for(let side=0;side<sides;side++){
        const next=side+1;
        if(ring===0)shadowTriangle([center[0],center[1],z],shadowPoint(outer,side),shadowPoint(outer,next),[opacity,outerAlpha,outerAlpha]);
        else{
          const a=shadowPoint(inner,side),b=shadowPoint(inner,next),c=shadowPoint(outer,next),d=shadowPoint(outer,side);
          shadowTriangle(a,b,c,[innerAlpha,innerAlpha,outerAlpha]);shadowTriangle(a,c,d,[innerAlpha,outerAlpha,outerAlpha]);
        }
      }
    }
  }
  return triangles;
}
export function polyGlowTriangles(triangles:PolyTriangle[]):PolyTriangle[]{
  const groups=new Map<string,PolyTriangle[]>();
  triangles.forEach((triangle,index)=>{
    if((triangle.emissive??0)<=0||triangle.opacity<=0||triangle.shadow)return;
    const key=triangle.group??`part:${triangle.partIndex??index}`,group=groups.get(key);
    if(group)group.push(triangle);else groups.set(key,[triangle]);
  });
  const glow:PolyTriangle[]=[],layers=16;
  const weights=Array.from({length:layers},(_,layer)=>Math.exp(-4*(layer/layers)**2)*(1-(layer+1)/(layers+1))**2),weightSum=weights.reduce((sum,value)=>sum+value,0);
  for(const group of groups.values()){
    const center=[0,0,0];let count=0,intensity=0;
    for(const triangle of group){intensity=Math.max(intensity,triangle.emissive??0);for(const at of [0,3,6]){for(let axis=0;axis<3;axis++)center[axis]+=triangle.positions[at+axis];count++;}}
    for(let axis=0;axis<3;axis++)center[axis]/=count;
    // Many faint shells approximate a diffuse halo: the outer shells fade to zero.
    // Keep total energy bounded as layers are added, rather than whitening the object.
    for(let layer=layers-1;layer>=0;layer--){
      const spread=(.14+.3*intensity)*(layer+1)/layers,weight=.14*intensity*weights[layer]/weightSum;
      for(const triangle of group){
        const positions=triangle.positions.map((value,index)=>center[index%3]+(value-center[index%3])*(1+spread));
        glow.push({...triangle,positions,opacity:weight*triangle.opacity,emissive:0,vertexOpacity:undefined,vertexColors:undefined,shadow:false,text:undefined,uv:undefined});
      }
    }
  }
  return glow;
}

export function polyModelDimensions(model:PolyModel){
  const positions=polyTriangles(model).flatMap(triangle=>[triangle.positions.slice(0,3),triangle.positions.slice(3,6),triangle.positions.slice(6,9)]);
  const bounds=pointBounds(positions),extent=(axis:number)=>Math.max(.5,bounds.max[axis]-bounds.min[axis]);
  return {width:extent(0),depth:extent(1),height:extent(2)};
}
export function polyFeatures(model:PolyModel):GeoJSON.FeatureCollection<GeoJSON.Polygon>{
  const features:GeoJSON.Feature<GeoJSON.Polygon>[]=[];
  model.parts.forEach((part,index)=>{
    if(part.shape==='cutout')return;
    const angle=part.rotation*Math.PI/180;
    const point=(east:number,north:number):Coord=>offset([0,0],part.x+east*Math.cos(angle)+north*Math.sin(angle),part.y-east*Math.sin(angle)+north*Math.cos(angle));
    const add=(ring:Coord[],height:number)=>features.push({type:'Feature',properties:{part:index,color:part.color,base:part.z,height:part.z+height,opacity:part.opacity??1,group:part.group},geometry:{type:'Polygon',coordinates:[[...ring,ring[0]]]}});
    if(part.shape==='cylinder'||part.shape==='cone'||part.shape==='sphere')add(Array.from({length:12},(_,side)=>point(Math.cos(side*Math.PI/6)*part.width/2,Math.sin(side*Math.PI/6)*part.depth/2)),part.height);
    else if(part.shape==='surface')add(part.outline!.map(([x,y])=>point(x*part.width/2,y*part.depth/2)),0);
    else if(part.shape==='extrusion')add(part.outline!.map(([x,y])=>point(x*part.width/2,y*part.depth/2)),part.height);
    else if(part.shape==='line'){
      const [start,end]=part.path!,startX=start[0]*part.width/2,startY=start[1]*part.depth/2,endX=end[0]*part.width/2,endY=end[1]*part.depth/2,dx=endX-startX,dy=endY-startY,length=Math.hypot(dx,dy),half=part.thickness!/2,nx=-dy/length*half,ny=dx/length*half;
      add([[startX+nx,startY+ny],[startX-nx,startY-ny],[endX-nx,endY-ny],[endX+nx,endY+ny]].map(([x,y])=>point(x,y)),0);
    }
    else if(part.shape==='roof'||part.shape==='pyramid')for(let slice=0;slice<12;slice++){
      const west=-part.width/2+part.width*slice/12,east=west+part.width/12;
      add([point(west,-part.depth/2),point(east,-part.depth/2),point(east,part.depth/2),point(west,part.depth/2)],part.height*(part.shape==='roof'?roofHeight(part,(slice+.5)/6-1,0):1-Math.abs((slice+.5)/6-1)));
    }else add([point(-part.width/2,-part.depth/2),point(part.width/2,-part.depth/2),point(part.width/2,part.depth/2),point(-part.width/2,part.depth/2)],part.height);
  });
  return {type:'FeatureCollection',features};
}
