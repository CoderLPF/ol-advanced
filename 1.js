import "ol/ol.css";
import "ol-plot/dist/ol-plot.css";
import OLMap from "ol/Map.js";
import View from "ol/View.js";
import TileLayer from "ol/layer/Tile.js";
import VectorLayer from "ol/layer/Vector.js";
import Feature from "ol/Feature.js";
import OSM from "ol/source/OSM.js";
import VectorSource from "ol/source/Vector.js";
import GeoJSON from "ol/format/GeoJSON.js";
import Style from "ol/style/Style.js";
import Fill from "ol/style/Fill.js";
import Stroke from "ol/style/Stroke.js";
import CircleStyle from "ol/style/Circle.js";
import Icon from "ol/style/Icon.js";
import Point from "ol/geom/Point.js";
import { defaults as defaultControls } from "ol/control/defaults.js";
import { getUid } from "ol/util.js";
import { apply as applyTransform } from "ol/transform.js";
import MVT from "ol/format/MVT.js";
import { createHatchLayer, getHatchFillPattern } from "./hatch-layer.js";
import {
  createGlowHoverOverlay,
  createInfoPanel,
  createProjectFeatureCard,
} from "./ui/panels.js";
import { createPlotUi } from "./ui/plot-ui.js";
import Plot from "ol-plot";
import VectorTileLayer from "ol/layer/VectorTile.js";
import VectorTile from "ol/source/VectorTile.js";
import { createXYZ } from "ol/tilegrid.js";

/* ---------------------------
 * 工具函数
 * --------------------------- */
function fract(x) {
  return x - Math.floor(x);
}

function parseColor(str) {
  // 简单解析rgba或rgb字符串返回{r,g,b,a}
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/i.exec(str);
  if (!m) throw new Error("Invalid color");
  return {
    r: Number(m[1]),
    g: Number(m[2]),
    b: Number(m[3]),
    a: m[4] ? Number(m[4]) : 1,
  };
}

function seededRandom(seed) {
  return fract(Math.sin(seed * 12.9898 + 78.233) * 43758.5453123);
}

function createRngFromSeed(seed) {
  let s = (Math.floor(seed * 1000003) ^ 0x9e3779b9) >>> 0;
  if (s === 0) s = 0x6d2b79f5;
  return function rng() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussianRandom(rng, mean = 0.5, std = 0.15) {
  // Box-Muller：近似正态分布
  const u1 = Math.max(1e-8, rng());
  const u2 = Math.max(1e-8, rng());
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return mean + z0 * std;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));

  let r1 = 0,
    g1 = 0,
    b1 = 0;

  if (hp >= 0 && hp < 1) [r1, g1, b1] = [c, x, 0];
  else if (hp >= 1 && hp < 2) [r1, g1, b1] = [x, c, 0];
  else if (hp >= 2 && hp < 3) [r1, g1, b1] = [0, c, x];
  else if (hp >= 3 && hp < 4) [r1, g1, b1] = [0, x, c];
  else if (hp >= 4 && hp < 5) [r1, g1, b1] = [x, 0, c];
  else if (hp >= 5 && hp < 6) [r1, g1, b1] = [c, 0, x];

  const m = l - c / 2;
  const r = Math.round((r1 + m) * 255);
  const g = Math.round((g1 + m) * 255);
  const b = Math.round((b1 + m) * 255);

  return "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");
}

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return { r: 59, g: 130, b: 246 };
  return {
    r: parseInt(m[1], 16),
    g: parseInt(m[2], 16),
    b: parseInt(m[3], 16),
  };
}

function hexToRgb01(hex) {
  const { r, g, b } = hexToRgb(hex);
  return [r / 255, g / 255, b / 255];
}

function darkenHex(hex, ratio = 0.2) {
  const { r, g, b } = hexToRgb(hex);
  const rr = Math.round(r * (1 - ratio));
  const gg = Math.round(g * (1 - ratio));
  const bb = Math.round(b * (1 - ratio));
  return `rgb(${rr}, ${gg}, ${bb})`;
}

function createStarfieldBackground(size = 512, starCount = 220, seed = 13.37) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  ctx.clearRect(0, 0, size, size);

  for (let i = 0; i < starCount; i++) {
    const x = seededRandom(seed + i * 1.91) * size;
    const y = seededRandom(seed + i * 4.37) * size;
    const radius = seededRandom(seed + i * 7.23) > 0.84 ? 1.4 : 0.9;
    const alpha = 0.2 + seededRandom(seed + i * 9.01) * 0.45;

    // 纯色点状星点，不加发光和模糊
    ctx.beginPath();
    ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  return canvas.toDataURL("image/png");
}

function getAdaptiveStarCountByZoom(zoom, minZoom = 3, maxZoom = 13) {
  const t = clamp((zoom - minZoom) / (maxZoom - minZoom), 0, 1);
  const maxStars = 260;
  const minStars = 60;
  return Math.round(maxStars + (minStars - maxStars) * t);
}

function applyMapStarBackground(mapInstance) {
  const targetEl = mapInstance.getTargetElement();
  if (!targetEl) return;

  targetEl.style.backgroundColor = "#0b1220";
  targetEl.style.backgroundRepeat = "repeat";
  targetEl.style.backgroundSize = "512px 512px";

  const tileSize = 512;
  const seed = 23.7;
  const cache = new globalThis.Map();
  let lastCount = -1;

  function updateStarBackground() {
    const zoomRaw = mapInstance.getView()?.getZoom();
    const zoom = Number.isFinite(zoomRaw) ? zoomRaw : 8;
    const quantizedZoom = Math.round(zoom * 4) / 4;
    const starCount = getAdaptiveStarCountByZoom(quantizedZoom, 3, 13);
    if (starCount === lastCount) return;
    lastCount = starCount;

    let stars = cache.get(starCount);
    if (!stars) {
      stars = createStarfieldBackground(
        tileSize,
        starCount,
        seed + starCount * 0.17,
      );
      cache.set(starCount, stars);
    }
    targetEl.style.backgroundImage = `url(${stars})`;
  }

  updateStarBackground();
  mapInstance.getView().on("change:resolution", updateStarBackground);
  mapInstance.on("change:view", () => {
    lastCount = -1;
    updateStarBackground();
    mapInstance.getView().on("change:resolution", updateStarBackground);
  });
}

