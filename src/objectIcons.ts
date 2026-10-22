import * as ReactIcons from '@phosphor-icons/react';
import { CarFront, FerrisWheel, RotateCw, TrainFront, Waves } from 'lucide-react';
import { renderToStaticMarkup } from 'react-dom/server';
import { kinds, type Kind } from './model';
import { createElement, type ReactNode } from 'react';

export type SavedObjectIcon = { id:string; pack:string; title?:string; svg:string; author?:string; authorUrl?:string; license?:string; licenseUrl?:string };

// One icon choice per object type, shared by React controls and DOM map markers.
const definitions = {
  shaping: ReactIcons.PathIcon,
  rollerCoaster: TrainFront as unknown as ReactIcons.Icon,
  ferrisWheel: FerrisWheel as unknown as ReactIcons.Icon,
  carousel: RotateCw as unknown as ReactIcons.Icon,
  logFlume: Waves as unknown as ReactIcons.Icon,
  bumperCars: CarFront as unknown as ReactIcons.Icon,
  barrier: ReactIcons.BarricadeIcon,
  information: ReactIcons.InfoIcon,
  waste: ReactIcons.RecycleIcon,
  restricted: ReactIcons.HandPalmIcon,
  showers: ReactIcons.ShowerIcon,
  start: ReactIcons.FlagIcon,
  finish: ReactIcons.FlagIcon,
  checkpoint: ReactIcons.FlagIcon,
  stage: ReactIcons.MusicNoteIcon,
  toilets: ReactIcons.ToiletIcon,
  food: ReactIcons.ForkKnifeIcon,
  water: ReactIcons.DropIcon,
  waterArea: ReactIcons.WavesIcon,
  habitat: ReactIcons.PawPrintIcon,
  animalHouse: ReactIcons.BuildingsIcon,
  tent: ReactIcons.TentIcon,
  tree: ReactIcons.TreeEvergreenIcon,
  medical: ReactIcons.FirstAidIcon,
  defib: ReactIcons.HeartbeatIcon,
  camping: ReactIcons.TentIcon,
  parking: ReactIcons.ParkIcon,
  entrance: ReactIcons.DoorOpenIcon,
  campusBuilding: ReactIcons.BuildingOfficeIcon,
  library: ReactIcons.BookOpenIcon,
  sportsCentre: ReactIcons.BasketballIcon,
  trailhead: ReactIcons.PersonSimpleHikeIcon,
  viewpoint: ReactIcons.BinocularsIcon,
  visitorCentre: ReactIcons.BuildingsIcon,
  reception: ReactIcons.BuildingsIcon,
  indoorPool: ReactIcons.BuildingsIcon,
  outdoorPool: ReactIcons.WavesIcon,
  marker: ReactIcons.MapPinIcon,
  custom: ReactIcons.CubeIcon,
  scenery: ReactIcons.MountainsIcon,
} as const;
export const objectIcons = definitions as Record<Kind, ReactIcons.Icon>;
const lucideKinds=new Set<Kind>(['rollerCoaster','ferrisWheel','carousel','logFlume','bumperCars']);
const allowedIconTags=new Set(['svg','g','path','circle','rect','ellipse','line','polyline','polygon','defs','clipPath','mask','use']);
const allowedIconAttributes=new Set(['viewBox','fill','stroke','stroke-width','stroke-linecap','stroke-linejoin','fill-rule','clip-rule','d','cx','cy','r','rx','ry','x','y','x1','x2','y1','y2','width','height','points','transform','opacity','fill-opacity','stroke-opacity','vector-effect','href']);
function safeAttribute(name:string,value:string):boolean {
  if(!allowedIconAttributes.has(name)||/url\s*\(|javascript:|[<>]/i.test(value))return false;
  if(name==='href')return value.startsWith('#')&&/^#[A-Za-z0-9_-]{1,80}$/.test(value);
  if(['fill','stroke'].includes(name))return value==='none'||value==='currentColor'||/^#[\da-f]{3,8}$/i.test(value)||/^(rgb|rgba)\([\d.,%\s]+\)$/.test(value);
  if(name==='viewBox')return /^[\d.\-\s]+$/.test(value);
  if(name==='d'||name==='points'||name==='transform')return /^[\dA-Za-z.,()\s+\-]+$/.test(value);
  return /^[\d.\-\s%]+$/.test(value);
}
export function safeObjectIconSvg(markup:string):string|null {
  if(typeof DOMParser==='undefined'||typeof markup!=='string'||markup.length>100_000)return null;
  try {
    const parsed=new DOMParser().parseFromString(markup,'image/svg+xml'),source=parsed.documentElement;
    if(source.localName!=='svg'||parsed.querySelector('parsererror'))return null;
    const viewBox=source.getAttribute('viewBox');if(!viewBox||!safeAttribute('viewBox',viewBox))return null;
    const clean=document.createElementNS('http://www.w3.org/2000/svg','svg');clean.setAttribute('viewBox',viewBox);clean.setAttribute('aria-hidden','true');
    const copy=(sourceNode:Element,target:Element)=>{
      for(const attribute of Array.from(sourceNode.attributes))if(safeAttribute(attribute.name,attribute.value))target.setAttribute(attribute.name,attribute.value);
      for(const child of Array.from(sourceNode.children)){
        if(!allowedIconTags.has(child.localName))continue;
        const next=document.createElementNS('http://www.w3.org/2000/svg',child.localName);
        copy(child,next);target.append(next);
      }
    };
    copy(source,clean);clean.removeAttribute('width');clean.removeAttribute('height');clean.setAttribute('fill','currentColor');
    return new XMLSerializer().serializeToString(clean);
  } catch { return null; }
}
export function MapObjectIcon({kind,customIcon,size=18}:{kind:Kind;customIcon?:SavedObjectIcon;size?:number}):ReactNode {
  if(customIcon){const safe=safeObjectIconSvg(customIcon.svg);if(safe){const root=new DOMParser().parseFromString(safe,'image/svg+xml').documentElement,inner=Array.from(root.childNodes).map(node=>new XMLSerializer().serializeToString(node)).join('');return createElement('svg',{width:size,height:size,viewBox:root.getAttribute('viewBox')??'0 0 24 24',fill:'currentColor','aria-hidden':true,dangerouslySetInnerHTML:{__html:inner}});}}
  const Icon=objectIcons[kind];return createElement(Icon,lucideKinds.has(kind)?{size,strokeWidth:1.8}:{size,weight:'regular'});
}
export function createObjectIcon(kind: Kind,customIcon?:SavedObjectIcon): SVGElement {
  if(customIcon){const safe=safeObjectIconSvg(customIcon.svg);if(safe){const parsed=new DOMParser().parseFromString(safe,'image/svg+xml').documentElement as unknown as SVGElement;parsed.setAttribute('width','18');parsed.setAttribute('height','18');return parsed;}}
  const markup=renderToStaticMarkup(createElement(definitions[kind],lucideKinds.has(kind)?{size:18,strokeWidth:1.8,'aria-hidden':true}:{size:18,weight:'regular','aria-hidden':true}));
  return new DOMParser().parseFromString(markup,'image/svg+xml').documentElement as unknown as SVGElement;
}

export function objectIconInk(kind:Kind):string {
  const rgb=kinds[kind].color.slice(1).match(/../g)!.map(hex=>{const n=parseInt(hex,16)/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;});
  return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2]>.179?'#14201b':'#ffffff';
}
