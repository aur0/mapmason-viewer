import { objectIconInk, createObjectIcon } from './objectIcons';
import { allowsGpsPosition } from './siteGps';
import { traceRoadRoute } from './roadRouting';
import type { WalkingRoute } from './routing';
import { useEffect, useRef } from 'react';
import { addReferenceMap, updateReferenceMap, referenceGlyphs } from './referenceMap';
import { referenceFeatures } from './referenceLayers';
import {waterTexture} from './waterTexture';
import * as maplibregl from 'maplibre-gl';
import './mapLibreWorker';
import type { GeoJSONSource, Map as LibreMap } from 'maplibre-gl';
import { groundControlRing,groundFromPoints,groundRing,isBoundaryTool,areaKinds,isAreaKind, connectedPathIds, bridgePaths,bridgeEndpoints,bridgeJunctions,bridgeHandlePoints, pathOutlineFeatures, moveConnectedPathVertex, gridFeatures, kinds, objectFeatures, objectRing, pathFeatures,pathProfile,pathSections, type Coord, type EventProject,type SitePath } from './model';
import type { FeatureCollection, Point } from 'geojson';
import { DRAFT_PATH_ID,drawingPreview,segmentLengthLabel } from './drawing';
import {pathAccess,pathTypes,pathVertexKey,type PathType} from './model';
import {PathDeckLayer} from './PathDeckLayer';
import {MapObjectModelsLayer} from './MapObjectModelsLayer';

