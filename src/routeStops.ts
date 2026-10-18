import type { EventProject, SiteObject } from './model';
export function isRouteVia(kind:string) { return kind==='checkpoint'; }
export function orderedRouteStops(project:EventProject) {
  return [...project.objects.filter(o=>o.kind==='start'),...project.objects.filter(o=>isRouteVia(o.kind)),...project.objects.filter(o=>o.kind==='finish')];
}
export function moveRouteVia(project:EventProject,id:string,direction:-1|1):EventProject {
  const indices=project.objects.flatMap((o,i)=>isRouteVia(o.kind)?[i]:[]),at=indices.findIndex(i=>project.objects[i].id===id),other=at+direction;
  if(at<0||other<0||other>=indices.length)return project;
  const objects=[...project.objects];[objects[indices[at]],objects[indices[other]]]=[objects[indices[other]],objects[indices[at]]];
  return {...project,objects};
}
export function visitorProject(project:EventProject):EventProject { const {referenceLayers:_references,...visitor}=project;return {...visitor,objects:project.objects.filter(o=>o.kind!=='shaping')}; }

export function insertShapingPoint(project:EventProject,point:SiteObject):EventProject { return {...project,objects:[...project.objects,point]}; }
