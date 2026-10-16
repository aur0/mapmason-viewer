import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newMapProject,newObject,offset,parseProject,type Coord} from './model';
import {visitorProject} from './routeStops';
import {traceRoadRoute} from './roadRouting';
import type {Feature} from 'geojson';
const at=(x:number,y:number):Coord=>offset([0,0],x,y);
const roads:Feature[]=[{type:'Feature',properties:{class:'minor'},geometry:{type:'MultiLineString',coordinates:[[at(0,0),at(100,0),at(200,0)],[at(100,0),at(100,100),at(200,100),at(200,0)]]}}];
test('unordered shaping point steers through another road instead of reversing on arrival',()=>{
 const p=newMapProject('route','Shaping test',[0,0]);p.objects=[{...newObject('start',at(0,0)),id:'s'},{...newObject('shaping',at(100,100)),id:'via'},{...newObject('finish',at(200,0)),id:'f'}];
 p.paths=traceRoadRoute(p,roads);assert.equal(p.paths.length,2);assert.deepEqual(p.paths[0].points.at(-1),at(100,100));assert.ok(p.paths[1].points.some(p=>p[0]===at(200,100)[0]&&p[1]===at(200,100)[1]));
 const saved=parseProject(JSON.parse(JSON.stringify(p)));assert.equal(saved.objects[1].kind,'shaping');assert.equal(saved.paths[0].generatedBy,'road-trace');const exported=visitorProject(saved);assert.deepEqual(exported.objects.map(o=>o.id),['s','f']);assert.deepEqual(exported.paths,saved.paths);
});
test('checkpoint and shaping placement order does not affect the traced result',()=>{
 const p=newMapProject('route','Order',[0,0]);p.objects=[{...newObject('start',at(0,0)),id:'s'},{...newObject('checkpoint',at(200,100)),id:'cp'},{...newObject('shaping',at(100,100)),id:'via'},{...newObject('finish',at(200,0)),id:'f'}];
 const a=traceRoadRoute(p,roads),b=traceRoadRoute({...p,objects:[...p.objects].reverse()},roads);assert.deepEqual(a.map(p=>p.points),b.map(p=>p.points));
});
test('an intentional out-and-back remains allowed when no through-road is available',()=>{
 const p=newMapProject('route','Dead end',[0,0]);p.objects=[newObject('start',at(0,0)),newObject('shaping',at(100,100)),newObject('finish',at(200,0))];
 const dead:Feature[]=[{type:'Feature',properties:{},geometry:{type:'MultiLineString',coordinates:[[at(0,0),at(100,0),at(200,0)],[at(100,0),at(100,100)]]}}];const paths=traceRoadRoute(p,dead);assert.equal(paths.length,2);assert.deepEqual(paths[1].points[0],at(100,100));assert.ok(paths[1].points.some(p=>p[0]===at(100,0)[0]&&p[1]===at(100,0)[1]));
});
