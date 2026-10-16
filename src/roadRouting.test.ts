import {test} from 'node:test';
import assert from 'node:assert/strict';
import {traceRoadRoute} from './roadRouting';
import {newMapProject,newObject,offset,type Coord} from './model';
import type {Feature} from 'geojson';
const at=(x:number,y:number):Coord=>offset([0,0],x,y);
test('road test follows checkpoints in order and preserves road bends',()=>{
  const p=newMapProject('route','Road test',[0,0]);
  p.objects=[{...newObject('start',at(0,0)),name:'Start'},{...newObject('checkpoint',at(100,100)),name:'Checkpoint'},{...newObject('finish',at(200,0)),name:'Finish'}];
  const line=[at(0,0),at(100,0),at(100,100),at(200,100),at(200,0)];
  const roads:Feature[]=[{type:'Feature',properties:{class:'minor'},geometry:{type:'LineString',coordinates:line}}];
  const paths=traceRoadRoute(p,roads);
  assert.equal(paths.length,2);
  assert.deepEqual(paths[0].points,[at(0,0),at(100,0),at(100,100)]);
  assert.deepEqual(paths[0].points.at(-1),p.objects[1].position);
  assert.deepEqual(paths[1].points.at(-1),p.objects[2].position);
});
test('missing stops and disconnected roads fail without fabricating a leg',()=>{
  const p=newMapProject('route','Road test',[0,0]);
  assert.throws(()=>traceRoadRoute(p,[]),/Start/);
  p.objects=[newObject('start',at(0,0)),newObject('finish',at(200,0))];
  assert.throws(()=>traceRoadRoute(p,[]),/No road geometry/);
  const roads:Feature[]=[{type:'Feature',properties:{},geometry:{type:'MultiLineString',coordinates:[[at(0,0),at(40,0)],[at(160,0),at(200,0)]]}}];
  assert.throws(()=>traceRoadRoute(p,roads),/Could not connect/);
});
