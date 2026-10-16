import { groundRing, type Coord, type EventProject } from './model';

export function allowsGpsPosition(project: EventProject, position: Coord): boolean {
  if ((project.layout ?? 'site') !== 'site') return true;
  const scaleX=111195*Math.cos(position[1]*Math.PI/180);
  const ring=groundRing(project).map(p=>[(p[0]-position[0])*scaleX,(p[1]-position[1])*111195] as Coord);
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[j],b=ring[i],dx=b[0]-a[0],dy=b[1]-a[1];
    const t=Math.max(0,Math.min(1,-(a[0]*dx+a[1]*dy)/(dx*dx+dy*dy||1)));
    if(Math.hypot(a[0]+t*dx,a[1]+t*dy)<.01)return true;
    if((a[1]>0)!==(b[1]>0)&&0<(b[0]-a[0])*(-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
}