function createGlowPointSprite(
  size = 128,
  seed = 6.2,
  themeColor = [0.08, 0.55, 1.0],
) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const gl = canvas.getContext("webgl", { preserveDrawingBuffer: true });
  if (!gl) {
    return createFallbackGlowSprite(size, themeColor);
  }

  const vsSource = `
    attribute vec2 a_position;
    varying vec2 v_uv;
    void main() {
      v_uv = (a_position + 1.0) * 0.5;
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  const fsSource = `
    precision mediump float;
    varying vec2 v_uv;
    uniform float u_seed;
    uniform vec3 u_themeColor;

    float hash(float n) {
      return fract(sin(n) * 43758.5453123);
    }

    void main() {
      vec2 p = v_uv - vec2(0.5);
      float r = length(p);
      float a = atan(p.y, p.x);

      // 中心强核
      float core = exp(-r * 40.0);

      // 大范围光晕
      float halo = exp(-r * 9.0) * 0.95;

      // 放射感（类似图中十字星芒）
      float ray1 = pow(max(0.0, cos(a * 2.0)), 18.0) * exp(-r * 10.0);
      float ray2 = pow(max(0.0, cos((a + 0.785398) * 2.0)), 20.0) * exp(-r * 11.0);
      float rays = (ray1 + ray2) * 0.65;

      // 轻微随机扰动，避免太机械
      float jitter = 0.92 + hash(u_seed + floor((a + 3.14159) * 8.0)) * 0.16;
      float intensity = (core * 1.45 + halo * 0.92 + rays) * jitter;

      vec3 center = vec3(1.0);
      vec3 color = mix(u_themeColor, center, clamp(core * 1.35 + rays * 0.6, 0.0, 1.0));
      color *= intensity;

      // 柔和边缘衰减，避免出现明显“包围圆”
      float edgeFade = smoothstep(0.72, 0.08, r);
      float alpha = clamp(intensity * edgeFade * 1.05, 0.0, 1.0);
      gl_FragColor = vec4(clamp(color, 0.0, 1.0), alpha);
    }
  `;

  function compileShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  const vs = compileShader(gl.VERTEX_SHADER, vsSource);
  const fs = compileShader(gl.FRAGMENT_SHADER, fsSource);
  if (!vs || !fs) {
    return createFallbackGlowSprite(size, themeColor);
  }

  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(program));
    return createFallbackGlowSprite(size, themeColor);
  }

  gl.useProgram(program);
  const quad = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

  const aPosition = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(aPosition);
  gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);
  gl.uniform1f(gl.getUniformLocation(program, "u_seed"), seed);
  gl.uniform3f(
    gl.getUniformLocation(program, "u_themeColor"),
    themeColor[0],
    themeColor[1],
    themeColor[2],
  );

  gl.viewport(0, 0, size, size);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  return canvas;
}

function createFallbackGlowSprite(size = 128, themeColor = [0.08, 0.55, 1.0]) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const rr = Math.round(clamp(themeColor[0], 0, 1) * 255);
  const gg = Math.round(clamp(themeColor[1], 0, 1) * 255);
  const bb = Math.round(clamp(themeColor[2], 0, 1) * 255);

  const c = size / 2;
  const r = size * 0.5;
  const g = ctx.createRadialGradient(c, c, 0, c, c, r);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.12, `rgba(${rr}, ${gg}, ${bb}, 0.92)`);
  g.addColorStop(0.34, `rgba(${rr}, ${gg}, ${bb}, 0.58)`);
  g.addColorStop(0.64, `rgba(${rr}, ${gg}, ${bb}, 0.22)`);
  g.addColorStop(1, `rgba(${rr}, ${gg}, ${bb}, 0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

// 方案A色盘，参考Carto等专题图柔和配色
const paletteA = [
  "#2f4f7f", // 深蓝灰
  "#355c7d", // 蓝紫灰
  "#3d5a80", // 冷蓝
  "#2d6a8a", // 深青蓝
  "#4b5563", // 冷灰
  "#3f5169", // 钢蓝灰
  "#31506f", // 夜蓝
  "#5a6c7d", // 灰蓝
  "#445b78", // 深雾蓝
  "#3c4a5f", // 靛灰
];

// 用方案A色盘均匀分配颜色
function createThemeColorA(seed) {
  const idx = Math.floor(seed) % paletteA.length;
  return paletteA[idx];
}

/**
 * 给每个要素生成一个“随机但均匀”的主题色
 * 用黄金角让色相分布更均匀，看起来不会扎堆
 */
function createThemeColor(seed) {
  const hue = (seed * 137.508) % 360;
  const sat = 58 + Math.floor(seededRandom(seed + 11) * 14); // 58~72
  const light = 46 + Math.floor(seededRandom(seed + 29) * 12); // 46~58
  return hslToHex(hue, sat, light);
}

/* ---------------------------
 * WebGL 生成“单个面”的主题纹理
 * 不 repeat，后面直接拉伸到整个面外接框
 * --------------------------- */
function createFeatureTexture(themeColor, seed, width = 512, height = 512) {
  const glCanvas = document.createElement("canvas");
  glCanvas.width = width;
  glCanvas.height = height;
  const resultCanvas = document.createElement("canvas");
  resultCanvas.width = width;
  resultCanvas.height = height;

  const gl = glCanvas.getContext("webgl", { preserveDrawingBuffer: true });
  if (!gl) {
    return createFallbackTexture(themeColor, seed, width, height);
  }
  let vs = null;
  let fs = null;
  let program = null;
  let buffer = null;

  function disposeGlResources() {
    if (buffer) {
      gl.deleteBuffer(buffer);
      buffer = null;
    }
    if (program) {
      gl.deleteProgram(program);
      program = null;
    }
    if (vs) {
      gl.deleteShader(vs);
      vs = null;
    }
    if (fs) {
      gl.deleteShader(fs);
      fs = null;
    }
    // 主动释放上下文，避免“Too many active WebGL contexts”
    const loseExt = gl.getExtension("WEBGL_lose_context");
    if (loseExt) loseExt.loseContext();
  }

  const vsSource = `
    attribute vec2 a_position;
    varying vec2 v_uv;
    void main() {
      v_uv = (a_position + 1.0) * 0.5;
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  const fsSource = `
    precision mediump float;
    varying vec2 v_uv;

    uniform vec3 u_themeColor;
    uniform float u_seed;

    float random(vec2 st) {
      return fract(sin(dot(st, vec2(12.9898, 78.233))) * 43758.5453123);
    }

    float noise(vec2 st) {
      vec2 i = floor(st);
      vec2 f = fract(st);

      float a = random(i);
      float b = random(i + vec2(1.0, 0.0));
      float c = random(i + vec2(0.0, 1.0));
      float d = random(i + vec2(1.0, 1.0));

      vec2 u = f * f * (3.0 - 2.0 * f);

      return mix(a, b, u.x)
        + (c - a) * u.y * (1.0 - u.x)
        + (d - b) * u.x * u.y;
    }

    float fbm(vec2 st) {
      float v = 0.0;
      float a = 0.5;
      float f = 1.0;
      for (int i = 0; i < 6; i++) {
        v += a * noise(st * f);
        f *= 2.0;
        a *= 0.55;
      }
      return v;
    }

    void main() {
      vec2 st = v_uv;

      // 低频形变，让云雾更自然
      vec2 warp = vec2(
        fbm(st * 2.0 + vec2(u_seed * 0.013, u_seed * 0.021)),
        fbm(st * 2.0 + vec2(5.2 + u_seed * 0.017, 1.3 + u_seed * 0.011))
      );

      // 大尺度云雾
      float cloud = fbm(st * 2.2 + warp * 1.3 + vec2(u_seed * 0.01, u_seed * 0.015));

      // 中尺度细节
      float detail = fbm(st * 7.5 + warp * 0.8 + vec2(2.3, 9.1));
      float mid = fbm(st * 4.3 + warp * 1.1 + vec2(8.7, 3.4));
      float micro = fbm(st * 14.0 + warp * 0.45 + vec2(12.1, 5.9));

      // 很低频的整体明暗变化，避免死板纯色
      float broad = fbm(st * 1.3 + vec2(u_seed * 0.007, u_seed * 0.009));

      // 提亮主基调并加强层次
      float shade = 1.02 + detail * 0.09 + broad * 0.09 + mid * 0.07;

      vec3 base = u_themeColor * shade;

      // 云雾提亮：更亮一些，但避免发灰发白
      float mist = smoothstep(0.34, 0.9, cloud) * 0.26;
      vec3 color = mix(base, vec3(1.0), mist);

      // 叠加高频起伏，让层次更丰富
      color *= (0.95 + detail * 0.09 + micro * 0.06);

      // 随机 holes：稀疏透明洞，增强“云层破碎”感
      float holeNoise = fbm(st * 5.2 + vec2(19.7 + u_seed * 0.011, 7.3 + u_seed * 0.013));
      float holeMask = smoothstep(0.82, 0.96, holeNoise) * (0.35 + 0.65 * smoothstep(0.45, 0.88, cloud));
      float alpha = 1.0 - holeMask * 0.62;

      gl_FragColor = vec4(clamp(color, 0.0, 1.0), clamp(alpha, 0.22, 1.0));
    }
  `;

  function compileShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  vs = compileShader(gl.VERTEX_SHADER, vsSource);
  fs = compileShader(gl.FRAGMENT_SHADER, fsSource);

  if (!vs || !fs) {
    disposeGlResources();
    return createFallbackTexture(themeColor, seed, width, height);
  }

  program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(program));
    disposeGlResources();
    return createFallbackTexture(themeColor, seed, width, height);
  }

  gl.useProgram(program);

  const quad = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);

  buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

  const aPosition = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(aPosition);
  gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

  const [r, g, b] = hexToRgb01(themeColor);
  gl.uniform3f(gl.getUniformLocation(program, "u_themeColor"), r, g, b);
  gl.uniform1f(gl.getUniformLocation(program, "u_seed"), seed);

  gl.viewport(0, 0, width, height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  // 在释放 WebGL 上下文前先把结果拷贝到 2D canvas，避免纹理丢失
  const outCtx = resultCanvas.getContext("2d");
  if (outCtx) {
    outCtx.clearRect(0, 0, width, height);
    outCtx.drawImage(glCanvas, 0, 0, width, height);
  }

  disposeGlResources();
  return outCtx
    ? resultCanvas
    : createFallbackTexture(themeColor, seed, width, height);
}

/**
 * 没有 WebGL 时的降级方案
 */
function createFallbackTexture(themeColor, seed, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = themeColor;
  ctx.fillRect(0, 0, width, height);

  // 多层亮雾细节
  for (let i = 0; i < 240; i++) {
    const x = seededRandom(seed + i * 3.1) * width;
    const y = seededRandom(seed + i * 7.7) * height;
    const r = 14 + seededRandom(seed + i * 11.3) * 110;

    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(255,255,255,0.12)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // holes：使用 destination-out 挖一些随机透明洞
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 40; i++) {
    const x = seededRandom(seed + i * 13.7) * width;
    const y = seededRandom(seed + i * 17.3) * height;
    const r = 10 + seededRandom(seed + i * 5.9) * 34;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(0,0,0,0.45)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  return canvas;
}

/* ---------------------------
 * 坐标路径与包围盒
 * 支持 Polygon / MultiPolygon
 * --------------------------- */
function isPoint(coords) {
  return (
    Array.isArray(coords) &&
    coords.length >= 2 &&
    typeof coords[0] === "number" &&
    typeof coords[1] === "number"
  );
}

function drawPathFromCoordinates(ctx, coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length === 0) return;

  // ring: [[x,y], [x,y], ...]
  if (isPoint(coordinates[0])) {
    const ring = coordinates;
    if (!ring.length) return;
    ctx.moveTo(ring[0][0], ring[0][1]);
    for (let i = 1; i < ring.length; i++) {
      ctx.lineTo(ring[i][0], ring[i][1]);
    }
    ctx.closePath();
    return;
  }

  for (const part of coordinates) {
    drawPathFromCoordinates(ctx, part);
  }
}

function getPixelBounds(coordinates) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  function walk(coords) {
    if (!Array.isArray(coords) || coords.length === 0) return;

    if (isPoint(coords[0])) {
      for (const p of coords) {
        const x = p[0];
        const y = p[1];
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
      return;
    }

    for (const part of coords) {
      walk(part);
    }
  }

  walk(coordinates);

  if (!isFinite(minX)) {
    minX = minY = 0;
    maxX = maxY = 1;
  }

  return { minX, minY, maxX, maxY };
}

function getFeatureExtentPixelBounds(feature, state) {
  const geom = feature?.getGeometry?.();
  const extent = geom?.getExtent?.();
  const tf = state?.coordinateToPixelTransform;
  if (!extent || !tf) return null;
  const corners = [
    [extent[0], extent[1]],
    [extent[0], extent[3]],
    [extent[2], extent[1]],
    [extent[2], extent[3]],
  ].map((c) => applyTransform(tf, c));
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

function buildFeatureExtentStretchPattern(ctx, texture, feature, state) {
  const pattern = ctx.createPattern(texture, "no-repeat");
  if (!pattern || typeof pattern.setTransform !== "function") return null;
  const geom = feature?.getGeometry?.();
  const extent = geom?.getExtent?.();
  const tf = state?.coordinateToPixelTransform;
  if (!extent || !tf) return null;

  const minX = extent[0];
  const minY = extent[1];
  const maxX = extent[2];
  const maxY = extent[3];
  const worldW = Math.max(1e-9, maxX - minX);
  const worldH = Math.max(1e-9, maxY - minY);

  // World-space anchoring:
  // texture(0,0)->(minX,minY), texture(w,h)->(maxX,maxY)
  const p0 = applyTransform(tf, [minX, minY]);
  const px = applyTransform(tf, [maxX, minY]);
  const py = applyTransform(tf, [minX, maxY]);

  const ax = (px[0] - p0[0]) / Math.max(1, texture.width);
  const ay = (px[1] - p0[1]) / Math.max(1, texture.width);
  const bx = (py[0] - p0[0]) / Math.max(1, texture.height);
  const by = (py[1] - p0[1]) / Math.max(1, texture.height);

  // align translation to device pixel grid to avoid sub-pixel wobble while zooming
  const pr = Math.max(1, Number(state?.pixelRatio) || 1);
  const tx = Math.round(p0[0] * pr) / pr;
  const ty = Math.round(p0[1] * pr) / pr;
  pattern.setTransform(new DOMMatrix([ax, ay, bx, by, tx, ty]));
  return pattern;
}

/* ---------------------------
 * 缓存
 * --------------------------- */
const textureCache = new globalThis.Map();
const styleCache = new globalThis.Map();
const FEATURE_SHADER_BASE_OPACITY = 0.28;
const FEATURE_SHADER_DARK_MASK_OPACITY = 0.08;

/* ---------------------------
 * 每个要素生成自己的主题色和纹理
 * --------------------------- */
function getFeatureSeed(feature) {
  const uid = Number(getUid(feature));
  return Number.isFinite(uid) ? uid : 1;
}

function ensureFeatureTheme(feature) {
  let color = feature.get("themeColor");
  if (!color) {
    const seed = getFeatureSeed(feature);
    // color = createThemeColor(seed);
    color = createThemeColorA(seed);
    feature.set("themeColor", color, true);
  }
  return color;
}

function getFeatureTexture(feature) {
  const uid = getUid(feature);
  if (textureCache.has(uid)) return textureCache.get(uid);

  const seed = getFeatureSeed(feature);
  const themeColor = ensureFeatureTheme(feature);
  const texture = createFeatureTexture(themeColor, seed, 512, 512);
  textureCache.set(uid, texture);
  return texture;
}

function getFeatureStyle(feature) {
  const uid = getUid(feature);
  if (styleCache.has(uid)) return styleCache.get(uid);

  const themeColor = ensureFeatureTheme(feature);
  const strokeColor = darkenHex(themeColor, 0.22);
  const texture = getFeatureTexture(feature);

  const style = new Style({
    renderer: (coordinates, state) => {
      const ctx = state.context;
      // 使用“要素坐标 extent -> 像素”映射，避免每帧按简化后的屏幕几何重算 UV 导致纹理抖动
      const bounds =
        getFeatureExtentPixelBounds(feature, state) ||
        getPixelBounds(coordinates);

      const x = bounds.minX;
      const y = bounds.minY;
      const w = Math.max(1, bounds.maxX - bounds.minX);
      const h = Math.max(1, bounds.maxY - bounds.minY);

      // 1. 先裁切到面内部
      ctx.save();
      ctx.beginPath();
      drawPathFromCoordinates(ctx, coordinates);
      ctx.clip("evenodd");

      // 2. 基于“要素世界坐标 extent”做拉伸映射，避免屏幕坐标驱动带来的缩放抖动
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.globalAlpha = FEATURE_SHADER_BASE_OPACITY;
      const stretchPattern = buildFeatureExtentStretchPattern(
        ctx,
        texture,
        feature,
        state,
      );
      if (stretchPattern) {
        ctx.fillStyle = stretchPattern;
        ctx.fillRect(x, y, w, h);
      } else {
        // fallback: very old canvas implementation
        ctx.drawImage(texture, x, y, w, h);
      }
      ctx.globalAlpha = 1;

      // 2.5 深色蒙层，让底图更沉稳，避免和高亮点色冲撞
      ctx.save();
      ctx.beginPath();
      drawPathFromCoordinates(ctx, coordinates);
      ctx.fillStyle = `rgba(8, 16, 32, ${FEATURE_SHADER_DARK_MASK_OPACITY})`;
      ctx.fill("evenodd");
      ctx.restore();

      ctx.restore();

      // 3. 再画边线
      ctx.save();
      ctx.beginPath();
      drawPathFromCoordinates(ctx, coordinates);
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.restore();
    },

    hitDetectionRenderer: (coordinates, state) => {
      const ctx = state.context;
      ctx.save();
      ctx.beginPath();
      drawPathFromCoordinates(ctx, coordinates);
      ctx.fillStyle = "#000";
      ctx.fill("evenodd");
      ctx.restore();
    },
  });

  styleCache.set(uid, style);
  return style;
}

/* ---------------------------
 * 数据源
 * --------------------------- */
const source = new VectorSource({
  url: "/data/world.geojson",
  format: new GeoJSON(),
  wrapX: false,
});

const vectorLayer = new VectorLayer({
  source,
  style: (feature) => getFeatureStyle(feature),
  updateWhileAnimating: false,
  updateWhileInteracting: false,
});

const hatchLayer = createHatchLayer({
  source,
  drawPathFromCoordinates,
  getPixelBounds,
});

const glowPointSource = new VectorSource({
  // 仅维护“当前可见点”子集，禁用索引减少维护成本
  useSpatialIndex: false,
});
const visibleGlowFeatureMap = new globalThis.Map();
let glowDataReady = false;
let lodBaseZoom = 0;
let lodLevels = 10;
let glowWorkerInitMeta = {
  total: 0,
  targetTotal: 0,
  levels: 0,
  sizeRange: { min: 0.1, max: 1.5 },
};
let lastQueryStats = {
  cacheHits: 0,
  cacheMisses: 0,
  hitRate: 0,
  candidateCount: 0,
  visibleCount: 0,
};
const WEB_MERCATOR_HALF = 20037508.342789244;
const glowThemeColors = [
  [0.216, 0.569, 1.0], // 蓝
  [1.0, 0.345, 0.282], // 红
  [1.0, 0.839, 0.259], // 黄
];
const glowThemeSpriteUrls = glowThemeColors.map((c, idx) =>
  createGlowPointSprite(128, 12.7 + idx * 17.3, c).toDataURL("image/png"),
);
const glowStyleCache = new globalThis.Map();

function getBaseScaleByBucket(sizeBucket) {
  // 尺寸范围固定在 0.1 ~ 1.5，非线性映射让大小差异更明显
  const t = clamp(sizeBucket, 0, 20) / 20;
  return 0.1 + Math.pow(t, 1.25) * 1.4;
}

function getOpacityByBucket(opacityBucket) {
  return 0.72 + clamp(opacityBucket, 0, 5) * 0.04;
}

function getGlowStyleMeta(feature) {
  const colorRaw =
    feature.get("colorIndex") ??
    feature.get("color_index") ??
    feature.get("ci");
  const sizeBucketRaw =
    feature.get("sizeBucket") ??
    feature.get("size_bucket") ??
    feature.get("sb");
  const opacityBucketRaw =
    feature.get("opacityBucket") ??
    feature.get("opacity_bucket") ??
    feature.get("ob");
  const sizeRaw = feature.get("size");
  const opacityRaw = feature.get("opacity");

  const colorIndex = clamp(Math.floor(Number(colorRaw) || 0), 0, 99);
  const sizeBucket = Number.isFinite(Number(sizeBucketRaw))
    ? clamp(Math.floor(Number(sizeBucketRaw)), 0, 20)
    : clamp(
        Math.round(
          ((clamp(Number(sizeRaw) || 0.8, 0.1, 1.5) - 0.1) / (1.5 - 0.1)) * 20,
        ),
        0,
        20,
      );
  const opacityBucket = Number.isFinite(Number(opacityBucketRaw))
    ? clamp(Math.floor(Number(opacityBucketRaw)), 0, 5)
    : clamp(Math.round((Number(opacityRaw) || 0.8) * 5), 0, 5);
  return { colorIndex, sizeBucket, opacityBucket };
}

function getGlowPointStyle(feature) {
  const { colorIndex, sizeBucket, opacityBucket } = getGlowStyleMeta(feature);
  const key = `${colorIndex}-${sizeBucket}-${opacityBucket}`;
  // if (glowStyleCache.has(key)) return glowStyleCache.get(key);

  const icon = new Icon({
    src: glowThemeSpriteUrls[colorIndex % glowThemeSpriteUrls.length],
    opacity: getOpacityByBucket(opacityBucket),
    scale: getBaseScaleByBucket(sizeBucket),
  });
  const style = new Style({ image: icon });
  glowStyleCache.set(key, style);
  return style;
}

const glowPointLayer = new VectorLayer({
  source: glowPointSource,
  updateWhileAnimating: false,
  updateWhileInteracting: false,
  style: (feature) => getGlowPointStyle(feature),
});
glowPointLayer.setZIndex(20);

function getBufferedViewportExtent(mapInstance, ratio = 0.25) {
  const size = mapInstance.getSize();
  const view = mapInstance.getView();
  if (!size || !view) return null;
  const extent = view.calculateExtent(size);
  const w = extent[2] - extent[0];
  const h = extent[3] - extent[1];
  return [
    extent[0] - w * ratio,
    extent[1] - h * ratio,
    extent[2] + w * ratio,
    extent[3] + h * ratio,
  ];
}

function getLodSettingsByZoom(zoomRaw) {
  const zoom = Number.isFinite(zoomRaw) ? zoomRaw : 8;
  // 连续缩放驱动 LOD，不强制取整
  const maxTier = clamp(zoom - lodBaseZoom + 1, 0, Math.max(0, lodLevels - 1));
  return { maxTier, zoom };
}

const GLOW_WORKER_COUNT = 1;
const glowWorkers = Array.from(
  { length: GLOW_WORKER_COUNT },
  () =>
    new Worker(new URL("./workers/glow-points.worker.js", import.meta.url), {
      type: "module",
    }),
);
const glowWorkerReqIds = new Array(GLOW_WORKER_COUNT).fill(0);
const glowWorkerPending = new globalThis.Map();
let viewportQueryToken = 0;
let lastZoomInt = null;
const queryResultCache = new globalThis.Map();
const QUERY_CACHE_MAX = 18;
const mapHostEl = document.getElementById("map");
// const infoPanel = createInfoPanel(mapHostEl);
const projectFeatureItems = [
  "实现星空背景",
  "实现面的云雾噪声纹理",
  "实现星空光点加载，带光晕和随机射线，实现点的 LOD 分级加载",
  "实现军事标绘（28种）",
  "实现面的自定义填充（斜线、网格线等，参数可配）",
  "支撑海量点快速交互性能，考虑采用矢量瓦片格式，笔记本可支持1000万点",
];
// createProjectFeatureCard(mapHostEl, projectFeatureItems);

function updateInfoPanel(mapInstance) {
  // const zoom = mapInstance.getView().getZoom();
  // const zoomSafe = Number.isFinite(zoom) ? zoom : 0;
  // const tileZ = Math.max(0, Math.floor(zoomSafe));
  // const lod = getLodSettingsByZoom(zoom);
  // const lodRule = getLodRuleByZoom(zoomSafe);
  // const sr = glowWorkerInitMeta.sizeRange || { min: 0.1, max: 1.5 };
  // const visible = visibleGlowFeatureMap.size;
  // infoPanel.textContent =
  //   `缩放等级: ${Number.isFinite(zoom) ? zoom.toFixed(2) : "-"}\n` +
  //   `瓦片级别: ${tileZ}\n` +
  //   `LOD层级: ${lod.maxTier + 1}/${lodLevels}\n` +
  //   `尺寸范围: ${sr.min.toFixed(2)} ~ ${sr.max.toFixed(2)}\n` +
  //   `LOD规则: [${lodRule.minSize.toFixed(2)}, ${lodRule.maxSize.toFixed(2)}]\n` +
  //   `当前可见点: ${visible}\n` +
  //   `候选点数: ${lastQueryStats.candidateCount}\n` +
  //   `缓存命中: ${lastQueryStats.cacheHits}/${lastQueryStats.cacheHits + lastQueryStats.cacheMisses} (${(lastQueryStats.hitRate * 100).toFixed(1)}%)\n` +
  //   `点数据量: ${glowWorkerInitMeta.total}/${glowWorkerInitMeta.targetTotal}`;
}

glowWorkers.forEach((w, workerIdx) => {
  w.onmessage = (evt) => {
    const { id, ok, data, error } = evt.data || {};
    const key = `${workerIdx}:${id}`;
    if (!glowWorkerPending.has(key)) return;
    const p = glowWorkerPending.get(key);
    glowWorkerPending.delete(key);
    if (ok) p.resolve(data);
    else p.reject(new Error(error || "worker_error"));
  };
});

function callGlowWorker(workerIdx, action, payload) {
  const id = ++glowWorkerReqIds[workerIdx];
  const key = `${workerIdx}:${id}`;
  return new Promise((resolve, reject) => {
    glowWorkerPending.set(key, { resolve, reject });
    glowWorkers[workerIdx].postMessage({ id, action, payload });
  });
}

function createFeatureFromWorkerPoint(p) {
  const f = new Feature(new Point([p.x, p.y]));
  f.set("pointId", p.id, true);
  f.set("colorIndex", p.colorIndex, true);
  f.set("sizeBucket", p.sizeBucket, true);
  f.set("opacityBucket", p.opacityBucket, true);
  return f;
}

function applyGlowViewportDiff(diff) {
  const removeIds = Array.isArray(diff?.removeIds) ? diff.removeIds : [];
  for (const id of removeIds) {
    const f = visibleGlowFeatureMap.get(id);
    if (f) {
      glowPointSource.removeFeature(f);
      visibleGlowFeatureMap.delete(id);
    }
  }

  const addPoints = Array.isArray(diff?.addPoints) ? diff.addPoints : [];
  const updatePoints = Array.isArray(diff?.updatePoints)
    ? diff.updatePoints
    : [];

  for (const upd of updatePoints) {
    const f = visibleGlowFeatureMap.get(upd.id);
    if (!f) continue;
    if (Number.isFinite(upd.sizeBucket))
      f.set("sizeBucket", upd.sizeBucket, true);
    if (Number.isFinite(upd.opacityBucket))
      f.set("opacityBucket", upd.opacityBucket, true);
  }
  if (!addPoints.length) return;
  const newFeatures = [];
  for (const p of addPoints) {
    if (visibleGlowFeatureMap.has(p.id)) continue;
    const f = createFeatureFromWorkerPoint(p);
    visibleGlowFeatureMap.set(p.id, f);
    newFeatures.push(f);
  }
  if (newFeatures.length) {
    glowPointSource.addFeatures(newFeatures);
  }
}

function extentToTiles(extent, z) {
  const n = Math.pow(2, z);
  const world = 2 * WEB_MERCATOR_HALF;
  const xMin = clamp(
    Math.floor(((extent[0] + WEB_MERCATOR_HALF) / world) * n),
    0,
    n - 1,
  );
  const xMax = clamp(
    Math.floor(((extent[2] + WEB_MERCATOR_HALF) / world) * n),
    0,
    n - 1,
  );
  const yMin = clamp(
    Math.floor(((WEB_MERCATOR_HALF - extent[3]) / world) * n),
    0,
    n - 1,
  );
  const yMax = clamp(
    Math.floor(((WEB_MERCATOR_HALF - extent[1]) / world) * n),
    0,
    n - 1,
  );
  const xxMin = Math.min(xMin, xMax);
  const xxMax = Math.max(xMin, xMax);
  const yyMin = Math.min(yMin, yMax);
  const yyMax = Math.max(yMin, yMax);
  const tiles = [];
  for (let x = xxMin; x <= xxMax; x++) {
    for (let y = yyMin; y <= yyMax; y++) {
      tiles.push({ z, x, y });
    }
  }
  return tiles;
}

function hashTileToWorkerIdx(tile) {
  const h =
    ((tile.z * 73856093) ^ (tile.x * 19349663) ^ (tile.y * 83492791)) >>> 0;
  return h % GLOW_WORKER_COUNT;
}

function partitionTilesForWorkers(tiles) {
  const groups = Array.from({ length: GLOW_WORKER_COUNT }, () => []);
  for (const t of tiles) {
    groups[hashTileToWorkerIdx(t)].push(t);
  }
  return groups;
}

function makeQueryCacheKey(tiles, lodRule) {
  const tilesKey = tiles
    .map((t) => `${t.z}/${t.x}/${t.y}`)
    .sort()
    .join(",");
  return `${lodRule.minSize.toFixed(3)}|${lodRule.maxSize.toFixed(3)}|${tilesKey}`;
}

function putQueryCache(key, diff) {
  if (queryResultCache.has(key)) queryResultCache.delete(key);
  queryResultCache.set(key, diff);
  if (queryResultCache.size > QUERY_CACHE_MAX) {
    const firstKey = queryResultCache.keys().next().value;
    if (firstKey) queryResultCache.delete(firstKey);
  }
}

function mergeWorkerDiffs(diffs) {
  const merged = {
    addPoints: [],
    removeIds: [],
    updatePoints: [],
    stats: {
      cacheHits: 0,
      cacheMisses: 0,
      hitRate: 0,
      candidateCount: 0,
      visibleCount: 0,
    },
  };
  for (const d of diffs) {
    if (!d) continue;
    if (Array.isArray(d.addPoints)) merged.addPoints.push(...d.addPoints);
    if (Array.isArray(d.removeIds)) merged.removeIds.push(...d.removeIds);
    if (Array.isArray(d.updatePoints))
      merged.updatePoints.push(...d.updatePoints);
    if (d.stats) {
      merged.stats.cacheHits += Number(d.stats.cacheHits) || 0;
      merged.stats.cacheMisses += Number(d.stats.cacheMisses) || 0;
      merged.stats.candidateCount += Number(d.stats.candidateCount) || 0;
      merged.stats.visibleCount += Number(d.stats.visibleCount) || 0;
    }
  }
  const q = merged.stats.cacheHits + merged.stats.cacheMisses;
  merged.stats.hitRate = q > 0 ? merged.stats.cacheHits / q : 0;
  return merged;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function getLodRuleByZoom(zoom) {
  // 连续规则：zoom 越大，允许更小尺寸，步长更细
  const z = clamp(zoom, 8, 14);
  const t = (z - 8) / (14 - 8);
  const minSize = lerp(1.4, 0.1, t);
  return { minSize, maxSize: 1.5 };
}

async function syncVisibleGlowPointsByWorker(mapInstance) {
  if (!glowDataReady) return;
  const extent = getBufferedViewportExtent(mapInstance, 0.25);
  if (!extent) return;
  const zoom = mapInstance.getView().getZoom();
  const lod = getLodSettingsByZoom(zoom);
  const lodRule = getLodRuleByZoom(lod.zoom);
  const tileZ = Math.max(0, Math.floor(lod.zoom));
  const tiles = extentToTiles(extent, tileZ);
  const zoomInt = Math.floor(Number.isFinite(zoom) ? zoom : 0);
  if (lastZoomInt !== null && zoomInt !== lastZoomInt) {
    // 整级变化时先清空显示，再进行增量回填
    glowPointSource.clear();
    visibleGlowFeatureMap.clear();
  }
  lastZoomInt = zoomInt;

  const cacheKey = makeQueryCacheKey(tiles, lodRule);
  const cachedDiff = queryResultCache.get(cacheKey);
  if (cachedDiff) {
    applyGlowViewportDiff(cachedDiff);
    if (cachedDiff.stats) {
      lastQueryStats = {
        cacheHits: Number(cachedDiff.stats.cacheHits) || 0,
        cacheMisses: Number(cachedDiff.stats.cacheMisses) || 0,
        hitRate: Number(cachedDiff.stats.hitRate) || 0,
        candidateCount: Number(cachedDiff.stats.candidateCount) || 0,
        visibleCount: Number(cachedDiff.stats.visibleCount) || 0,
      };
    }
    updateInfoPanel(mapInstance);
    return;
  }

  const tileGroups = partitionTilesForWorkers(tiles);
  const token = ++viewportQueryToken;
  try {
    const jobs = [];
    for (let i = 0; i < GLOW_WORKER_COUNT; i++) {
      if (!tileGroups[i].length) continue;
      jobs.push(
        callGlowWorker(i, "queryTiles", {
          tiles: tileGroups[i],
          lodMaxTier: lod.maxTier,
          lodRule,
        }),
      );
    }
    const parts = await Promise.all(jobs);
    const res = mergeWorkerDiffs(parts);
    if (token !== viewportQueryToken) return;
    putQueryCache(cacheKey, res);
    if (res?.stats) {
      lastQueryStats = {
        cacheHits: Number(res.stats.cacheHits) || 0,
        cacheMisses: Number(res.stats.cacheMisses) || 0,
        hitRate: Number(res.stats.hitRate) || 0,
        candidateCount: Number(res.stats.candidateCount) || 0,
        visibleCount: Number(res.stats.visibleCount) || 0,
      };
    }
    applyGlowViewportDiff(res);
    updateInfoPanel(mapInstance);
  } catch (err) {
    console.error("queryViewport failed:", err);
  }
}

function buildWorkerPolygonPayload(polygonSource) {
  const polygons = [];
  for (const polygonFeature of polygonSource.getFeatures()) {
    const geometry = polygonFeature.getGeometry();
    if (!geometry) continue;
    const type = geometry.getType();
    if (type !== "Polygon" && type !== "MultiPolygon") continue;
    polygons.push({
      type,
      coordinates: geometry.getCoordinates(),
    });
  }
  return polygons;
}

async function initGlowPointsWorker(polygonSource) {
  glowDataReady = false;
  viewportQueryToken++;
  glowPointSource.clear();
  glowStyleCache.clear();
  visibleGlowFeatureMap.clear();
  queryResultCache.clear();
  lastZoomInt = null;

  const polygons = buildWorkerPolygonPayload(polygonSource);
  if (!polygons.length) {
    glowDataReady = true;
    return;
  }
  const initPayload = {
    polygons,
    pyramid: {
      // 2^10 * (2^14 - 1) = 16,776,192（千万量级）
      levels: 14,
    },
    // 更平衡的默认量级：低缩放可见性和交互性能折中
    totalPoints: 100000,
    sizeRange: { min: 0.1, max: 1.5 },
    seedBase: 4096.73,
  };
  const initResults = await Promise.all(
    glowWorkers.map((_, i) => callGlowWorker(i, "init", initPayload)),
  );
  const res = initResults[0] || {};
  const levels = Number(res?.data?.levels);
  lodLevels = Number.isFinite(levels) && levels > 0 ? levels : 10;
  glowWorkerInitMeta = {
    total: Number(res?.data?.total) || 0,
    targetTotal: Number(res?.data?.targetTotal) || 0,
    levels: lodLevels,
    sizeRange: res?.data?.sizeRange || { min: 0.1, max: 1.5 },
  };
  const sizeHistogram = Array.isArray(res?.data?.sizeHistogram)
    ? res.data.sizeHistogram
    : [];
  if (sizeHistogram.length) {
    console.log("点尺寸统计（0.1间隔）");
    console.table(sizeHistogram);
  }
  glowDataReady = true;
}

function startGlowPulseAnimation(mapInstance) {
  // 保留调用链，当前按性能优先不做逐帧动画更新
  mapInstance.render();
}

import { fromLonLat, get as getProjection } from "ol/proj.js";

/* ---------------------------
 * 地图
 * --------------------------- */
const map = new OLMap({
  target: "map",
  controls: defaultControls({ zoom: false }),
  layers: [
    // new TileLayer({
    //   // source: new OSM()
    // }),
    vectorLayer,
    // hatchLayer,
    // glowPointLayer,
    // new VectorTileLayer({
    //   source: new VectorTile({
    //     format: new MVT({
    //       layerName: "mapGrid", // 与 SQL 中 ST_AsMVT 的第二个参数对应
    //     }),
    //     url: "http://localhost:31300/gis/test/{z}/{x}/{y}.pbf",
    //     tileGrid: createXYZ({
    //       tileSize: 256,
    //       maxZoom: 20,
    //       minZoom: 12,
    //     }),
    //     preload: 1, // 预加载相邻层级，优化小数缩放体验
    //   }),
    //   style: (feature) => getGlowPointStyle(feature),
    //   updateWhileAnimating: true,
    //   updateWhileInteracting: false,
    // }),
  ],
  view: new View({
    center: fromLonLat([0, 0]),
    // center: [0,0],
    // extent: worldExtent,
    zoom: 0,
    wrapX: false,
    multiWorld: false,
    constrainOnlyCenter: true,
    showFullExtent: true,
    constrainResolution: false,
    smoothResolutionConstraint: true,
    smoothExtentConstraint: false,
    padding: [20, 20, 20, 20],
  }),
});

window.olmap = map;

// const { hoverEl, hoverOverlay } = createGlowHoverOverlay(map);

map.on("pointermove", (evt) => {
  // if (evt.dragging) {
  //   hoverEl.style.display = "none";
  //   map.getTargetElement().style.cursor = "";
  //   return;
  // }
  // const feature = map.forEachFeatureAtPixel(
  //   evt.pixel,
  //   (f, layer) => (layer === glowPointLayer ? f : null),
  //   { hitTolerance: 3 },
  // );
  // if (!feature) {
  //   hoverEl.style.display = "none";
  //   map.getTargetElement().style.cursor = "";
  //   return;
  // }
  // const geom = feature.getGeometry();
  // const coord = geom?.getCoordinates?.() || evt.coordinate;
  // const id = feature.get("pointId");
  // const sizeBucket = feature.get("sizeBucket");
  // const opacityBucket = feature.get("opacityBucket");
  // hoverEl.textContent = `点ID: ${id}  尺寸桶: ${sizeBucket}  透明桶: ${opacityBucket}`;
  // hoverEl.style.display = "block";
  // hoverOverlay.setPosition(coord);
  // map.getTargetElement().style.cursor = "pointer";
});

applyMapStarBackground(map);
startGlowPulseAnimation(map);

const plot = new Plot(map, { layerName: "plot-layer" });
let plotLayer = null;
function resolvePlotLayer() {
  if (plotLayer) return plotLayer;
  const layers = map.getLayers().getArray();
  plotLayer =
    layers.find(
      (l) =>
        l && typeof l.get === "function" && l.get("layerName") === "plot-layer",
    ) || null;
  return plotLayer;
}

const plotStyleConfig = {
  pointColor: "#4781d9",
  pointRadius: 7,
  pointStrokeColor: "#ffffff",
  pointStrokeWidth: 1,
  lineColor: "#4781d9",
  lineWidth: 2,
  polygonStrokeColor: "#4781d9",
  polygonStrokeWidth: 2,
  fillMode: "solid",
  fillColor: "#436eee",
  fillOpacity: 0.4,
  hatchType: "right",
  hatchSpacing: 18,
  hatchLineWidth: 1,
  hatchAngle: 45,
  hatchColor: "#b4cdeb",
  hatchOpacity: 0.38,
};

const PLOT_FEATURE_STYLE_PROP_MAP = {
  pointColor: "plotPointColor",
  pointRadius: "plotPointRadius",
  pointStrokeColor: "plotPointStrokeColor",
  pointStrokeWidth: "plotPointStrokeWidth",
  lineColor: "plotLineColor",
  lineWidth: "plotLineWidth",
  polygonStrokeColor: "plotPolygonStrokeColor",
  polygonStrokeWidth: "plotPolygonStrokeWidth",
  fillMode: "plotFillMode",
  fillColor: "plotFillColor",
  fillOpacity: "plotFillOpacity",
  hatchType: "plotHatchType",
  hatchSpacing: "plotHatchSpacing",
  hatchLineWidth: "plotHatchLineWidth",
  hatchAngle: "plotHatchAngle",
  hatchColor: "plotHatchColor",
  hatchOpacity: "plotHatchOpacity",
};

const plotStyleCache = new globalThis.Map();
let activePlotFeature = null;

function rgbaFromHex(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  const a = clamp(Number(alpha), 0, 1);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function resetPlotFeatureStyles() {
  const layer = resolvePlotLayer();
  const src = layer?.getSource?.();
  if (!src) return;
  const features = src.getFeatures();
  for (const f of features) f.setStyle(undefined);
}

function clearPlotStyleCache() {
  plotStyleCache.clear();
}

function getFeatureStyleConfig(feature) {
  if (!feature) return { ...plotStyleConfig };
  const merged = { ...plotStyleConfig };
  for (const [configKey, propKey] of Object.entries(
    PLOT_FEATURE_STYLE_PROP_MAP,
  )) {
    const v = feature.get(propKey);
    if (v !== undefined && v !== null && v !== "") merged[configKey] = v;
  }
  return merged;
}

function setFeatureStyleOverrides(feature, cfg) {
  if (!feature || !cfg) return;
  for (const [configKey, propKey] of Object.entries(
    PLOT_FEATURE_STYLE_PROP_MAP,
  )) {
    if (cfg[configKey] === undefined) continue;
    feature.set(propKey, cfg[configKey], true);
  }
}

function clearFeatureStyleOverrides(feature) {
  if (!feature) return;
  for (const propKey of Object.values(PLOT_FEATURE_STYLE_PROP_MAP)) {
    if (feature.get(propKey) !== undefined) feature.unset(propKey, true);
  }
}

let plotStyleFn = null;
function applyPlotLayerStyle(resetExisting = true) {
  const layer = resolvePlotLayer();
  if (!layer) return;
  clearPlotStyleCache();

  plotStyleFn = (feature) => {
    const geom = feature?.getGeometry?.();
    const t = geom?.getType?.() || "";
    const cfg = getFeatureStyleConfig(feature);
    const styleKey = `${t}|${JSON.stringify(cfg)}`;
    if (plotStyleCache.has(styleKey)) return plotStyleCache.get(styleKey);

    const pointColor = cfg.pointColor;
    const pointRadius = Math.max(1, Number(cfg.pointRadius) || 7);
    const pointStrokeColor = cfg.pointStrokeColor;
    const pointStrokeWidth = Math.max(0, Number(cfg.pointStrokeWidth) || 1);
    const lineColor = cfg.lineColor;
    const lineWidth = Math.max(0, Number(cfg.lineWidth) || 1);
    const polygonStrokeColor = cfg.polygonStrokeColor;
    const polygonStrokeWidth = Math.max(0, Number(cfg.polygonStrokeWidth) || 1);
    const fillMode = cfg.fillMode;
    const fillColor = rgbaFromHex(cfg.fillColor, cfg.fillOpacity);
    const hatchColor = rgbaFromHex(cfg.hatchColor, cfg.hatchOpacity);
    const hatchType = cfg.hatchType;
    const hatchSpacing = Number(cfg.hatchSpacing) || 18;
    const hatchLineWidth = Number(cfg.hatchLineWidth) || 1;
    const hatchAngle = Number(cfg.hatchAngle) || 0;

    let style;
    if (t === "Point" || t === "MultiPoint") {
      style = new Style({
        image: new CircleStyle({
          radius: pointRadius,
          fill: new Fill({ color: pointColor }),
          stroke: new Stroke({
            color: pointStrokeColor,
            width: pointStrokeWidth,
          }),
        }),
      });
    } else if (t === "LineString" || t === "MultiLineString") {
      style = new Style({
        stroke: new Stroke({ color: lineColor, width: lineWidth }),
      });
    } else if (fillMode === "hatch") {
      style = new Style({
        renderer: (coordinates, state) => {
          const ctx = state.context;
          const bounds = getPixelBounds(coordinates);
          const x = bounds.minX;
          const y = bounds.minY;
          const w = Math.max(1, bounds.maxX - bounds.minX);
          const h = Math.max(1, bounds.maxY - bounds.minY);

          ctx.save();
          ctx.beginPath();
          drawPathFromCoordinates(ctx, coordinates);
          if (fillMode !== "none") {
            ctx.fillStyle = fillColor;
            ctx.fill("evenodd");
          }
          ctx.clip("evenodd");

          const pattern = getHatchFillPattern(ctx, {
            type: hatchType,
            spacing: hatchSpacing,
            lineWidth: hatchLineWidth,
            color: hatchColor,
          });
          if (pattern) {
            ctx.fillStyle = pattern;
            if (hatchAngle) {
              const cx = x + w * 0.5;
              const cy = y + h * 0.5;
              const rad = (hatchAngle * Math.PI) / 180;
              ctx.translate(cx, cy);
              ctx.rotate(rad);
              ctx.translate(-cx, -cy);
            }
            const pad = Math.max(w, h);
            ctx.fillRect(x - pad, y - pad, w + pad * 2, h + pad * 2);
          }
          ctx.restore();

          ctx.save();
          ctx.beginPath();
          drawPathFromCoordinates(ctx, coordinates);
          ctx.strokeStyle = polygonStrokeColor;
          ctx.lineWidth = polygonStrokeWidth;
          ctx.stroke();
          ctx.restore();
        },
        hitDetectionRenderer: (coordinates, state) => {
          const ctx = state.context;
          ctx.save();
          ctx.beginPath();
          drawPathFromCoordinates(ctx, coordinates);
          ctx.fillStyle = "#000";
          ctx.fill("evenodd");
          ctx.restore();
        },
      });
    } else {
      style = new Style({
        fill: fillMode === "none" ? undefined : new Fill({ color: fillColor }),
        stroke: new Stroke({
          color: polygonStrokeColor,
          width: polygonStrokeWidth,
        }),
      });
    }
    plotStyleCache.set(styleKey, style);
    return style;
  };
  layer.setStyle(plotStyleFn);
  if (resetExisting) resetPlotFeatureStyles();
  layer.changed();
}

const plotTypeLabelByValue = new globalThis.Map([
  ["TextArea", "文本框"],
  ["Arc", "弓形/圆弧线"],
  ["Curve", "曲线"],
  ["GatheringPlace", "集结地"],
  ["Polyline", "折线"],
  ["FreeHandLine", "自由线"],
  ["Point", "点"],
  ["Pennant", "燕尾旗"],
  ["RectAngle", "矩形"],
  ["Circle", "圆"],
  ["Ellipse", "椭圆"],
  ["Lune", "弓形面"],
  ["Sector", "扇形"],
  ["ClosedCurve", "闭合曲线面"],
  ["Polygon", "多边形"],
  ["FreePolygon", "自由面"],
  ["AttackArrow", "进攻方向箭头"],
  ["DoubleArrow", "双箭头"],
  ["StraightArrow", "细直箭头"],
  ["FineArrow", "尖头箭头"],
  ["AssaultDirection", "粗单直箭头"],
  ["TailedSquadCombat", "分队战斗行动（尾）"],
  ["TailedAttackArrow", "进攻方向（尾）"],
  ["SquadCombat", "分队战斗行动"],
  ["RectFlag", "矩形旗"],
  ["TriangleFlag", "三角旗"],
  ["CurveFlag", "曲线旗"],
  ["RectInclined1", "斜矩形1"],
  ["RectInclined2", "斜矩形2"],
]);

function getPlotTypeLabel(typeValue) {
  return plotTypeLabelByValue.get(typeValue) || String(typeValue || "-");
}

const allPlotTypes = Object.entries(Plot.PlotTypes)
  .map(([k, v]) => ({ key: k, value: v }))
  .filter((it) => typeof it.value === "string" && it.value.length > 0)
  .sort((a, b) => a.key.localeCompare(b.key));

function applyStyleToActiveFeature() {
  if (!activePlotFeature) return;
  setFeatureStyleOverrides(activePlotFeature, plotStyleConfig);
  clearPlotStyleCache();
  resolvePlotLayer()?.changed();
}

function clearActiveFeatureStyle() {
  if (!activePlotFeature) return;
  clearFeatureStyleOverrides(activePlotFeature);
  clearPlotStyleCache();
  resolvePlotLayer()?.changed();
}

let plotUi = null;
// plotUi = createPlotUi({
//   mapHostEl,
//   plotTypes: allPlotTypes,
//   getPlotTypeLabel,
//   styleConfig: plotStyleConfig,
//   initialPlotType: Plot.PlotTypes.ATTACK_ARROW,
//   onStyleChange: () => applyPlotLayerStyle(true),
//   onApplyStyle: () => applyPlotLayerStyle(true),
//   onApplyToFeature: () => applyStyleToActiveFeature(),
//   onClearFeatureStyle: () => clearActiveFeatureStyle(),
//   onStartDraw: (typeValue) => {
//     if (!typeValue) return;
//     plot.plotDraw.activate(typeValue);
//   },
//   onStopDraw: () => {
//     plot.plotDraw.deactivate();
//     plot.plotEdit.deactivate();
//     plotUi?.setPlotStatus("状态: 空闲");
//   },
//   onClearDraw: () => {
//     plot.plotDraw.deactivate();
//     plot.plotEdit.deactivate();
//     plot.plotUtils.removeAllFeatures();
//     plotUi?.setPlotStatus("状态: 空闲");
//   },
// });
applyPlotLayerStyle(true);

function hideFeatureMenu() {
  plotUi?.hideFeatureMenu();
}

function showFeatureMenu(x, y, feature) {
  activePlotFeature = feature || null;
  plotUi?.showFeatureMenu(x, y);
}

plot.plotDraw.on("drawStart", (e) => {
  const t = e?.plotType || "-";
  plotUi?.setPlotStatus(`状态: 绘制中（${getPlotTypeLabel(t)}）`);
});
plot.plotDraw.on("drawEnd", (e) => {
  const f = e?.feature;
  if (f) {
    activePlotFeature = f;
    plot.plotEdit.activate(f);
  }
  plotUi?.setPlotStatus("状态: 空闲");
});

map.on("singleclick", (evt) => {
  hideFeatureMenu();
  const layer = resolvePlotLayer();
  if (!layer) return;
  const picked = map.forEachFeatureAtPixel(
    evt.pixel,
    (f, l) => (l === layer ? f : null),
    {
      hitTolerance: 4,
    },
  );
  activePlotFeature = picked || null;
  if (picked) plot.plotEdit.activate(picked);
});

map.getViewport().addEventListener("contextmenu", (evt) => {
  evt.preventDefault();
  const layer = resolvePlotLayer();
  if (!layer) {
    hideFeatureMenu();
    return;
  }
  const pixel = map.getEventPixel(evt);
  const picked = map.forEachFeatureAtPixel(
    pixel,
    (f, l) => (l === layer ? f : null),
    {
      hitTolerance: 4,
    },
  );
  if (!picked) {
    hideFeatureMenu();
    return;
  }
  plot.plotEdit.activate(picked);
  showFeatureMenu(evt.clientX, evt.clientY, picked);
});

let lodUpdateRaf = 0;
let constrainedDataExtent = null;

function clampViewCenterToExtent(view, extent) {
  if (!view || !extent) return;
  const c = view.getCenter();
  if (!c || c.length < 2) return;
  const x = clamp(c[0], extent[0], extent[2]);
  const y = clamp(c[1], extent[1], extent[3]);
  if (x !== c[0] || y !== c[1]) {
    view.setCenter([x, y]);
  }
}

function applyDataExtentConstraint(extent) {
  if (!extent || !extent.every(Number.isFinite)) return;
  constrainedDataExtent = extent.slice();
  const view = map.getView();
  view.setExtent(constrainedDataExtent);
  // 立即夹回，避免当前中心已经在边界外
  clampViewCenterToExtent(view, constrainedDataExtent);
}

map.getView().on("change:resolution", () => {
  if (lodUpdateRaf) return;
  lodUpdateRaf = requestAnimationFrame(() => {
    lodUpdateRaf = 0;
    syncVisibleGlowPointsByWorker(map);
    updateInfoPanel(map);
  });
});
map.on("moveend", () => {
  if (constrainedDataExtent) {
    clampViewCenterToExtent(map.getView(), constrainedDataExtent);
  }
  syncVisibleGlowPointsByWorker(map);
  updateInfoPanel(map);
});

map.getView().on("change:center", () => {
  if (!constrainedDataExtent) return;
  clampViewCenterToExtent(map.getView(), constrainedDataExtent);
});

// 数据加载后自动定位到 beijing.geojson
source.once("featuresloadend", async () => {
  const extent = source.getExtent();
  if (extent && extent.every(Number.isFinite)) {
    const view = map.getView();
    // 锁定可视范围：平移中心点不能超出数据边界
    applyDataExtentConstraint(extent);
    const mapSize = map.getSize();
    let fitZoom = 8;
    if (mapSize) {
      // 最小缩放等级锁定为 fit 等级
      const fitResolution = view.getResolutionForExtent(extent, mapSize);
      const fitZoomRaw = view.getZoomForResolution(fitResolution);
      fitZoom = Number.isFinite(fitZoomRaw) ? Math.min(fitZoomRaw, 12) : 8;
      view.setMinZoom(fitZoom);
      lodBaseZoom = fitZoom;
    }

    // Worker 一次性初始化并集点数据（金字塔分层）
    await initGlowPointsWorker(source);

    map.getView().fit(extent, {
      padding: [30, 30, 30, 30],
      duration: 0,
      maxZoom: 12,
    });
    // 初始化完成后立即请求首屏数据
    syncVisibleGlowPointsByWorker(map);
    updateInfoPanel(map);
  }
});

window.__map = map;
window.__plot = plot;
