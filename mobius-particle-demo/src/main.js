import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const CONFIG = Object.freeze({
  radius: 3.25,
  halfWidth: 1.08,
  surfaceUSegments: 320,
  surfaceVSegments: 34,
  particleCount: 5200,
  dustCount: 1100,
  packetCount: 18,
  baseSpeed: 0.092,
});

const TAU = Math.PI * 2;
const canvas = document.querySelector('#scene');
const fallback = document.querySelector('#fallback');
const panel = document.querySelector('.panel');
const speedInput = document.querySelector('#speed');
const speedValue = document.querySelector('#speedValue');
const bloomInput = document.querySelector('#bloom');
const bloomValue = document.querySelector('#bloomValue');
const toggleButton = document.querySelector('#toggleMotion');
const resetButton = document.querySelector('#resetCamera');
const statusText = document.querySelector('#statusText');

let renderer;
let composer;
let bloomPass;
let scene;
let camera;
let controls;
let root;
let surfaceMaterial;
let particleMaterial;
let dustMaterial;
let trajectoryMaterial;
let edgeMaterial;
let comet;
let cometGlow;
let clock;
let rafId = 0;
let elapsed = 0;
let paused = false;
let speedMultiplier = Number(speedInput.value);
let isPageVisible = !document.hidden;

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function mobiusPoint(u, v, target = new THREE.Vector3()) {
  const half = u * 0.5;
  const ring = CONFIG.radius + v * Math.cos(half);
  return target.set(
    ring * Math.cos(u),
    v * Math.sin(half),
    ring * Math.sin(u),
  );
}

function mainTrajectoryV(u) {
  return CONFIG.halfWidth * 0.62 * Math.cos(u * 0.5);
}

