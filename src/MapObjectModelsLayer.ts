import {PolyTextTexture,polyVertexShader,polyFragmentShader} from './polyTextTexture';
import {MercatorCoordinate,type CustomLayerInterface,type CustomRenderMethodInput,type Map as LibreMap} from 'maplibre-gl';
import {polyGlowTriangles,polyTriangles,type PolyModel,type PolyTriangle} from './polyModel';
import type {EventProject,SiteObject} from './model';
import {deckProjection,projectDeckPoint} from './pathDeck';

type VertexTriangle={positions:number[];color:number[];vertexColors?:PolyTriangle['vertexColors'];opacity:number;emissive?:number;text?:PolyTriangle['text'];uv?:number[];id:string};
type BaseMesh={triangles:PolyTriangle[];min:[number,number,number];max:[number,number,number]};
type ModelMesh={id:string;base:BaseMesh;center:[number,number];root:number;sx:number;sy:number;sz:number;lift:number;min:[number,number,number];max:[number,number,number]};
export class MapObjectModelsLayer implements CustomLayerInterface{
  constructor(private onRender:()=>void=()=>{}){}
  readonly id='object-models';readonly type='custom' as const;readonly renderingMode='3d' as const;
  private map?:LibreMap;private gl?:WebGL2RenderingContext;private program?:WebGLProgram;private opaqueBuffer?:WebGLBuffer;private transparentBuffer?:WebGLBuffer;private opaqueVao?:WebGLVertexArrayObject;private transparentVao?:WebGLVertexArrayObject;private uniform?:WebGLUniformLocation|null;private textUniform?:WebGLUniformLocation|null;private textTexture=new PolyTextTexture();
  private matrix=new Float32Array(16);private models:ModelMesh[]=[];private visibleTriangles:VertexTriangle[]=[];private baseMeshes=new Map<string,BaseMesh>();private active=false;private signature='';private origin:[number,number]=[0,0];
  update(project:EventProject,mode:'2d'|'3d'){
    const signature=JSON.stringify([project.center,project.objects.filter(object=>object.customModel),mode]);if(signature===this.signature)return;
    this.signature=signature;this.active=mode==='3d';this.origin=project.center;this.models=[];this.visibleTriangles=[];
    if(this.active)for(const object of project.objects)if(object.customModel)this.addObject(object);
    this.map?.triggerRepaint();
  }
  project(position:[number,number],height:number):{x:number;y:number}|undefined{
    if(!this.map||!this.active)return;
    const at=MercatorCoordinate.fromLngLat(position),origin=MercatorCoordinate.fromLngLat(this.origin),scale=origin.meterInMercatorCoordinateUnits(),canvas=this.map.getCanvas();
    const screen=projectDeckPoint([(at.x-origin.x)/scale,(at.y-origin.y)/scale,height],this.matrix,canvas.clientWidth,canvas.clientHeight);
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
    const center=MercatorCoordinate.fromLngLat(object.position),origin=MercatorCoordinate.fromLngLat(this.origin),scale=origin.meterInMercatorCoordinateUnits(),sz=Math.max(.1,object.height)/Math.max(.1,height),placement:ModelMesh={id:object.id,base,center:[(center.x-origin.x)/scale,(center.y-origin.y)/scale],root:object.rotation*Math.PI/180,sx:object.width/width,sy:object.depth/depth,sz,lift:(model.transform?.elevation??0)*sz,min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
    const point=(x:number,y:number,z:number):[number,number,number]=>{x=(x-base.min[0]-width/2)*placement.sx;y=(y-base.min[1]-depth/2)*placement.sy;z=(z-base.min[2])*placement.sz+placement.lift;return [placement.center[0]+x*Math.cos(placement.root)-y*Math.sin(placement.root),placement.center[1]+x*Math.sin(placement.root)+y*Math.cos(placement.root),z];};
    for(let x=0;x<2;x++)for(let y=0;y<2;y++)for(let z=0;z<2;z++){const corner=point(x?base.max[0]:base.min[0],y?base.max[1]:base.min[1],z?base.max[2]:base.min[2]);for(let axis=0;axis<3;axis++){placement.min[axis]=Math.min(placement.min[axis],corner[axis]);placement.max[axis]=Math.max(placement.max[axis],corner[axis]);}}
    this.models.push(placement);
  }
  private placedTriangles(model:ModelMesh,source:PolyTriangle[]=model.base.triangles):VertexTriangle[]{
    const {base,center,root,sx,sy,sz,lift}=model,cos=Math.cos(root),sin=Math.sin(root),width=base.max[0]-base.min[0],depth=base.max[1]-base.min[1];
    return source.map(triangle=>{const positions:number[]=[];for(const at of [0,3,6]){const x=(triangle.positions[at]-base.min[0]-width/2)*sx,y=(triangle.positions[at+1]-base.min[1]-depth/2)*sy,z=(triangle.positions[at+2]-base.min[2])*sz+lift;positions.push(center[0]+x*cos-y*sin,center[1]+x*sin+y*cos,z);}return {positions,color:triangle.color,vertexColors:triangle.vertexColors,opacity:triangle.opacity,emissive:triangle.emissive,text:triangle.text,uv:triangle.uv,id:model.id};});
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
    this.matrix=deckProjection(options.defaultProjectionData.mainMatrix,MercatorCoordinate.fromLngLat(this.origin));
    if(!this.active||!this.models.length||!this.program){this.visibleTriangles=[];if(this.active)this.onRender();return;}
    const visibleModels=this.models.filter(model=>this.isVisible(model)),placed=visibleModels.map(model=>({model,triangles:this.placedTriangles(model)})),glow=visibleModels.flatMap(model=>this.placedTriangles(model,polyGlowTriangles(model.base.triangles)));this.visibleTriangles=placed.flatMap(instance=>instance.triangles);
    const vao=gl.getParameter(gl.VERTEX_ARRAY_BINDING),buffer=gl.getParameter(gl.ARRAY_BUFFER_BINDING),program=gl.getParameter(gl.CURRENT_PROGRAM),depth=gl.isEnabled(gl.DEPTH_TEST),blend=gl.isEnabled(gl.BLEND),cull=gl.isEnabled(gl.CULL_FACE),mask=gl.getParameter(gl.DEPTH_WRITEMASK),depthFunction=gl.getParameter(gl.DEPTH_FUNC),srcRgb=gl.getParameter(gl.BLEND_SRC_RGB),dstRgb=gl.getParameter(gl.BLEND_DST_RGB),srcAlpha=gl.getParameter(gl.BLEND_SRC_ALPHA),dstAlpha=gl.getParameter(gl.BLEND_DST_ALPHA),eqRgb=gl.getParameter(gl.BLEND_EQUATION_RGB),eqAlpha=gl.getParameter(gl.BLEND_EQUATION_ALPHA);
    const restoreText=this.textTexture.bind(gl,this.visibleTriangles);
    const depthOf=(model:ModelMesh)=>{const center=[0,1,2].map(axis=>(model.min[axis]+model.max[axis])/2),m=this.matrix,w=m[3]*center[0]+m[7]*center[1]+m[11]*center[2]+m[15];return w?(m[2]*center[0]+m[6]*center[1]+m[10]*center[2]+m[14])/w:0;};
    const opaque=placed.flatMap(instance=>instance.triangles.filter(triangle=>triangle.opacity>=1)),transparent=placed.filter(instance=>instance.triangles.some(triangle=>triangle.opacity>0&&triangle.opacity<1)).sort((first,second)=>depthOf(second.model)-depthOf(first.model)).flatMap(instance=>instance.triangles.filter(triangle=>triangle.opacity>0&&triangle.opacity<1));
    const values=(triangles:VertexTriangle[])=>{const data:number[]=[];for(const triangle of triangles)for(let vertex=0;vertex<3;vertex++)data.push(...triangle.positions.slice(vertex*3,vertex*3+3),...(triangle.vertexColors?.[vertex]??triangle.color),triangle.opacity,triangle.emissive??0,...this.textTexture.vertex(triangle,vertex));return new Float32Array(data);};
    gl.useProgram(this.program);gl.uniform1i(this.textUniform!,0);gl.uniformMatrix4fv(this.uniform!,false,this.matrix);
    gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.disable(gl.CULL_FACE);gl.disable(gl.BLEND);gl.depthMask(true);
    if(opaque.length){gl.bindVertexArray(this.opaqueVao!);gl.bindBuffer(gl.ARRAY_BUFFER,this.opaqueBuffer!);gl.bufferData(gl.ARRAY_BUFFER,values(opaque),gl.DYNAMIC_DRAW);gl.drawArrays(gl.TRIANGLES,0,opaque.length*3);}
    if(glow.length){gl.bindVertexArray(this.transparentVao!);gl.bindBuffer(gl.ARRAY_BUFFER,this.transparentBuffer!);gl.bufferData(gl.ARRAY_BUFFER,values(glow),gl.DYNAMIC_DRAW);gl.enable(gl.BLEND);gl.blendEquationSeparate(gl.FUNC_ADD,gl.FUNC_ADD);gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE,gl.ONE,gl.ONE);gl.depthMask(false);gl.drawArrays(gl.TRIANGLES,0,glow.length*3);}
    if(transparent.length){gl.bindVertexArray(this.transparentVao!);gl.bindBuffer(gl.ARRAY_BUFFER,this.transparentBuffer!);gl.bufferData(gl.ARRAY_BUFFER,values(transparent),gl.DYNAMIC_DRAW);gl.enable(gl.BLEND);gl.blendEquationSeparate(gl.FUNC_ADD,gl.FUNC_ADD);gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);gl.drawArrays(gl.TRIANGLES,0,transparent.length*3);}
    restoreText();gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.useProgram(program);gl.depthMask(mask);gl.depthFunc(depthFunction);gl.blendFuncSeparate(srcRgb,dstRgb,srcAlpha,dstAlpha);gl.blendEquationSeparate(eqRgb,eqAlpha);
    for(const[capability,enabled]of [[gl.DEPTH_TEST,depth],[gl.BLEND,blend],[gl.CULL_FACE,cull]] as const)enabled?gl.enable(capability):gl.disable(capability);
    this.onRender();
  }
  onRemove(_map:unknown,gl:WebGL2RenderingContext){this.textTexture.destroy(gl);gl.deleteBuffer(this.opaqueBuffer!);gl.deleteBuffer(this.transparentBuffer!);gl.deleteVertexArray(this.opaqueVao!);gl.deleteVertexArray(this.transparentVao!);gl.deleteProgram(this.program!);this.map=undefined;this.gl=undefined;}
}
