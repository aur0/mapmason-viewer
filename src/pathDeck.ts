import {objectRing,pathProfile,pathSections,type Coord,type EventProject} from './model';

export function bridgeSupportDistances(points:number[][],water:number[][][]):number[]{
  const inside=(point:number[],ring:number[][])=>{
    let contained=false;
    for(let index=0,previous=ring.length-1;index<ring.length;previous=index++){
      const first=ring[index],last=ring[previous];
      if((first[1]>point[1])!==(last[1]>point[1])&&point[0]<(last[0]-first[0])*(point[1]-first[1])/(last[1]-first[1])+first[0])contained=!contained;
    }
    return contained;
  };
  const spans:{start:number;end:number;wet:boolean}[]=[];
  let traversed=0;
  for(let index=1;index<points.length;index++){
    const first=points[index-1],last=points[index],direction=[last[0]-first[0],last[1]-first[1]],length=Math.hypot(...direction);
    if(length<1e-6)continue;
    const cuts=[0,1];
    for(const ring of water)for(let edge=1;edge<ring.length;edge++){
      const start=ring[edge-1],end=ring[edge],side=[end[0]-start[0],end[1]-start[1]],relative=[start[0]-first[0],start[1]-first[1]];
      const determinant=direction[0]*side[1]-direction[1]*side[0];
      if(Math.abs(determinant)<1e-9)continue;
      const along=(relative[0]*side[1]-relative[1]*side[0])/determinant,across=(relative[0]*direction[1]-relative[1]*direction[0])/determinant;
      if(along>0&&along<1&&across>=0&&across<=1)cuts.push(along);
    }
    cuts.sort((first,last)=>first-last);
    for(let cut=1;cut<cuts.length;cut++){
      const start=traversed+cuts[cut-1]*length,end=traversed+cuts[cut]*length;
      if(end-start<1e-6)continue;
      const middle=(cuts[cut-1]+cuts[cut])/2,wet=water.some(ring=>inside([first[0]+direction[0]*middle,first[1]+direction[1]*middle],ring)),previous=spans.at(-1);
      if(previous&&previous.wet===wet)previous.end=end;else spans.push({start,end,wet});
    }
    traversed+=length;
  }
  return spans.flatMap(span=>{
    const length=span.end-span.start;
    const count=Math.min(100,span.wet?(length<=8?0:Math.max(1,Math.ceil(length/6)-1)):Math.max(1,Math.ceil(length/6)));
    return Array.from({length:count},(_,index)=>span.start+length*(span.wet?(index+1)/(count+1):(index+.5)/count));
  });
}