function createMobiusGeometry() {
  const uCount = CONFIG.surfaceUSegments + 1;
  const vCount = CONFIG.surfaceVSegments + 1;
  const positions = new Float32Array(uCount * vCount * 3);
  const uvs = new Float32Array(uCount * vCount * 2);
  const indices = [];
  const point = new THREE.Vector3();

  let p = 0;
  let t = 0;
  for (let i = 0; i < uCount; i += 1) {
    const uRatio = i / CONFIG.surfaceUSegments;
    const u = uRatio * TAU;

    for (let j = 0; j < vCount; j += 1) {
      const vRatio = j / CONFIG.surfaceVSegments;
      const v = (vRatio * 2 - 1) * CONFIG.halfWidth;
      mobiusPoint(u, v, point);

      positions[p++] = point.x;
      positions[p++] = point.y;
      positions[p++] = point.z;
      uvs[t++] = uRatio;
      uvs[t++] = vRatio;
    }
  }

  for (let i = 0; i < CONFIG.surfaceUSegments; i += 1) {
    for (let j = 0; j < CONFIG.surfaceVSegments; j += 1) {
      const a = i * vCount + j;
      const b = (i + 1) * vCount + j;
      const c = (i + 1) * vCount + j + 1;
      const d = i * vCount + j + 1;
      indices.push(a, b, d, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createSurfaceMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColorA: { value: new THREE.Color('#070914') },
      uColorB: { value: new THREE.Color('#3f1a79') },
      uEdge: { value: new THREE.Color('#7defff') },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;

      void main() {
        vUv = uv;
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      uniform vec3 uEdge;

      varying vec2 vUv;
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;

      float lineMask(float value, float density, float thickness) {
        float wave = abs(fract(value * density) - 0.5);
        return 1.0 - smoothstep(thickness, thickness + 0.035, wave);
      }

      void main() {
        vec3 normal = normalize(vWorldNormal);
        vec3 viewDir = normalize(cameraPosition - vWorldPosition);
        float facing = abs(dot(normal, viewDir));
        float fresnel = pow(1.0 - facing, 2.25);

        float uGrid = lineMask(vUv.x + uTime * 0.004, 42.0, 0.018);
        float vGrid = lineMask(vUv.y, 10.0, 0.028);
        float movingBand = pow(0.5 + 0.5 * sin(vUv.x * 52.0 - uTime * 1.35), 18.0);
        float widthFade = smoothstep(0.0, 0.36, vUv.y) * (1.0 - smoothstep(0.64, 1.0, vUv.y));

        vec3 base = mix(uColorA, uColorB, 0.34 + vUv.y * 0.42);
        vec3 color = base;
        color += uEdge * fresnel * 1.15;
        color += uEdge * (uGrid * 0.11 + vGrid * 0.07 + movingBand * 0.1) * widthFade;

        float alpha = 0.075 + fresnel * 0.38 + uGrid * 0.035 + vGrid * 0.025;
        alpha *= 0.8 + widthFade * 0.2;
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

function createParticleGeometry(count, dust = false) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const progress = new Float32Array(count);
  const lane = new Float32Array(count);
  const size = new Float32Array(count);
  const seed = new Float32Array(count);
  const pace = new Float32Array(count);

  for (let i = 0; i < count; i += 1) {
    const r1 = Math.random();
    const r2 = Math.random();
    const packet = i % CONFIG.packetCount;
    const packetJitter = (r1 + r2 - 1) * (dust ? 0.055 : 0.026);

    progress[i] = ((packet / CONFIG.packetCount) + packetJitter + 1) % 1;
    lane[i] = Math.random() * 2 - 1;
    seed[i] = Math.random();
    pace[i] = dust ? 0.72 + Math.random() * 0.34 : 0.93 + Math.random() * 0.14;
    size[i] = dust
      ? 0.016 + Math.pow(Math.random(), 2) * 0.032
      : 0.028 + Math.pow(Math.random(), 1.7) * 0.082;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aProgress', new THREE.BufferAttribute(progress, 1));
  geometry.setAttribute('aLane', new THREE.BufferAttribute(lane, 1));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  geometry.setAttribute('aPace', new THREE.BufferAttribute(pace, 1));
  return geometry;
}

function createParticleMaterial({ dust = false } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSpeed: { value: CONFIG.baseSpeed },
      uRadius: { value: CONFIG.radius },
      uWidth: { value: CONFIG.halfWidth },
      uPointScale: { value: window.innerHeight * Math.min(window.devicePixelRatio, 1.8) },
      uOpacity: { value: dust ? 0.5 : 1 },
      uDust: { value: dust ? 1 : 0 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uSpeed;
      uniform float uRadius;
      uniform float uWidth;
      uniform float uPointScale;
      uniform float uDust;

      attribute float aProgress;
      attribute float aLane;
      attribute float aSize;
      attribute float aSeed;
      attribute float aPace;

      varying vec3 vColor;
      varying float vAlpha;

      const float PI = 3.141592653589793;
      const float TAU = 6.283185307179586;

      float trajectoryV(float u, float lane, float seed) {
        float mainArc = 0.62 * cos(u * 0.5);
        float sideArc = lane * (0.12 + 0.10 * uDust) * sin(u * 0.5);
        float flutter = (0.025 + 0.035 * uDust) * sin(u * 1.5 + seed * TAU);
        return uWidth * (mainArc + sideArc + flutter);
      }

      vec3 mobius(float u, float v) {
        float halfU = u * 0.5;
        float ring = uRadius + v * cos(halfU);
        return vec3(
          ring * cos(u),
          v * sin(halfU),
          ring * sin(u)
        );
      }

      void main() {
        float flow = fract(aProgress + uTime * uSpeed * aPace);
        float u = flow * TAU;
        float v = trajectoryV(u, aLane, aSeed);
        vec3 pos = mobius(u, v);

        float epsilon = 0.006;
        float nextU = u + epsilon;
        vec3 nextPos = mobius(nextU, trajectoryV(nextU, aLane, aSeed));
        vec3 tangent = normalize(nextPos - pos);
        vec3 widthDir = normalize(vec3(
          cos(u * 0.5) * cos(u),
          sin(u * 0.5),
          cos(u * 0.5) * sin(u)
        ));
        vec3 normal = normalize(cross(tangent, widthDir));

        float orbit = sin(u * (5.0 + aSeed * 2.0) + uTime * (1.4 + aSeed * 1.8) + aSeed * TAU);
        float jitter = (0.018 + uDust * 0.07) * aLane * orbit;
        pos += normal * jitter;
        pos += widthDir * (uDust * 0.055 * sin(u * 7.0 + aSeed * 19.0));

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = clamp(aSize * uPointScale / max(1.0, -mvPosition.z), 1.0, 18.0);

        vec3 cyan = vec3(0.20, 0.92, 1.00);
        vec3 blue = vec3(0.31, 0.42, 1.00);
        vec3 violet = vec3(0.77, 0.32, 1.00);
        float hueMix = 0.5 + 0.5 * sin(u * 0.5 + aSeed * 4.2 + uTime * 0.12);
        vColor = mix(cyan, violet, hueMix);
        vColor = mix(vColor, blue, 0.18 + 0.18 * aLane);

        float packetPulse = 0.56 + 0.44 * pow(0.5 + 0.5 * sin(flow * 18.0 * TAU), 2.0);
        vAlpha = mix(packetPulse, 0.34 + 0.3 * packetPulse, uDust);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      uniform float uDust;
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec2 point = gl_PointCoord - 0.5;
        float distanceToCenter = length(point);
        if (distanceToCenter > 0.5) discard;

        float halo = smoothstep(0.5, 0.08, distanceToCenter);
        float core = smoothstep(0.19, 0.0, distanceToCenter);
        float sparkle = mix(1.0, 0.68, uDust);
        float alpha = (halo * 0.48 + core * 0.92) * vAlpha * uOpacity;
        vec3 color = vColor * (1.1 + core * 1.9) * sparkle;
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
  });
}

function createClosedCurve(sampleCount, vFunction, turns = 1) {
  const points = [];
  for (let i = 0; i < sampleCount; i += 1) {
    const ratio = i / sampleCount;
    const u = ratio * TAU * turns;
    points.push(mobiusPoint(u, vFunction(u), new THREE.Vector3()));
  }
  return new THREE.CatmullRomCurve3(points, true, 'centripetal', 0.5);
}

function createTrajectory() {
  const curve = createClosedCurve(280, mainTrajectoryV);

  const glowGeometry = new THREE.TubeGeometry(curve, 520, 0.052, 7, true);
  const coreGeometry = new THREE.TubeGeometry(curve, 520, 0.012, 6, true);

  const glowMaterial = new THREE.MeshBasicMaterial({
    color: 0x5b9dff,
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  trajectoryMaterial = new THREE.MeshBasicMaterial({
    color: 0x91f7ff,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const glowTube = new THREE.Mesh(glowGeometry, glowMaterial);
  const coreTube = new THREE.Mesh(coreGeometry, trajectoryMaterial);
  glowTube.renderOrder = 2;
  coreTube.renderOrder = 3;

  const group = new THREE.Group();
  group.add(glowTube, coreTube);
  return { group, curve };
}

function createSingleEdge() {
  const edgeCurve = createClosedCurve(
    520,
    () => CONFIG.halfWidth,
    2,
  );

  const geometry = new THREE.TubeGeometry(edgeCurve, 820, 0.009, 5, true);
  edgeMaterial = new THREE.MeshBasicMaterial({
    color: 0xa98cff,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return new THREE.Mesh(geometry, edgeMaterial);
}

function createStars() {
  const count = 1600;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const color = new THREE.Color();

  for (let i = 0; i < count; i += 1) {
    const radius = 11 + Math.pow(Math.random(), 0.45) * 28;
    const theta = Math.random() * TAU;
    const phi = Math.acos(THREE.MathUtils.randFloatSpread(2));
    positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = radius * Math.cos(phi);
    positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);

    color.setHSL(0.53 + Math.random() * 0.18, 0.38, 0.58 + Math.random() * 0.28);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size: 0.045,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.52,
    vertexColors: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  return new THREE.Points(geometry, material);
}

function createComet() {
  const group = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.078, 20, 20),
    new THREE.MeshBasicMaterial({ color: 0xf4ffff }),
  );
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(0.19, 18, 18),
    new THREE.MeshBasicMaterial({
      color: 0x65eaff,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  group.add(core, halo);
  cometGlow = halo;
  return group;
}

function setupScene() {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x05030d, 0.028);

  camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 80);
  camera.position.set(7.6, 4.8, 9.2);

  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.055;
  controls.minDistance = 6.3;
  controls.maxDistance = 20;
  controls.maxPolarAngle = Math.PI * 0.86;
  controls.autoRotate = !prefersReducedMotion;
  controls.autoRotateSpeed = 0.34;
  controls.target.set(0.3, 0, 0);
  controls.update();

  root = new THREE.Group();
  root.rotation.set(-0.28, -0.38, 0.12);
  scene.add(root);

  const surfaceGeometry = createMobiusGeometry();
  surfaceMaterial = createSurfaceMaterial();
  const surface = new THREE.Mesh(surfaceGeometry, surfaceMaterial);
  surface.renderOrder = 1;
  root.add(surface);

  const particleGeometry = createParticleGeometry(CONFIG.particleCount);
  particleMaterial = createParticleMaterial();
  const particles = new THREE.Points(particleGeometry, particleMaterial);
  particles.frustumCulled = false;
  particles.renderOrder = 5;
  root.add(particles);

  const dustGeometry = createParticleGeometry(CONFIG.dustCount, true);
  dustMaterial = createParticleMaterial({ dust: true });
  const dust = new THREE.Points(dustGeometry, dustMaterial);
  dust.frustumCulled = false;
  dust.renderOrder = 4;
  root.add(dust);

  const trajectory = createTrajectory();
  root.add(trajectory.group);

  const edge = createSingleEdge();
  edge.renderOrder = 2;
  root.add(edge);

  comet = createComet();
  comet.renderOrder = 6;
  root.add(comet);
  comet.userData.curve = trajectory.curve;

  scene.add(createStars());

  const ambient = new THREE.HemisphereLight(0x8acbff, 0x160d2a, 0.55);
  scene.add(ambient);

  const keyLight = new THREE.PointLight(0x59dfff, 18, 20, 2);
  keyLight.position.set(4, 5, 6);
  scene.add(keyLight);

  const rimLight = new THREE.PointLight(0xa65cff, 14, 18, 2);
  rimLight.position.set(-6, -3, -5);
  scene.add(rimLight);

  composer = new EffectComposer(renderer);
  composer.setSize(window.innerWidth, window.innerHeight);
  composer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
  composer.addPass(new RenderPass(scene, camera));

  bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    Number(bloomInput.value),
    0.68,
    0.11,
  );
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());

  clock = new THREE.Clock();
}

function updateScene(delta) {
  if (!paused && isPageVisible) {
    elapsed += delta * speedMultiplier;
  }

  surfaceMaterial.uniforms.uTime.value = elapsed;
  particleMaterial.uniforms.uTime.value = elapsed;
  dustMaterial.uniforms.uTime.value = elapsed;

  const cometT = (elapsed * CONFIG.baseSpeed * 1.04 + 0.015) % 1;
  comet.userData.curve.getPointAt(cometT, comet.position);
  const pulse = 1 + Math.sin(elapsed * 5.4) * 0.16;
  comet.scale.setScalar(pulse);
  cometGlow.material.opacity = 0.12 + (0.5 + 0.5 * Math.sin(elapsed * 4.6)) * 0.08;

  trajectoryMaterial.opacity = 0.34 + (0.5 + 0.5 * Math.sin(elapsed * 1.65)) * 0.12;
  edgeMaterial.opacity = 0.22 + (0.5 + 0.5 * Math.sin(elapsed * 0.72)) * 0.1;

  root.rotation.z = 0.12 + Math.sin(elapsed * 0.18) * 0.035;
  controls.autoRotate = !paused && !prefersReducedMotion;
  controls.update();
}

function animate() {
  rafId = requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.05);
  updateScene(delta);
  composer.render();
}

function resetCamera() {
  camera.position.set(7.6, 4.8, 9.2);
  controls.target.set(0.3, 0, 0);
  controls.update();
}

function setPaused(nextPaused) {
  paused = nextPaused;
  panel.classList.toggle('is-paused', paused);
  toggleButton.textContent = paused ? '继续' : '暂停';
  statusText.textContent = paused ? '动画已暂停' : '无限循环中';
}

function bindEvents() {
  speedInput.addEventListener('input', () => {
    speedMultiplier = Number(speedInput.value);
    speedValue.value = `${speedMultiplier.toFixed(2)}×`;
  });

  bloomInput.addEventListener('input', () => {
    const bloom = Number(bloomInput.value);
    bloomPass.strength = bloom;
    bloomValue.value = bloom.toFixed(2);
  });

  toggleButton.addEventListener('click', () => setPaused(!paused));
  resetButton.addEventListener('click', resetCamera);

  window.addEventListener('keydown', (event) => {
    if (event.code === 'Space' && event.target === document.body) {
      event.preventDefault();
      setPaused(!paused);
    }
    if (event.key.toLowerCase() === 'r') resetCamera();
  });

  document.addEventListener('visibilitychange', () => {
    isPageVisible = !document.hidden;
    clock.getDelta();
  });

  window.addEventListener('resize', () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const pixelRatio = Math.min(window.devicePixelRatio, 1.8);

    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
    composer.setPixelRatio(pixelRatio);
    composer.setSize(width, height);
    particleMaterial.uniforms.uPointScale.value = height * pixelRatio;
    dustMaterial.uniforms.uPointScale.value = height * pixelRatio;
  }, { passive: true });
}

function boot() {
  try {
    setupScene();
    bindEvents();
    animate();
  } catch (error) {
    console.error('Unable to initialize the Möbius particle scene:', error);
    cancelAnimationFrame(rafId);
    fallback.hidden = false;
  }
}

boot();
