import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newMapProject, groundFromPoints, offset } from './model';
import { allowsGpsPosition } from './siteGps';

test('site GPS respects the rotated ground and its boundary',()=>{
  const p=newMapProject('site','Site',[0,0]);p.site={width:200,depth:100,rotation:90};
  assert.equal(allowsGpsPosition(p,offset(p.center,0,80)),true);
  assert.equal(allowsGpsPosition(p,offset(p.center,80,0)),false);
  assert.equal(allowsGpsPosition(p,offset(p.center,50,0)),true);
  assert.equal(allowsGpsPosition({...p,layout:undefined},offset(p.center,500,0)),false);
});
test('site GPS uses concave ground rather than a rectangular bounding box',()=>{
  const p=newMapProject('site','Site',[0,0]);
  p.site=groundFromPoints([[0,0],[100,0],[100,40],[40,40],[40,100],[0,100]].map(([x,y])=>offset(p.center,x,y)));
  assert.equal(allowsGpsPosition(p,offset(p.center,20,80)),true);
  assert.equal(allowsGpsPosition(p,offset(p.center,80,80)),false);
});
test('route and blank maps allow GPS outside their ground',()=>{
  for(const layout of ['route','blank'] as const){const p=newMapProject(layout,'Map',[0,0]);assert.equal(allowsGpsPosition(p,[1,1]),true);}
});
