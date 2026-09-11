/**
 * Трёхмерная модель группировки.
 *
 * Единица длины сцены — радиус Земли, поэтому координаты из расчётного ядра
 * попадают сюда делением на R. Ось Z — полярная, как в расчётной модели, поэтому
 * камера поднята по Z, а не по Y (умолчание three.js).
 *
 * Отрисовка — только представление расчёта: никаких собственных формул,
 * положения и связи берутся из core/geometry и core/routing.
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { feature } from 'topojson-client';
import type { GeometryObject, Topology } from 'topojson-specification';
import type { Feature, FeatureCollection, Position } from 'geojson';
import landTopo from 'world-atlas/land-110m.json';
import { R_EARTH_KM, activeMask, groundPosition, positions } from '../core/geometry';
import { buildNetwork } from '../core/routing';
import type { Scenario } from '../core/types';

/** Плоскости различаются нейтралями палитры; оранжевый зарезервирован за маршрутом. */
export const PLANE_COLORS = ['#eeeeee', '#a0ca92', '#b8b3b0', '#8a8380', '#d8d2cc'];

interface Props {
  scenario: Scenario;
  t_s: number;
  routePath?: string[];
  /** Медленное вращение — для витринных экранов. */
  autoRotate?: boolean;
  /** Вращение мышью и колесо. */
  interactive?: boolean;
  showLinks?: boolean;
  showLabels?: boolean;
  className?: string;
  selectedSatellite?: string | null;
  onSelectSatellite?: (id: string) => void;
  onSelectSite?: (id: string) => void;
}

const DEG = Math.PI / 180;

function lonLatToVec(lon: number, lat: number, r: number): THREE.Vector3 {
  const la = lat * DEG;
  const lo = lon * DEG;
  return new THREE.Vector3(
    r * Math.cos(la) * Math.cos(lo),
    r * Math.cos(la) * Math.sin(lo),
    r * Math.sin(la),
  );
}

/**
 * Отрезки контуров суши: [x1,y1,z1, x2,y2,z2, ...] на сфере радиуса r.
 *
 * В world-atlas объект land — GeometryCollection, и topojson.feature() для него
 * возвращает FeatureCollection, а не одиночный Feature. Разбираем оба случая и
 * оба типа полигонов, чтобы замена набора данных не роняла сцену.
 */
export function buildLandSegments(r = 1.002): number[] {
  const topo = landTopo as Topology;
  const result = feature(topo, topo.objects.land as GeometryObject) as FeatureCollection | Feature;
  const features = result.type === 'FeatureCollection' ? result.features : [result];

  const rings: Position[][] = [];
  for (const f of features) {
    const geom = f.geometry;
    if (!geom) continue;
    if (geom.type === 'Polygon') rings.push(...geom.coordinates);
    else if (geom.type === 'MultiPolygon') for (const poly of geom.coordinates) rings.push(...poly);
  }

  const points: number[] = [];
  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i++) {
      const a = lonLatToVec(ring[i][0], ring[i][1], r);
      const b = lonLatToVec(ring[i + 1][0], ring[i + 1][1], r);
      points.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }
  return points;
}

/** Контуры суши строятся один раз на модуль: геометрия не зависит от сценария. */
let landGeometry: THREE.BufferGeometry | null = null;
function getLandGeometry(): THREE.BufferGeometry {
  if (landGeometry) return landGeometry;
  landGeometry = new THREE.BufferGeometry();
  landGeometry.setAttribute('position', new THREE.Float32BufferAttribute(buildLandSegments(), 3));
  return landGeometry;
}

