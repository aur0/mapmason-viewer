import {bridgePaths,objectRing,pathProfile,pathSections,type Coord,type EventProject} from './model';
import polygonClipping from 'polygon-clipping';
import earcut from 'earcut';

// Fill a corner from the incident arm edges, keeping its footprint bounded by
// their actual widths. Decks and railings must use the same corner polygons.
function bridgeCornerJoins(samples:{position:number[];section:number}[],width:number){
  const nodes=new Map<string,{point:number[];section:number;corners:Coord[]}>();
  for(let index=1;index<samples.length;index++){
    const first=samples[index-1].position,last=samples[index].position,dx=last[0]-first[0],dy=last[1]-first[1],length=Math.hypot(dx,dy);if(length<1e-6)continue;
    const normal=[-dy/length*width/2,dx/length*width/2];
    for(const point of [first,last]){const key=point.map(value=>Math.round(value*1000)).join(','),node=nodes.get(key)??{point,section:samples[index-1].section,corners:[]};for(const sign of [-1,1])node.corners.push([point[0]+normal[0]*sign,point[1]+normal[1]*sign]);nodes.set(key,node);}
  }
  return [...nodes.values()].flatMap(node=>{
    const points=[...new Map(node.corners.map(point=>[point.map(value=>value.toFixed(8)).join(','),point])).values()].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);if(points.length<3)return [];
    const cross=(a:Coord,b:Coord,c:Coord)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]),half=(values:Coord[])=>{const hull:Coord[]=[];for(const point of values){while(hull.length>=2&&cross(hull[hull.length-2],hull[hull.length-1],point)<=1e-9)hull.pop();hull.push(point);}return hull;},lower=half(points),upper=half([...points].reverse()),ring=[...lower.slice(0,-1),...upper.slice(0,-1)];
    if(ring.length<3)return [];return [{ring:[...ring,ring[0]],height:node.point[2],section:node.section}];
  });
}

