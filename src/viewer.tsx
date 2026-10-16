import { objectIconInk, objectIcons } from './objectIcons';
import ShareMap from './ShareMap';
import { visitorProject } from './routeStops';
import { createPathNetwork, shortestRoute } from './routing';
import { startPhoneSensors, type PhonePose } from './phoneSensors';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QrCode, Crosshair, ZoomIn, ZoomOut, MapPin, X } from 'lucide-react';
import MapCanvas, { type MapActions, type ViewerPosition } from './MapCanvas';
import { objectTypeLabel, kinds, parseProject, type EventProject } from './model';
import 'maplibre-gl/dist/maplibre-gl.css';
import './viewer-base.css';
import './map-labels.css';
import './viewer.css';

const noop = () => {};
function Viewer({ project, accent, logo, backgroundMap }: { project: EventProject; accent: string; logo?: string; backgroundMap: boolean }) {
  const actions = useRef<MapActions | null>(null);
  const [sharing,setSharing]=useState(false);
  const closeShare=useCallback(()=>setSharing(false),[]);
  const [mode, setMode] = useState<'2d' | '3d'>('2d');
  const [selectedPlace,setSelectedPlace]=useState<string|null>(null);
  const [places, setPlaces] = useState(false), [search, setSearch] = useState(''), [error, setError] = useState(''), [gpsError, setGpsError] = useState('');
  const [sensors, setSensors] = useState(false), [sensorError, setSensorError] = useState('');
  const stopSensors = useRef<(() => void) | null>(null), pose = useRef<PhonePose | null>(null), viewMode = useRef(mode), sensorGeneration = useRef(0);
  viewMode.current = mode;
  const [sensorPaused,setSensorPaused] = useState(false);
  const paused = useRef(false);
  const pauseLock = () => { paused.current = true; setSensorPaused(true); };
  const resumeLock = () => { paused.current = false; setSensorPaused(false); actions.current?.relock(); applyPose(); };
  const applyPose = () => { if(pose.current)actions.current?.heading(viewMode.current==='3d'?pose.current.bearing:pose.current.compass);if (!paused.current && pose.current) actions.current?.orient(viewMode.current === '3d' ? pose.current.bearing : pose.current.compass, viewMode.current === '3d' ? pose.current.pitch : 0); };
  const stop = () => { sensorGeneration.current++; stopSensors.current?.(); stopSensors.current = null; pose.current = null; actions.current?.heading(null); paused.current = false; setSensorPaused(false); setSensors(false); };
  useEffect(() => () => { sensorGeneration.current++; stopSensors.current?.(); }, []);
  useEffect(() => { if (sensors) applyPose(); }, [mode]);
  const toggleSensors = async () => {
    if (sensors) { stop(); return; }
    const generation = ++sensorGeneration.current; paused.current = false; setSensorPaused(false); setSensors(true); setSensorError('');
    try { const cleanup = await startPhoneSensors(value => { if (generation !== sensorGeneration.current) return; pose.current = value; applyPose(); }, message => { if (generation !== sensorGeneration.current) return; setSensorError(message); stop(); });
      if (generation !== sensorGeneration.current) cleanup(); else stopSensors.current = cleanup;
    } catch (error) { if (generation === sensorGeneration.current) { setSensorError(error instanceof Error ? error.message : 'Could not start phone sensors.'); stop(); } }
  };
  const [routingOpen,setRoutingOpen] = useState(false), [routingActive,setRoutingActive] = useState(false);
  useEffect(() => {
    if (!places && !routingOpen) return;
    const closePanels = () => { setPlaces(false); setRoutingOpen(false); };
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('.visitor-places, .visitor-routing, .visitor-places-button, .visitor-route-button')) return;
      closePanels();
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') closePanels(); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [places, routingOpen]);
  const [routeFrom,setRouteFrom] = useState(project.objects.find(o=>o.kind==='entrance'||o.kind==='start')?.id ?? project.objects[0]?.id ?? 'gps'), [routeTo,setRouteTo] = useState('');
  const [gpsFix,setGpsFix] = useState<ViewerPosition | null>(null);
  const [quickRouting,setQuickRouting]=useState(false);
  const selectMapPlace=(id?:string)=>{
    const destination=id?project.objects.find(o=>o.id===id):undefined;
    const next=destination&&selectedPlace!==destination.id?destination.id:null;
    setSelectedPlace(next);
    if(!next){if(quickRouting)setRoutingActive(false);setQuickRouting(false);return;}
    if(gpsFix&&Date.now()-gpsFix.timestamp<=60000){
      setRouteFrom('gps');setRouteTo(next);setRoutingActive(true);setQuickRouting(true);
    }else if(quickRouting){setRoutingActive(false);setQuickRouting(false);}
  };
  useEffect(()=>{ if(!gpsFix)return;const timer=setTimeout(()=>setGpsFix(null),Math.max(0,60000-(Date.now()-gpsFix.timestamp)));return ()=>clearTimeout(timer); },[gpsFix]);
  const network = useMemo(()=>createPathNetwork(project),[project]);
  const routeResult = useMemo(()=>{
    if(!routingActive || !routeTo)return {route:null,error:''};
    const to=project.objects.find(o=>o.id===routeTo), from=project.objects.find(o=>o.id===routeFrom);
    if(!to)return {route:null,error:'Choose a destination.'};
    if(routeFrom==='gps' && (!gpsFix || Date.now()-gpsFix.timestamp>60000))return {route:null,error:'Tap the GPS button to get your current location, then try again.'};
    try {return {route:shortestRoute(network,routeFrom==='gps'?[gpsFix!.coords.longitude,gpsFix!.coords.latitude]:from!.position,to.position),error:''};}
    catch(e){return {route:null,error:e instanceof Error?e.message:'Could not calculate route.'};}
  },[network,routeFrom,routeTo,gpsFix,routingActive,project]);
  return <div className="visitor-app" style={{ '--accent': accent } as React.CSSProperties}>
    <main className="visitor-map" aria-label={project.name}>
      <MapCanvas onManualInteraction={pauseLock} route={routeResult.route} onPosition={setGpsFix} gps onLocationError={message=>{setGpsError(message);if(message)setGpsFix(null);}} project={project} mode={mode} selected={selectedPlace} tool="preview" reference={backgroundMap} ground={project.layout !== 'route' && project.layout !== 'blank'} boundary={false} groundVertex={null} grid={false} labels={true} draft={[]} target={null} pathVertex={null} actions={actions} onGroundSelect={noop} onGroundMove={noop} onGroundInsert={noop} onGroundRemove={noop} onConnect={noop} onClick={(_at,id)=>selectMapPlace(id)} onMove={noop} onPathMove={noop} onPathInsert={noop} onPathRemove={noop} onPathBranch={noop} onPathSelect={noop} onCursor={noop} onError={() => setError('The background map could not load. Check your internet connection.')} />
    </main>
    <button className="visitor-header" aria-label="Share this map" onClick={()=>{setPlaces(false);setRoutingOpen(false);setSharing(true);}}>{logo ? <img src={logo} alt=""/> : <span className="visitor-mark"><MapPin size={23}/></span>}<div><span className="visitor-event-name">{project.name}</span></div><QrCode className="visitor-share-hint" size={18} aria-hidden="true"/></button>
    <div className="view-switch visitor-views" aria-label="Map view">{(['2d', '3d'] as const).map(value => <button key={value} aria-pressed={mode === value} className={mode === value ? 'active' : ''} onClick={() => setMode(value)}>{value.toUpperCase()}</button>)}</div>
    <div className="map-controls visitor-controls"><button aria-label="Zoom in" onClick={() => actions.current?.zoom(1)}><ZoomIn size={20}/></button><button aria-label="Zoom out" onClick={() => actions.current?.zoom(-1)}><ZoomOut size={20}/></button><button aria-label="Fit entire event" onClick={() => { pauseLock(); actions.current?.fit(); }}><Crosshair size={20}/></button></div>
    <button className="visitor-sensors primary" aria-pressed={sensors} onClick={() => void toggleSensors()}>{sensors ? (sensorPaused ? 'Sensors paused' : 'Phone sensors on') : 'Use phone sensors'}</button>
    {sensors && sensorPaused && <button className="visitor-resume-lock primary" onClick={resumeLock}>Resume sensor lock</button>}
    {sensorError && <div className="visitor-sensor-error" role="alert">{sensorError}<button aria-label="Dismiss sensor message" onClick={() => setSensorError('')}><X size={15}/></button></div>}
    <button className="visitor-places-button primary" onClick={() => { setPlaces(v => !v);setRoutingOpen(false); }} aria-expanded={places}><MapPin size={17}/>Find a place</button>
    <button className="visitor-route-button primary" aria-expanded={routingOpen} onClick={()=>{setRoutingOpen(v=>!v);setPlaces(false);}}>Directions</button>
    {routingOpen && <aside className="visitor-routing"><header><h2>Shortest route</h2><button aria-label="Close directions" onClick={()=>setRoutingOpen(false)}><X size={19}/></button></header>
      <label>From<select aria-label="Route start" value={routeFrom} onChange={e=>{setQuickRouting(false);setRouteFrom(e.target.value);}}><option value="gps">My GPS location</option>{project.objects.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
      <label>To<select aria-label="Route destination" value={routeTo} onChange={e=>{setQuickRouting(false);setRouteTo(e.target.value);}}><option value="">Choose a place</option>{project.objects.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
      <div><button className="primary" disabled={!routeTo} onClick={()=>{setQuickRouting(false);setRoutingActive(true);}}>Show route</button><button className="ghost" onClick={()=>{setQuickRouting(false);setRoutingActive(false);}}>Clear route</button></div>
      {routeResult.error && <p role="alert">{routeResult.error}</p>}
      {routeResult.route && <p role="status"><strong>{Math.round(routeResult.route.distance)} m along paths</strong>{routeResult.route.accessDistance>1 && <span> + {Math.round(routeResult.route.accessDistance)} m to/from paths</span>}</p>}
      <p>Solid blue follows connected paths. Dashed links to places are straight-line connections; check access on the ground. Crossings connect only at shared path points.</p>
    </aside>}
    {places && <aside className="visitor-places"><header><h2>Places</h2><button aria-label="Close places" onClick={() => setPlaces(false)}><X size={19}/></button></header><input aria-label="Search places" placeholder="Stage, toilets, water…" value={search} onChange={e => setSearch(e.target.value)}/><div>{project.objects.filter(o => `${o.name} ${objectTypeLabel(o)}`.toLowerCase().includes(search.toLowerCase())).map(o => {const Icon=objectIcons[o.kind];return <button key={o.id} onClick={() => { pauseLock(); actions.current?.locate(o.position,{preserveZoom:true,from:gpsFix&&Date.now()-gpsFix.timestamp<=60000?[gpsFix.coords.longitude,gpsFix.coords.latitude]:undefined,pointTowards:true}); selectMapPlace(o.id); setPlaces(false); }}><span className="visitor-place-icon" style={{ background: kinds[o.kind].color, color:objectIconInk(o.kind) }}><Icon size={18}/></span><strong>{o.name}</strong><small>{objectTypeLabel(o)}</small></button>;})}{!project.objects.some(o => `${o.name} ${objectTypeLabel(o)}`.toLowerCase().includes(search.toLowerCase())) && <p>No places found.</p>}</div></aside>}
    {quickRouting && routingActive && !routingOpen && gpsFix && routeResult.error && <div className="visitor-error" role="alert">{routeResult.error}<button aria-label="Dismiss route message" onClick={()=>{setRoutingActive(false);setQuickRouting(false);}}><X size={15}/></button></div>}
    {gpsError && <div className="visitor-gps-error" role="alert">{gpsError}<button aria-label="Dismiss GPS message" onClick={() => setGpsError('')}><X size={15}/></button></div>}
    {error && <div className="visitor-error" role="status">{error}<button aria-label="Dismiss message" onClick={() => setError('')}><X size={15}/></button></div>}
    {sharing && <ShareMap name={project.name} onClose={closeShare}/>}
    <footer className="visitor-fieldwork-brand" aria-label="Made with MapMason"><span aria-hidden="true">◆</span><span>Made with <strong>MapMason</strong></span></footer>
  </div>;
}
const root = createRoot(document.getElementById('root')!);
async function start() {
  try {
    const embedded = document.getElementById('event-map-data');
    let data;
    if (embedded) data = JSON.parse(embedded.textContent || '{}');
    else {
      const response = await fetch('./map.json');
      if (!response.ok) throw new Error('Map data is missing. Upload the complete extracted website folder.');
      data = await response.json();
    }
    const project = visitorProject(parseProject(data.project));
    const accent = /^#[a-f0-9]{6}$/i.test(data.accent) ? data.accent : '#c4ed9c';
    const logo = typeof data.logo === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(data.logo) ? data.logo : undefined;
    document.title = project.name;
    root.render(<Viewer project={project} accent={accent} logo={logo} backgroundMap={typeof data.backgroundMap === 'boolean' ? data.backgroundMap : project.layout === 'route'}/>);
  } catch (error) {
    root.render(<div className="visitor-failure"><h1>Map unavailable</h1><p>{error instanceof Error ? error.message : 'Could not open this map.'}</p><p>Serve this folder from a website host or local HTTP server.</p></div>);
  }
}
void start();
