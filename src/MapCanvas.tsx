import { objectIconInk, createObjectIcon } from './objectIcons';
import { allowsGpsPosition } from './siteGps';
import { traceRoadRoute } from './roadRouting';
import type { WalkingRoute } from './routing';
import { useEffect, useRef } from 'react';
import { addReferenceMap, updateReferenceMap, referenceGlyphs } from './referenceMap';
import * as maplibregl from 'maplibre-gl';
import workerSource from 'maplibre-gl/dist/maplibre-gl-worker.mjs?raw';
import type { GeoJSONSource, Map as LibreMap } from 'maplibre-gl';
import { groundControlRing,groundFromPoints,groundRing,isBoundaryTool,areaKinds,isAreaKind, connectedPathIds, pathOutlineFeatures, moveConnectedPathVertex, gridFeatures, kinds, objectFeatures, objectRing, pathFeatures, type Coord, type EventProject } from './model';
import type { FeatureCollection, Point } from 'geojson';
import { drawingPreview,segmentLengthLabel } from './drawing';

export type ViewerPosition = Pick<GeolocationPosition,'coords'|'timestamp'>;
export type MapActions = { roadRoute: () => import('./model').SitePath[]; relock: () => void; heading: (heading: number | null) => void; orient: (bearing: number, pitch: number) => void; fit: () => void; zoom: (by: number) => void; north: () => void; locate: (at: Coord, options?: { preserveZoom?: boolean; from?: Coord; pointTowards?: boolean }) => void };
type Props = { onManualInteraction?: () => void; route?: WalkingRoute | null; onPosition?: (position: ViewerPosition) => void; gps?: boolean; onLocationError?: (message: string) => void; project: EventProject; selected: string | null; tool: string; mode: '2d' | '3d'; reference: boolean; ground:boolean; boundary:boolean; groundVertex:number|null; onGroundSelect:(index:number)=>void; onGroundMove:(index:number,at:Coord)=>void; onGroundInsert:(index:number,at:Coord)=>void; onGroundRemove:(index:number)=>void; grid: boolean; labels: boolean; draft: Coord[]; target: Coord | null; pathVertex: number | null; actions: React.RefObject<MapActions | null>; onConnect: (at:Coord,closeLoop:boolean) => void; onClick: (at: Coord, id?: string) => void; onMove: (id: string, at: Coord) => void; onPathMove: (id: string, index: number, at: Coord) => void; onPathInsert: (id: string, index: number, at: Coord) => void; onPathRemove: (id: string, index: number) => void; onPathBranch: (id:string,index:number) => void; onPathSelect: (id:string,index: number) => void; onCursor: (at: Coord) => void; onError: (s: string) => void };
const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };
// Keep the renderer worker bundled, including when a single HTML export is opened offline.
// MapLibre falls back to a classic worker for file:// pages. Its bundled worker is
// self-contained; removing only the unused default export supports both worker types.
const standaloneWorker = workerSource.replace(/export\{\w+ as default\};\s*(?:\/\/# sourceMappingURL=[^\n]*)?\s*$/, '');
maplibregl.setWorkerUrl(URL.createObjectURL(new Blob([standaloneWorker], { type: 'text/javascript' })));

export default function MapCanvas(props: Props) {
  const el = useRef<HTMLDivElement>(null), mapRef = useRef<LibreMap | null>(null);
  const latest = useRef(props); latest.current = props;
  const markers = useRef<maplibregl.Marker[]>([]);
  useEffect(() => {
    let map: LibreMap; let ready = false;
    const lengthLabel=document.createElement('div');lengthLabel.className='drawing-length';lengthLabel.hidden=true;lengthLabel.title='Next segment length';
    let endpointHandles: { marker: maplibregl.Marker; id:string; index: number }[] = [];
    let midpointHandles: { marker: maplibregl.Marker; id:string; index: number }[] = [];
    let groundPoints:Coord[]=[];
    let groundMidpoints:{marker:maplibregl.Marker;index:number}[]=[];
    let editingPaths=new Map<string,Coord[]>();
    let vertexHandles:{marker:maplibregl.Marker;id:string;index:number}[]=[];
    let pointer:{x:number;y:number}|null=null,shiftHeld=false,hasDraft=false;
    let snapTargets:{at:Coord;node:HTMLButtonElement;closeLoop:boolean}[]=[];
    const nearestTarget=(point:{x:number;y:number})=>{
      let distance=14,result:typeof snapTargets[number]|undefined;
      for(const target of snapTargets){const at=map.project(target.at),d=Math.hypot(at.x-point.x,at.y-point.y);if(d<distance){distance=d;result=target;}}
      return result;
    };
    const resolveDrawingPoint=(at:Coord,point:{x:number;y:number},shift:boolean):Coord=>{
      const target=nearestTarget(point);if(target)return target.at;
      if(!shift)return at;
      const p=latest.current,path=p.project.paths.find(path=>path.id===p.selected);
      const origin=p.tool==='path'||isBoundaryTool(p.tool)?p.draft.at(-1):p.tool==='extend-start'?path?.points[0]:p.tool==='extend-end'?path?.points.at(-1):undefined;
      if(!origin)return at;
      const horizontal:Coord=[at[0],origin[1]],vertical:Coord=[origin[0],at[1]],a=map.project(horizontal),b=map.project(vertical);
      return Math.hypot(a.x-point.x,a.y-point.y)<=Math.hypot(b.x-point.x,b.y-point.y)?horizontal:vertical;
    };
    const renderDraft=()=>{
      if(!ready)return;const p=latest.current;
      const drawing=p.tool==='path'||isBoundaryTool(p.tool)||p.tool.startsWith('extend-');
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
      const data=drawingPreview(p.tool,p.draft,cursor,extension);
      (map.getSource('draft') as GeoJSONSource).setData(data.draft);(map.getSource('draft-preview') as GeoJSONSource).setData(data.preview);
    };
    const shiftChange=(event:KeyboardEvent)=>{if(event.key==='Shift'){shiftHeld=event.type==='keydown';renderDraft();}};
    const positionEnds = () => {
      groundMidpoints.forEach(({marker,index})=>{const a=map.project(groundPoints[index]),b=map.project(groundPoints[(index+1)%groundPoints.length]);marker.setLngLat(map.unproject([(a.x+b.x)/2,(a.y+b.y)/2]));});
      vertexHandles.forEach(({marker,id,index})=>marker.setLngLat(editingPaths.get(id)![index]));
      midpointHandles.forEach(({ marker, id,index }) => {
        const editingPoints=editingPaths.get(id)!;
        const a = map.project(editingPoints[index - 1]), b = map.project(editingPoints[index]);
        marker.setLngLat(map.unproject([(a.x + b.x) / 2, (a.y + b.y) / 2]));
      });
      endpointHandles.forEach(({ marker,id, index }) => {
        const editingPoints=editingPaths.get(id)!;
        const point=editingPoints[index],a=map.project(point);
        const closed=JSON.stringify(editingPoints[0])===JSON.stringify(editingPoints.at(-1));
        const previous=editingPoints[index-1] ?? (closed?editingPoints.at(-2):undefined);
        const next=editingPoints[index+1];
        let dx=0,dy=0;
        for(const neighbour of [previous,next])if(neighbour){const b=map.project(neighbour),length=Math.hypot(a.x-b.x,a.y-b.y);if(length>.1){dx+=(a.x-b.x)/length;dy+=(a.y-b.y)/length;}}
        const length=Math.hypot(dx,dy);
        marker.setLngLat(point).setOffset(length>.1?[dx/length*26,dy/length*26]:[23,-18]);
      });
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
      if (latest.current.reference) { addReferenceMap(map); referenceReady = true; updateReferenceMap(map, true, latest.current.mode); }
      for (const id of ['ground', 'grid', 'areas', 'objects', 'paths', 'path-outlines', 'draft', 'draft-preview', 'target']) map.addSource(id, { type: 'geojson', data: empty });
      map.addLayer({ id: 'ground', type: 'fill', source: 'ground', paint: { 'fill-color': '#d9e3d3', 'fill-opacity': .93 } });
      map.addLayer({ id: 'ground-edge', type: 'line', source: 'ground', paint: { 'line-color': '#6b8f76', 'line-width': 1.5, 'line-dasharray': [4, 3] } });
      map.addLayer({ id: 'grid', type: 'line', source: 'grid', paint: { 'line-color': '#6a8a74', 'line-width': .6, 'line-opacity': .2 } });
      map.addLayer({ id: 'camping', type: 'fill', source: 'objects', filter: ['in', ['get','kind'], ['literal',[...areaKinds]]], paint: { 'fill-color': ['get','color'], 'fill-opacity': ['case',['get','selected'],.55,.32] } });
      map.addLayer({ id: 'camping-edge', type: 'line', source: 'objects', filter: ['in', ['get','kind'], ['literal',[...areaKinds]]], paint: { 'line-color': ['case',['get','selected'],'#254c2e','#63865a'], 'line-width': ['case',['get','selected'],2,1.3], 'line-dasharray':[4,2] } });
      map.addLayer({ id: 'areas-flat', type: 'fill', source: 'areas', paint: { 'fill-color': ['case', ['get', 'selected'], '#c1e4ad', '#abc3ad'], 'fill-opacity': .8 } });
      map.addLayer({ id: 'areas-edge', type: 'line', source: 'areas', paint: { 'line-color': ['case', ['get', 'selected'], '#254a31', '#6c9074'], 'line-width': ['case', ['get', 'selected'], 3, 1.5] } });
      map.addLayer({ id: 'areas-3d', type: 'fill-extrusion', source: 'areas', filter: ['>', ['get', 'height'], 0], paint: { 'fill-extrusion-color': ['case', ['get', 'selected'], '#c1e4ad', '#abc3ad'], 'fill-extrusion-height': ['get', 'height'] } });
      map.addLayer({ id: 'paths', type: 'fill', source: 'paths', paint: { 'fill-color': ['case', ['get', 'selected'], '#efffe0', '#f4efde'] } });
      map.addLayer({ id: 'path-edge', type: 'line', source: 'path-outlines', paint: { 'line-color': '#9b9f84', 'line-width': .8, 'line-opacity': .5 } });
      map.addLayer({ id: 'objects-flat', type: 'fill', source: 'objects', filter:['!', ['in',['get','kind'],['literal',[...areaKinds]]]], paint: { 'fill-color': ['get', 'color'] } });
      map.addLayer({ id: 'objects-3d', type: 'fill-extrusion', source: 'objects', filter:['!', ['in',['get','kind'],['literal',[...areaKinds]]]], paint: { 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-opacity': 1, 'fill-extrusion-vertical-gradient': true } });
      map.addLayer({ id: 'object-edge', type: 'line', source: 'objects', filter:['!', ['in',['get','kind'],['literal',[...areaKinds]]]], paint: { 'line-color': ['case', ['get', 'selected'], '#173e2b', '#ffffff'], 'line-width': ['case', ['get', 'selected'], 3, 1], 'line-opacity': .8 } });
      map.addLayer({ id: 'draft', type: 'line', source: 'draft', paint: { 'line-color': '#24714b', 'line-width': 4, 'line-dasharray': [2, 1] } });
      map.addLayer({id:'draft-preview',type:'line',source:'draft-preview',paint:{'line-color':'#24714b','line-width':2,'line-opacity':.65,'line-dasharray':[3,2]}});
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
      ready = true; update(); props.actions.current?.fit();
    });
    let labelFrame=0;
    const priorities:Record<string,number>={medical:100,defib:95,start:85,finish:85,entrance:80,stage:75,information:70,camping:65,parking:65,toilets:55,water:50};
    function layoutLabels(){
      labelFrame=0;if(!ready)return;
      const zoom=map.getZoom(),bounds=map.getContainer().getBoundingClientRect();
      const occupied:{left:number;right:number;top:number;bottom:number}[]=[];
      const labels=markers.current.map(m=>m.getElement()).filter(e=>e.classList.contains('map-label'));
      labels.sort((a,b)=>Number(b.classList.contains('selected'))-Number(a.classList.contains('selected'))+((priorities[b.dataset.kind!]??30)-(priorities[a.dataset.kind!]??30))/1000);
      for(const node of labels){
        const selected=node.classList.contains('selected')||node.contains(document.activeElement),priority=priorities[node.dataset.kind!]??30;
        node.classList.toggle('map-label-compact',!selected&&zoom<(priority>=95?14.5:priority>=65?16:17));
        node.style.translate='0px 0px';
        const r=node.getBoundingClientRect();
        const onScreen=r.right>bounds.left&&r.left<bounds.right&&r.bottom>bounds.top&&r.top<bounds.bottom;
        const positions=[[0,0]];
        let placed=false;
        for(const [dx,dy] of positions){
          const box={left:r.left+dx-5,right:r.right+dx+5,top:r.top+dy-5,bottom:r.bottom+dy+5};
          const overlaps=occupied.some(b=>box.left<b.right&&box.right>b.left&&box.top<b.bottom&&box.bottom>b.top);
          
          if(selected||(onScreen&&!(zoom<14&&priority<65)&&!overlaps)){
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
      set('walking-route', p.route ? {type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:p.route.points}},... [p.route.points[0],p.route.points.at(-1)!].map(at=>({type:'Feature' as const,properties:{},geometry:{type:'Point' as const,coordinates:at}}))]} : empty);
      set('walking-access', p.route ? {type:'FeatureCollection',features:p.route.access.map(points=>({type:'Feature',properties:{},geometry:{type:'LineString',coordinates:points}}))} : empty);
      set('ground', { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [groundRing(p.project)] } });
      set('grid', gridFeatures(p.project)); set('objects', objectFeatures(p.project, p.selected)); const paths=pathFeatures(p.project,p.selected);set('paths',paths);set('path-outlines',pathOutlineFeatures(paths));
      set('areas', { type: 'FeatureCollection', features: p.project.areas.map(a => ({ type: 'Feature', properties: { id: a.id, height: a.height, selected: a.id === p.selected }, geometry: { type: 'Polygon', coordinates: a.rings } })) });
      map.setPaintProperty('draft-area','fill-color',p.tool==='ground'?'#d9e3d3':isAreaKind(p.tool)?kinds[p.tool].color:'#91b886');
      set('target', { type: 'FeatureCollection', features: p.target ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: p.target } }] : [] } as FeatureCollection<Point>);
      if (p.reference && !referenceReady) { addReferenceMap(map, 'ground'); referenceReady = true; }
      if (referenceReady) updateReferenceMap(map, p.reference, p.mode);
      map.setLayoutProperty('ground','visibility',p.project.layout!=='route' && p.ground && p.tool!=='ground'?'visible':'none');
      map.setLayoutProperty('ground-edge','visibility',p.project.layout!=='route' && p.boundary?'visible':'none');
      map.setLayoutProperty('grid', 'visibility', p.project.layout!=='route' && p.grid && p.tool!=='ground' ? 'visible' : 'none');
      map.setLayoutProperty('objects-flat', 'visibility', p.mode === '2d' ? 'visible' : 'none');
      map.setLayoutProperty('objects-3d', 'visibility', p.mode === '3d' ? 'visible' : 'none');
      map.setLayoutProperty('areas-3d', 'visibility', p.mode === '3d' ? 'visible' : 'none');
      map.getCanvas().style.cursor = p.tool === 'select' || p.tool === 'preview' || p.tool==='edit-ground' ? 'grab' : 'crosshair';
      if(p.tool==='path' || isBoundaryTool(p.tool) || p.tool==='extend-start' || p.tool==='extend-end')map.boxZoom.disable();else map.boxZoom.enable();
      const focusLabel = document.activeElement instanceof HTMLElement && document.activeElement.classList.contains('path-vertex') ? document.activeElement.getAttribute('aria-label') : null;
      markers.current.forEach(m => m.remove()); markers.current = []; endpointHandles = []; midpointHandles = []; editingPaths.clear();vertexHandles=[];snapTargets=[];groundPoints=[];groundMidpoints=[];
      if (p.labels) for (const o of p.project.objects) {
        const node = document.createElement('button'); node.type = 'button'; node.dataset.kind=o.kind; node.className = `map-label ${p.selected === o.id ? 'selected' : ''}`;
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
        node.addEventListener('click', e => { e.stopPropagation(); latest.current.onClick(o.position, o.id); });
        const marker = new maplibregl.Marker({ element: node, anchor: 'bottom', offset: [0, -8], draggable: p.selected === o.id && p.tool === 'select' }).setLngLat(o.position).addTo(map);
        marker.on('drag', () => { const at = marker.getLngLat(); const updated = { ...latest.current.project, objects: latest.current.project.objects.map(item => item.id === o.id ? { ...item, position: [at.lng, at.lat] as Coord } : item) }; set('objects', objectFeatures(updated, o.id)); });
        marker.on('dragend', () => { const at = marker.getLngLat(); latest.current.onMove(o.id, [at.lng, at.lat]); });
        markers.current.push(marker);
      }
      const linked=connectedPathIds(p.project,p.selected),seenVertices=new Set<string>();
      const editablePaths=p.project.paths.filter(path=>linked.has(path.id)).sort((a,b)=>Number(b.id===p.selected)-Number(a.id===p.selected));
      for(const path of editablePaths)if(p.tool==='select'){
        editingPaths.set(path.id,path.points);
        const closed = JSON.stringify(path.points[0]) === JSON.stringify(path.points.at(-1));
        path.points.forEach((point, index) => {
          const pointKey=JSON.stringify(point);
          if ((!closed || index < path.points.length - 1) && !seenVertices.has(pointKey)) {
          seenVertices.add(pointKey);
          const node = document.createElement('button'); node.type = 'button';
          node.className = `path-vertex ${p.selected===path.id && p.pathVertex === index ? 'active' : ''}`;
          node.setAttribute('aria-label',p.selected===path.id?`Path point ${index+1}`:`${path.name} point ${index+1}`);node.dataset.pathId=path.id;
          node.title = `Point ${index + 1} · drag to move, right-click to remove`;
          node.addEventListener('click', e => { e.stopPropagation(); node.focus({ preventScroll: true }); latest.current.onPathSelect(path.id,index); });
          node.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); latest.current.onPathRemove(path.id, index); });
          node.addEventListener('keydown', e => { if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); latest.current.onPathRemove(path.id, index); } });
          const marker = new maplibregl.Marker({ element: node, anchor: 'center', draggable: true }).setLngLat(point).addTo(map);
          marker.on('drag', () => {
            const at = marker.getLngLat(); const next = moveConnectedPathVertex(latest.current.project,path.id,index,[at.lng,at.lat]);
            const paths=pathFeatures(next,path.id);set('paths',paths);set('path-outlines',pathOutlineFeatures(paths));
            editingPaths=new Map(next.paths.map(path=>[path.id,path.points]));positionEnds();
          });
          marker.on('dragend', () => { const at = marker.getLngLat(); latest.current.onPathMove(path.id, index, [at.lng, at.lat]); });
          markers.current.push(marker);vertexHandles.push({marker,id:path.id,index});
          }
          if (index > 0 && path.points.length < 200) {
            const before = path.points[index - 1];
            const midpoint: Coord = [(before[0] + point[0]) / 2, (before[1] + point[1]) / 2];
            const add = document.createElement('button'); add.type = 'button'; add.className = 'path-midpoint';
            add.setAttribute('aria-label', `Insert path point between ${index} and ${index + 1}`); add.title = 'Insert a point here';
            const midpointMarker = new maplibregl.Marker({ element: add, anchor: 'center' }).setLngLat(midpoint).addTo(map);
            add.addEventListener('click', e => { e.stopPropagation(); const at = midpointMarker.getLngLat(); latest.current.onPathInsert(path.id, index, [at.lng, at.lat]); });
            markers.current.push(midpointMarker); midpointHandles.push({ marker: midpointMarker,id:path.id, index });
          }
        });
        path.points.forEach((point,index)=>{
          if(closed && index===path.points.length-1)return;
          if(p.selected!==path.id || p.pathVertex!==index)return;
          const add=document.createElement('button');add.type='button';add.className='path-midpoint path-branch';
          add.setAttribute('aria-label',`Branch from path point ${index+1}`);add.title=`Start a new path from point ${index+1}`;
          add.addEventListener('click',e=>{e.stopPropagation();latest.current.onPathBranch(path.id,index);});
          const marker=new maplibregl.Marker({element:add,anchor:'center'}).setLngLat(point).addTo(map);
          markers.current.push(marker);endpointHandles.push({marker,id:path.id,index});
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
      const addSnap=(at:Coord,label:string,_number:string,closeLoop=false)=>{
        if(!closeLoop && snapTargets.some(t=>t.at[0]===at[0] && t.at[1]===at[1]))return;
        const node=document.createElement('button');node.type='button';node.className='path-connect-target';node.title=label;node.setAttribute('aria-label',label);
        node.addEventListener('click',e=>{e.stopPropagation();latest.current.onConnect(at,closeLoop);});
        markers.current.push(new maplibregl.Marker({element:node,anchor:'center'}).setLngLat(at).addTo(map));
        const target={at,node,closeLoop};if(closeLoop)snapTargets.unshift(target);else snapTargets.push(target);
      };
      if(p.tool==='path' || p.tool==='extend-start' || p.tool==='extend-end') {
        for(const route of p.project.paths)route.points.forEach((at,index)=>{
          const last=route.points.length-1,closed=JSON.stringify(route.points[0])===JSON.stringify(route.points[last]);
          if(closed && index===last)return;
          if(route.id===p.selected && ((p.tool==='extend-start' && index===0) || (p.tool==='extend-end' && index===last)))return;
          if(p.draft.length && JSON.stringify(at)===JSON.stringify(p.draft.at(-1)))return;
          const label=!closed && index===0?'start':!closed && index===last?'end':`point ${index+1}`;
          addSnap(at,`Connect to ${route.name} ${label}`,String(index+1));
        });
      }
      if((p.tool==='path' || isBoundaryTool(p.tool)) && p.draft.length>=3)addSnap(p.draft[0],isBoundaryTool(p.tool)?`Close ${p.tool} boundary at point 1`:'Close path at point 1','1',true);
      renderDraft();scheduleLabels();renderGpsHeading();
    }
    const updateListener = () => update(); el.current!.addEventListener('project-update', updateListener);
    map.on('move', positionEnds);
    map.on('click', e => {
      const p = latest.current; if (!ready) return;
      const target=nearestTarget(e.point);if(target){p.onConnect(target.at,target.closeLoop);return;}
      const hits = map.queryRenderedFeatures(e.point, { layers: ['objects-flat', 'objects-3d', 'paths', 'areas-flat', 'areas-3d', 'camping'] });
      const at=resolveDrawingPoint([e.lngLat.lng,e.lngLat.lat],e.point,e.originalEvent.shiftKey);
      p.onClick(at, p.tool === 'select'||p.tool==='preview' ? hits[0]?.properties?.id : undefined);
    });
    let lastCursor = 0; map.on('mousemove', e => {
      pointer={x:e.point.x,y:e.point.y};shiftHeld=e.originalEvent.shiftKey;renderDraft();
      if(ready && snapTargets.length){const target=nearestTarget(e.point);snapTargets.forEach(t=>t.node.classList.toggle('snap-highlight',t===target));map.getCanvas().style.cursor=target?'pointer':'crosshair';}
      if (ready && latest.current.tool === 'select') {
        const hits = map.queryRenderedFeatures(e.point, { layers: ['objects-flat', 'objects-3d', 'paths', 'areas-flat', 'areas-3d', 'camping'] });
        map.getCanvas().style.cursor = hits.length ? 'pointer' : 'grab';
      }
      if (Date.now() - lastCursor > 100) { lastCursor = Date.now(); latest.current.onCursor([e.lngLat.lng, e.lngLat.lat]); }
    });
    map.on('mouseout',()=>{pointer=null;renderDraft();});
    map.on('move',renderDraft);window.addEventListener('keydown',shiftChange);window.addEventListener('keyup',shiftChange);
    map.on('error', e => { if (latest.current.reference) latest.current.onError(`Reference tiles could not load. Your event layout is still editable. ${e.error?.message?.slice(0, 80) ?? ''}`); });
    const resize = new ResizeObserver(() => map.resize()); resize.observe(el.current!);
    return () => { cancelAnimationFrame(labelFrame);map.off('rotate',renderGpsHeading);map.off('move',scheduleLabels);map.off('resize',scheduleLabels);canvas.removeEventListener('pointerdown', manualInteraction); canvas.removeEventListener('touchstart', manualInteraction); canvas.removeEventListener('wheel', manualInteraction); ready = false;lengthLabel.remove();window.removeEventListener('keydown',shiftChange);window.removeEventListener('keyup',shiftChange);map.off('move',renderDraft); resize.disconnect(); el.current?.removeEventListener('project-update', updateListener); map.off('move', positionEnds); endpointHandles = []; markers.current.forEach(m => m.remove()); map.remove(); mapRef.current = null; props.actions.current = null; };
  }, []);
  useEffect(() => { el.current?.dispatchEvent(new Event('project-update')); }, [props.route, props.project, props.selected, props.tool, props.reference, props.ground,props.boundary,props.groundVertex, props.grid, props.labels, props.draft, props.target, props.pathVertex]);
  useEffect(() => { const map = mapRef.current; if (!map) return; map.easeTo({ pitch: props.mode === '3d' ? 55 : 0, duration: 550 }); el.current?.dispatchEvent(new Event('project-update')); }, [props.mode]);
  return <div ref={el} className="map-canvas" aria-label="Interactive geographically aligned event map" />;
}