// Union the arm footprints first: shared edges inside a junction cannot carry rails.
export function bridgeRailEdges(samples:{position:number[];section:number}[],width:number):{first:number[];last:number[];section:number;postable:boolean}[]{
  const arms=samples.slice(1).flatMap((sample,index)=>{
    const first=samples[index].position,last=sample.position,dx=last[0]-first[0],dy=last[1]-first[1],length=Math.hypot(dx,dy);
    if(length<1e-6)return [];
    const normal=[-dy/length*width/2,dx/length*width/2];
    const sides=[1,-1].map(sign=>[first,last].map(point=>[point[0]+normal[0]*sign,point[1]+normal[1]*sign] as Coord));
    return [{first,last,section:samples[index].section,sides,ring:[sides[0][0],sides[0][1],sides[1][1],sides[1][0],sides[0][0]]}];
  });
  if(!arms.length)return [];
  const joins=bridgeCornerJoins(samples,width),outline=polygonClipping.union([arms[0].ring],...arms.slice(1).map(arm=>[arm.ring]),...joins.map(join=>[join.ring]));
  const edges:{first:number[];last:number[];section:number;postable:boolean}[]=[];
  for(const polygon of outline)for(const ring of polygon)for(let index=1;index<ring.length;index++){
    const start=ring[index-1],end=ring[index],edgeX=end[0]-start[0],edgeY=end[1]-start[1],edgeLengthSquared=edgeX*edgeX+edgeY*edgeY,cuts=[0,1];
    if(edgeLengthSquared<1e-12)continue;
    // Polygon union removes collinear vertices; restore the ramp/step breaks.
    for(const arm of arms)for(const side of arm.sides)for(const point of side){
      const ratio=((point[0]-start[0])*edgeX+(point[1]-start[1])*edgeY)/edgeLengthSquared;
      if(ratio>1e-7&&ratio<1-1e-7&&Math.abs((point[0]-start[0])*edgeY-(point[1]-start[1])*edgeX)/Math.sqrt(edgeLengthSquared)<1e-5)cuts.push(ratio);
    }
    const sorted=[...new Set(cuts)].sort((a,b)=>a-b);
    for(let cut=1;cut<sorted.length;cut++){
    const first=[start[0]+edgeX*sorted[cut-1],start[1]+edgeY*sorted[cut-1]],last=[start[0]+edgeX*sorted[cut],start[1]+edgeY*sorted[cut]],middle=[(first[0]+last[0])/2,(first[1]+last[1])/2];
    // Match the outer deck boundary to either a longitudinal side or a join
    // boundary so rails and their posts stay together around corners.
    let matched=false;
    for(const arm of arms){
      const dx=arm.last[0]-arm.first[0],dy=arm.last[1]-arm.first[1],lengthSquared=dx*dx+dy*dy;
      const side=arm.sides.find(([a,b])=>Math.abs((middle[0]-a[0])*(b[1]-a[1])-(middle[1]-a[1])*(b[0]-a[0]))/Math.sqrt(lengthSquared)<1e-5&&((middle[0]-a[0])*dx+(middle[1]-a[1])*dy)/lengthSquared>=-1e-6&&((middle[0]-a[0])*dx+(middle[1]-a[1])*dy)/lengthSquared<=1+1e-6);
      if(!side)continue;
      const raised=(point:number[])=>{const t=Math.max(0,Math.min(1,((point[0]-arm.first[0])*dx+(point[1]-arm.first[1])*dy)/lengthSquared));return [point[0],point[1],arm.first[2]+(arm.last[2]-arm.first[2])*t];};
      edges.push({first:raised(first),last:raised(last),section:arm.section,postable:true});matched=true;break;
    }
    if(!matched)for(const join of joins){
      const onCorner=join.ring.slice(1).some((b,index)=>{
        const a=join.ring[index],dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy;
        const t=length?((middle[0]-a[0])*dx+(middle[1]-a[1])*dy)/length:-1;
        return t>=-1e-6&&t<=1+1e-6&&Math.abs((middle[0]-a[0])*dy-(middle[1]-a[1])*dx)/Math.sqrt(length)<1e-5;
      });
      if(onCorner){edges.push({first:[...first,join.height],last:[...last,join.height],section:join.section,postable:true});break;}
    }
    }
  }
  return edges;
}

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
  const triangles:DeckTriangle[]=[],railSegments=new Set<string>(),railPosts=new Set<string>(),origin=project.center,scaleX=111319.49079327358*Math.cos(origin[1]*Math.PI/180);
  const local=(point:Coord)=>[(point[0]-origin[0])*scaleX,-(Math.log(Math.tan(Math.PI/4+point[1]*Math.PI/360))-Math.log(Math.tan(Math.PI/4+origin[1]*Math.PI/360)))*6378137*Math.cos(origin[1]*Math.PI/180)];
  const water=project.objects.filter(object=>object.kind==='waterArea').map(object=>objectRing(object).map(local));
  const paths=[...project.paths,...bridgePaths(project.bridges)],positionKey=(point:number[])=>point.map(value=>Math.round(value*1000)).join(',');
  for(const path of paths){
    if(!path.heights?.some(height=>height>0))continue;
    for(const section of pathSections(path)){
      const samples=pathProfile(section.path).map(sample=>({position:[(sample.position[0]-origin[0])*scaleX,-(Math.log(Math.tan(Math.PI/4+sample.position[1]*Math.PI/360))-Math.log(Math.tan(Math.PI/4+origin[1]*Math.PI/360)))*6378137*Math.cos(origin[1]*Math.PI/180),sample.height+.025],section:section.start+sample.segment,unrailed:section.path.unrailedSegments?.[sample.segment]??false}));
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
      if(section.type==='bridge'){
        const arms=samples.slice(1).flatMap((sample,index)=>{
          const first=samples[index].position,last=sample.position,dx=last[0]-first[0],dy=last[1]-first[1],length=Math.hypot(dx,dy);
          if(length<1e-6)return [];
          const normal=[-dy/length*path.width/2,dx/length*path.width/2],a=[first[0]+normal[0],first[1]+normal[1]],b=[last[0]+normal[0],last[1]+normal[1]],c=[last[0]-normal[0],last[1]-normal[1]],d=[first[0]-normal[0],first[1]-normal[1]];
          return [{first,last,section:samples[index].section,ring:[a,b,c,d,a] as Coord[]}];
        });
        if(arms.length){
          // Steps are stored as two samples at the same centreline position:
          // one at the lower tread height and one at the next riser height.
          // Close that vertical face across the full deck width.
          for(let index=1;index<samples.length;index++){
            const lower=samples[index-1].position,upper=samples[index].position,dx=upper[0]-lower[0],dy=upper[1]-lower[1];
            if(Math.hypot(dx,dy)>1e-6||Math.abs(upper[2]-lower[2])<1e-4)continue;
            let tangent=[0,0];
            for(let offset=1;offset<samples.length&&!Math.hypot(...tangent);offset++){
              const before=samples[Math.max(0,index-offset)].position,after=samples[Math.min(samples.length-1,index+offset)].position;
              tangent=[after[0]-before[0],after[1]-before[1]];
            }
            const length=Math.hypot(...tangent);if(length<1e-6)continue;
            const normal=[-tangent[1]/length*path.width/2,tangent[0]/length*path.width/2],low=Math.min(lower[2],upper[2]),high=Math.max(lower[2],upper[2]),
              first=[lower[0]+normal[0],lower[1]+normal[1],low],second=[lower[0]-normal[0],lower[1]-normal[1],low],
              third=[lower[0]-normal[0],lower[1]-normal[1],high],fourth=[lower[0]+normal[0],lower[1]+normal[1],high];
            add(first,second,third,.8,samples[index].section);add(first,third,fourth,.8,samples[index].section);
          }
          for(const arm of arms){
            const [leftFirst,leftLast,rightLast,rightFirst]=arm.ring,[firstHeight,lastHeight]=[arm.first[2],arm.last[2]],leftStart=[leftFirst[0],leftFirst[1],firstHeight],rightStart=[rightFirst[0],rightFirst[1],firstHeight],leftEnd=[leftLast[0],leftLast[1],lastHeight],rightEnd=[rightLast[0],rightLast[1],lastHeight];
            add(leftStart,rightStart,leftEnd,1,arm.section);add(rightStart,rightEnd,leftEnd,1,arm.section);
          }
          for(const join of bridgeCornerJoins(samples,path.width)){
            const flat=join.ring.slice(0,-1).flat(),indices=earcut(flat),vertex=(index:number)=>[flat[index*2],flat[index*2+1],join.height];
            for(let index=0;index<indices.length;index+=3)add(vertex(indices[index]),vertex(indices[index+1]),vertex(indices[index+2]),1,join.section);
          }
          for(const edge of bridgeRailEdges(samples,path.width)){
            const first=edge.first,last=edge.last,firstBottom=bottom(first),lastBottom=bottom(last);
            add(first,last,firstBottom,.62,edge.section);add(last,lastBottom,firstBottom,.62,edge.section);
          }
          for(const index of [0,samples.length-1]){
            const center=samples[index].position,neighbor=samples[index===0?1:samples.length-2].position,dx=neighbor[0]-center[0],dy=neighbor[1]-center[1],length=Math.hypot(dx,dy)||1,normal=[-dy/length*path.width/2,dx/length*path.width/2],first=[center[0]+normal[0],center[1]+normal[1],center[2]],last=[center[0]-normal[0],center[1]-normal[1],center[2]],firstBottom=bottom(first),lastBottom=bottom(last);
            add(first,last,firstBottom,.62,section.start);add(last,lastBottom,firstBottom,.62,section.start);
          }
        }
      }else{
        for(let index=1;index<samples.length;index++){
          const first=sides[index-1],last=sides[index],segment=samples[index-1].section;
          if(Math.hypot(samples[index].position[0]-samples[index-1].position[0],samples[index].position[1]-samples[index-1].position[1])<1e-6)continue;
          add(first.left,first.right,last.left,1,segment);add(first.right,last.right,last.left,1,segment);
          for(const side of ['left','right'] as const){add(first[side],last[side],bottom(first[side]),.62,segment);add(last[side],bottom(last[side]),bottom(first[side]),.62,segment);}
        }
        if(samples.length>1)for(const index of [0,samples.length-1]){
          const side=sides[index];add(side.left,side.right,bottom(side.left),.62,samples[index].section);add(side.right,bottom(side.right),bottom(side.left),.62,samples[index].section);
        }
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
          if(samples[sampleIndex].unrailed)continue;
          if(!lengths[sampleIndex])continue;
          const first=samples[sampleIndex].position,last=samples[sampleIndex+1].position,ratio=(distance-traversed)/lengths[sampleIndex];
          const position=first.map((value,index)=>value+(last[index]-value)*ratio);
          const height=position[2]-.18;
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
        for(const edge of bridgeRailEdges(samples,path.width)){
          if(path.bridgeDesigns?.[edge.section]!=='railed')continue;
          if(path.unrailedSegments?.[edge.section])continue;
          const first=edge.first,last=edge.last,key=[positionKey(first),positionKey(last)].sort().join('|');
          if(railSegments.has(key))continue;
          railSegments.add(key);
          for(const height of [.9,.48])beam([first[0],first[1],first[2]+height],[last[0],last[1],last[2]+height],height===.9?.14:.1,edge.section,height===.9?.62:.65);
          const onRamp=Math.abs(last[2]-first[2])>.001;
          if(edge.postable&&!onRamp){
            const postLength=Math.hypot(last[0]-first[0],last[1]-first[1]),count=Math.max(1,Math.ceil(postLength/2));
            for(let index=0;index<=count;index++){
              const point=first.map((value,axis)=>value+(last[axis]-value)*index/count),postKey=positionKey(point);
              if(railPosts.has(postKey))continue;
              railPosts.add(postKey);beam([point[0],point[1],point[2]+.08],[point[0],point[1],point[2]+.88],.14,edge.section,.58);
            }
          }
        }
        // Stair treads must not turn the handrail into a zigzag. Keep their
        // usual deck-side rail edges suppressed, then run each handrail along
        // the stair flight with height interpolated evenly from bottom to top.
        let stairStart=-1;
        const addStairRailRun=(start:number,end:number)=>{
          if(start<0||end<=start)return;
          const section=samples[start].section;
          if(path.bridgeDesigns?.[section]!=='railed')return;
          const runLengths=Array.from({length:end-start},(_,offset)=>{
            const first=samples[start+offset].position,last=samples[start+offset+1].position;
            return Math.hypot(last[0]-first[0],last[1]-first[1]);
          }),runLength=runLengths.reduce((sum,length)=>sum+length,0);
          if(runLength<1e-5)return;
          const startHeight=samples[start].position[2],rise=samples[end].position[2]-startHeight;
          let travelled=0;
          for(let offset=0;offset<runLengths.length;offset++){
            const length=runLengths[offset],index=start+offset;
            if(length<1e-6)continue;
            const firstHeight=startHeight+rise*travelled/runLength,lastHeight=startHeight+rise*(travelled+length)/runLength;
            for(const side of ['left','right'] as const){
              const first=sides[index][side],last=sides[index+1][side],key=[positionKey(first),positionKey(last)].sort().join('|');
              if(railSegments.has(key))continue;
              railSegments.add(key);
              for(const railHeight of [.9,.48])beam([first[0],first[1],firstHeight+railHeight],[last[0],last[1],lastHeight+railHeight],railHeight===.9?.14:.1,samples[index].section,railHeight===.9?.62:.65);
            }
            travelled+=length;
          }
        };
        for(let index=0;index<samples.length-1;index++){
          if(samples[index].unrailed){if(stairStart<0)stairStart=index;}
          else if(stairStart>=0){addStairRailRun(stairStart,index);stairStart=-1;}
        }
        if(stairStart>=0)addStairRailRun(stairStart,samples.length-1);
        const groundRampEnd=samples.findIndex((sample,index)=>sample.position[2]<.08&&(
          sample.unrailed||Boolean(samples[index+1]&&samples[index+1].position[2]>sample.position[2]+.001)
        ));
        if(groundRampEnd>=0&&path.bridgeDesigns?.[samples[groundRampEnd].section]==='railed'){
          for(const side of ['left','right'] as const){
            const point=sides[groundRampEnd][side],key=positionKey(point);
            if(railPosts.has(key))continue;
            railPosts.add(key);beam([point[0],point[1],point[2]+.08],[point[0],point[1],point[2]+.88],.14,samples[groundRampEnd].section,.58);
          }
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
