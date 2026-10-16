import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matrixFromEuler, poseFromMatrix } from './phoneSensors';

test('camera direction and tilt match Night Scanner conventions', () => {
  const north = poseFromMatrix(matrixFromEuler(0, 90, 0));
  assert.ok(Math.abs(north.bearing) < 1e-8);
  assert.equal(north.pitch, 60);
  const east = poseFromMatrix(matrixFromEuler(270, 90, 0));
  assert.ok(Math.abs(east.bearing - 90) < 1e-8);
  const flat = poseFromMatrix(matrixFromEuler(0, 0, 0));
  assert.equal(flat.bearing, flat.compass);
  assert.equal(flat.pitch, 46.25);
});

test('screen rotation affects flat compass while camera axis stays fixed', () => {
  const matrix = matrixFromEuler(0, 90, 0);
  const portrait = poseFromMatrix(matrix), landscape = poseFromMatrix(matrix, 90);
  assert.equal(landscape.bearing, portrait.bearing);
  const flat = matrixFromEuler(0, 0, 0);
  assert.equal(poseFromMatrix(flat, 90).compass, 90);
});