/** Круглый спрайт для точек-аппаратов: мягкий край без внешних файлов. */
function makeDotTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.85)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function graticule(): THREE.BufferGeometry {
  const pts: number[] = [];
  const push = (a: THREE.Vector3, b: THREE.Vector3) => pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
  for (let lat = -60; lat <= 60; lat += 30) {
    for (let lon = -180; lon < 180; lon += 5) {
      push(lonLatToVec(lon, lat, 1.001), lonLatToVec(lon + 5, lat, 1.001));
    }
  }
  for (let lon = -180; lon < 180; lon += 30) {
    for (let lat = -90; lat < 90; lat += 5) {
      push(lonLatToVec(lon, lat, 1.001), lonLatToVec(lon, lat + 5, 1.001));
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return geo;
}

/** Общая граница для динамических объектов: всё в сцене лежит внутри неё. */
const SCENE_BOUNDS = new THREE.Sphere(new THREE.Vector3(), 3);

function dynamicGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.boundingSphere = SCENE_BOUNDS.clone();
  return g;
}

/**
 * Записывает данные в динамический буфер. Буфер переиспользуется между кадрами
 * и растёт только при смене сценария. Раньше на каждом кадре создавался новый
 * буфер, а старый оставался на видеокарте — за время показа их копились тысячи.
 */
function writeAttribute(geometry: THREE.BufferGeometry, name: string, data: ArrayLike<number>): void {
  let attr = geometry.getAttribute(name) as THREE.BufferAttribute | undefined;
  if (!attr || attr.array.length < data.length) {
    geometry.dispose();
    const capacity = Math.max(Math.ceil(data.length / 3) * 2, 8) * 3;
    attr = new THREE.BufferAttribute(new Float32Array(capacity), 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute(name, attr);
  }
  (attr.array as Float32Array).set(data);
  attr.needsUpdate = true;
}

interface SceneApi {
  update(
    scenario: Scenario,
    t_s: number,
    routePath: string[],
    showLinks: boolean,
    selected: string | null,
  ): void;
  setAutoRotate(on: boolean): void;
}

export default function Globe({
  scenario,
  t_s,
  routePath = [],
  autoRotate = false,
  interactive = true,
  showLinks = true,
  showLabels = false,
  className,
  selectedSatellite = null,
  onSelectSatellite,
  onSelectSite,
}: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<SceneApi | null>(null);
  // Сцена создаётся один раз, поэтому обработчики берутся из ссылки, а не из замыкания.
  const callbacks = useRef({ onSelectSatellite, onSelectSite });
  callbacks.current = { onSelectSatellite, onSelectSite };

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const disposables: Array<{ dispose(): void }> = [];
    const own = <T extends { dispose(): void }>(x: T): T => {
      disposables.push(x);
      return x;
    };

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.up.set(0, 0, 1);
    camera.position.set(2.6, -1.9, 1.7);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.enablePan = false;
    controls.minDistance = 1.6;
    controls.maxDistance = 7;
    controls.enabled = interactive;
    controls.autoRotateSpeed = 0.45;

    // Земля: тёмная сфера, контуры суши и координатная сетка. Без свечений — глубину даёт контраст.
    const earth = new THREE.Mesh(
      own(new THREE.SphereGeometry(1, 64, 48)),
      own(new THREE.MeshBasicMaterial({ color: 0x131110 })),
    );
    scene.add(earth);
    scene.add(
      new THREE.LineSegments(
        own(graticule()),
        own(new THREE.LineBasicMaterial({ color: 0x2a2624, transparent: true, opacity: 0.7 })),
      ),
    );
    scene.add(
      new THREE.LineSegments(
        getLandGeometry(),
        own(new THREE.LineBasicMaterial({ color: 0x6b6663, transparent: true, opacity: 0.9 })),
      ),
    );

    // Звёздный фон.
    const starPos: number[] = [];
    for (let i = 0; i < 1400; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(28 + Math.random() * 12);
      starPos.push(v.x, v.y, v.z);
    }
    const stars = own(new THREE.BufferGeometry());
    stars.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
    scene.add(
      new THREE.Points(
        stars,
        own(
          new THREE.PointsMaterial({
            color: 0x8a8380,
            size: 0.07,
            sizeAttenuation: true,
            transparent: true,
            opacity: 0.45,
          }),
        ),
      ),
    );

    // Аппараты, подсветка выбранного, связи и маршрут — динамические буферы.
    const dotTexture = own(makeDotTexture());
    const pointMaterial = (size: number, extra: THREE.PointsMaterialParameters = {}) =>
      own(
        new THREE.PointsMaterial({
          size,
          sizeAttenuation: true,
          map: dotTexture,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          ...extra,
        }),
      );

    const satGeometry = own(dynamicGeometry());
    const satPoints = new THREE.Points(satGeometry, pointMaterial(0.055, { vertexColors: true }));
    satPoints.frustumCulled = false;
    scene.add(satPoints);

    const highlightGeometry = own(dynamicGeometry());
    const highlight = new THREE.Points(highlightGeometry, pointMaterial(0.16, { color: 0xfafafa }));
    highlight.frustumCulled = false;
    highlight.visible = false;
    scene.add(highlight);

    const linkGeometry = own(dynamicGeometry());
    const links = new THREE.LineSegments(
      linkGeometry,
      own(new THREE.LineBasicMaterial({ color: 0x4d4947, transparent: true, opacity: 0.6 })),
    );
    links.frustumCulled = false;
    scene.add(links);

    const routeGeometry = own(dynamicGeometry());
    const routeLine = new THREE.LineSegments(
      routeGeometry,
      own(new THREE.LineBasicMaterial({ color: 0xee6018 })),
    );
    routeLine.frustumCulled = false;
    scene.add(routeLine);

    const groundGroup = new THREE.Group();
    scene.add(groundGroup);

    const labels = new Map<string, HTMLSpanElement>();
    const groundMarkers: { id: string; mesh: THREE.Mesh }[] = [];

    const clearGround = () => {
      for (const { mesh } of groundMarkers) {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
      groundGroup.clear();
      groundMarkers.length = 0;
      if (labelRef.current) labelRef.current.innerHTML = '';
      labels.clear();
    };

    const buildGround = (s: Scenario) => {
      clearGround();
      for (const site of s.ground_sites) {
        const p = groundPosition(site);
        const isGw = site.role === 'gateway';
        const mesh = new THREE.Mesh(
          new THREE.SphereGeometry(isGw ? 0.022 : 0.016, 16, 12),
          new THREE.MeshBasicMaterial({ color: isGw ? 0xeeeeee : 0xa0ca92 }),
        );
        mesh.position.set(p[0] / R_EARTH_KM, p[1] / R_EARTH_KM, p[2] / R_EARTH_KM);
        groundGroup.add(mesh);
        groundMarkers.push({ id: site.id, mesh });

        if (showLabels && labelRef.current) {
          const el = document.createElement('span');
          el.className = 'globe-label';
          el.textContent = site.id;
          labelRef.current.appendChild(el);
          labels.set(site.id, el);
        }
      }
    };

    let current = scenario;
    let currentIds: string[] = [];

    const api: SceneApi = {
      update(s, t, route, withLinks, selected) {
        if (s !== current) {
          current = s;
          buildGround(s);
        }
        const { ids, xyz } = positions(s, t);
        currentIds = ids;
        const active = activeMask(s, t);
        const planeIndex = new Map(s.design.planes.map((p, i) => [p.id, i]));
        const planeOf = new Map(s.design.satellites.map((x) => [x.id, x.plane_id]));

        const pts = new Float32Array(ids.length * 3);
        const colors = new Float32Array(ids.length * 3);
        const byId = new Map<string, [number, number, number]>();
        const dim = new THREE.Color(0x3d3a39);
        const color = new THREE.Color();
        for (let k = 0; k < ids.length; k++) {
          const v: [number, number, number] = [
            xyz[k * 3] / R_EARTH_KM,
            xyz[k * 3 + 1] / R_EARTH_KM,
            xyz[k * 3 + 2] / R_EARTH_KM,
          ];
          byId.set(ids[k], v);
          pts.set(v, k * 3);
          const idx = planeIndex.get(planeOf.get(ids[k])!) ?? 0;
          if (active[k]) color.set(PLANE_COLORS[idx % PLANE_COLORS.length]);
          else color.copy(dim);
          colors.set([color.r, color.g, color.b], k * 3);
        }
        writeAttribute(satGeometry, 'position', pts);
        writeAttribute(satGeometry, 'color', colors);
        satGeometry.setDrawRange(0, ids.length);

        const siteIds = new Set<string>();
        for (const site of s.ground_sites) {
          const p = groundPosition(site);
          siteIds.add(site.id);
          byId.set(site.id, [p[0] / R_EARTH_KM, p[1] / R_EARTH_KM, p[2] / R_EARTH_KM]);
        }

        const linkPts: number[] = [];
        if (withLinks) {
          const net = buildNetwork(s, t);
          for (let i = 0; i < net.islAdjacency.length; i++) {
            for (const j of net.islAdjacency[i]) {
              if (j <= i) continue;
              linkPts.push(...byId.get(net.satIds[i])!, ...byId.get(net.satIds[j])!);
            }
          }
        }
        writeAttribute(linkGeometry, 'position', linkPts);
        linkGeometry.setDrawRange(0, linkPts.length / 3);

        const routePts: number[] = [];
        for (let i = 0; i < route.length - 1; i++) {
          const a = byId.get(route[i]);
          const b = byId.get(route[i + 1]);
          if (a && b) routePts.push(...a, ...b);
        }
        writeAttribute(routeGeometry, 'position', routePts);
        routeGeometry.setDrawRange(0, routePts.length / 3);

        const sel = selected && !siteIds.has(selected) ? byId.get(selected) : undefined;
        if (sel) {
          writeAttribute(highlightGeometry, 'position', sel);
          highlightGeometry.setDrawRange(0, 1);
        }
        highlight.visible = Boolean(sel);
      },
      setAutoRotate(on) {
        controls.autoRotate = on;
      },
    };
    apiRef.current = api;

    buildGround(scenario);
    api.update(scenario, t_s, routePath, showLinks, selectedSatellite);
    controls.autoRotate = autoRotate;

    // Выбор кликом. Короткое нажатие без сдвига — клик, иначе это было вращение.
    const raycaster = new THREE.Raycaster();
    raycaster.params.Points = { threshold: 0.035 };
    const pointer = new THREE.Vector2();
    let downAt: [number, number] | null = null;
    const onDown = (e: PointerEvent) => {
      downAt = [e.clientX, e.clientY];
    };
    const onUp = (e: PointerEvent) => {
      const start = downAt;
      downAt = null;
      if (!start || Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 5) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      // Объекты за Землёй не выбираются: сфера должна быть дальше найденной точки.
      const earthHit = raycaster.intersectObject(earth, false)[0];
      const inFront = (d: number) => !earthHit || d <= earthHit.distance + 1e-3;

      const siteHit = raycaster
        .intersectObjects(
          groundMarkers.map((g) => g.mesh),
          false,
        )
        .find((h) => inFront(h.distance));
      if (siteHit) {
        const marker = groundMarkers.find((g) => g.mesh === siteHit.object);
        if (marker) callbacks.current.onSelectSite?.(marker.id);
        return;
      }
      const satHit = raycaster
        .intersectObject(satPoints, false)
        .filter((h) => h.index !== undefined && h.index < currentIds.length && inFront(h.distance))
        .sort((a, b) => (a.distanceToRay ?? 0) - (b.distanceToRay ?? 0))[0];
      if (satHit?.index !== undefined) callbacks.current.onSelectSatellite?.(currentIds[satHit.index]);
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);

    const resize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    let raf = 0;
    const tmp = new THREE.Vector3();
    const loop = () => {
      controls.update();
      // Подписи наземных пунктов проецируются на экран и прячутся за горизонтом.
      if (showLabels) {
        // Близкие подписи разводятся по вертикали, иначе пункты рядом сливаются в кашу.
        const spots = groundMarkers.map(({ id, mesh }) => {
          tmp.copy(mesh.position);
          const behind = tmp.clone().normalize().dot(camera.position.clone().normalize()) < 0.08;
          tmp.project(camera);
          return {
            el: labels.get(id),
            behind,
            x: ((tmp.x + 1) / 2) * mount.clientWidth,
            y: ((1 - tmp.y) / 2) * mount.clientHeight,
          };
        });
        spots.sort((a, b) => a.y - b.y);
        const placed: Array<[number, number]> = [];
        for (const spot of spots) {
          if (!spot.el) continue;
          let y = spot.y;
          // Зазоры чуть больше самой плашки (~22px в высоту), иначе края всё равно
          // задевают друг друга.
          while (placed.some(([px, py]) => Math.abs(px - spot.x) < 96 && Math.abs(py - y) < 26)) {
            y += 26;
          }
          placed.push([spot.x, y]);
          spot.el.style.transform = `translate(${spot.x}px, ${y}px)`;
          spot.el.style.opacity = spot.behind ? '0' : '1';
        }
      }
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      clearGround();
      for (const d of disposables) d.dispose();
      renderer.dispose();
      // Браузер держит ограниченное число WebGL-контекстов — отдаём свой сразу.
      renderer.forceContextLoss();
      mount.removeChild(renderer.domElement);
      apiRef.current = null;
    };
    // Сцена создаётся один раз; данные обновляются через api.update ниже.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactive, showLabels]);

  useEffect(() => {
    apiRef.current?.update(scenario, t_s, routePath, showLinks, selectedSatellite);
  }, [scenario, t_s, routePath, showLinks, selectedSatellite]);

  useEffect(() => {
    apiRef.current?.setAutoRotate(autoRotate);
  }, [autoRotate]);

  return (
    <div className={`globe ${className ?? ''}`}>
      <div className="globe-canvas" ref={mountRef} />
      <div className="globe-labels" ref={labelRef} />
    </div>
  );
}
