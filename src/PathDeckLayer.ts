import {MercatorCoordinate,type CustomLayerInterface,type CustomRenderMethodInput,type Map as LibreMap} from 'maplibre-gl';
import {deckProjection,pathDeckTriangles,projectDeckPoint,type DeckTriangle} from './pathDeck';
import type {Coord,EventProject} from './model';
import type {WalkingRoute} from './routing';

export class PathDeckLayer implements CustomLayerInterface{
  constructor(private onRender:()=>void=()=>{}){}
  readonly id='path-decks';
  readonly type='custom' as const;
  readonly renderingMode='3d' as const;
  private map?:LibreMap;
  private gl?:WebGL2RenderingContext;
  private program?:WebGLProgram;
  private buffer?:WebGLBuffer;
  private vao?:WebGLVertexArrayObject;
  private uniform?:WebGLUniformLocation|null;
  private triangles:DeckTriangle[]=[];
  private signature='';
  private origin:Coord=[0,0];
  private matrix=new Float32Array(16);
  private active=false;
  private dirty=true;

  onAdd(map:LibreMap,gl:WebGL2RenderingContext){
    this.map=map;this.gl=gl;
    const compile=(type:number,source:string)=>{
      const shader=gl.createShader(type)!;gl.shaderSource(shader,source);gl.compileShader(shader);
      if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){const message=gl.getShaderInfoLog(shader);gl.deleteShader(shader);throw new Error(`Path deck shader: ${message}`);}
      return shader;
    };
    const vertex=compile(gl.VERTEX_SHADER,'#version 300 es\nin vec3 a_position;in vec3 a_color;uniform mat4 u_matrix;out vec3 v_color;void main(){v_color=a_color;gl_Position=u_matrix*vec4(a_position,1.0);}');
    const fragment=compile(gl.FRAGMENT_SHADER,'#version 300 es\nprecision highp float;in vec3 v_color;out vec4 color;void main(){color=vec4(v_color,1.0);}');
    const program=gl.createProgram()!;gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);gl.deleteShader(vertex);gl.deleteShader(fragment);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(`Path deck shader: ${gl.getProgramInfoLog(program)}`);
    this.program=program;this.buffer=gl.createBuffer()!;this.vao=gl.createVertexArray()!;this.uniform=gl.getUniformLocation(program,'u_matrix');
    gl.bindVertexArray(this.vao);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
    for(const [name,offset] of [['a_position',0],['a_color',12]] as const){const location=gl.getAttribLocation(program,name);gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,3,gl.FLOAT,false,24,offset);}
    gl.bindVertexArray(null);
  }

  update(project:EventProject,selected:string|null,mode:'2d'|'3d',route?:WalkingRoute|null){
    this.active=mode==='3d';this.origin=project.center;
    const signature=JSON.stringify([project.center,project.paths,project.bridges,selected,route]);
    if(signature===this.signature)return;
    this.signature=signature;this.triangles=pathDeckTriangles(project,selected);
    if(route?.heights?.some(height=>height>0)){
      for(const [width,color,lift] of [[2.2,[1,1,1],.05],[1.3,[.137,.545,1],.07]] as const){
        const overlay={id:'walking-route-deck',name:'Directions',points:route.points,width,heights:route.heights.map(height=>height+lift)};
        this.triangles.push(...pathDeckTriangles({...project,paths:[overlay]},null).map(triangle=>({...triangle,color:[...color]})));
      }
    }
    this.dirty=true;this.map?.triggerRepaint();
  }

  render(gl:WebGL2RenderingContext,options:CustomRenderMethodInput){
    if(!this.active||!this.triangles.length||!this.program)return;
    const vao=gl.getParameter(gl.VERTEX_ARRAY_BINDING),buffer=gl.getParameter(gl.ARRAY_BUFFER_BINDING),program=gl.getParameter(gl.CURRENT_PROGRAM),depth=gl.isEnabled(gl.DEPTH_TEST),blend=gl.isEnabled(gl.BLEND),cull=gl.isEnabled(gl.CULL_FACE),depthMask=gl.getParameter(gl.DEPTH_WRITEMASK),depthFunction=gl.getParameter(gl.DEPTH_FUNC);
    this.matrix=deckProjection(options.defaultProjectionData.mainMatrix,MercatorCoordinate.fromLngLat(this.origin));
    gl.useProgram(this.program);gl.bindVertexArray(this.vao!);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer!);
    if(this.dirty){const data:number[]=[];for(const triangle of this.triangles)for(let vertex=0;vertex<3;vertex++)data.push(...triangle.positions.slice(vertex*3,vertex*3+3),...triangle.color);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.STATIC_DRAW);this.dirty=false;}
    gl.uniformMatrix4fv(this.uniform!,false,this.matrix);gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.depthMask(true);gl.disable(gl.BLEND);gl.disable(gl.CULL_FACE);gl.drawArrays(gl.TRIANGLES,0,this.triangles.length*3);
    gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.useProgram(program);gl.depthMask(depthMask);gl.depthFunc(depthFunction);
    for(const [capability,enabled] of [[gl.DEPTH_TEST,depth],[gl.BLEND,blend],[gl.CULL_FACE,cull]] as const)enabled?gl.enable(capability):gl.disable(capability);
    this.onRender();
  }

  project(position:Coord,height:number):{x:number;y:number}|undefined{
    if(!this.active||!this.map)return;
    const at=MercatorCoordinate.fromLngLat(position),origin=MercatorCoordinate.fromLngLat(this.origin),scale=origin.meterInMercatorCoordinateUnits(),canvas=this.map.getCanvas();
    const screen=projectDeckPoint([(at.x-origin.x)/scale,(at.y-origin.y)/scale,height+.025],this.matrix,canvas.clientWidth,canvas.clientHeight);
    return Number.isFinite(screen[0])&&Number.isFinite(screen[1])?{x:screen[0],y:screen[1]}:undefined;
  }

  pick(point:{x:number;y:number}):{id:string;section:number}|undefined{
    if(!this.active||!this.map)return;
    const canvas=this.map.getCanvas();let best:{id:string;section:number;depth:number}|undefined;
    for(const triangle of this.triangles){
      if(triangle.id==='walking-route-deck')continue;
      const vertices=[0,1,2].map(index=>projectDeckPoint(triangle.positions.slice(index*3,index*3+3),this.matrix,canvas.clientWidth,canvas.clientHeight));
      if(vertices.some(vertex=>!Number.isFinite(vertex.depth)))continue;
      const [first,second,third]=vertices,denominator=(second[1]-third[1])*(first[0]-third[0])+(third[0]-second[0])*(first[1]-third[1]);
      if(Math.abs(denominator)<1e-8)continue;
      const firstWeight=((second[1]-third[1])*(point.x-third[0])+(third[0]-second[0])*(point.y-third[1]))/denominator;
      const secondWeight=((third[1]-first[1])*(point.x-third[0])+(first[0]-third[0])*(point.y-third[1]))/denominator,thirdWeight=1-firstWeight-secondWeight;
      const depth=firstWeight*first.depth!+secondWeight*second.depth!+thirdWeight*third.depth!;
      if(firstWeight>=0&&secondWeight>=0&&thirdWeight>=0&&(!best||depth<best.depth))best={id:triangle.id,section:triangle.section,depth};
    }
    return best;
  }

  onRemove(){if(this.gl){this.gl.deleteBuffer(this.buffer!);this.gl.deleteVertexArray(this.vao!);this.gl.deleteProgram(this.program!);}this.map=undefined;}
}
