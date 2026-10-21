import * as ReactIcons from 'lucide-react';
import * as SvgIcons from 'lucide';
import { kinds, type Kind } from './model';

// One icon choice per object type, shared by React controls and DOM map markers.
const definitions = {
  shaping: [ReactIcons.Route, SvgIcons.Route],
  barrier: [ReactIcons.Fence, SvgIcons.Fence],
  information: [ReactIcons.Info, SvgIcons.Info],
  waste: [ReactIcons.Recycle, SvgIcons.Recycle],
  restricted: [ReactIcons.ShieldAlert, SvgIcons.ShieldAlert],
  showers: [ReactIcons.ShowerHead, SvgIcons.ShowerHead],
  start: [ReactIcons.Flag, SvgIcons.Flag],
  finish: [ReactIcons.Flag, SvgIcons.Flag],
  checkpoint: [ReactIcons.Flag, SvgIcons.Flag],
  stage: [ReactIcons.Music2, SvgIcons.Music2],
  toilets: [ReactIcons.Toilet, SvgIcons.Toilet],
  food: [ReactIcons.Utensils, SvgIcons.Utensils],
  water: [ReactIcons.Droplets, SvgIcons.Droplets],
  waterArea: [ReactIcons.Waves, SvgIcons.Waves],
  tent: [ReactIcons.Tent, SvgIcons.Tent],
  tree: [ReactIcons.TreePine, SvgIcons.TreePine],
  medical: [ReactIcons.Cross, SvgIcons.Cross],
  defib: [ReactIcons.HeartPulse, SvgIcons.HeartPulse],
  camping: [ReactIcons.Tent, SvgIcons.Tent],
  parking: [ReactIcons.SquareParking, SvgIcons.SquareParking],
  entrance: [ReactIcons.DoorOpen, SvgIcons.DoorOpen],
  reception: [ReactIcons.Building2, SvgIcons.Building2],
  indoorPool: [ReactIcons.Building2, SvgIcons.Building2],
  outdoorPool: [ReactIcons.Waves, SvgIcons.Waves],
  marker: [ReactIcons.MapPin, SvgIcons.MapPin],
  custom: [ReactIcons.Box, SvgIcons.Box],
  scenery: [ReactIcons.Trees, SvgIcons.Trees],
} as const;
export const objectIcons = Object.fromEntries(Object.entries(definitions).map(([kind,icons])=>[kind,icons[0]])) as Record<Kind, ReactIcons.LucideIcon>;
export function createObjectIcon(kind: Kind): SVGElement {
  const svg = SvgIcons.createElement(definitions[kind][1]);
  svg.setAttribute('width','18');svg.setAttribute('height','18');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','2');svg.setAttribute('aria-hidden','true');
  return svg;
}

export function objectIconInk(kind:Kind):string {
  const rgb=kinds[kind].color.slice(1).match(/../g)!.map(hex=>{const n=parseInt(hex,16)/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;});
  return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2]>.179?'#14201b':'#ffffff';
}
