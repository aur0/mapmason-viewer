export type PhonePose = { compass: number; bearing: number; pitch: number };
const degrees = 180 / Math.PI;
const wrap = (n: number) => (n % 360 + 360) % 360;

// Same rear-camera axis, flat-phone fallback and pitch limits as ScannerView.
export function poseFromMatrix(r: number[], screenAngle = 0): PhonePose {
  const angle = screenAngle / degrees;
  const flat = wrap(Math.atan2(r[0] * Math.sin(angle) + r[1] * Math.cos(angle), r[3] * Math.sin(angle) + r[4] * Math.cos(angle)) * degrees);
  const east = -r[2], north = -r[5], up = -r[8], horizontal = Math.hypot(east, north);
  const cameraPitch = Math.max(-55, Math.min(45, Math.atan2(up, horizontal) * degrees));
  return { compass: flat, bearing: horizontal < .25 ? flat : wrap(Math.atan2(east, north) * degrees), pitch: Math.max(45, Math.min(60, 60 + cameraPitch * .25)) };
}

export function matrixFromEuler(alpha: number, beta: number, gamma: number): number[] {
  const a = alpha / degrees, b = beta / degrees, g = gamma / degrees;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cg = Math.cos(g), sg = Math.sin(g);
  return [ca*cg-sa*sb*sg, -sa*cb, ca*sg+sa*sb*cg, sa*cg+ca*sb*sg, ca*cb, sa*sg-ca*sb*cg, -cb*sg, sb, cb*cg];
}

type FusedSensor = { quaternion: number[] | null; start(): void; stop(): void; addEventListener(name: string, fn: () => void): void };
type SensorWindow = Window & { AbsoluteOrientationSensor?: new (options: { frequency: number; referenceFrame: string }) => FusedSensor };

export async function startPhoneSensors(onPose: (pose: PhonePose) => void, onError: (message: string) => void): Promise<() => void> {
  const orientation = window.DeviceOrientationEvent as typeof DeviceOrientationEvent & { requestPermission?: (absolute?: boolean) => Promise<string> };
  if (orientation?.requestPermission && await orientation.requestPermission(true) !== 'granted') throw new Error('Motion and orientation permission was denied.');
  let stopped = false, last = 0, previous: PhonePose | null = null, fused: FusedSensor | undefined, gotFused = false;
  const accept = (matrix: number[]) => {
    if (stopped) return;
    const now = performance.now(); if (last && now - last < 33) return;
    const pose = poseFromMatrix(matrix, screen.orientation?.angle ?? 0);
    const weight = previous ? 1 - Math.exp(-(now-last)/100) : 1;
    if (previous) {
      pose.bearing = wrap(previous.bearing + ((pose.bearing-previous.bearing+540)%360-180)*weight);
      pose.compass = wrap(previous.compass + ((pose.compass-previous.compass+540)%360-180)*weight);
      pose.pitch = previous.pitch + (pose.pitch-previous.pitch)*weight;
    }
    previous = pose; last = now; clearTimeout(timer); onPose(pose);
  };
  const eventReading = (event: DeviceOrientationEvent) => {
    if (gotFused) return;
    const safari = event as DeviceOrientationEvent & { webkitCompassHeading?: number };
    let alpha = event.alpha;
    if (typeof safari.webkitCompassHeading === 'number' && Number.isFinite(safari.webkitCompassHeading)) alpha = 360-safari.webkitCompassHeading;
    else if (!event.absolute) return;
    if (alpha === null || event.beta === null || event.gamma === null || ![alpha,event.beta,event.gamma].every(Number.isFinite)) return;
    accept(matrixFromEuler(alpha,event.beta,event.gamma));
  };
  const stop = () => { stopped = true; clearTimeout(timer); fused?.stop(); window.removeEventListener('deviceorientationabsolute', eventReading as EventListener); window.removeEventListener('deviceorientation', eventReading); };
  const timer = setTimeout(() => { stop(); onError('No compass readings received. Check motion/sensor permissions and try again.'); }, 8000);
  window.addEventListener('deviceorientationabsolute', eventReading as EventListener);
  window.addEventListener('deviceorientation', eventReading);
  const Sensor = (window as SensorWindow).AbsoluteOrientationSensor;
  if (Sensor) {
    try {
      fused = new Sensor({ frequency: 30, referenceFrame: 'device' });
      fused.addEventListener('reading', () => {
        const q = fused?.quaternion; if (!q || q.length !== 4 || !q.every(Number.isFinite)) return;
        const [x,y,z,w] = q; gotFused = true;
        accept([1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w),2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w),2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]);
      });
      fused.addEventListener('error', () => { gotFused = false; fused?.stop(); });
      fused.start();
    } catch { fused?.stop(); }
  }
  return stop;
}