export type ViewerPosition = Pick<GeolocationPosition,'coords'|'timestamp'>;
export type MapActions = { roadRoute: () => import('./model').SitePath[]; relock: () => void; heading: (heading: number | null) => void; orient: (bearing: number, pitch: number) => void; fit: () => void; fitReference: (id:string) => void; zoom: (by: number) => void; north: () => void; locate: (at: Coord, options?: { preserveZoom?: boolean; from?: Coord; pointTowards?: boolean }) => void };
type Props = {onMapReady?:(map:LibreMap|null)=>void;pathType?:PathType;draftTypes?:PathType[]; onManualInteraction?: () => void; route?: WalkingRoute | null; onPosition?: (position: ViewerPosition) => void; gps?: boolean; onLocationError?: (message: string) => void; project: EventProject; selected: string | null; boxSelectedIds?:string[];boxSelectionActive?:boolean; tool: string; mode: '2d' | '3d'; reference: boolean; ground:boolean; boundary:boolean; groundVertex:number|null; onGroundSelect:(index:number)=>void; onGroundMove:(index:number,at:Coord)=>void; onGroundInsert:(index:number,at:Coord)=>void; onGroundRemove:(index:number)=>void; grid: boolean; labels: boolean; draftHeights?:number[]; draft: Coord[]; target: Coord | null; pathVertex: number | null; pathVertices?: {pathId:string;index:number}[]; actions: React.RefObject<MapActions | null>; onConnect: (at:Coord,closeLoop:boolean,height?:number) => void; onBridgeBranchAt:(id:string,at:Coord)=>void; onClick: (at: Coord, id?: string) => void; onMove: (id: string, at: Coord) => void; onPathMove: (id: string, index: number, at: Coord, connectTo?:{pathId:string;segment:number;at:Coord}) => void; onPathInsert: (id: string, index: number, at: Coord) => void; onPathRemove: (id: string, index: number) => void; onPathBranchAt:(id:string,at:Coord,segment:number,pointIndex?:number,branchTool?:'path'|'underpass'|'bridge')=>void; onPathSelect: (id:string,index:number,additive:boolean) => void; onPathSegmentSelect:(id:string,segment:number,extend:boolean)=>void; onBoxSelect:(ids:string[],points:{pathId:string;index:number}[])=>void; onCursor: (at: Coord) => void; onError: (s: string) => void };
const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };
const labelZoom={fullText:{highPriority:13,mediumPriority:14,other:15},showLowPriority:12.5};
export default function MapCanvas(props: Props) {
  const el = useRef<HTMLDivElement>(null), mapRef = useRef<LibreMap | null>(null);
  const latest = useRef(props); latest.current = props;
  const markers = useRef<maplibregl.Marker[]>([]);
  useEffect(() => {
    let map: LibreMap; let ready = false;
    const decks=new PathDeckLayer();
    const objectModels=new MapObjectModelsLayer(()=>positionEnds());
    const lengthLabel=document.createElement('div');lengthLabel.className='drawing-length';lengthLabel.hidden=true;lengthLabel.title='Next segment length';

    let midpointHandles: { marker: maplibregl.Marker; id:string; index: number }[] = [];
    let objectLabelMarkers:{marker:maplibregl.Marker;id:string}[]=[];
    let groundPoints:Coord[]=[];
    let groundMidpoints:{marker:maplibregl.Marker;index:number}[]=[];
    let editingPaths=new Map<string,Coord[]>();
    let vertexHandles:{marker:maplibregl.Marker;id:string;index:number}[]=[];
    let activeVertexDrag:{id:string;index:number;at?:Coord}|null=null;
    let pathDragCleanups:(()=>void)[]=[];
    let pointer:{x:number;y:number}|null=null,shiftHeld=false,hasDraft=false;
    let startObjectDrag:(event:PointerEvent,fromLabel?:boolean)=>void=()=>{};
    let snapTargets:{at:Coord;node:HTMLButtonElement;marker:maplibregl.Marker;closeLoop:boolean;height:number}[]=[];
    let bridgePreviewMarker:maplibregl.Marker|null=null,bridgePreviewNode:HTMLDivElement|null=null,bridgeHoverTarget:{id:string;at:Coord;height:number;segment:number;pointIndex?:number;tool:'bridge'|'path'|'underpass'}|null=null;
    let bridgeGuideSvg:SVGSVGElement|null=null;
    let highlightedDrawingPoint:{pathId:string;index:number}|null=null;
    const updateDrawingSnapHighlight=(target:{pathId:string;index:number}|null)=>{
      highlightedDrawingPoint=target;
      bridgeGuideSvg?.querySelectorAll<HTMLButtonElement>('[data-drawing-snap]').forEach(node=>node.classList.toggle('snap-highlight',node.dataset.pathId===target?.pathId&&node.dataset.pointIndex===String(target?.index)));
    };
    const renderBridgeGuideSvg=()=>{
      if(!bridgeGuideSvg)return;
      bridgeGuideSvg.replaceChildren();
      const dragging=activeVertexDrag!==null;
      if(!dragging&&(!['bridge','path','underpass'].includes(latest.current.tool)||latest.current.mode!=='3d'))return;
      const width=map.getContainer().clientWidth,height=map.getContainer().clientHeight;bridgeGuideSvg.setAttribute('viewBox',`0 0 ${width} ${height}`);bridgeGuideSvg.setAttribute('width',String(width));bridgeGuideSvg.setAttribute('height',String(height));
      const candidates=dragging?drawingGuidePaths(vertexDragTool(activeVertexDrag!.id,activeVertexDrag!.index)).filter(candidate=>candidate.path.id!==activeVertexDrag!.id):drawingGuidePaths(latest.current.tool);
      for(const candidate of candidates){
        const profile=pathProfile(candidate.path),projectPoint=(at:Coord,height:number)=>latest.current.mode==='3d'?decks.project(at,height)??map.project(at):map.project(at),projected=profile.map(sample=>projectPoint(sample.position,sample.height));
        if(projected.length<2)continue;
        if(latest.current.mode==='3d')for(const run of drawingGuideRuns(candidate)){const line=document.createElementNS('http://www.w3.org/2000/svg','polyline');line.setAttribute('points',run.samples.map(sample=>projectPoint(sample.position,sample.height)).map(point=>`${point.x},${point.y}`).join(' '));line.setAttribute('fill','none');line.setAttribute('stroke',run.blocked?'#e26358':candidate.kind==='bridge'?'#f6d879':candidate.kind==='underpass'?'#8fc9f1':'#50d7a0');line.setAttribute('stroke-width','3.5');line.setAttribute('stroke-dasharray','5 5');line.setAttribute('stroke-linecap','round');line.setAttribute('stroke-linejoin','round');line.setAttribute('vector-effect','non-scaling-stroke');line.style.filter='drop-shadow(0 1px 2px #18301caa)';bridgeGuideSvg.append(line);}
        if(dragging){
          for(const index of drawingGuidePointIndices(candidate)){
            const point=candidate.path.points[index],height=candidate.path.heights?.[index]??0,screen=projectPoint(point,height),dot=document.createElementNS('http://www.w3.org/2000/svg','foreignObject');dot.setAttribute('x',String(screen.x-8));dot.setAttribute('y',String(screen.y-8));dot.setAttribute('width','16');dot.setAttribute('height','16');const target=document.createElement('button');target.type='button';target.className='path-connect-target';target.dataset.drawingSnap='true';target.dataset.pathId=candidate.path.id;target.dataset.pointIndex=String(index);if(highlightedDrawingPoint?.pathId===candidate.path.id&&highlightedDrawingPoint.index===index)target.classList.add('snap-highlight');target.setAttribute('aria-hidden','true');target.tabIndex=-1;target.style.pointerEvents='none';dot.append(target);bridgeGuideSvg.append(dot);
          }
        }
      }
    };
    const drawingGuidePaths=(tool:string)=>{
      const paths:{path:SitePath;offset:number;kind:'path'|'underpass'|'bridge'}[]=[];
      if(tool==='path'){
        for(const path of latest.current.project.paths){
          if(!path.segmentTypes?.includes('underpass'))paths.push({path,offset:0,kind:'path'});
          else for(const section of pathSections(path))if(section.type!=='underpass')paths.push({path:section.path,offset:section.start,kind:'path'});
        }
      }else if(tool==='underpass'){
        for(const path of latest.current.project.paths)paths.push({path,offset:0,kind:'path'});
      }else if(tool==='bridge'){
        for(const path of latest.current.project.paths){
          for(const section of pathSections(path))if(section.type!=='underpass')paths.push({path:section.path,offset:section.start,kind:section.type==='bridge'?'bridge':'path'});
        }
        for(const path of bridgePaths(latest.current.project.bridges))paths.push({path,offset:0,kind:'bridge'});
      }
      if(['path','bridge','underpass'].includes(tool)&&latest.current.tool===tool&&!activeVertexDrag&&latest.current.draft.length>=2){const kind=tool as 'path'|'bridge'|'underpass';paths.push({path:{id:DRAFT_PATH_ID,name:'Unfinished route',width:4,points:latest.current.draft,heights:latest.current.draftHeights,segmentTypes:kind==='path'?latest.current.draftTypes:latest.current.draft.slice(1).map(()=>kind)},offset:0,kind});}
      return paths;
    };
    const drawingGuidePointIndices=(candidate:ReturnType<typeof drawingGuidePaths>[number])=>{
      const bridge=latest.current.project.bridges?.find(bridge=>bridge.id===candidate.path.id),key=(point:Coord)=>`${point[0].toFixed(9)},${point[1].toFixed(9)}`,seen=new Set<string>();
      const allowed=candidate.kind==='bridge'?new Set(bridgeHandlePoints(bridge?.sourcePoints??bridge?.points??candidate.path.points).map(key)):null;
      const ends=new Set(bridgeEndpoints(bridge?.sourcePoints??bridge?.points??candidate.path.points).map(key)),deckHeight=Math.max(0,...candidate.path.heights??[]);
      const blockedPoints=new Set(allowed?drawingGuideSegments(candidate).filter(segment=>segment.blocked).flatMap(segment=>[key(segment.first.position),key(segment.last.position)]):[]);
      return candidate.path.points.flatMap((point,index)=>{const value=key(point);if(seen.has(value)||allowed&&!allowed.has(value))return [];if(allowed&&!ends.has(value)&&((candidate.path.heights?.[index]??0)<deckHeight-.001||blockedPoints.has(value)))return [];seen.add(value);return [index];});
    };
    const nearestDrawingPoint=(point:{x:number;y:number},tool:'path'|'underpass'|'bridge',excludeId?:string)=>{
      let best:{distance:number;at:Coord;height:number;pathId:string;index:number}|undefined;
      for(const candidate of drawingGuidePaths(tool)){
        if(candidate.path.id===excludeId)continue;
        for(const index of drawingGuidePointIndices(candidate)){
          const at=candidate.path.points[index],height=candidate.path.heights?.[index]??0,ground=map.project(at),projected=latest.current.mode==='3d'?decks.project(at,height)??ground:ground,distance=Math.hypot(point.x-projected.x,point.y-projected.y);
          if(!best||distance<best.distance)best={distance,at,height,pathId:candidate.path.id,index};
        }
      }
      return best;
    };
    const vertexDragTool=(id:string,index:number):'path'|'underpass'|'bridge'=>{
      if(latest.current.project.bridges?.some(bridge=>bridge.id===id))return 'bridge';
      const path=latest.current.project.paths.find(path=>path.id===id),type=path?.segmentTypes?.[Math.min(index,path.points.length-2)];
      return type==='underpass'?'underpass':type==='bridge'?'bridge':'path';
    };
    const drawingGuideSegments=(candidate:ReturnType<typeof drawingGuidePaths>[number])=>{
      const samples=pathProfile(candidate.path),deckHeight=Math.max(0,...samples.map(sample=>sample.height));
      const segments=samples.slice(1).map((last,index)=>{const first=samples[index];return {first,last,blocked:candidate.kind==='bridge'&&candidate.path.id!==DRAFT_PATH_ID&&Math.min(first.height,last.height)<deckHeight-.001};});
      if(candidate.kind!=='bridge')return segments;
      const distances=[0];for(const segment of segments){const a=segment.first.position,b=segment.last.position,length=Math.hypot((b[0]-a[0])*111319.49079327358*Math.cos((a[1]+b[1])*Math.PI/360),(b[1]-a[1])*111319.49079327358);distances.push(distances.at(-1)!+length);}
      const incomingWidth=activeVertexDrag?(latest.current.project.bridges?.find(bridge=>bridge.id===activeVertexDrag!.id)?.width??latest.current.project.paths.find(path=>path.id===activeVertexDrag!.id)?.width??4):4;
      const clearance=Math.max(2,(candidate.path.width+incomingWidth)/2),blocked=segments.flatMap((segment,index)=>segment.blocked?[{start:Math.max(0,distances[index]-clearance),end:distances[index+1]+clearance}]:[]);
      return segments.flatMap((segment,index)=>{
        const start=distances[index],end=distances[index+1],length=end-start;if(length<1e-8)return [segment];
        const cuts=[start,end,...blocked.flatMap(zone=>[zone.start,zone.end]).filter(distance=>distance>start+1e-8&&distance<end-1e-8)].sort((a,b)=>a-b);
        const sampleAt=(distance:number)=>{const t=(distance-start)/length;return {segment:segment.first.segment,position:[segment.first.position[0]+(segment.last.position[0]-segment.first.position[0])*t,segment.first.position[1]+(segment.last.position[1]-segment.first.position[1])*t] as Coord,height:segment.first.height+(segment.last.height-segment.first.height)*t};};
        return cuts.slice(1).flatMap((distance,cut)=>distance-cuts[cut]<1e-8?[]:[{first:sampleAt(cuts[cut]),last:sampleAt(distance),blocked:blocked.some(zone=>(cuts[cut]+distance)/2>=zone.start&&(cuts[cut]+distance)/2<=zone.end)}]);
      });
    };
    const drawingGuideRuns=(candidate:ReturnType<typeof drawingGuidePaths>[number])=>{
      const runs:{blocked:boolean;samples:ReturnType<typeof pathProfile>}[]=[];
      for(const segment of drawingGuideSegments(candidate)){const previous=runs.at(-1);if(previous&&previous.blocked===segment.blocked)previous.samples.push(segment.last);else runs.push({blocked:segment.blocked,samples:[segment.first,segment.last]});}
      return runs;
    };
    const drawingGuideData=(paths:ReturnType<typeof drawingGuidePaths>)=>({type:'FeatureCollection' as const,features:paths.flatMap(candidate=>drawingGuideRuns(candidate).map(run=>({type:'Feature' as const,properties:{id:candidate.path.id,guideType:run.blocked?'ramp':candidate.kind},geometry:{type:'LineString' as const,coordinates:run.samples.map(sample=>sample.position)}})))});
    const bridgeRampEndpoints=()=> (latest.current.project.bridges??[]).flatMap(bridge=>{
      const source=bridge.sourcePoints??bridge.points,key=(point:Coord)=>`${point[0].toFixed(9)},${point[1].toFixed(9)}`;
      return bridgeEndpoints(source).flatMap(at=>{const setting=bridge.endpoints?.find(endpoint=>key(endpoint.point)===key(at)),mode=setting?.mode??'ramp';return mode==='ramp'||mode==='steps'?[{id:bridge.id,at}]:[];});
    });
    const nearestBridgeRampEndpoint=(point:{x:number;y:number})=>{
      let best:{id:string;at:Coord;distance:number}|undefined;
      for(const endpoint of bridgeRampEndpoints()){const projected=map.project(endpoint.at),distance=Math.hypot(point.x-projected.x,point.y-projected.y);if(!best||distance<best.distance)best={...endpoint,distance};}
      return best;
    };
    const nearestDrawingLine=(point:{x:number;y:number},tool:'path'|'underpass'|'bridge',excludeId?:string)=>{
      let best:{distance:number;id:string;at:Coord;height:number;segment:number;pointIndex?:number;kind:'path'|'underpass'|'bridge';blocked:boolean}|undefined;
      for(const candidate of drawingGuidePaths(tool)){
        if(candidate.path.id===excludeId)continue;
        const isBridge=candidate.kind==='bridge';
        const screenAt=(at:Coord,height:number)=>{const ground=map.project(at);return latest.current.mode==='3d'?decks.project(at,height)??ground:ground;};
        for(const {first,last,blocked} of drawingGuideSegments(candidate)){
          const a=screenAt(first.position,first.height),b=screenAt(last.position,last.height),dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
          const t=length?Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/length)):0,distance=Math.hypot(point.x-(a.x+t*dx),point.y-(a.y+t*dy));
          if(best&&distance>=best.distance)continue;
          const at:Coord=[first.position[0]+(last.position[0]-first.position[0])*t,first.position[1]+(last.position[1]-first.position[1])*t];
          const segment=candidate.offset+Math.max(0,Math.min(candidate.path.points.length-2,first.segment));
          let pointIndex:number|undefined;
          if(!isBridge)candidate.path.points.forEach((control,index)=>{const projected=screenAt(control,candidate.path.heights?.[index]??0);if(Math.hypot(point.x-projected.x,point.y-projected.y)<8)pointIndex=candidate.offset+index;});
          best={distance,id:candidate.path.id,at:pointIndex===undefined?at:(candidate.path.points[pointIndex-candidate.offset]??at),height:first.height+(last.height-first.height)*t,segment,pointIndex,kind:candidate.kind,blocked};
        }
      }
      return best?.blocked?undefined:best;
    };
    const setBridgePreview=(data:GeoJSON.GeoJSON)=>{const source=map.getSource('bridge-connect-preview') as GeoJSONSource|undefined;if(source&&map.isStyleLoaded())source.setData(data);};
    const updateVertexSnapPreview=(point:{x:number;y:number},excludeId:string)=>{
      if(!activeVertexDrag||activeVertexDrag.id!==excludeId)return;
      const tool=vertexDragTool(excludeId,activeVertexDrag.index),existingPoint=nearestDrawingPoint(point,tool,excludeId),overSnapPoint=Boolean(existingPoint&&existingPoint.distance<=14),target=overSnapPoint?undefined:nearestDrawingLine(point,tool,excludeId),inRange=Boolean(target&&target.distance<=14);
      updateDrawingSnapHighlight(overSnapPoint&&existingPoint?{pathId:existingPoint.pathId,index:existingPoint.index}:null);
      if(latest.current.mode==='2d'){
        map.setLayoutProperty('bridge-connect-preview','visibility',inRange?'visible':'none');
        setBridgePreview(inRange?{type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'Point',coordinates:target!.at}}]}:{type:'FeatureCollection',features:[]});
        return;
      }
      setBridgePreview({type:'FeatureCollection',features:[]});
      if(!inRange){if(bridgePreviewNode)bridgePreviewNode.style.display='none';return;}
      const ground=map.project(target!.at),raised=decks.project(target!.at,target!.height);
      if(!bridgePreviewMarker){bridgePreviewNode=document.createElement('div');bridgePreviewNode.className='path-vertex';bridgePreviewNode.setAttribute('aria-hidden','true');bridgePreviewNode.style.pointerEvents='none';bridgePreviewMarker=new maplibregl.Marker({element:bridgePreviewNode,anchor:'center'}).setLngLat(target!.at).addTo(map);}
      bridgePreviewMarker.setLngLat(target!.at).setOffset(raised?[raised.x-ground.x,raised.y-ground.y]:[0,0]);bridgePreviewNode!.style.display='block';bridgePreviewMarker.getElement().style.zIndex='20';
    };
    const nearestTarget=(point:{x:number;y:number})=>{
      let distance=14,result:typeof snapTargets[number]|undefined;
      for(const target of snapTargets){const ground=map.project(target.at),raised=latest.current.mode==='3d'&&target.height>0?decks.project(target.at,target.height):undefined,at=raised??ground,d=Math.hypot(at.x-point.x,at.y-point.y);if(d<distance){distance=d;result=target;}}
      return result;
    };
    const resolveDrawingPoint=(at:Coord,point:{x:number;y:number},shift:boolean):Coord=>{
      const target=nearestTarget(point);if(target)return target.at;
      if(['path','bridge','underpass'].includes(latest.current.tool)){const line=nearestDrawingLine(point,latest.current.tool as 'path'|'bridge'|'underpass');if(line&&line.distance<=14)return line.at;}
      if(!shift)return at;
      const p=latest.current,path=p.project.paths.find(path=>path.id===p.selected);
      const origin=p.tool==='path'||p.tool==='bridge'||p.tool==='underpass'||isBoundaryTool(p.tool)?p.draft.at(-1):p.tool==='extend-start'?path?.points[0]:p.tool==='extend-end'?path?.points.at(-1):undefined;
      if(!origin)return at;
      const horizontal:Coord=[at[0],origin[1]],vertical:Coord=[origin[0],at[1]],a=map.project(horizontal),b=map.project(vertical);
      return Math.hypot(a.x-point.x,a.y-point.y)<=Math.hypot(b.x-point.x,b.y-point.y)?horizontal:vertical;
    };
    const renderDraft=()=>{
      if(!ready)return;const p=latest.current;
      const drawing=p.tool==='path'||p.tool==='bridge'||p.tool==='underpass'||isBoundaryTool(p.tool)||p.tool.startsWith('extend-');
      if(!drawing&&!hasDraft)return;
      hasDraft=drawing;
      const at=pointer?map.unproject([pointer.x,pointer.y]):null,cursor=at&&pointer?resolveDrawingPoint([at.lng,at.lat],pointer,shiftHeld):null;
      const path=p.project.paths.find(path=>path.id===p.selected),extension=p.tool==='extend-start'?path?.points[0]:p.tool==='extend-end'?path?.points.at(-1):undefined;
      const origin=extension??p.draft.at(-1);
      lengthLabel.hidden=!(drawing&&cursor&&pointer&&origin);
      if(!lengthLabel.hidden&&origin&&cursor&&pointer){
        lengthLabel.textContent=segmentLengthLabel(origin,cursor);
        const x=Math.max(8,Math.min(pointer.x+14,map.getContainer().clientWidth-lengthLabel.offsetWidth-8)),y=Math.max(8,Math.min(pointer.y-32,map.getContainer().clientHeight-lengthLabel.offsetHeight-8));
        lengthLabel.style.transform=`translate(${x}px,${y}px)`;
      }
      const data=drawingPreview(p.tool,p.draft,cursor,extension,p.draftTypes,p.pathType);
      (map.getSource('draft') as GeoJSONSource).setData(data.draft);(map.getSource('draft-preview') as GeoJSONSource).setData(data.preview);
    };
    const shiftChange=(event:KeyboardEvent)=>{if(event.key==='Shift'){shiftHeld=event.type==='keydown';renderDraft();}};
    const positionEnds = () => {
      objectLabelMarkers.forEach(({marker,id})=>{const object=latest.current.project.objects.find(item=>item.id===id);if(!object)return;const ground=map.project(object.position),raised=latest.current.mode==='3d'?objectModels.project(object.position,object.height):undefined;marker.setLngLat(object.position).setOffset(raised?[raised.x-ground.x,raised.y-ground.y-8]:[0,-8]);});
      groundMidpoints.forEach(({marker,index})=>{const a=map.project(groundPoints[index]),b=map.project(groundPoints[(index+1)%groundPoints.length]);marker.setLngLat(map.unproject([(a.x+b.x)/2,(a.y+b.y)/2]));});
      vertexHandles.forEach(({marker,id,index})=>{
        if(activeVertexDrag?.id===id&&activeVertexDrag.index===index)return;
        const at=editingPaths.get(id)?.[index];if(!at)return;const height=latest.current.project.paths.find(path=>path.id===id)?.heights?.[index]??bridgePaths(latest.current.project.bridges).find(path=>path.id===id)?.heights?.[index]??0,ground=map.project(at),raised=latest.current.mode==='3d'?decks.project(at,height):undefined;
        marker.setLngLat(at).setOffset(raised?[raised.x-ground.x,raised.y-ground.y]:[0,0]);
      });
      snapTargets.forEach(({at,marker,height})=>{const ground=map.project(at),raised=latest.current.mode==='3d'&&height>0?decks.project(at,height):undefined;marker.setLngLat(at).setOffset(raised?[raised.x-ground.x,raised.y-ground.y]:[0,0]);});
      midpointHandles.forEach(({ marker, id,index }) => {
        const editingPoints=editingPaths.get(id)!;
        const a = map.project(editingPoints[index - 1]), b = map.project(editingPoints[index]);
        const at=map.unproject([(a.x+b.x)/2,(a.y+b.y)/2]),path=latest.current.project.paths.find(path=>path.id===id),height=((path?.heights?.[index-1]??0)+(path?.heights?.[index]??0))/2;
        const ground=map.project(at),raised=latest.current.mode==='3d'?decks.project([at.lng,at.lat],height):undefined;
        marker.setLngLat(at).setOffset(raised?[raised.x-ground.x,raised.y-ground.y]:[0,0]);
      });
      renderBridgeGuideSvg();
    };
    try {
      map = new maplibregl.Map({ container: el.current!, center: props.project.center, zoom: 17.5, maxZoom: 22, minZoom: 3, maxPitch: 65, pitch: props.mode === '3d' ? 55 : 0, bearing: props.mode === '3d' ? -22 : 0, attributionControl: false,
        style: { version: 8, glyphs: referenceGlyphs, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#b8c9bb' } }] } });
    } catch { props.onError('WebGL is unavailable. Enable hardware acceleration or try another browser.'); return; }
    mapRef.current = map;
    el.current!.append(lengthLabel);
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-left');
    let gpsControl: maplibregl.GeolocateControl | undefined, gpsFollowing = false;
    let lastGPS: Coord | undefined, recenterRequested = false, gpsCameraPaused=false;
    let pauseGpsFollow=()=>{};
    let sensorHeading:number|null=null;
    function renderGpsHeading(){
      const dot=map.getContainer().querySelector<HTMLElement>('.maplibregl-user-location-dot');if(!dot)return;
      const heading=sensorHeading;
      dot.classList.toggle('gps-navigation-arrow',heading!==null);
      if(heading!==null)dot.style.setProperty('--gps-heading',(heading-map.getBearing())+'deg');
      if(!dot.querySelector('.gps-direction-icon')){
        const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('gps-direction-icon');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');
        const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d','M12 2 3 21 12 17 21 21Z');path.setAttribute('fill','#238bff');path.setAttribute('stroke','white');path.setAttribute('stroke-width','1.7');path.setAttribute('stroke-linejoin','round');svg.append(path);dot.append(svg);
      }
    }
    map.on('rotate',renderGpsHeading);
    const manualInteraction = () => {pauseGpsFollow();latest.current.onManualInteraction?.();};
    const canvas = map.getCanvas();
    let pathBox:{pointer:number;start:{x:number;y:number};box:HTMLDivElement;pan:boolean;boxZoom:boolean}|null=null,suppressBoxClick=false;
    const boxPoint=(event:PointerEvent)=>{const rect=canvas.getBoundingClientRect();return{x:event.clientX-rect.left,y:event.clientY-rect.top};};
    const boxDown=(event:PointerEvent)=>{const p=latest.current;if(event.button!==0||!event.shiftKey||event.ctrlKey||event.metaKey||p.tool!=='select')return;const start=boxPoint(event),box=document.createElement('div');Object.assign(box.style,{position:'absolute',pointerEvents:'none',border:'1px solid #38bdf8',background:'rgba(56,189,248,.12)',zIndex:'20'});canvas.parentElement?.appendChild(box);pathBox={pointer:event.pointerId,start,box,pan:map.dragPan.isEnabled(),boxZoom:map.boxZoom.isEnabled()};map.stop();map.dragPan.disable();map.boxZoom.disable();canvas.setPointerCapture(event.pointerId);canvas.style.cursor='crosshair';event.preventDefault();event.stopImmediatePropagation();};
    const boxMove=(event:PointerEvent)=>{if(!pathBox||event.pointerId!==pathBox.pointer)return;const p=boxPoint(event),box=pathBox.box;Object.assign(box.style,{left:Math.min(p.x,pathBox.start.x)+'px',top:Math.min(p.y,pathBox.start.y)+'px',width:Math.abs(p.x-pathBox.start.x)+'px',height:Math.abs(p.y-pathBox.start.y)+'px'});event.preventDefault();event.stopImmediatePropagation();};
    const boxFinish=(event:PointerEvent)=>{
      if(!pathBox||event.pointerId!==pathBox.pointer)return;
      const drag=pathBox,end=boxPoint(event),rect={left:Math.min(end.x,drag.start.x),right:Math.max(end.x,drag.start.x),top:Math.min(end.y,drag.start.y),bottom:Math.max(end.y,drag.start.y)},ids=new Set<string>(),canvasRect=canvas.getBoundingClientRect();
      // Point handles are only rendered for the currently editable paths. Box
      // selection must still find points on every path, including when no path
      // was selected before the drag began.
      const selectablePaths=[...latest.current.project.paths,...bridgePaths(latest.current.project.bridges)];
      const points=selectablePaths.flatMap(path=>path.points.flatMap((coordinate,index)=>{const point=map.project(coordinate);return point.x>=rect.left&&point.x<=rect.right&&point.y>=rect.top&&point.y<=rect.bottom?[{pathId:path.id,index}]:[]}));
      const project=latest.current.project,insideCoordinates=(coordinates:unknown)=>{let found=false,contained=true;const visit=(value:unknown)=>{if(!Array.isArray(value))return;if(typeof value[0]==='number'&&typeof value[1]==='number'){found=true;const point=map.project([value[0],value[1]]);if(point.x<rect.left||point.x>rect.right||point.y<rect.top||point.y>rect.bottom)contained=false;return;}value.forEach(visit);};visit(coordinates);return found&&contained;};
      const features=[...objectFeatures(project,null).features,...pathFeatures(project,null).features,...pathFeatures({...project,paths:bridgePaths(project.bridges)},null).features,...project.areas.map(area=>({type:'Feature' as const,properties:{id:area.id},geometry:{type:'Polygon' as const,coordinates:area.rings}}))],containedById=new Map<string,boolean>();
      for(const feature of features){const id=feature.properties?.id;if(typeof id!=='string')continue;containedById.set(id,(containedById.get(id)??true)&&insideCoordinates(feature.geometry.coordinates));}
      for(const [id,contained] of containedById)if(contained)ids.add(id);
      drag.box.remove();if(drag.pan)map.dragPan.enable();if(drag.boxZoom)map.boxZoom.enable();pathBox=null;suppressBoxClick=event.type==='pointerup';if(ids.size||points.length)latest.current.onBoxSelect([...ids],points);if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);canvas.style.cursor='';event.preventDefault();event.stopImmediatePropagation();
    };
    const boxClick=(event:MouseEvent)=>{if(!suppressBoxClick)return;suppressBoxClick=false;event.preventDefault();event.stopImmediatePropagation();};
    canvas.addEventListener('pointerdown',boxDown,true);canvas.addEventListener('pointermove',boxMove,true);canvas.addEventListener('pointerup',boxFinish,true);canvas.addEventListener('pointercancel',boxFinish,true);canvas.addEventListener('click',boxClick,true);
    canvas.addEventListener('pointerdown', manualInteraction, { passive: true });
    canvas.addEventListener('touchstart', manualInteraction, { passive: true });
    canvas.addEventListener('wheel', manualInteraction, { passive: true });
    if (props.gps) {
      // Use the control's boundary rejection before it moves the camera or emits a fix.
      class SiteGeolocateControl extends maplibregl.GeolocateControl {
        _isOutOfMapMaxBounds(position: GeolocationPosition) {
          return !allowsGpsPosition(latest.current.project,[position.coords.longitude,position.coords.latitude]) || super._isOutOfMapMaxBounds(position);
        }
      }
      const gps = new SiteGeolocateControl({
        positionOptions: { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 },
        trackUserLocation: true, showUserLocation: true, showAccuracyCircle: true,
        // Keep the visitor's chosen camera scale on every GPS fix and recenter.
        fitBoundsOptions: {
          get zoom() { return map.getZoom(); },
          get pitch() { return map.getPitch(); },
          linear: true,
          duration: 300,
        },
      });
      gpsControl = gps;
      const updateGpsCamera=gps._updateCamera;
      gps._updateCamera=position=>{if(!gpsCameraPaused)updateGpsCamera(position);};
      pauseGpsFollow=()=>{
        gpsCameraPaused=true;recenterRequested=false;
        // The built-in handler ignores moves while zooming. Stop that animation
        // before releasing follow, and guard camera updates during pending fixes.
        map.stop();gps._onMoveStart({});
      };
      gps.on('trackuserlocationstart', () => { gpsFollowing = true;gpsCameraPaused=false; });
      gps.on('trackuserlocationend', () => { gpsFollowing = false; });
      gps.on('userlocationfocus',()=>{if(lastGPS)map.easeTo({center:lastGPS,duration:300},{geolocateSource:true});});
      gps.on('outofmaxbounds', () => {
        lastGPS=undefined;recenterRequested=false;
        latest.current.onLocationError?.('Your location is outside this site. GPS will centre on you when you enter the site.');
      });
      gps.on('error', (event: { code?: number }) => {
        latest.current.onLocationError?.(event.code === 1 ? 'Location permission was denied. Allow location in your browser settings to show your position.' : event.code === 3 ? 'GPS timed out. Try again with a clearer view of the sky.' : 'Your position is unavailable. Check that location services are enabled and try again.');
      });
      gps.on('geolocate', (position) => { lastGPS = [position.coords.longitude, position.coords.latitude]; if (recenterRequested) { recenterRequested = false; map.jumpTo({ center: lastGPS }, { geolocateSource: true }); } latest.current.onLocationError?.(''); latest.current.onPosition?.(position); });
      map.addControl(gps, 'bottom-right');
    }

    props.actions.current = {
      roadRoute: () => {
        if (!ready || !latest.current.reference || !map.getSource('openmaptiles')) throw new Error('Enable the reference map and wait for roads to finish loading.');
        return traceRoadRoute(latest.current.project, map.querySourceFeatures('openmaptiles', { sourceLayer: 'transportation' }));
      },
      relock: () => { gpsCameraPaused=false;recenterRequested = true; if (!gpsFollowing) gpsControl?.trigger(); if (lastGPS) { recenterRequested = false; map.jumpTo({ center: lastGPS }, { geolocateSource: true }); } },
      heading: heading => {sensorHeading=heading!==null&&Number.isFinite(heading)?heading:null;renderGpsHeading();},
      orient: (bearing, pitch) => map.jumpTo({ bearing, pitch }, { geolocateSource: true }),
      fit: () => { pauseGpsFollow();const p = latest.current.project; const corners = p.layout === 'route' ? [] : groundRing(p); const bounds = new maplibregl.LngLatBounds(); corners.forEach(c => bounds.extend(c)); p.objects.forEach(o => objectRing(o).forEach(c=>bounds.extend(c))); p.paths.forEach(path => path.points.forEach(c => bounds.extend(c))); p.areas.forEach(a => a.rings.forEach(r => r.forEach(c => bounds.extend(c)))); if (bounds.isEmpty()) { map.flyTo({center:p.center,zoom:17.5}); return; } map.fitBounds(bounds, { padding: Math.min(65, map.getContainer().clientWidth / 5), duration: 600, maxZoom: 19 }); },
      fitReference: id => {const layer=latest.current.project.referenceLayers?.find(l=>l.id===id);if(!layer)return;pauseGpsFollow();const bounds=new maplibregl.LngLatBounds();layer.points.forEach(p=>bounds.extend(p.position));layer.lines.forEach(l=>l.points.forEach(p=>bounds.extend(p)));layer.polygons.forEach(a=>a.rings.forEach(r=>r.forEach(p=>bounds.extend(p))));if(!bounds.isEmpty())map.fitBounds(bounds,{padding:Math.min(65,map.getContainer().clientWidth/5),maxZoom:18,duration:500});},
      zoom: by => map.jumpTo({ zoom: map.getZoom() + by }, { geolocateSource: true }), north: () => map.easeTo({ bearing: 0, duration: 400 }),
      locate: (at,options) => {
        pauseGpsFollow();
        if(options?.from){
          const from=options.from,rad=Math.PI/180,delta=(at[0]-from[0])*rad;
          const bearing=options.pointTowards&&Math.hypot(at[0]-from[0],at[1]-from[1])>1e-9?
            Math.atan2(Math.sin(delta)*Math.cos(at[1]*rad),Math.cos(from[1]*rad)*Math.sin(at[1]*rad)-Math.sin(from[1]*rad)*Math.cos(at[1]*rad)*Math.cos(delta))/rad:map.getBearing();
          const container=map.getContainer(),pitch=map.getPitch();
          const camera=map.cameraForBounds(new maplibregl.LngLatBounds(from,from).extend(at),{
            bearing,maxZoom:16.5,padding:{top:Math.min(100,container.clientHeight*.16),bottom:Math.min(220,container.clientHeight*.28),left:40,right:Math.min(75,container.clientWidth*.2)},
          });
          // Leave extra room for the perspective view's foreground.
          if(camera)map.easeTo({...camera,zoom:(camera.zoom??map.getZoom())-(pitch>0?.6:0),pitch,duration:500});
        }else if(options?.preserveZoom)map.easeTo({center:at,duration:400});
        else map.flyTo({center:at,zoom:17.5,duration:700});
      },
    };
    let referenceReady = false;
    map.on('load', () => {
      bridgeGuideSvg=document.createElementNS('http://www.w3.org/2000/svg','svg');Object.assign(bridgeGuideSvg.style,{position:'absolute',inset:'0',pointerEvents:'none',zIndex:'4',overflow:'visible'});map.getContainer().append(bridgeGuideSvg);
      for (const id of ['ground', 'grid', 'areas', 'objects', 'paths', 'path-outlines', 'path-selection', 'draft', 'draft-preview', 'target','bridge-connect-guides','bridge-connect-preview']) map.addSource(id, { type: 'geojson', data: empty });
      map.addLayer({ id: 'ground', type: 'fill', source: 'ground', paint: { 'fill-color': '#d9e3d3', 'fill-opacity': .93 } });
      map.addLayer({ id: 'ground-edge', type: 'line', source: 'ground', paint: { 'line-color': '#6b8f76', 'line-width': 1.5, 'line-dasharray': [4, 3] } });
      map.addLayer({ id: 'grid', type: 'line', source: 'grid', paint: { 'line-color': '#6a8a74', 'line-width': .6, 'line-opacity': .2 } });
      map.addSource('tracing-reference',{type:'geojson',data:empty});
      map.addLayer({id:'tracing-reference-fill',type:'fill',source:'tracing-reference',filter:['==',['geometry-type'],'Polygon'],paint:{'fill-color':'#7963bf','fill-opacity':['*',['get','opacity'],.2]}});
      map.addLayer({id:'tracing-reference-lines',type:'line',source:'tracing-reference',filter:['in',['geometry-type'],['literal',['LineString','Polygon']]],paint:{'line-color':'#7050b4','line-width':2.5,'line-opacity':['get','opacity']}});
      map.addLayer({id:'tracing-reference-points',type:'circle',source:'tracing-reference',filter:['==',['geometry-type'],'Point'],paint:{'circle-radius':5,'circle-color':'#7050b4','circle-opacity':['get','opacity'],'circle-stroke-color':'#fff','circle-stroke-width':1,'circle-stroke-opacity':['get','opacity']}});
      map.addLayer({id:'tracing-reference-labels',type:'symbol',source:'tracing-reference',layout:{'text-field':['get','name'],'text-font':['Noto Sans Regular'],'text-size':12,'text-anchor':'top','text-offset':[0,.7],'text-max-width':14},paint:{'text-color':'#503585','text-halo-color':'#fff','text-halo-width':1.5,'text-opacity':['get','opacity']}});
      map.addLayer({ id: 'camping', type: 'fill', source: 'objects', filter: ['in', ['get','kind'], ['literal',[...areaKinds]]], paint: { 'fill-color': ['get','color'], 'fill-opacity': ['case',['==',['get','kind'],'waterArea'],.8,['get','selected'],.55,.32] } });
      map.addLayer({ id: 'camping-edge', type: 'line', source: 'objects', filter: ['in', ['get','kind'], ['literal',areaKinds.filter(kind=>kind!=='waterArea')]], paint: { 'line-color': ['case',['get','selected'],'#254c2e','#63865a'], 'line-width': ['case',['get','selected'],2,1.3], 'line-dasharray':[4,2] } });
      map.addImage('water-facets',waterTexture());
      map.addLayer({id:'water-area-texture',type:'fill',source:'objects',filter:['==',['get','kind'],'waterArea'],paint:{'fill-pattern':'water-facets','fill-opacity':.45}});
      map.addLayer({id:'water-area-edge',type:'line',source:'objects',filter:['==',['get','kind'],'waterArea'],paint:{'line-color':['case',['get','selected'],'#254c2e','#428eae'],'line-width':['case',['get','selected'],2,1.3]}});
      map.addLayer({ id: 'areas-flat', type: 'fill', source: 'areas', paint: { 'fill-color': ['case', ['get', 'selected'], '#c1e4ad', '#abc3ad'], 'fill-opacity': .8 } });
      map.addLayer({ id: 'areas-edge', type: 'line', source: 'areas', paint: { 'line-color': ['case', ['get', 'selected'], '#254a31', '#6c9074'], 'line-width': ['case', ['get', 'selected'], 3, 1.5] } });
      map.addLayer({ id: 'areas-3d', type: 'fill-extrusion', source: 'areas', filter: ['>', ['get', 'height'], 0], paint: { 'fill-extrusion-color': ['case', ['get', 'selected'], '#c1e4ad', '#abc3ad'], 'fill-extrusion-height': ['get', 'height'] } });
      map.addLayer({ id: 'paths', type: 'fill', source: 'paths', paint: { 'fill-color': ['case', ['get', 'selected'], '#efffe0', '#f4efde'] } });
      map.setPaintProperty('paths','fill-color',['case',['get','selected'],'#efffe0',['match',['get','segmentType'],'bridge','#dfb974','underpass','#94aeba','#f4efde']]);
      map.addLayer({id:'path-selection',type:'line',source:'path-selection',paint:{'line-color':'#d6ff9d','line-width':7,'line-opacity':.95}});
      map.addLayer({id:'not-step-free-paths',type:'fill',source:'paths',filter:['all',['==',['get','access'],'notStepFree'],['==',['get','selected'],true]],paint:{'fill-color':'#c54f3f','fill-opacity':.78}});
      map.addLayer({id:'bridge-edge',type:'line',source:'paths',filter:['==',['get','segmentType'],'bridge'],paint:{'line-color':'#705329','line-width':2}});
      map.addLayer({id:'underpass-edge',type:'line',source:'paths',filter:['==',['get','segmentType'],'underpass'],paint:{'line-color':'#445b68','line-width':2,'line-dasharray':[3,2]}});
      map.moveLayer('path-selection');
      map.addLayer({ id: 'path-edge', type: 'line', source: 'path-outlines', paint: { 'line-color': '#9b9f84', 'line-width': .8, 'line-opacity': .5 } });
      map.addLayer({ id: 'objects-flat', type: 'fill', source: 'objects', filter:['!', ['in',['get','kind'],['literal',[...areaKinds]]]], paint: { 'fill-color': ['get', 'color'] } });
      map.addLayer({ id: 'objects-3d', type: 'fill-extrusion', source: 'objects', filter:['all',['!', ['in',['get','kind'],['literal',[...areaKinds]]] ],['!=',['get','customModel'],true]], paint: { 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-base': ['get','base'], 'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-opacity': 1, 'fill-extrusion-vertical-gradient': true } });
      map.addLayer({ id: 'object-edge', type: 'line', source: 'objects', filter:['!', ['in',['get','kind'],['literal',[...areaKinds,'tree']]]], paint: { 'line-color': ['case', ['get', 'selected'], '#173e2b', '#ffffff'], 'line-width': ['case', ['get', 'selected'], 3, 1], 'line-opacity': .8 } });
      map.addLayer(decks);
      map.addLayer(objectModels);
      map.addLayer({id:'bridge-connect-guides',type:'line',source:'bridge-connect-guides',paint:{'line-color':['match',['get','guideType'],'ramp','#e26358','bridge','#f6d879','underpass','#8fc9f1','#50d7a0'],'line-width':3.5,'line-opacity':.98,'line-dasharray':[1.2,1.2]}});
      map.addLayer({id:'bridge-connect-preview',type:'circle',source:'bridge-connect-preview',paint:{'circle-radius':8,'circle-color':'#315a37','circle-stroke-color':'#ffffff','circle-stroke-width':3,'circle-opacity':1}});
      map.addLayer({ id: 'draft', type: 'line', source: 'draft', paint: { 'line-color': '#24714b', 'line-width': 4, 'line-dasharray': [2, 1] } });
      map.addLayer({id:'draft-preview',type:'line',source:'draft-preview',paint:{'line-color':'#24714b','line-width':2,'line-opacity':.65,'line-dasharray':[3,2]}});
      for(const layer of ['draft','draft-preview'])map.setPaintProperty(layer,'line-color',['match',['get','segmentType'],'bridge','#ad7832','underpass','#446e91','#24714b']);
      map.setFilter('draft',['==','$type','LineString']);
      map.addLayer({ id:'draft-area',type:'fill',source:'draft',filter:['==','$type','Polygon'],paint:{'fill-color':'#91b886','fill-opacity':.3} },'draft');
      map.addLayer({ id: 'draft-points', type: 'circle', source: 'draft', filter: ['==', '$type', 'Point'], paint: { 'circle-radius': 5, 'circle-color': '#24714b', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } });
      map.addLayer({ id: 'target', type: 'circle', source: 'target', paint: { 'circle-radius': 8, 'circle-color': '#f7fff2', 'circle-stroke-color': '#173e2b', 'circle-stroke-width': 2 } });
      map.setLight({ anchor: 'viewport', color: '#ffffff', intensity: .35, position: [1.5, 160, 50] });
      map.addSource('walking-route', { type: 'geojson', data: empty });
      map.addSource('walking-access', { type: 'geojson', data: empty });
      map.addLayer({id:'walking-route-outline',type:'line',source:'walking-route',filter:['==','$type','LineString'],layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#ffffff','line-width':10}});
      map.addLayer({id:'walking-route-line',type:'line',source:'walking-route',filter:['==','$type','LineString'],layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#238bff','line-width':6}});
      map.addLayer({id:'walking-access-line',type:'line',source:'walking-access',paint:{'line-color':'#238bff','line-width':3,'line-dasharray':[2,2]}});
      map.addLayer({id:'walking-route-ends',type:'circle',source:'walking-route',filter:['==','$type','Point'],paint:{'circle-radius':6,'circle-color':'#238bff','circle-stroke-color':'#ffffff','circle-stroke-width':3}});
      ready = true; update(); props.actions.current?.fit();latest.current.onMapReady?.(map);
    });
    let labelFrame=0;
    const priorities:Record<string,number>={medical:100,defib:95,start:85,finish:85,entrance:80,reception:78,indoorPool:73,outdoorPool:73,stage:75,information:70,camping:65,parking:65,toilets:55,water:50};
    function layoutLabels(){
      labelFrame=0;if(!ready)return;
      const zoom=map.getZoom(),bounds=map.getContainer().getBoundingClientRect();
      const occupied:{left:number;right:number;top:number;bottom:number}[]=[];
      const labels=markers.current.map(m=>m.getElement()).filter(e=>e.classList.contains('map-label'));
      labels.sort((a,b)=>Number(b.classList.contains('selected'))-Number(a.classList.contains('selected'))+((priorities[b.dataset.kind!]??30)-(priorities[a.dataset.kind!]??30))/1000);
      for(const node of labels){
        const selected=node.classList.contains('selected')||node.contains(document.activeElement),priority=priorities[node.dataset.kind!]??30;
        node.classList.toggle('map-label-compact',!selected&&zoom<(priority>=95?labelZoom.fullText.highPriority:priority>=65?labelZoom.fullText.mediumPriority:labelZoom.fullText.other));
        node.style.translate='0px 0px';
        const r=node.getBoundingClientRect();
        const onScreen=r.right>bounds.left&&r.left<bounds.right&&r.bottom>bounds.top&&r.top<bounds.bottom;
        const positions=[[0,0]];
        let placed=false;
        for(const [dx,dy] of positions){
          const box={left:r.left+dx-5,right:r.right+dx+5,top:r.top+dy-5,bottom:r.bottom+dy+5};
          const overlaps=occupied.some(b=>box.left<b.right&&box.right>b.left&&box.top<b.bottom&&box.bottom>b.top);
          
          if(selected||(onScreen&&!(zoom<labelZoom.showLowPriority&&priority<65)&&!overlaps)){
            node.style.translate=dx+'px '+dy+'px';
            node.style.setProperty('--leader-length',Math.hypot(dx,dy)+'px');
            node.style.setProperty('--leader-angle',Math.atan2(-dy,-dx)+'rad');
            node.classList.toggle('map-label-displaced',dx!==0||dy!==0);
            occupied.push(box);placed=true;break;
          }
        }
        node.style.visibility=placed?'visible':'hidden';
      }
    }
    function scheduleLabels(){if(!labelFrame)labelFrame=requestAnimationFrame(layoutLabels);}
    map.on('move',scheduleLabels);map.on('resize',scheduleLabels);
    function update() {
      const p = latest.current; if (!ready) return;
      const set = (id: string, data: GeoJSON.GeoJSON) => (map.getSource(id) as GeoJSONSource).setData(data);
      set('tracing-reference',referenceFeatures(p.project.referenceLayers));
      map.setLayoutProperty('tracing-reference-labels','visibility',p.labels?'visible':'none');
      set('walking-route', p.route ? {type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:p.route.points}},... [p.route.points[0],p.route.points.at(-1)!].map(at=>({type:'Feature' as const,properties:{},geometry:{type:'Point' as const,coordinates:at}}))]} : empty);
      set('walking-access', p.route ? {type:'FeatureCollection',features:p.route.access.map(points=>({type:'Feature',properties:{},geometry:{type:'LineString',coordinates:points}}))} : empty);
      const guidePaths=drawingGuidePaths(p.tool);
      set('bridge-connect-guides',drawingGuideData(guidePaths));
      set('ground', { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [groundRing(p.project)] } });
      decks.update(p.project,p.selected,p.mode,p.route);
      objectModels.update(p.project,p.mode);
      const boxSelected=new Set(p.boxSelectedIds??[]);set('grid', gridFeatures(p.project));const objects=objectFeatures(p.project,p.selected);for(const feature of objects.features)feature.properties!.selected=p.boxSelectionActive?boxSelected.has(String(feature.properties?.id)):String(feature.properties?.id)===p.selected;set('objects',objects);const paths=pathFeatures(p.project,p.selected),bridgeFeatures=pathFeatures({...p.project,paths:bridgePaths(p.project.bridges)},p.selected);paths.features.push(...bridgeFeatures.features);for(const feature of paths.features)feature.properties!.selected=p.boxSelectionActive?boxSelected.has(String(feature.properties?.id)):Boolean(feature.properties?.selected);set('paths',paths);set('path-outlines',pathOutlineFeatures({...paths,features:paths.features.filter(feature=>p.mode!=='3d'||!feature.properties?.elevated)}));
      const selectedSegments=new Map<string,number[]>();for(const vertex of p.pathVertices??[])selectedSegments.set(vertex.pathId,[...(selectedSegments.get(vertex.pathId)??[]),vertex.index]);
      set('path-selection',{type:'FeatureCollection',features:[...selectedSegments].flatMap(([id,indices])=>{const route=p.project.paths.find(path=>path.id===id)??bridgePaths(p.project.bridges).find(path=>path.id===id),sorted=[...new Set(indices)].sort((a,b)=>a-b);if(!route||sorted.length<2)return[];const from=sorted[0],to=sorted.at(-1)!;return [{type:'Feature' as const,properties:{id},geometry:{type:'LineString' as const,coordinates:route.points.slice(from,to+1)}}];})});
      map.setFilter('paths',p.mode==='3d'?['!=',['get','elevated'],true]:null);
      for(const [layer,type] of [['bridge-edge','bridge'],['underpass-edge','underpass']])map.setFilter(layer,p.mode==='3d'?['all',['==',['get','segmentType'],type],['!=',['get','elevated'],true]]:['==',['get','segmentType'],type]);
      for(const layer of ['walking-route-outline','walking-route-line','walking-route-ends'])map.setLayoutProperty(layer,'visibility',p.mode==='3d'&&p.route?.heights?.some(height=>height>0)?'none':'visible');
      set('areas', { type: 'FeatureCollection', features: p.project.areas.map(a => ({ type: 'Feature', properties: { id: a.id, height: a.height, selected: p.boxSelectionActive?boxSelected.has(a.id):a.id===p.selected }, geometry: { type: 'Polygon', coordinates: a.rings } })) });
      map.setPaintProperty('draft-area','fill-color',p.tool==='ground'?'#d9e3d3':isAreaKind(p.tool)?kinds[p.tool].color:'#91b886');
      set('target', { type: 'FeatureCollection', features: p.target ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: p.target } }] : [] } as FeatureCollection<Point>);
      const referenceVisible=p.reference&&!(p.ground&&p.project.layout!=='route');
      if (referenceVisible && !referenceReady) { addReferenceMap(map, 'ground'); referenceReady = true; }
      if (referenceReady) updateReferenceMap(map, referenceVisible, p.mode);
      map.setLayoutProperty('ground','visibility',p.project.layout!=='route' && p.ground && p.tool!=='ground'?'visible':'none');
      map.setLayoutProperty('ground-edge','visibility',p.project.layout!=='route' && p.boundary?'visible':'none');
      map.setLayoutProperty('grid', 'visibility', p.project.layout!=='route' && p.grid && p.tool!=='ground' ? 'visible' : 'none');
      map.setLayoutProperty('objects-flat', 'visibility', p.mode === '2d' ? 'visible' : 'none');
      map.setLayoutProperty('objects-3d', 'visibility', p.mode === '3d' ? 'visible' : 'none');
      map.setLayoutProperty('areas-3d', 'visibility', p.mode === '3d' ? 'visible' : 'none');
      const drawingGuideActive=['bridge','path','underpass'].includes(p.tool);
      map.setLayoutProperty('bridge-connect-guides','visibility',drawingGuideActive&&p.mode==='2d'?'visible':'none');renderBridgeGuideSvg();
      map.setLayoutProperty('bridge-connect-preview','visibility',drawingGuideActive&&p.mode==='2d'?'visible':'none');
      if(!drawingGuideActive){setBridgePreview(empty);if(bridgePreviewNode)bridgePreviewNode.style.display='none';bridgeHoverTarget=null;}
      map.getCanvas().style.cursor = p.tool === 'select' || p.tool === 'preview' || p.tool==='edit-ground' ? 'grab' : 'crosshair';
      if(p.tool==='path' || isBoundaryTool(p.tool) || p.tool==='extend-start' || p.tool==='extend-end')map.boxZoom.disable();else map.boxZoom.enable();
      const focusLabel = document.activeElement instanceof HTMLElement && document.activeElement.classList.contains('path-vertex') ? document.activeElement.getAttribute('aria-label') : null;
      pathDragCleanups.forEach(cleanup=>cleanup());pathDragCleanups=[];
      markers.current.forEach(m => m.remove()); markers.current = [];objectLabelMarkers=[]; midpointHandles = []; editingPaths.clear();vertexHandles=[];snapTargets=[];groundPoints=[];groundMidpoints=[];
      if (p.labels) for (const o of p.project.objects) {
        if(o.kind==='tree'||o.kind==='waterArea'||o.kind==='scenery')continue;
        const node = document.createElement('button'); node.type = 'button'; node.dataset.kind=o.kind; node.className = `map-label ${p.selected === o.id ? 'selected' : ''}${o.customModel&&p.mode==='3d'?' map-label-custom-model':''}`;
        if(o.kind==='medical'||o.kind==='defib')node.classList.add('map-label-safety',`map-label-${o.kind}`);
        node.style.setProperty('--object-color', kinds[o.kind].color);node.style.setProperty('--object-ink',objectIconInk(o.kind)); node.style.pointerEvents = p.tool === 'select'||p.tool==='preview' ? 'auto' : 'none';
        const icon = document.createElement('span');icon.className='map-label-icon';icon.append(createObjectIcon(o.kind));
        if(o.kind==='medical'&&o.hasDefib){
          const badge=document.createElement('span');badge.className='map-label-combined-aed';badge.title='Defibrillator available';badge.append(createObjectIcon('defib'));icon.append(badge);
        }
        const name = document.createElement('span'); name.className = 'map-label-name'; name.textContent = o.name;
        node.append(icon, name); node.title = `${o.name}${o.kind==='medical'&&o.hasDefib?' ? Defibrillator available':''} · ${o.width} × ${o.depth} m${p.selected === o.id ? ' · drag to move' : ''}`;
        node.setAttribute('aria-label', `${p.tool==='preview'?(p.selected===o.id?'Hide name for':'Show name for'):'Select'} ${o.name}${o.kind==='medical'&&o.hasDefib?' - Defibrillator available':''}`);
        if(p.tool==='preview')node.setAttribute('aria-pressed',String(p.selected===o.id));
        node.addEventListener('pointerdown',event=>{if(p.selected===o.id&&p.tool==='select')startObjectDrag(event,true);});
        node.addEventListener('click', e => { e.stopPropagation(); latest.current.onClick(o.position, o.id); });
        const marker = new maplibregl.Marker({ element: node, anchor: 'bottom', offset: [0, -8], draggable: p.selected === o.id && p.tool === 'select' }).setLngLat(o.position).addTo(map);
        objectLabelMarkers.push({marker,id:o.id});
        marker.on('drag', () => { const at = marker.getLngLat(); const updated = { ...latest.current.project, objects: latest.current.project.objects.map(item => item.id === o.id ? { ...item, position: [at.lng, at.lat] as Coord } : item) }; set('objects', objectFeatures(updated, o.id));objectModels.update(updated,latest.current.mode); });
        marker.on('dragend', () => { const at = marker.getLngLat(); latest.current.onMove(o.id, [at.lng, at.lat]); });
        markers.current.push(marker);
      }
      const linked=connectedPathIds(p.project,p.selected),seenVertices=new Set<string>();
      const editablePaths=[...(p.pathVertices?.length?p.project.paths:p.project.paths.filter(path=>linked.has(path.id))),...bridgePaths(p.project.bridges).filter(path=>path.id===p.selected)].sort((a,b)=>Number(b.id===p.selected)-Number(a.id===p.selected));
      for(const path of editablePaths)if(p.tool==='select'){
        editingPaths.set(path.id,path.points);
        const isBridgePoint=!(p.project.paths.some(candidate=>candidate.id===path.id));
        const bridgeHandleKeys=isBridgePoint?new Set(bridgeHandlePoints(p.project.bridges?.find(bridge=>bridge.id===path.id)?.sourcePoints??path.points).map(point=>`${point[0].toFixed(9)},${point[1].toFixed(9)}`)):null;
        const closed = JSON.stringify(path.points[0]) === JSON.stringify(path.points.at(-1));
        path.points.forEach((point, index) => {
          if(bridgeHandleKeys&&!bridgeHandleKeys.has(`${point[0].toFixed(9)},${point[1].toFixed(9)}`))return;
          const pointKey=JSON.stringify(point);
          if ((!closed || index < path.points.length - 1) && !seenVertices.has(pointKey)) {
          seenVertices.add(pointKey);
          const node = document.createElement('button'); node.type = 'button';
          // A single restriction is attached to the selected point (the segment
          // beginning there); don't color both endpoint markers for that segment.
          const notStepFreePoint=path.pointAccess?.[index]==='notStepFree';
          node.className = `path-vertex ${notStepFreePoint?'not-step-free':''} ${p.selected===path.id && p.pathVertex === index ? 'active' : ''} ${p.pathVertices?.some(selected=>selected.pathId===path.id&&selected.index===index) ? 'range-selected' : ''}`;
          node.setAttribute('aria-label',p.selected===path.id?`Path point ${index+1}`:`${path.name} point ${index+1}`);node.dataset.pathId=path.id;
          node.title = `Point ${index + 1} · drag to move, right-click to remove`;
          node.addEventListener('click', e => { e.stopPropagation(); node.focus({ preventScroll: true }); const event=e as MouseEvent;latest.current.onPathSelect(path.id,index,event.ctrlKey||event.metaKey); });
          // Marker dragging is handled through MapLibre's map-level mouse/touch
          // listeners. Disable only map panning for the gesture; stopping
          // propagation here would prevent MapLibre from moving the marker.
          let restorePan = false;
          const pauseMapPan = () => { node.classList.add('path-vertex-held'); restorePan = map.dragPan.isEnabled(); if (restorePan) map.dragPan.disable(); };
          const resumeMapPan = () => { node.classList.remove('path-vertex-held'); if (restorePan) map.dragPan.enable(); restorePan = false; };
          node.addEventListener('mousedown', pauseMapPan);
          node.addEventListener('touchstart', pauseMapPan, { passive: true });
          window.addEventListener('mouseup', resumeMapPan);
          window.addEventListener('touchend', resumeMapPan);
          window.addEventListener('touchcancel', resumeMapPan);
          pathDragCleanups.push(()=>{resumeMapPan();window.removeEventListener('mouseup',resumeMapPan);window.removeEventListener('touchend',resumeMapPan);window.removeEventListener('touchcancel',resumeMapPan);});
          node.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); latest.current.onPathRemove(path.id, index); });
          node.addEventListener('keydown', e => { if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); latest.current.onPathRemove(path.id, index); } });
          const marker = new maplibregl.Marker({ element: node, anchor: 'center', draggable: true }).setLngLat(point).addTo(map);
          let draggedTo: Coord | null = null;
          marker.on('dragstart',()=>{activeVertexDrag={id:path.id,index,at:point};const guides=drawingGuidePaths(vertexDragTool(path.id,index)).filter(candidate=>candidate.path.id!==path.id),source=map.getSource('bridge-connect-guides') as GeoJSONSource|undefined;source?.setData(drawingGuideData(guides));map.setLayoutProperty('bridge-connect-guides','visibility',latest.current.mode==='2d'?'visible':'none');map.setLayoutProperty('bridge-connect-preview','visibility',latest.current.mode==='2d'?'visible':'none');const movePreview=(event:PointerEvent|MouseEvent)=>{const bounds=map.getContainer().getBoundingClientRect();updateVertexSnapPreview({x:event.clientX-bounds.left,y:event.clientY-bounds.top},path.id);};window.addEventListener('pointermove',movePreview,true);window.addEventListener('mousemove',movePreview,true);pathDragCleanups.push(()=>{window.removeEventListener('pointermove',movePreview,true);window.removeEventListener('mousemove',movePreview,true);});renderBridgeGuideSvg();});
          marker.on('drag', () => {
            const at = marker.getLngLat(); draggedTo=[at.lng,at.lat];if(activeVertexDrag)activeVertexDrag.at=draggedTo;
            const ground=map.project(draggedTo),offset=marker.getOffset();updateVertexSnapPreview({x:ground.x+offset.x,y:ground.y+offset.y},path.id);
            const next = moveConnectedPathVertex(latest.current.project,path.id,index,draggedTo);
            decks.update(next,latest.current.selected,latest.current.mode,latest.current.route);
            const routes=[...next.paths,...bridgePaths(next.bridges)],paths=pathFeatures({...next,paths:routes},path.id);set('paths',paths);set('path-outlines',pathOutlineFeatures({...paths,features:paths.features.filter(feature=>latest.current.mode!=='3d'||!feature.properties?.elevated)}));
            editingPaths=new Map(routes.map(route=>[route.id,isBridgePoint&&route.id===path.id?path.points.map(original=>original[0]===point[0]&&original[1]===point[1]?draggedTo!:original):route.points]));
            renderBridgeGuideSvg();
          });
          marker.on('dragend', () => {
            const at=draggedTo??[marker.getLngLat().lng,marker.getLngLat().lat];draggedTo=null;activeVertexDrag=null;updateDrawingSnapHighlight(null);map.setLayoutProperty('bridge-connect-guides','visibility','none');map.setLayoutProperty('bridge-connect-preview','visibility','none');setBridgePreview({type:'FeatureCollection',features:[]});if(bridgePreviewNode)bridgePreviewNode.style.display='none';renderBridgeGuideSvg();
            const ground=map.project(at),offset=marker.getOffset(),screen={x:ground.x+offset.x,y:ground.y+offset.y},dragTool=vertexDragTool(path.id,index),candidates=drawingGuidePaths(dragTool).filter(candidate=>candidate.path.id!==path.id);
            type PathSnap={distance:number;pathId:string;segment:number;at:Coord};
            let vertexSnap:PathSnap|null=null;
            for(const guide of candidates)for(let pointIndex=0;pointIndex<guide.path.points.length;pointIndex++){
              const candidate=guide.path,point=candidate.points[pointIndex],height=candidate.heights?.[pointIndex]??0,projected=latest.current.mode==='3d'?decks.project(point,height)??map.project(point):map.project(point),distance=Math.hypot(screen.x-projected.x,screen.y-projected.y);
              if(!drawingGuidePointIndices(guide).includes(pointIndex))continue;
              if(Number.isFinite(distance)&&(!vertexSnap||distance<vertexSnap.distance))vertexSnap={distance,pathId:candidate.id,segment:guide.offset+Math.max(0,Math.min(candidate.points.length-2,pointIndex-1)),at:point};
            }
            let snap:PathSnap|null=vertexSnap&&vertexSnap.distance<=14?vertexSnap:null;
            if(!snap){const nearest=nearestDrawingLine(screen,dragTool,path.id);if(nearest&&nearest.distance<=14)snap={distance:nearest.distance,pathId:nearest.id,segment:nearest.segment,at:nearest.at};}
            const connectTo=snap&&snap.distance<=14?{pathId:snap.pathId,segment:snap.segment,at:snap.at}:undefined;
            latest.current.onPathMove(path.id,index,connectTo?.at??at,connectTo);
          });
          markers.current.push(marker);vertexHandles.push({marker,id:path.id,index});
          }
          if (!isBridgePoint && index > 0 && path.points.length < 200) {
            const before = path.points[index - 1];
            const midpoint: Coord = [(before[0] + point[0]) / 2, (before[1] + point[1]) / 2];
            const add = document.createElement('button'); add.type = 'button'; add.className = 'path-midpoint';
            add.setAttribute('aria-label', `Insert path point between ${index} and ${index + 1}`); add.title = 'Insert a point here';
            const midpointMarker = new maplibregl.Marker({ element: add, anchor: 'center' }).setLngLat(midpoint).addTo(map);
            add.addEventListener('click', e => { e.stopPropagation(); const at = midpointMarker.getLngLat(); latest.current.onPathInsert(path.id, index, [at.lng, at.lat]); });
            markers.current.push(midpointMarker); midpointHandles.push({ marker: midpointMarker,id:path.id, index });
          }
        });
        positionEnds();
        if (focusLabel) markers.current.find(m => m.getElement().getAttribute('aria-label') === focusLabel)?.getElement().focus({ preventScroll: true });
      }
      if(p.tool==='edit-ground'){
        const points=groundControlRing(p.project).slice(0,-1);groundPoints=points;const handles:{marker:maplibregl.Marker;index:number}[]=[];
        const showGround=(project:EventProject)=>{
          set('ground',{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[groundRing(project)]}});set('grid',gridFeatures(project));
          const next=groundControlRing(project);groundPoints=next.slice(0,-1);handles.forEach(({marker,index})=>marker.setLngLat(next[index]));positionEnds();
        };
        points.forEach((point,index)=>{
          const node=document.createElement('button');node.type='button';node.className=`path-vertex ground-vertex ${p.groundVertex===index?'active':''}`;node.setAttribute('aria-label',`Ground point ${index+1}`);node.title=`Boundary point ${index+1}: drag to move, right-click to remove`;
          node.addEventListener('click',e=>{e.stopPropagation();node.focus({preventScroll:true});latest.current.onGroundSelect(index);});
          node.addEventListener('contextmenu',e=>{e.preventDefault();e.stopPropagation();latest.current.onGroundRemove(index);});
          node.addEventListener('keydown',e=>{if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();e.stopPropagation();latest.current.onGroundRemove(index);}});
          const marker=new maplibregl.Marker({element:node,anchor:'center',draggable:true}).setLngLat(point).addTo(map);
          marker.on('drag',()=>{const at=marker.getLngLat();try{const site=groundFromPoints(points.map((p,i)=>i===index?[at.lng,at.lat]:p),latest.current.project.site.curves);showGround({...latest.current.project,site});}catch{/* Keep the last valid preview while dragging through an invalid shape. */}});
          marker.on('dragend',()=>{const at=marker.getLngLat();showGround(latest.current.project);latest.current.onGroundMove(index,[at.lng,at.lat]);});
          markers.current.push(marker);handles.push({marker,index});
          if(points.length<200){
            const next=points[(index+1)%points.length],at:Coord=[(point[0]+next[0])/2,(point[1]+next[1])/2];
            const add=document.createElement('button');add.type='button';add.className='path-midpoint ground-midpoint';add.setAttribute('aria-label',`Insert boundary point after ${index+1}`);add.title='Add a boundary point';
            const midpoint=new maplibregl.Marker({element:add,anchor:'center'}).setLngLat(at).addTo(map);
            add.addEventListener('click',e=>{e.stopPropagation();const at=midpoint.getLngLat();latest.current.onGroundInsert(index+1,[at.lng,at.lat]);});
            markers.current.push(midpoint);groundMidpoints.push({marker:midpoint,index});
          }
        });
        positionEnds();
        if(focusLabel)markers.current.find(m=>m.getElement().getAttribute('aria-label')===focusLabel)?.getElement().focus({preventScroll:true});
      }
      const addSnap=(at:Coord,label:string,_number:string,closeLoop=false,height=0,onSelect?:()=>void)=>{
        if(!closeLoop && snapTargets.some(t=>t.at[0]===at[0] && t.at[1]===at[1]&&Math.abs(t.height-height)<.001))return;
        const node=document.createElement('button');node.type='button';node.className='path-connect-target';node.title=label;node.setAttribute('aria-label',label);
        node.addEventListener('click',e=>{e.stopPropagation();if(onSelect)onSelect();else latest.current.onConnect(at,closeLoop,height);});
        const ground=map.project(at),raised=latest.current.mode==='3d'&&height>0?decks.project(at,height):undefined,marker=new maplibregl.Marker({element:node,anchor:'center',offset:raised?[raised.x-ground.x,raised.y-ground.y]:[0,0]}).setLngLat(at).addTo(map);
        markers.current.push(marker);
        const target={at,node,marker,closeLoop,height};if(closeLoop)snapTargets.unshift(target);else snapTargets.push(target);
      };
      if(p.tool==='path' || p.tool==='bridge' || p.tool==='underpass' || p.tool==='extend-start' || p.tool==='extend-end') {
        const bridgeIds=new Set((p.project.bridges??[]).map(bridge=>bridge.id));
        for(const route of [...p.project.paths,...bridgePaths(p.project.bridges)])route.points.forEach((at,index)=>{
          const last=route.points.length-1,closed=JSON.stringify(route.points[0])===JSON.stringify(route.points[last]);
          if(bridgeIds.has(route.id)||pathVertexKey(route,index)!=='height:0.000')return;
          if(closed && index===last)return;
          if(route.id===p.selected && ((p.tool==='extend-start' && index===0) || (p.tool==='extend-end' && index===last)))return;
          if(p.draft.length && JSON.stringify(at)===JSON.stringify(p.draft.at(-1)))return;
          const label=!closed && index===0?'start':!closed && index===last?'end':`point ${index+1}`;
          addSnap(at,`Connect to ${route.name} ${label}`,String(index+1),false,route.heights?.[index]??0);
        });
      }
      if(p.tool==='path'||p.tool==='underpass')for(const endpoint of bridgeRampEndpoints()){
        const node=document.createElement('button');node.type='button';node.className='path-connect-target';node.title='Connect to this bridge ramp or steps';node.setAttribute('aria-label','Connect to this bridge ramp or steps');
        node.addEventListener('click',event=>{event.stopPropagation();const current=latest.current;if((current.tool==='path'||current.tool==='underpass')&&current.draft.length){current.onClick(endpoint.at);return;}if(current.tool==='path'||current.tool==='underpass')current.onPathBranchAt(endpoint.id,endpoint.at,0,undefined,current.tool);});
        const marker=new maplibregl.Marker({element:node,anchor:'center'}).setLngLat(endpoint.at).addTo(map);markers.current.push(marker);
      }
      if(p.tool==='bridge')for(const bridge of p.project.bridges??[]){
        const source=bridge.sourcePoints??bridge.points,profile=bridgePaths([bridge])[0],key=(point:Coord)=>`${point[0].toFixed(9)},${point[1].toFixed(9)}`,endpoints=new Set(bridgeEndpoints(source).map(key)),junctions=new Set(bridgeJunctions(source).map(key));
        for(const at of bridgeHandlePoints(source)){
          const index=source.findIndex(point=>key(point)===key(at)),profileIndex=profile.points.findIndex(point=>key(point)===key(at)),kind=endpoints.has(key(at))?(index===0?'start':'end'):junctions.has(key(at))?'junction':'turn',height=profile.heights?.[profileIndex]??bridge.height;
          addSnap(at,`Connect to ${bridge.name} ${kind}`,String(index+1),false,height,()=>latest.current.onBridgeBranchAt(bridge.id,at));
        }
      }
      if(!['bridge','path','underpass'].includes(p.tool)){bridgePreviewMarker?.remove();bridgePreviewMarker=null;bridgePreviewNode=null;bridgeHoverTarget=null;}
      if((p.tool==='path' || isBoundaryTool(p.tool)) && p.draft.length>=3)addSnap(p.draft[0],isBoundaryTool(p.tool)?`Close ${p.tool} boundary at point 1`:'Close path at point 1','1',true);
      renderDraft();scheduleLabels();renderGpsHeading();
    }
    const updateListener = () => update(); el.current!.addEventListener('project-update', updateListener);
    map.on('move', positionEnds);
    let referencePopup:maplibregl.Popup|null=null;
    let objectDrag:{id:string;pointerId:number;start:{x:number;y:number};ground:Coord;origin:Coord;position:Coord;moved:boolean;panEnabled:boolean}|null=null;
    let objectClickBlockedUntil=0;
    const showObjectPosition=(id:string,position:Coord)=>{
      const project={...latest.current.project,objects:latest.current.project.objects.map(object=>object.id===id?{...object,position}:object)};
      (map.getSource('objects') as GeoJSONSource).setData(objectFeatures(project,id));
      objectModels.update(project,latest.current.mode);
    };
    const finishObjectDrag=(commit:boolean)=>{
      const drag=objectDrag;if(!drag)return;objectDrag=null;
      if(canvas.hasPointerCapture(drag.pointerId))canvas.releasePointerCapture(drag.pointerId);
      if(drag.panEnabled)map.dragPan.enable();
      canvas.style.cursor='grab';
      if(drag.moved){
        objectClickBlockedUntil=Date.now()+300;
        if(commit)latest.current.onMove(drag.id,drag.position);
        else if(ready&&map.getSource('objects'))showObjectPosition(drag.id,drag.origin);
      }
    };
    startObjectDrag=(event:PointerEvent,fromLabel=false)=>{
      const current=latest.current;
      if(!ready||current.tool!=='select'||event.button!==0||!event.isPrimary||objectDrag)return;
      const selected=current.project.objects.find(object=>object.id===current.selected);
      if(!selected)return;
      const bounds=canvas.getBoundingClientRect(),point={x:event.clientX-bounds.left,y:event.clientY-bounds.top};
      if(!fromLabel){const hit=objectModels.pick(point)??map.queryRenderedFeatures([point.x,point.y],{layers:['objects-flat','objects-3d','camping']})[0]?.properties?.id;if(hit!==selected.id)return;}
      event.preventDefault();event.stopPropagation();map.stop();
      const ground=map.unproject([point.x,point.y]);
      objectDrag={id:selected.id,pointerId:event.pointerId,start:point,ground:[ground.lng,ground.lat],origin:selected.position,position:selected.position,moved:false,panEnabled:map.dragPan.isEnabled()};
      map.dragPan.disable();canvas.setPointerCapture(event.pointerId);canvas.style.cursor='grabbing';
    };
    const moveObjectDrag=(event:PointerEvent)=>{
      const drag=objectDrag;if(!drag||event.pointerId!==drag.pointerId)return;
      event.preventDefault();event.stopPropagation();
      const bounds=canvas.getBoundingClientRect(),point={x:event.clientX-bounds.left,y:event.clientY-bounds.top};
      if(!drag.moved&&Math.hypot(point.x-drag.start.x,point.y-drag.start.y)<4)return;
      const ground=map.unproject([point.x,point.y]);
      drag.moved=true;drag.position=[drag.origin[0]+ground.lng-drag.ground[0],drag.origin[1]+ground.lat-drag.ground[1]];
      showObjectPosition(drag.id,drag.position);
    };
    const endObjectDrag=(event:PointerEvent)=>{if(objectDrag?.pointerId===event.pointerId)finishObjectDrag(event.type==='pointerup');};
    const cancelObjectDrag=()=>finishObjectDrag(false);
    const escapeObjectDrag=(event:KeyboardEvent)=>{if(event.key==='Escape')cancelObjectDrag();};
    canvas.addEventListener('pointerdown',startObjectDrag,{capture:true});
    window.addEventListener('pointermove',moveObjectDrag,{capture:true,passive:false});
    window.addEventListener('pointerup',endObjectDrag,true);window.addEventListener('pointercancel',endObjectDrag,true);
    window.addEventListener('blur',cancelObjectDrag);window.addEventListener('keydown',escapeObjectDrag);
    map.on('remove',()=>{
      cancelObjectDrag();canvas.removeEventListener('pointerdown',startObjectDrag,true);
      window.removeEventListener('pointermove',moveObjectDrag,true);window.removeEventListener('pointerup',endObjectDrag,true);window.removeEventListener('pointercancel',endObjectDrag,true);
      window.removeEventListener('blur',cancelObjectDrag);window.removeEventListener('keydown',escapeObjectDrag);
    });
    map.on('click', e => {
      const p = latest.current; if (!ready) return;
      if(Date.now()<objectClickBlockedUntil)return;
      if(p.tool==='measure')return;
      referencePopup?.remove();referencePopup=null;
      if(p.tool==='bridge'||p.tool==='path'||p.tool==='underpass'){
        const endpoint=nearestBridgeRampEndpoint(e.point);
        if(endpoint&&endpoint.distance<=24){if((p.tool==='path'||p.tool==='underpass')&&p.draft.length)p.onClick(endpoint.at);else if(p.tool==='bridge')p.onBridgeBranchAt(endpoint.id,endpoint.at);else p.onPathBranchAt(endpoint.id,endpoint.at,0,undefined,p.tool);return;}
      }
      const target=nearestTarget(e.point);if(target){p.onConnect(target.at,target.closeLoop,target.height);return;}
      if(p.tool==='bridge'){
        const lineTarget=nearestDrawingLine(e.point,'bridge');
        if(lineTarget&&lineTarget.distance<=14){if(lineTarget.kind==='bridge'&&lineTarget.id!==DRAFT_PATH_ID)p.onBridgeBranchAt(lineTarget.id,lineTarget.at);else p.onPathBranchAt(lineTarget.id,lineTarget.at,lineTarget.segment,lineTarget.pointIndex,'bridge');return;}
      }else if(p.tool==='path'||p.tool==='underpass'){
        const lineTarget=nearestDrawingLine(e.point,p.tool);
        if(lineTarget&&lineTarget.distance<=14){p.onPathBranchAt(lineTarget.id,lineTarget.at,lineTarget.segment,lineTarget.pointIndex,p.tool);return;}
      }
      const hits = map.queryRenderedFeatures(e.point, { layers: ['objects-flat', 'objects-3d', 'paths', 'areas-flat', 'areas-3d', 'camping'] });
      const deckHit=decks.pick(e.point),modelHit=objectModels.pick(e.point),hitId=deckHit?.id??modelHit??hits[0]?.properties?.id;
      if(p.tool==='select' && !hits.length&&!deckHit&&!modelHit){
        const reference=map.queryRenderedFeatures([[e.point.x-5,e.point.y-5],[e.point.x+5,e.point.y+5]],{layers:['tracing-reference-points','tracing-reference-lines','tracing-reference-fill','tracing-reference-labels']})[0];
        if(reference){
          const content=document.createElement('div'),name=document.createElement('strong'),details=document.createElement('div');
          name.textContent=String(reference.properties?.name||'Unnamed reference feature');
          details.textContent=`${reference.properties?.layerName||'Reference layer'} · ${reference.geometry.type} · Locked reference`;
          content.append(name,details);
          referencePopup=new maplibregl.Popup({closeButton:true,maxWidth:'280px'}).setLngLat(e.lngLat).setDOMContent(content).addTo(map);
          return;
        }
      }
      const at=resolveDrawingPoint([e.lngLat.lng,e.lngLat.lat],e.point,e.originalEvent.shiftKey);
      const clickedPath=p.project.paths.find(path=>path.id===hitId);
      let clickedSection=deckHit?.section??Number(hits[0]?.properties?.segmentStart??0);
      if(p.tool==='select'&&clickedPath&&(e.originalEvent.ctrlKey||e.originalEvent.metaKey)){
        const profile=pathProfile(clickedPath);let nearest:{distance:number;segment:number}|null=null;
        for(let sample=0;sample<profile.length-1;sample++){const a=map.project(profile[sample].position),b=map.project(profile[sample+1].position),dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy,t=length?Math.max(0,Math.min(1,((e.point.x-a.x)*dx+(e.point.y-a.y)*dy)/length)):0,distance=Math.hypot(e.point.x-(a.x+t*dx),e.point.y-(a.y+t*dy)),segment=Math.max(0,Math.min(clickedPath.points.length-2,profile[sample].segment));if(Number.isFinite(distance)&&(!nearest||distance<nearest.distance))nearest={distance,segment};}
        if(nearest)p.onPathSegmentSelect(clickedPath.id,nearest.segment,e.originalEvent.ctrlKey||e.originalEvent.metaKey);return;
      }
      if(p.tool==='select'&&clickedPath){p.onClick(at,clickedPath.id);return;}
      if(p.tool==='preview'&&clickedPath){
        const content=document.createElement('div'),name=document.createElement('strong'),details=document.createElement('div');
        name.textContent=clickedPath.name;
        details.textContent=`${pathTypes[clickedPath.segmentTypes?.[clickedSection]??'standard']} · ${pathAccess[clickedPath.segmentAccess?.[clickedSection]??'unknown']} (reported by the map owner)`;
        content.append(name,details);referencePopup=new maplibregl.Popup({closeButton:true,maxWidth:'280px'}).setLngLat(e.lngLat).setDOMContent(content).addTo(map);return;
      }
      p.onClick(at, p.tool === 'select'||p.tool==='preview' ? hitId : undefined);
    });
    let lastCursor = 0; map.on('mousemove', e => {
      if(!ready)return;
      if(objectDrag){canvas.style.cursor='grabbing';return;}
      pointer={x:e.point.x,y:e.point.y};shiftHeld=e.originalEvent.shiftKey;renderDraft();
      let bridgeEndpointHovered=false;
      if(['bridge','path','underpass'].includes(latest.current.tool)){
        const activeTool=latest.current.tool as 'bridge'|'path'|'underpass';
        const existingSnap=nearestTarget(e.point);
        const endpoint=nearestBridgeRampEndpoint(e.point);
        const lineTarget=existingSnap?undefined:nearestDrawingLine(e.point,activeTool),endpointTarget=endpoint&&endpoint.distance<=24;
        bridgeEndpointHovered=Boolean(endpointTarget||existingSnap);
        const target=endpointTarget?{...endpoint!,height:0,segment:0,kind:'bridge' as const}:existingSnap?undefined:lineTarget;
        if(target&&target.distance<=(endpointTarget?24:14)){
          setBridgePreview(empty);
          bridgeHoverTarget={id:target.id,at:target.at,height:target.height,segment:target.segment,pointIndex:'pointIndex'in target?target.pointIndex:undefined,tool:activeTool};
          if(!target.at.every(Number.isFinite)){bridgeHoverTarget=null;setBridgePreview(empty);if(bridgePreviewNode)bridgePreviewNode.style.display='none';return;}
          if(endpointTarget){if(bridgePreviewNode)bridgePreviewNode.style.display='none';canvas.style.cursor='pointer';}
          else{
          const ground=map.project(target.at),raised=latest.current.mode==='3d'?decks.project(target.at,target.height):undefined;
          if(!bridgePreviewMarker){bridgePreviewNode=document.createElement('div');bridgePreviewNode.className='path-vertex';bridgePreviewNode.setAttribute('aria-hidden','true');bridgePreviewNode.style.pointerEvents='none';bridgePreviewMarker=new maplibregl.Marker({element:bridgePreviewNode,anchor:'center'}).setLngLat(target.at).addTo(map);}
          bridgePreviewMarker.setLngLat(target.at).setOffset(latest.current.mode==='3d'&&raised?[raised.x-ground.x,raised.y-ground.y]:[0,0]);
          bridgePreviewMarker.getElement().style.zIndex='20';bridgePreviewNode!.style.display='block';
          canvas.style.cursor='pointer';
          }
        }else{bridgeHoverTarget=null;setBridgePreview(empty);if(bridgePreviewNode)bridgePreviewNode.style.display='none';}
      }else{bridgeHoverTarget=null;setBridgePreview(empty);if(bridgePreviewNode)bridgePreviewNode.style.display='none';}
      if(ready && snapTargets.length){const target=nearestTarget(e.point);snapTargets.forEach(t=>t.node.classList.toggle('snap-highlight',t===target));map.getCanvas().style.cursor=target||bridgeEndpointHovered?'pointer':'crosshair';}
      if (ready && latest.current.tool === 'select') {
        const hits = map.queryRenderedFeatures(e.point, { layers: ['objects-flat', 'objects-3d', 'paths', 'areas-flat', 'areas-3d', 'camping'] });
        map.getCanvas().style.cursor = decks.pick(e.point)||objectModels.pick(e.point)||hits.length ? 'pointer' : 'grab';
      }
      if (Date.now() - lastCursor > 100) { lastCursor = Date.now(); latest.current.onCursor([e.lngLat.lng, e.lngLat.lat]); }
    });
    map.on('mouseout',()=>{pointer=null;bridgeHoverTarget=null;(map.getSource('bridge-connect-preview') as GeoJSONSource|undefined)?.setData(empty);if(bridgePreviewNode)bridgePreviewNode.style.display='none';renderDraft();});
    map.on('move',renderDraft);window.addEventListener('keydown',shiftChange);window.addEventListener('keyup',shiftChange);
    map.on('error', e => { if (latest.current.reference) latest.current.onError(`Reference tiles could not load. Your event layout is still editable. ${e.error?.message?.slice(0, 80) ?? ''}`); });
    const resize = new ResizeObserver(() => {map.resize();renderBridgeGuideSvg();}); resize.observe(el.current!);
    return () => { pathBox?.box.remove();if(pathBox?.pan)map.dragPan.enable();if(pathBox?.boxZoom)map.boxZoom.enable();canvas.removeEventListener('pointerdown',boxDown,true);canvas.removeEventListener('pointermove',boxMove,true);canvas.removeEventListener('pointerup',boxFinish,true);canvas.removeEventListener('pointercancel',boxFinish,true);canvas.removeEventListener('click',boxClick,true);cancelAnimationFrame(labelFrame);map.off('rotate',renderGpsHeading);map.off('move',scheduleLabels);map.off('resize',scheduleLabels);canvas.removeEventListener('pointerdown', manualInteraction); canvas.removeEventListener('touchstart', manualInteraction); canvas.removeEventListener('wheel', manualInteraction); ready = false;lengthLabel.remove();bridgeGuideSvg?.remove();bridgePreviewMarker?.remove();window.removeEventListener('keydown',shiftChange);window.removeEventListener('keyup',shiftChange);map.off('move',renderDraft); resize.disconnect(); el.current?.removeEventListener('project-update', updateListener); map.off('move', positionEnds); markers.current.forEach(m => m.remove()); map.remove(); mapRef.current = null;latest.current.onMapReady?.(null); props.actions.current = null; };
  }, []);
  useEffect(() => { el.current?.dispatchEvent(new Event('project-update')); }, [props.pathType,props.draftTypes,props.route, props.project, props.selected,props.boxSelectedIds,props.boxSelectionActive, props.tool, props.reference, props.ground,props.boundary,props.groundVertex, props.grid, props.labels, props.draft, props.target, props.pathVertex,props.pathVertices]);
  useEffect(() => { const map = mapRef.current; if (!map) return; map.easeTo({ pitch: props.mode === '3d' ? 55 : 0, duration: 550 }); el.current?.dispatchEvent(new Event('project-update')); }, [props.mode]);
  return <div ref={el} className="map-canvas" aria-label="Interactive geographically aligned event map" />;
}
