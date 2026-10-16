import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPathNetwork, shortestRoute } from './routing';
import { newMapProject, offset, pathCenterline, type Coord, type SitePath } from './model';
const at = (x:number,y:number):Coord => offset([0,0],x,y);
const path = (id:string,points:Coord[],curves?:number[]):SitePath => ({id,name:id,width:3,points,curves});
const network = (paths:SitePath[]) => createPathNetwork({...newMapProject('route','Test',[0,0]),paths});

test('chooses the shorter of alternative connected paths',()=>{
  const n=network([path('long',[at(0,0),at(0,100),at(100,0)]),path('short',[at(0,0),at(100,0)])]);
  assert.ok(Math.abs(shortestRoute(n,at(0,0),at(100,0)).distance-100)<.01);
});
test('snaps partway along one edge without detouring via its ends',()=>{
  const result=shortestRoute(network([path('a',[at(0,0),at(100,0)])]),at(20,5),at(80,8));
  assert.ok(Math.abs(result.distance-60)<.01);
  assert.ok(Math.abs(result.accessDistance-13)<.01);
});
test('shared interior vertices are junctions, geometric crossings alone are not',()=>{
  const a=path('a',[at(-100,0),at(0,0),at(100,0)]),b=path('b',[at(0,0),at(0,100)]);
  assert.ok(Math.abs(shortestRoute(network([a,b]),at(-100,0),at(0,100)).distance-200)<.01);
  assert.throws(()=>shortestRoute(network([path('a',[at(-100,0),at(100,0)]),path('b',[at(0,-100),at(0,100)])]),at(-100,0),at(0,100)),/not connected/);
});
test('curved paths use the rendered centreline length',()=>{
  const p=path('curve',[at(0,0),at(100,0),at(100,100)],[0,1,0]);
  const result=shortestRoute(network([p]),at(0,0),at(100,100));
  const sampled=pathCenterline(p);let expected=0;
  for(let i=1;i<sampled.length;i++)expected+=Math.hypot((sampled[i][0]-sampled[i-1][0])*111195,(sampled[i][1]-sampled[i-1][1])*111195);
  assert.ok(Math.abs(result.distance-expected)<.01);
  assert.ok(result.distance<200 && result.distance>Math.sqrt(20000));
});
test('rejects missing paths and handles a closed loop',()=>{
  assert.throws(()=>shortestRoute(network([]),at(0,0),at(10,0)),/no paths/);

  const loop=network([path('loop',[at(0,0),at(100,0),at(100,100),at(0,100),at(0,0)])]);
  assert.ok(Math.abs(shortestRoute(loop,at(0,0),at(0,100)).distance-100)<.01);
});

test('distant endpoints join the nearest path with separate straight access lines',()=>{
  const from=at(20,300),to=at(80,-400);
  const route=shortestRoute(network([path('walk',[at(0,0),at(100,0)])]),from,to);
  assert.ok(Math.abs(route.distance-60)<.01);
  assert.ok(Math.abs(route.accessDistance-700)<.01);
  assert.deepEqual(route.access[0][0],from);
  assert.deepEqual(route.access[1][1],to);
  assert.ok(Math.abs(route.access[0][1][1])<1e-9);
  assert.ok(Math.abs(route.access[1][0][1])<1e-9);
});

test('equal-length alternatives prefer wider paths regardless of insertion order',()=>{
  const narrow={...path('narrow',[at(0,0),at(50,-40),at(100,0)]),width:2};
  const wide={...path('wide',[at(0,0),at(50,40),at(100,0)]),width:8};
  for(const routes of [[narrow,wide],[wide,narrow]]){
    const route=shortestRoute(network(routes),at(0,0),at(100,0));
    assert.ok(route.points.some(p=>p[1]>0));assert.ok(!route.points.some(p=>p[1]<0));
    assert.ok(Math.abs(route.distance-2*Math.hypot(50,40))<.01);
  }
});
test('width preference does not override a genuinely shorter path',()=>{
  const narrow={...path('short',[at(0,0),at(100,0)]),width:1};
  const wide={...path('detour',[at(0,0),at(50,1),at(100,0)]),width:20};
  const route=shortestRoute(network([wide,narrow]),at(0,0),at(100,0));
  assert.ok(Math.abs(route.distance-100)<.01);assert.ok(route.points.every(p=>Math.abs(p[1])<1e-9));
});