export type DeckTriangle={positions:number[];color:number[];id:string;section:number};
export function pathDeckTriangles(project:EventProject,selected:string|null):DeckTriangle[]{
  const triangles:DeckTriangle[]=[],origin=project.center,scaleX=111319.49079327358*Math.cos(origin[1]*Math.PI/180);
  const local=(point:Coord)=>[(point[0]-origin[0])*scaleX,-(Math.log(Math.tan(Math.PI/4+point[1]*Math.PI/360))-Math.log(Math.tan(Math.PI/4+origin[1]*Math.PI/360)))*6378137*Math.cos(origin[1]*Math.PI/180)];
  const water=project.objects.filter(object=>object.kind==='waterArea').map(object=>objectRing(object).map(local));
  for(const path of [...project.paths,...(project.bridges??[]).map(bridge=>({id:bridge.id,name:bridge.name,width:bridge.width,points:bridge.points,heights:bridge.heights,segmentTypes:bridge.points.slice(1).map(()=>'bridge' as const),bridgeDesigns:bridge.points.slice(1).map(()=>bridge.design)}))]){
    if(!path.heights?.some(height=>height>0))continue;
    for(const section of pathSections(path)){
      const samples=pathProfile(section.path).map(sample=>({position:[(sample.position[0]-origin[0])*scaleX,-(Math.log(Math.tan(Math.PI/4+sample.position[1]*Math.PI/360))-Math.log(Math.tan(Math.PI/4+origin[1]*Math.PI/360)))*6378137*Math.cos(origin[1]*Math.PI/180),sample.height+.025],section:section.start+sample.segment}));
      const sides=samples.map((sample,index)=>{
        const previous=samples[Math.max(0,index-1)].position,next=samples[Math.min(samples.length-1,index+1)].position;
        const before=[sample.position[0]-previous[0],sample.position[1]-previous[1]],after=[next[0]-sample.position[0],next[1]-sample.position[1]];
        const beforeLength=Math.hypot(...before),afterLength=Math.hypot(...after);
        const first=beforeLength>1e-8?[-before[1]/beforeLength,before[0]/beforeLength]:[-after[1]/(afterLength||1),after[0]/(afterLength||1)];
        const last=afterLength>1e-8?[-after[1]/afterLength,after[0]/afterLength]:first;
        const normal=[first[0]+last[0],first[1]+last[1]],length=Math.hypot(...normal)||1;
        normal[0]/=length;normal[1]/=length;
        const radius=Math.min(path.width*2,path.width/2/Math.max(.25,normal[0]*last[0]+normal[1]*last[1]));
        return {left:[sample.position[0]+normal[0]*radius,sample.position[1]+normal[1]*radius,sample.position[2]],right:[sample.position[0]-normal[0]*radius,sample.position[1]-normal[1]*radius,sample.position[2]]};
      });
      const color=selected===path.id?[.78,.9,.67]:section.type==='bridge'?[.87,.72,.45]:section.type==='underpass'?[.58,.68,.73]:[.95,.93,.86];
      const add=(first:number[],second:number[],third:number[],shade:number,index:number)=>triangles.push({positions:[...first,...second,...third],color:color.map(channel=>channel*shade),id:path.id,section:index});
      const bottom=(point:number[])=>[point[0],point[1],Math.max(0,point[2]-.18)];
      for(let index=1;index<samples.length;index++){
        const first=sides[index-1],last=sides[index],segment=samples[index-1].section;
        if(Math.hypot(samples[index].position[0]-samples[index-1].position[0],samples[index].position[1]-samples[index-1].position[1])<1e-6)continue;
        add(first.left,first.right,last.left,1,segment);add(first.right,last.right,last.left,1,segment);
        for(const side of ['left','right'] as const){add(first[side],last[side],bottom(first[side]),.62,segment);add(last[side],bottom(last[side]),bottom(first[side]),.62,segment);}
      }
      if(samples.length>1)for(const index of [0,samples.length-1]){
        const side=sides[index];add(side.left,side.right,bottom(side.left),.62,samples[index].section);add(side.right,bottom(side.right),bottom(side.left),.62,samples[index].section);
      }
      if(section.type==='bridge'){
        const beam=(first:number[],last:number[],thickness:number,segment:number,shade=.72)=>{
          const axis=[last[0]-first[0],last[1]-first[1],last[2]-first[2]],length=Math.hypot(...axis);if(length<1e-5)return;
          axis.forEach((value,index)=>axis[index]=value/length);
          const reference=Math.abs(axis[2])>.9?[0,1,0]:[0,0,1],u=[axis[1]*reference[2]-axis[2]*reference[1],axis[2]*reference[0]-axis[0]*reference[2],axis[0]*reference[1]-axis[1]*reference[0]],uLength=Math.hypot(...u);u.forEach((value,index)=>u[index]=value/uLength);
          const v=[axis[1]*u[2]-axis[2]*u[1],axis[2]*u[0]-axis[0]*u[2],axis[0]*u[1]-axis[1]*u[0]],radius=thickness/2;
          const corners=[first,last].map(center=>[[-1,-1],[1,-1],[1,1],[-1,1]].map(([a,b])=>center.map((value,index)=>value+u[index]*a*radius+v[index]*b*radius)));
          for(let side=0;side<4;side++){const next=(side+1)%4;add(corners[0][side],corners[0][next],corners[1][side],shade,segment);add(corners[0][next],corners[1][next],corners[1][side],shade,segment);}
          add(corners[0][0],corners[1][0],corners[1][1],shade,segment);add(corners[0][0],corners[1][1],corners[0][1],shade,segment);add(corners[0][3],corners[1][3],corners[1][2],shade,segment);add(corners[0][3],corners[1][2],corners[0][2],shade,segment);
        };
        const lengths=samples.slice(1).map((sample,index)=>Math.hypot(sample.position[0]-samples[index].position[0],sample.position[1]-samples[index].position[1]));
        let sampleIndex=0,traversed=0;
        for(const distance of bridgeSupportDistances(samples.map(sample=>sample.position),water)){
          while(sampleIndex<lengths.length-1&&traversed+lengths[sampleIndex]<distance){traversed+=lengths[sampleIndex];sampleIndex++;}
          if(!lengths[sampleIndex])continue;
          const first=samples[sampleIndex].position,last=samples[sampleIndex+1].position,ratio=(distance-traversed)/lengths[sampleIndex];
          const position=first.map((value,index)=>value+(last[index]-value)*ratio),height=position[2]-.18;
          if(height<.5)continue;
          const tangent=[(last[0]-first[0])/lengths[sampleIndex],(last[1]-first[1])/lengths[sampleIndex]],normal=[-tangent[1],tangent[0]];
          const thickness=Math.min(.5,Math.max(.2,path.width*.08)),offset=Math.max(0,path.width/2-thickness);
          for(const lateral of offset>thickness?[-offset,offset]:[0]){
            const corners=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([along,across])=>[position[0]+normal[0]*lateral+(tangent[0]*along+normal[0]*across)*thickness/2,position[1]+normal[1]*lateral+(tangent[1]*along+normal[1]*across)*thickness/2,.025]);
            const tops=corners.map(point=>[point[0],point[1],height]),segment=samples[sampleIndex].section;
            for(let side=0;side<4;side++){
              const next=(side+1)%4,shade=side%2===0?.55:.7;
              add(corners[side],corners[next],tops[side],shade,segment);add(corners[next],tops[next],tops[side],shade,segment);
            }
            add(tops[0],tops[1],tops[2],.8,segment);add(tops[0],tops[2],tops[3],.8,segment);
          }
        }
        let railPostTravel=Infinity;
        for(let index=0;index<samples.length;index++){
          const segment=samples[index].section;if(path.bridgeDesigns?.[segment]!=='railed') {railPostTravel=Infinity;continue;}
          const previous=index?samples[index-1].position:null,current=samples[index].position;
          if(previous)for(const side of ['left','right'] as const){
            const first=[...sides[index-1][side]],last=[...sides[index][side]];first[2]+=.9;last[2]+=.9;beam(first,last,.14,segment,.62);
            first[2]-=.42;last[2]-=.42;beam(first,last,.1,segment,.65);
          }
          const step=previous?Math.hypot(current[0]-previous[0],current[1]-previous[1]):0;railPostTravel+=step;
          if(railPostTravel>=2||!previous){railPostTravel=0;for(const side of ['left','right'] as const){const foot=[...sides[index][side]],top=[...foot];foot[2]+=.08;top[2]+=.88;beam(foot,top,.14,segment,.58);}}
        }
      }
    }
  }
  return triangles;
}

export function deckProjection(matrix:ArrayLike<number>,origin:{x:number;y:number;meterInMercatorCoordinateUnits:()=>number}):Float32Array{
  const result=new Float32Array(16),scale=origin.meterInMercatorCoordinateUnits();
  for(let row=0;row<4;row++){
    for(let column=0;column<3;column++)result[column*4+row]=matrix[column*4+row]*scale;
    result[12+row]=matrix[row]*origin.x+matrix[4+row]*origin.y+matrix[12+row];
  }
  return result;
}

export function projectDeckPoint(point:number[],matrix:Float32Array,width:number,height:number):Coord&{depth?:number}{
  const clip=Array.from({length:4},(_,row)=>matrix[row]*point[0]+matrix[4+row]*point[1]+matrix[8+row]*point[2]+matrix[12+row]);
  const screen:Coord&{depth?:number}=[(clip[0]/clip[3]+1)*width/2,(1-clip[1]/clip[3])*height/2];
  screen.depth=clip[3]>0?clip[2]/clip[3]:Infinity;
  return screen;
}
