import {PolyTextTexture,polyVertexShader,polyFragmentShader} from './polyTextTexture';
import {MercatorCoordinate,type CustomLayerInterface,type CustomRenderMethodInput,type Map as LibreMap} from 'maplibre-gl';
import {polyGlowTriangles,polyTriangles,type PolyModel,type PolyTriangle} from './polyModel';
import {offset,pathProfile,wallPaths,type EventProject,type SiteObject,type SiteWall} from './model';
import {deckProjection,projectDeckPoint} from './pathDeck';

type VertexTriangle={positions:number[];color:number[];vertexColors?:PolyTriangle['vertexColors'];opacity:number;emissive?:number;text?:PolyTriangle['text'];brick?:boolean;group?:string;uv?:number[];id:string};
type BaseMesh={triangles:PolyTriangle[];min:[number,number,number];max:[number,number,number]};
type ModelMesh={id:string;base:BaseMesh;position:[number,number];terrainElevation:number;center:[number,number];root:number;sx:number;sy:number;sz:number;lift:number;min:[number,number,number];max:[number,number,number];triangles:VertexTriangle[];glow:VertexTriangle[];transparentStart:number;transparentCount:number};
export class MapObjectModelsLayer implements CustomLayerInterface{
  constructor(private onRender:()=>void=()=>{}){}
  readonly id='object-models';readonly type='custom' as const;readonly renderingMode='3d' as const;
  private map?:LibreMap;private gl?:WebGL2RenderingContext;private program?:WebGLProgram;private opaqueBuffer?:WebGLBuffer;private transparentBuffer?:WebGLBuffer;private opaqueVao?:WebGLVertexArrayObject;private transparentVao?:WebGLVertexArrayObject;private uniform?:WebGLUniformLocation|null;private textUniform?:WebGLUniformLocation|null;private textTexture=new PolyTextTexture();
  private matrix=new Float32Array(16);private models:ModelMesh[]=[];private visibleTriangles:VertexTriangle[]=[];private baseMeshes=new Map<string,BaseMesh>();private active=false;private signature='';private origin:[number,number]=[0,0];private geometryDirty=true;private opaqueVertexCount=0;private glowVertexCount=0;
  update(project:EventProject,mode:'2d'|'3d'){
    const signature=JSON.stringify([project.center,project.objects.filter(object=>object.customModel),project.walls,mode]);if(signature===this.signature)return;
    this.signature=signature;this.active=mode==='3d';this.origin=project.center;this.models=[];this.visibleTriangles=[];
    if(this.active)for(const object of project.objects)if(object.customModel)this.addObject(object);
    if(this.active)for(const wall of project.walls??[])this.addWall(wall,project.walls??[]);
    for(const model of this.models){model.triangles=this.placedTriangles(model);model.glow=this.placedTriangles(model,polyGlowTriangles(model.base.triangles));}
    this.geometryDirty=true;
    this.map?.triggerRepaint();
  }
  private addWall(wall:SiteWall,allWalls:SiteWall[]){
    const metres=Math.PI/180*6371000;
    const profile=pathProfile(wallPaths([wall])[0]);
    const positions=profile.map(point=>point.position);
    const distance=(a:[number,number],b:[number,number])=>{const cos=Math.cos((a[1]+b[1])*.5*Math.PI/180);return Math.hypot((a[0]-b[0])*metres*cos,(a[1]-b[1])*metres);};
    const nearRoute=(point:[number,number],route:[number,number][])=>{
      let nearest:[number,number]|undefined,best=Infinity;
      for(let index=1;index<route.length;index++){
        const a=route[index-1],b=route[index],cos=Math.cos((a[1]+b[1])*.5*Math.PI/180),dx=(b[0]-a[0])*metres*cos,dy=(b[1]-a[1])*metres,length2=dx*dx+dy*dy;
        if(length2<1e-8)continue;
        const px=(point[0]-a[0])*metres*cos,py=(point[1]-a[1])*metres,t=Math.max(0,Math.min(1,(px*dx+py*dy)/length2)),candidate: [number,number]=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t],separation=distance(point,candidate);
        if(separation<best){best=separation;nearest=candidate;}
      }
      return best<=.15?nearest:undefined;
    };
    const joinPositions:[number,number][]=[];
    if(wall.style==='timber')for(const other of allWalls){
      if(other.id===wall.id)continue;
      const otherRoute=pathProfile(wallPaths([other])[0]).map(point=>point.position);
      for(const point of wall.points){const join=nearRoute(point,otherRoute);if(join&&!joinPositions.some(existing=>distance(existing,join)<.05))joinPositions.push(join);}
      for(const point of other.points){const join=nearRoute(point,positions);if(join&&!joinPositions.some(existing=>distance(existing,join)<.05))joinPositions.push(join);}
    }
    if(wall.style==='timber'&&positions.length>1){
      const first=positions[0],last=positions.at(-1)!,latitude=(first[1]+last[1])*.5,cos=Math.cos(latitude*Math.PI/180),east=(last[0]-first[0])*metres*cos,north=(last[1]-first[1])*metres,length=Math.hypot(east,north),chordLengthSquared=east*east+north*north;
      let previous=-Infinity,straight=length>.01;
      for(const point of positions){const pointEast=(point[0]-first[0])*metres*cos,pointNorth=(point[1]-first[1])*metres,along=(pointEast*east+pointNorth*north)/(chordLengthSquared||1),deviation=Math.abs(pointEast*north-pointNorth*east)/(length||1);if(deviation>.03||along<previous-1e-5){straight=false;break;}previous=along;}
      if(straight){
        const postWidth=Math.min(1,.24/length),postCount=Math.max(2,Math.floor(length)+1),parts:PolyModel['parts']=[];
        const hiddenPosts=new Set<number>();
        for(const join of joinPositions){
          const joinEast=(join[0]-first[0])*metres*cos,joinNorth=(join[1]-first[1])*metres,joinAlong=(joinEast*east+joinNorth*north)/(chordLengthSquared||1),joinDistance=Math.max(0,Math.min(length,joinAlong*length));
          const candidates=Array.from({length:postCount},(_,index)=>({index,distance:Math.abs(index*length/(postCount-1)-joinDistance)})).sort((a,b)=>a.distance-b.distance);
          const nearest=candidates.find(candidate=>candidate.distance>.05&&candidate.distance<=.75&&!hiddenPosts.has(candidate.index));
          if(nearest)hiddenPosts.add(nearest.index);
        }
        for(let index=0;index<postCount;index++){if(hiddenPosts.has(index))continue;const x=-1+2*index/(postCount-1);parts.push({shape:'box',x,y:0,z:0,width:postWidth,depth:1,height:1.9,rotation:0,color:wall.postColor??'#765437',group:'wall-post'});}
        for(const z of [.93,1.71])parts.push({shape:'box',x:0,y:0,z,width:2,depth:.7,height:.15,rotation:0,color:'#a47750'});
        const model:PolyModel={format:'mapmason-poly',version:1,name:wall.name,parts},object:SiteObject={id:wall.id,kind:'custom',name:wall.name,position:offset(first,east/2,north/2),width:length+postWidth*length/2,depth:wall.thickness,height:wall.height,rotation:Math.atan2(-north,east)*180/Math.PI,customModelId:'map-wall-'+wall.style,customModel:model};this.addObject(object);return;
      }
    }
    if(wall.style==='panel'&&positions.length>1){
      const first=positions[0],last=positions.at(-1)!,latitude=(first[1]+last[1])*.5,cos=Math.cos(latitude*Math.PI/180),east=(last[0]-first[0])*metres*cos,north=(last[1]-first[1])*metres,length=Math.hypot(east,north),chordLengthSquared=east*east+north*north;
      let previous=-Infinity,straight=length>.01;
      for(const point of positions){const pointEast=(point[0]-first[0])*metres*cos,pointNorth=(point[1]-first[1])*metres,along=(pointEast*east+pointNorth*north)/(chordLengthSquared||1),deviation=Math.abs(pointEast*north-pointNorth*east)/(length||1);if(deviation>.03||along<previous-1e-5){straight=false;break;}previous=along;}
      if(straight){
        const postWidth=Math.min(1,.24/length),postCount=Math.max(2,Math.ceil(length/2)+1),parts:PolyModel['parts']=[];
        for(let index=0;index<postCount;index++){const x=-1+2*index/(postCount-1);parts.push({shape:'box',x,y:0,z:0,width:postWidth,depth:1,height:2,rotation:0,color:wall.postColor??'#765437',group:'wall-post'});}
        parts.push({shape:'box',x:0,y:0,z:.1,width:2,depth:.8,height:1.8,rotation:0,color:'#a47750'});
        const model:PolyModel={format:'mapmason-poly',version:1,name:wall.name,parts},object:SiteObject={id:wall.id,kind:'custom',name:wall.name,position:offset(first,east/2,north/2),width:length+postWidth*length/2,depth:wall.thickness,height:wall.height,rotation:Math.atan2(-north,east)*180/Math.PI,customModelId:'map-wall-'+wall.style,customModel:model};this.addObject(object);return;
      }
    }
    const segments:{first:[number,number];last:[number,number]}[]=[];
    if(wall.style==='panel'||wall.style==='timber'){
      let routeLength=0;
      for(let index=1;index<positions.length;index++){const first=positions[index-1],last=positions[index],cos=Math.cos((first[1]+last[1])*.5*Math.PI/180);routeLength+=Math.hypot((last[0]-first[0])*metres*cos,(last[1]-first[1])*metres);}
      const bayCount=Math.max(1,Math.floor(routeLength)),bayWidth=wall.style==='panel'?2:routeLength/bayCount;
      let panelStart=positions[0],panelDistance=0;
      for(let index=1;index<positions.length;index++){
        const first=positions[index-1],last=positions[index],cos=Math.cos((first[1]+last[1])*.5*Math.PI/180),east=(last[0]-first[0])*metres*cos,north=(last[1]-first[1])*metres,edgeLength=Math.hypot(east,north);
        if(edgeLength<.001)continue;
        let travelled=0;
        while(travelled<edgeLength-1e-6){
          const take=Math.min(bayWidth-panelDistance,edgeLength-travelled);travelled+=take;panelDistance+=take;
          const point=offset(first,east*travelled/edgeLength,north*travelled/edgeLength);
          if(panelDistance>=bayWidth-1e-5){segments.push({first:panelStart,last:point});panelStart=point;panelDistance=0;}
        }
      }
      if(panelDistance>.001)segments.push({first:panelStart,last:positions.at(-1)!});
      else if(segments.length)segments[segments.length-1].last=positions.at(-1)!;
    }else for(let index=1;index<positions.length;index++)segments.push({first:positions[index-1],last:positions[index]});
    const hiddenTimberPosts: [number,number][]=[];
    if(wall.style==='timber')for(const join of joinPositions){
      const candidates=segments.flatMap(segment=>[segment.first,segment.last]).filter((point,index,all)=>all.findIndex(other=>distance(point,other)<.01)===index).map(point=>({point,distance:distance(point,join)})).filter(candidate=>candidate.distance>.05&&candidate.distance<=.75).sort((a,b)=>a.distance-b.distance);
      const nearest=candidates.find(candidate=>!hiddenTimberPosts.some(point=>distance(point,candidate.point)<.01));
      if(nearest)hiddenTimberPosts.push(nearest.point);
    }
    for(const [segmentIndex,segment] of segments.entries()){
      const {first,last}=segment,cos=Math.cos((first[1]+last[1])*.5*Math.PI/180),east=(last[0]-first[0])*metres*cos,north=(last[1]-first[1])*metres,length=Math.hypot(east,north);
      if(length<.01)continue;
      const postWidth=Math.min(1,.24/length),axis:[number,number]=[east/length,north/length],lateral:[number,number]=[-north/length,east/length],startCut=segmentIndex===0?this.miterEnd(wall,allWalls,first,last,axis,lateral,metres):undefined,endCut=segmentIndex===segments.length-1?this.miterEnd(wall,allWalls,last,first,axis,lateral,metres):undefined,mitered=wall.style!=='timber'&&wall.style!=='panel'&&(startCut||endCut)?this.miteredWallPart(wall,length,startCut,endCut,wall.style==='brick'?'#a65342':wall.color,wall.style==='brick'):undefined;
      const parts=mitered?[mitered.part]:wall.style==='brick'?[{shape:'box' as const,x:0,y:0,z:0,width:2,depth:1,height:2,rotation:0,color:'#a65342',brickTexture:true}]:wall.style==='timber'?[...[-1,1].map(side=>({side,point:side<0?first:last})).filter(({point})=>!hiddenTimberPosts.some(hidden=>distance(point,hidden)<.01)).map(({side})=>{const fullPost=side<0?segmentIndex===0:segmentIndex===segments.length-1,width=postWidth*(fullPost?1:.5);return{shape:'box' as const,x:side*(1-width/2),y:0,z:0,width,depth:1,height:1.9,rotation:0,color:wall.postColor??'#765437',group:'wall-post'};}),...[.93,1.71].map(z=>({shape:'box' as const,x:0,y:0,z,width:2-postWidth,depth:1,height:.15,rotation:0,color:wall.railColor??'#a47750'}))]:wall.style==='panel'?[...[-1,1].map(side=>{const fullPost=side<0?segmentIndex===0:segmentIndex===segments.length-1,width=postWidth*(fullPost?1:.5);return{shape:'box' as const,x:side*(1-width/2),y:0,z:0,width,depth:1,height:2,rotation:0,color:wall.postColor??'#765437',group:'wall-post'};}),{shape:'box' as const,x:0,y:0,z:.1,width:2-postWidth,depth:1,height:1.8,rotation:0,color:'#a47750'}]:[
        {shape:'box' as const,x:0,y:0,z:0,width:2,depth:1,height:2,rotation:0,color:wall.color},
      ],model:PolyModel={format:'mapmason-poly',version:1,name:wall.name,parts};
      const object:SiteObject={id:wall.id,kind:'custom',name:wall.name,position:offset(first,east*(mitered?.centerX??length/2)/length,north*(mitered?.centerX??length/2)/length),width:mitered?.width??length,depth:wall.thickness,height:wall.height,rotation:Math.atan2(-north,east)*180/Math.PI,customModelId:'map-wall-'+wall.style,customModel:model};this.addObject(object);
    }
  }
  private miterEnd(wall:SiteWall,allWalls:SiteWall[],point:[number,number],inside:[number,number],axis:[number,number],lateral:[number,number],metres:number):[number,number]|undefined{
    const latitude=(point[1]+inside[1])*.5,cos=Math.cos(latitude*Math.PI/180),insideEast=(inside[0]-point[0])*metres*cos,insideNorth=(inside[1]-point[1])*metres,insideLength=Math.hypot(insideEast,insideNorth);
    if(insideLength<.01)return;
    const inward:[number,number]=[insideEast/insideLength,insideNorth/insideLength];let best:[number,number]|undefined,bestDistance=Infinity;
    for(const other of allWalls){
      if(other.id===wall.id)continue;
      const profile=pathProfile(wallPaths([other])[0]);
      for(let index=1;index<profile.length;index++){
        const a=profile[index-1].position,b=profile[index].position,otherEast=(b[0]-a[0])*metres*cos,otherNorth=(b[1]-a[1])*metres,otherLength=Math.hypot(otherEast,otherNorth);
        if(otherLength<.01)continue;
        const vx=otherEast/otherLength,vy=otherNorth/otherLength,px=(point[0]-a[0])*metres*cos,py=(point[1]-a[1])*metres,along=px*vx+py*vy,distance=Math.hypot(px-vx*Math.max(0,Math.min(otherLength,along)),py-vy*Math.max(0,Math.min(otherLength,along))),cross= vx*axis[1]-vy*axis[0],side=Math.sign(vx*inward[1]-vy*inward[0]);
        if(Math.abs(cross)<.2||!side||distance>Math.max(.04,other.thickness*.25)||distance>=bestDistance)continue;
        const lateralCross=vx*lateral[1]-vy*lateral[0],at=[-wall.thickness/2,wall.thickness/2].map(y=>(side*other.thickness/2-(vx*py-vy*px)-y*lateralCross)/cross) as [number,number];
        if(at.some(value=>!Number.isFinite(value)||Math.abs(value)>Math.max(2,other.thickness*3)))continue;
        best=at;bestDistance=distance;
      }
    }
    return best;
  }
  private miteredWallPart(wall:SiteWall,length:number,start:[number,number]|undefined,end:[number,number]|undefined,color:string,brick:boolean){
    const half=wall.thickness/2,points:[[number,number],[number,number],[number,number],[number,number]]=[[start?.[0]??0,-half],[length+(end?.[0]??0),-half],[length+(end?.[1]??0),half],[start?.[1]??0,half]],minimum=Math.min(...points.map(point=>point[0])),maximum=Math.max(...points.map(point=>point[0])),width=maximum-minimum,centerX=(minimum+maximum)/2;
    const outline=points.map(([x,y])=>[2*(x-centerX)/width,2*y/wall.thickness] as [number,number]);
    return {part:{shape:'extrusion' as const,x:0,y:0,z:0,width,depth:wall.thickness,height:wall.height,rotation:0,color,outline,...(brick?{brickTexture:true}:{})},width,centerX};
  }
  project(position:[number,number],height:number):{x:number;y:number}|undefined{
    if(!this.map||!this.active)return;
    const at=MercatorCoordinate.fromLngLat(position),origin=MercatorCoordinate.fromLngLat(this.origin),scale=origin.meterInMercatorCoordinateUnits(),canvas=this.map.getCanvas();
    const terrain=this.map.queryTerrainElevation(position)??0;
    const screen=projectDeckPoint([(at.x-origin.x)/scale,(at.y-origin.y)/scale,height+terrain],this.matrix,canvas.clientWidth,canvas.clientHeight);
    return Number.isFinite(screen[0])&&Number.isFinite(screen[1])?{x:screen[0],y:screen[1]}:undefined;
  }
  private addObject(object:SiteObject){
    const model=object.customModel!;if(!model.parts.length)return;
    const key=JSON.stringify([model.parts,model.transform]);let base=this.baseMeshes.get(key);
    if(!base){
      const triangles=polyTriangles(model),minimum:[number,number,number]=[Infinity,Infinity,Infinity],maximum:[number,number,number]=[-Infinity,-Infinity,-Infinity];
      for(const triangle of triangles)for(const at of [0,3,6])for(let axis=0;axis<3;axis++){const value=triangle.positions[at+axis];minimum[axis]=Math.min(minimum[axis],value);maximum[axis]=Math.max(maximum[axis],value);}
      base={triangles,min:minimum,max:maximum};this.baseMeshes.set(key,base);
    }
    const width=base.max[0]-base.min[0],depth=base.max[1]-base.min[1],height=base.max[2]-base.min[2];if(width<=0||depth<=0||!base.triangles.length)return;
    const center=MercatorCoordinate.fromLngLat(object.position),origin=MercatorCoordinate.fromLngLat(this.origin),scale=origin.meterInMercatorCoordinateUnits(),sz=Math.max(.1,object.height)/Math.max(.1,height),terrainElevation=this.map?.queryTerrainElevation(object.position)??0,placement:ModelMesh={id:object.id,base,position:object.position,terrainElevation,center:[(center.x-origin.x)/scale,(center.y-origin.y)/scale],root:object.rotation*Math.PI/180,sx:object.width/width,sy:object.depth/depth,sz,lift:terrainElevation+(model.transform?.elevation??0)*sz,min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity],triangles:[],glow:[],transparentStart:0,transparentCount:0};
    const point=(x:number,y:number,z:number):[number,number,number]=>{x=(x-base.min[0]-width/2)*placement.sx;y=(y-base.min[1]-depth/2)*placement.sy;z=(z-base.min[2])*placement.sz+placement.lift;return [placement.center[0]+x*Math.cos(placement.root)-y*Math.sin(placement.root),placement.center[1]+x*Math.sin(placement.root)+y*Math.cos(placement.root),z];};
    for(let x=0;x<2;x++)for(let y=0;y<2;y++)for(let z=0;z<2;z++){const corner=point(x?base.max[0]:base.min[0],y?base.max[1]:base.min[1],z?base.max[2]:base.min[2]);for(let axis=0;axis<3;axis++){placement.min[axis]=Math.min(placement.min[axis],corner[axis]);placement.max[axis]=Math.max(placement.max[axis],corner[axis]);}}
    this.models.push(placement);
  }
  private placedTriangles(model:ModelMesh,source:PolyTriangle[]=model.base.triangles):VertexTriangle[]{
    const {base,center,root,sx,sy,sz,lift}=model,cos=Math.cos(root),sin=Math.sin(root),width=base.max[0]-base.min[0],depth=base.max[1]-base.min[1];
    return source.map(triangle=>{const positions:number[]=[];for(const at of [0,3,6]){const x=(triangle.positions[at]-base.min[0]-width/2)*sx,y=(triangle.positions[at+1]-base.min[1]-depth/2)*sy,z=(triangle.positions[at+2]-base.min[2])*sz+lift;positions.push(center[0]+x*cos-y*sin,center[1]+x*sin+y*cos,z);}const uv=triangle.uv?.map((value,index)=>value*(index%2===0?sx:sz));return {positions,color:triangle.color,vertexColors:triangle.vertexColors,opacity:triangle.opacity,emissive:triangle.emissive,text:triangle.text,brick:triangle.brick,group:triangle.group,uv,id:model.id};});
  }
  private isVisible(model:ModelMesh){
    const m=this.matrix,outside=[true,true,true,true,true,true],canvas=this.map?.getCanvas();if(!canvas)return false;
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity,crossesNearPlane=false;
    for(let xIndex=0;xIndex<2;xIndex++)for(let yIndex=0;yIndex<2;yIndex++)for(let zIndex=0;zIndex<2;zIndex++){
      const x=xIndex?model.max[0]:model.min[0],y=yIndex?model.max[1]:model.min[1],z=zIndex?model.max[2]:model.min[2];
      const clipX=m[0]*x+m[4]*y+m[8]*z+m[12],clipY=m[1]*x+m[5]*y+m[9]*z+m[13],clipZ=m[2]*x+m[6]*y+m[10]*z+m[14],w=m[3]*x+m[7]*y+m[11]*z+m[15],margin=Math.abs(w)*.025+1e-7;
      if(clipX+w>=-margin)outside[0]=false;if(w-clipX>=-margin)outside[1]=false;
      if(clipY+w>=-margin)outside[2]=false;if(w-clipY>=-margin)outside[3]=false;
      if(clipZ+w>=-margin)outside[4]=false;if(w-clipZ>=-margin)outside[5]=false;
      if(w<=margin){crossesNearPlane=true;continue;}
      const screenX=(clipX/w+1)*canvas.clientWidth/2,screenY=(1-clipY/w)*canvas.clientHeight/2;
      minX=Math.min(minX,screenX);minY=Math.min(minY,screenY);maxX=Math.max(maxX,screenX);maxY=Math.max(maxY,screenY);
    }
    if(outside.some(Boolean))return false;
    return crossesNearPlane||Math.max(maxX-minX,maxY-minY)>=1.5;
  }
  private refreshTerrain(){
    if(!this.map?.getTerrain())return;
    for(const model of this.models){
      const elevation=this.map.queryTerrainElevation(model.position);if(elevation===null)continue;
      const delta=elevation-model.terrainElevation;if(Math.abs(delta)<.01)continue;
      model.terrainElevation=elevation;model.lift+=delta;model.min[2]+=delta;model.max[2]+=delta;
      for(const triangle of [...model.triangles,...model.glow])for(const at of [2,5,8])triangle.positions[at]+=delta;
      this.geometryDirty=true;
    }
  }
  pick(point:{x:number;y:number}):string|undefined{
    const canvas=this.map?.getCanvas();if(!this.active||!canvas)return;
    let best:{id:string;depth:number}|undefined;
    for(const triangle of this.visibleTriangles){if(triangle.opacity<=0)continue;
      const vertices=[0,3,6].map(index=>projectDeckPoint(triangle.positions.slice(index,index+3),this.matrix,canvas.clientWidth,canvas.clientHeight));if(vertices.some(vertex=>!Number.isFinite(vertex.depth)))continue;
      const [first,second,third]=vertices,denominator=(second[1]-third[1])*(first[0]-third[0])+(third[0]-second[0])*(first[1]-third[1]);if(Math.abs(denominator)<1e-8)continue;
      const a=((second[1]-third[1])*(point.x-third[0])+(third[0]-second[0])*(point.y-third[1]))/denominator,b=((third[1]-first[1])*(point.x-third[0])+(first[0]-third[0])*(point.y-third[1]))/denominator,c=1-a-b,depth=a*first.depth!+b*second.depth!+c*third.depth!;
      if(a>=0&&b>=0&&c>=0&&(!best||depth<best.depth))best={id:triangle.id,depth};
    }
    return best?.id;
  }
  onAdd(map:LibreMap,gl:WebGL2RenderingContext){
    this.map=map;this.gl=gl;
    const compile=(type:number,source:string)=>{const shader=gl.createShader(type)!;gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){const message=gl.getShaderInfoLog(shader);gl.deleteShader(shader);throw Error(`Custom model shader: ${message}`);}return shader;};
    const vertex=compile(gl.VERTEX_SHADER,polyVertexShader);
    const fragment=compile(gl.FRAGMENT_SHADER,polyFragmentShader);
    const program=gl.createProgram()!;gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);gl.deleteShader(vertex);gl.deleteShader(fragment);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(`Custom model shader: ${gl.getProgramInfoLog(program)}`);
    this.program=program;this.opaqueBuffer=gl.createBuffer()!;this.transparentBuffer=gl.createBuffer()!;this.opaqueVao=gl.createVertexArray()!;this.transparentVao=gl.createVertexArray()!;this.uniform=gl.getUniformLocation(program,'u_matrix');this.textUniform=gl.getUniformLocation(program,'u_text');
    for(const[vao,buffer]of [[this.opaqueVao,this.opaqueBuffer],[this.transparentVao,this.transparentBuffer]] as const){gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);for(const[name,size,offset]of [['a_position',3,0],['a_color',3,12],['a_opacity',1,24],['a_emissive',1,28],['a_uv',2,32],['a_text',1,40]] as const){const location=gl.getAttribLocation(program,name);gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,size,gl.FLOAT,false,44,offset);}}
    gl.bindVertexArray(null);
  }
  render(gl:WebGL2RenderingContext,options:CustomRenderMethodInput){
    this.matrix.set(deckProjection(options.defaultProjectionData.mainMatrix,MercatorCoordinate.fromLngLat(this.origin)));
    this.refreshTerrain();
    if(!this.active||!this.models.length||!this.program){this.visibleTriangles=[];if(this.active)this.onRender();return;}
    const visibleModels=this.models.filter(model=>this.isVisible(model));this.visibleTriangles=visibleModels.flatMap(model=>model.triangles);
    const vao=gl.getParameter(gl.VERTEX_ARRAY_BINDING),buffer=gl.getParameter(gl.ARRAY_BUFFER_BINDING),program=gl.getParameter(gl.CURRENT_PROGRAM),depth=gl.isEnabled(gl.DEPTH_TEST),blend=gl.isEnabled(gl.BLEND),cull=gl.isEnabled(gl.CULL_FACE),mask=gl.getParameter(gl.DEPTH_WRITEMASK),depthFunction=gl.getParameter(gl.DEPTH_FUNC),srcRgb=gl.getParameter(gl.BLEND_SRC_RGB),dstRgb=gl.getParameter(gl.BLEND_DST_RGB),srcAlpha=gl.getParameter(gl.BLEND_SRC_ALPHA),dstAlpha=gl.getParameter(gl.BLEND_DST_ALPHA),eqRgb=gl.getParameter(gl.BLEND_EQUATION_RGB),eqAlpha=gl.getParameter(gl.BLEND_EQUATION_ALPHA);
    const restoreText=this.textTexture.bind(gl,this.models.flatMap(model=>[...model.triangles,...model.glow]));
    const depthOf=(model:ModelMesh)=>{const center=[0,1,2].map(axis=>(model.min[axis]+model.max[axis])/2),m=this.matrix,w=m[3]*center[0]+m[7]*center[1]+m[11]*center[2]+m[15];return w?(m[2]*center[0]+m[6]*center[1]+m[10]*center[2]+m[14])/w:0;};

    const values=(triangles:VertexTriangle[])=>{const data:number[]=[];for(const triangle of triangles)for(let vertex=0;vertex<3;vertex++){const texture=this.textTexture.vertex(triangle,vertex);data.push(...triangle.positions.slice(vertex*3,vertex*3+3),...(triangle.vertexColors?.[vertex]??triangle.color),triangle.opacity,triangle.emissive??0,texture[0],texture[1],triangle.group==='wall-post'?3:texture[2]);}return new Float32Array(data);};
    if(this.geometryDirty){
      const opaque:VertexTriangle[]=[],glow:VertexTriangle[]=[],transparent:VertexTriangle[]=[];
      for(const model of this.models){opaque.push(...model.triangles.filter(triangle=>triangle.opacity>=1));glow.push(...model.glow);const faded=model.triangles.filter(triangle=>triangle.opacity>0&&triangle.opacity<1);model.transparentStart=transparent.length*3;model.transparentCount=faded.length*3;transparent.push(...faded);}
      gl.bindBuffer(gl.ARRAY_BUFFER,this.opaqueBuffer!);gl.bufferData(gl.ARRAY_BUFFER,values(opaque),gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER,this.transparentBuffer!);gl.bufferData(gl.ARRAY_BUFFER,values([...glow,...transparent]),gl.STATIC_DRAW);
      this.opaqueVertexCount=opaque.length*3;this.glowVertexCount=glow.length*3;
      for(const model of this.models)model.transparentStart+=this.glowVertexCount;
      this.geometryDirty=false;
    }
    gl.useProgram(this.program);gl.uniform1i(this.textUniform!,0);gl.uniformMatrix4fv(this.uniform!,false,this.matrix);
    gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.disable(gl.CULL_FACE);gl.disable(gl.BLEND);gl.depthMask(true);
    if(this.opaqueVertexCount){gl.bindVertexArray(this.opaqueVao!);gl.bindBuffer(gl.ARRAY_BUFFER,this.opaqueBuffer!);gl.drawArrays(gl.TRIANGLES,0,this.opaqueVertexCount);}
    if(this.glowVertexCount){gl.bindVertexArray(this.transparentVao!);gl.bindBuffer(gl.ARRAY_BUFFER,this.transparentBuffer!);gl.enable(gl.BLEND);gl.blendEquationSeparate(gl.FUNC_ADD,gl.FUNC_ADD);gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE,gl.ONE,gl.ONE);gl.depthMask(false);gl.drawArrays(gl.TRIANGLES,0,this.glowVertexCount);}
    const transparentModels=visibleModels.filter(model=>model.transparentCount).sort((first,second)=>depthOf(second)-depthOf(first));
    if(transparentModels.length){gl.bindVertexArray(this.transparentVao!);gl.bindBuffer(gl.ARRAY_BUFFER,this.transparentBuffer!);gl.enable(gl.BLEND);gl.blendEquationSeparate(gl.FUNC_ADD,gl.FUNC_ADD);gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);for(const model of transparentModels)gl.drawArrays(gl.TRIANGLES,model.transparentStart,model.transparentCount);}
    restoreText();gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.useProgram(program);gl.depthMask(mask);gl.depthFunc(depthFunction);gl.blendFuncSeparate(srcRgb,dstRgb,srcAlpha,dstAlpha);gl.blendEquationSeparate(eqRgb,eqAlpha);
    for(const[capability,enabled]of [[gl.DEPTH_TEST,depth],[gl.BLEND,blend],[gl.CULL_FACE,cull]] as const)enabled?gl.enable(capability):gl.disable(capability);
    this.onRender();
  }
  onRemove(_map:unknown,gl:WebGL2RenderingContext){this.textTexture.destroy(gl);gl.deleteBuffer(this.opaqueBuffer!);gl.deleteBuffer(this.transparentBuffer!);gl.deleteVertexArray(this.opaqueVao!);gl.deleteVertexArray(this.transparentVao!);gl.deleteProgram(this.program!);this.geometryDirty=true;this.map=undefined;this.gl=undefined;}
}
