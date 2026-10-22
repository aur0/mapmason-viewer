import type {PolyTriangle} from './polyModel';

// Shared by Studio and map models. System-font masks are drawn locally; model
// data stores only text, never a font download, generated image or canvas data.
export const polyVertexShader=`#version 300 es
in vec3 a_position;in vec3 a_color;in float a_opacity;in float a_emissive;
in vec2 a_uv;in float a_text;uniform mat4 u_matrix;
out vec3 v_color;out float v_opacity;out float v_emissive;out vec2 v_uv;out float v_text;
void main(){v_color=a_color;v_opacity=a_opacity;v_emissive=a_emissive;v_uv=a_uv;v_text=a_text;gl_Position=u_matrix*vec4(a_position,1.0);if(a_text>2.5)gl_Position.z-=0.00005*gl_Position.w;}`;
export const polyFragmentShader=`#version 300 es
precision highp float;
in vec3 v_color;in float v_opacity;in float v_emissive;in vec2 v_uv;in float v_text;
uniform sampler2D u_text;out vec4 color;
void main(){vec3 surface=v_color;if(v_text>2.5){}else if(v_text>1.5){float row=floor(v_uv.y/0.086);float x=v_uv.x/0.276+mod(row,2.0)*0.5;float y=v_uv.y/0.086;vec2 cell=fract(vec2(x,y));vec2 edge=min(cell,1.0-cell);float aa=max(fwidth(x),fwidth(y))*0.5;float mortar=max(1.0-smoothstep(0.035-aa,0.065+aa,edge.x),1.0-smoothstep(0.055-aa,0.085+aa,edge.y));float variation=0.94+0.06*sin(floor(x)*19.1+row*13.7);vec3 brick=mix(v_color*variation,vec3(0.72,0.68,0.61),mortar);float detail=1.0-smoothstep(0.45,1.4,max(fwidth(x),fwidth(y)));surface=mix(v_color*0.92,brick,detail);}else if(v_text>0.5){float ink=dot(v_color,vec3(0.2126,0.7152,0.0722))>0.4?0.04:1.0;surface=mix(surface,vec3(ink),texture(u_text,v_uv).a);}color=vec4(surface*(1.0+2.2*v_emissive),v_opacity);}`;

type TexturedTriangle=Pick<PolyTriangle,'text'|'brick'|'uv'>;
const textKey=(text:NonNullable<PolyTriangle['text']>)=>JSON.stringify([text.value,text.aspect]);

export class PolyTextTexture{
  private texture:WebGLTexture|null=null;
  private signature='';
  private slots=new Map<string,number>();
  private columns=1;
  private rows=1;
  private width=1;
  private height=1;

  /** Binds unit zero and returns a callback restoring the host map's GL state. */
  bind(gl:WebGL2RenderingContext,triangles:TexturedTriangle[]):()=>void{
    const active=gl.getParameter(gl.ACTIVE_TEXTURE);
    gl.activeTexture(gl.TEXTURE0);
    const previous=gl.getParameter(gl.TEXTURE_BINDING_2D),sampler=gl.getParameter(gl.SAMPLER_BINDING);
    if(!this.texture){this.texture=gl.createTexture();this.signature='uninitialised';}
    gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.bindSampler(0,null);
    const restore=()=>{gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,previous);gl.bindSampler(0,sampler);gl.activeTexture(active);};
    try{
      const labels=new Map<string,NonNullable<PolyTriangle['text']>>();
      for(const triangle of triangles)if(triangle.text)labels.set(textKey(triangle.text),triangle.text);
      const keys=[...labels.keys()].sort(),signature=JSON.stringify(keys);
      if(signature!==this.signature){
        this.slots=new Map(keys.map((key,index)=>[key,index]));
        const maximum=Math.min(4096,gl.getParameter(gl.MAX_TEXTURE_SIZE));
        this.columns=Math.max(1,Math.ceil(Math.sqrt(keys.length/4)));
        this.rows=Math.max(1,Math.ceil(keys.length/this.columns));
        const tileWidth=Math.max(1,Math.min(512,Math.floor(maximum/this.columns))),tileHeight=Math.max(1,Math.min(128,Math.floor(maximum/this.rows)));
        this.width=this.columns*tileWidth;this.height=this.rows*tileHeight;
        const canvas=document.createElement('canvas');canvas.width=this.width;canvas.height=this.height;
        const context=canvas.getContext('2d');if(!context)throw Error('Could not draw model text.');
        keys.forEach((key,index)=>{
          const text=labels.get(key)!,left=index%this.columns*tileWidth,top=Math.floor(index/this.columns)*tileHeight;
          // Virtual coordinates use the panel's physical aspect ratio so the
          // texture does not stretch the font on wide or tall sign panels.
          const virtualHeight=tileWidth/text.aspect;
          context.save();context.beginPath();context.rect(left,top,tileWidth,tileHeight);context.clip();
          context.translate(left,top);context.scale(1,tileHeight/virtualHeight);
          context.font='600 100px system-ui, sans-serif';
          const measured=context.measureText(text.value).width;
          const size=Math.min(virtualHeight*.68,tileWidth*.88/Math.max(1,measured)*100);
          context.font=`600 ${size}px system-ui, sans-serif`;
          context.textAlign='center';context.textBaseline='alphabetic';context.fillStyle='#FFFFFF';
          const metrics=context.measureText(text.value),ascent=metrics.actualBoundingBoxAscent,descent=metrics.actualBoundingBoxDescent;
          context.fillText(text.value,tileWidth/2,(virtualHeight+ascent-descent)/2);
          context.restore();
        });
        const flip=gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL),premultiplied=gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL),unpackBuffer=gl.getParameter(gl.PIXEL_UNPACK_BUFFER_BINDING);
        try{
          gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER,null);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
          gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,canvas);
          gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
        }finally{gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,flip);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,premultiplied);gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER,unpackBuffer);}
        this.signature=signature;
      }
      return restore;
    }catch(error){restore();throw error;}
  }

  vertex(triangle:TexturedTriangle,vertex:number):[number,number,number]{
    if(triangle.brick&&triangle.uv)return [triangle.uv[vertex*2],triangle.uv[vertex*2+1],2];
    if(!triangle.text||!triangle.uv)return [0,0,0];
    const slot=this.slots.get(textKey(triangle.text));if(slot===undefined)return [0,0,0];
    const u=triangle.uv[vertex*2],v=triangle.uv[vertex*2+1];
    // Half-texel insets avoid sampling a neighbouring label at panel edges.
    return [(slot%this.columns+(u*(this.width/this.columns-1)+.5)/(this.width/this.columns))/this.columns,
      1-(Math.floor(slot/this.columns)+((1-v)*(this.height/this.rows-1)+.5)/(this.height/this.rows))/this.rows,1];
  }

  destroy(gl:WebGL2RenderingContext){if(this.texture)gl.deleteTexture(this.texture);this.texture=null;this.slots.clear();this.signature='';}
}
