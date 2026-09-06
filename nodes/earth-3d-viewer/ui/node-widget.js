/**
 * earth-3d-viewer 自定义 UI 组件（module 模式，ui.apiVersion: 1）
 *
 * 渲染可交互 3D 地球：
 *  - NASA Blue Marble 真实地表贴图（内嵌 base64，离线可用）
 *  - 昼夜混合 shader：晨昏线位置由真实太阳直射点决定，夜间显示城市灯光
 *  - 太阳光照与真实世界一致：每秒按 UTC 时间重算太阳直射点（低精度天文模型，误差 <0.1°）
 *  - 实时气象卫星云图（clouds.matteason.co.uk，~3h 更新，30min 自动刷新；失败自动回退内嵌静态云图）
 *  - 大气边缘辉光 + 星空背景 + 相机自动环绕（旋转相机而非地球，保持日地几何真实）
 *
 * 契约：默认导出 mount(el, props) => { update(props), unmount() }
 */

import * as THREE from './three.module.min.js'
import { TEX } from './textures.js'

const CLOUD_LIVE_URL = 'https://clouds.matteason.co.uk/images/2048x1024/clouds.jpg'
const CLOUD_REFRESH_MS = 30 * 60 * 1000

const STATUS_COLORS = {
  idle: '#94a3b8',
  running: '#22d3ee',
  success: '#34d399',
  failed: '#fb7185',
  skipped: '#64748b',
}

const DEFAULT_CFG = {
  autoRotate: true,
  rotationSpeed: 2,
  cameraLat: 25,
  cameraLon: 110,
  cloudOpacity: 0.85,
}

/** 太阳直射点（subsolar point）：低精度模型，J2000 起算 */
function subsolarPoint(date) {
  const d = (date.getTime() - 946728000000) / 86400000
  const D2R = Math.PI / 180
  const L = 280.46 + 0.9856474 * d
  let g = (357.528 + 0.9856003 * d) % 360
  if (g < 0) g += 360
  const lambda = L + 1.915 * Math.sin(g * D2R) + 0.02 * Math.sin(2 * g * D2R)
  const eps = 23.439 - 0.0000004 * d
  const decl = Math.asin(Math.sin(eps * D2R) * Math.sin(lambda * D2R)) / D2R
  let ra = Math.atan2(Math.cos(eps * D2R) * Math.sin(lambda * D2R), Math.cos(lambda * D2R)) / D2R
  if (ra < 0) ra += 360
  let gmst = ((18.697374558 + 24.06570982441908 * d) * 15) % 360
  if (gmst < 0) gmst += 360
  let lon = ra - gmst
  while (lon > 180) lon -= 360
  while (lon < -180) lon += 360
  return { lat: decl, lon }
}

/** 经纬度 → three.js 球面世界坐标（与 SphereGeometry + equirect 贴图严格对齐） */
function lonLatToVec3(lonDeg, latDeg, r, out) {
  const lon = (lonDeg * Math.PI) / 180
  const lat = (latDeg * Math.PI) / 180
  return (out || new THREE.Vector3()).set(
    r * Math.cos(lat) * Math.cos(lon),
    r * Math.sin(lat),
    -r * Math.cos(lat) * Math.sin(lon)
  )
}

const isTemplate = (v) => typeof v === 'string' && v.indexOf('{{') >= 0

function parseConfig(props) {
  let base = { ...DEFAULT_CFG }
  const raw = props && props.outputs && props.outputs.config
  if (typeof raw === 'string' && raw.trim().startsWith('{')) {
    try {
      base = { ...base, ...JSON.parse(raw) }
    } catch { /* fallthrough */ }
  }
  // 画布参数（config.params）优先于运行时输出：编辑态调整后即时生效，
  // 模板接线值（{{ ... }}）不解析，保持现有配置
  const p = (props && props.params) || {}
  const num = (v, d) => { const n = parseFloat(v); return isNaN(n) ? d : n }
  if (p.auto_rotate !== undefined && !isTemplate(p.auto_rotate)) base.autoRotate = p.auto_rotate !== 'false'
  if (p.rotation_speed !== undefined && !isTemplate(p.rotation_speed)) base.rotationSpeed = num(p.rotation_speed, base.rotationSpeed)
  if (p.camera_lat !== undefined && !isTemplate(p.camera_lat)) base.cameraLat = num(p.camera_lat, base.cameraLat)
  if (p.camera_lon !== undefined && !isTemplate(p.camera_lon)) base.cameraLon = num(p.camera_lon, base.cameraLon)
  if (p.cloud_opacity !== undefined && !isTemplate(p.cloud_opacity)) base.cloudOpacity = num(p.cloud_opacity, base.cloudOpacity)
  return base
}

const EARTH_VERT = /* glsl */ `
  varying vec3 vNormal;
  varying vec2 vUv;
  varying vec3 vWorldPos;
  void main() {
    vNormal = normalize(mat3(modelMatrix) * normal);
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`

const EARTH_FRAG = /* glsl */ `
  uniform sampler2D dayMap;
  uniform sampler2D nightMap;
  uniform sampler2D specMap;
  uniform vec3 sunDir;
  varying vec3 vNormal;
  varying vec2 vUv;
  varying vec3 vWorldPos;
  void main() {
    vec3 n = normalize(vNormal);
    float ndl = dot(n, sunDir);
    float daylight = clamp(ndl, 0.0, 1.0);
    float dayMix = smoothstep(-0.12, 0.22, ndl);
    vec3 dayCol = texture2D(dayMap, vUv).rgb * (0.12 + 1.05 * daylight);
    vec3 nightCol = texture2D(nightMap, vUv).rgb * 0.9;
    vec3 col = mix(nightCol, dayCol, dayMix);
    // 海洋镜面反射（太阳耀斑）
    float spec = texture2D(specMap, vUv).r;
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    vec3 h = normalize(sunDir + viewDir);
    col += spec * pow(max(dot(n, h), 0.0), 28.0) * daylight * vec3(0.9, 0.85, 0.7) * 0.6;
    gl_FragColor = vec4(col, 1.0);
  }
`

const CLOUD_FRAG = /* glsl */ `
  uniform sampler2D cloudMap;
  uniform vec3 sunDir;
  uniform float opacity;
  uniform float useLuma;
  varying vec3 vNormal;
  varying vec2 vUv;
  void main() {
    vec4 t = texture2D(cloudMap, vUv);
    float luma = dot(t.rgb, vec3(0.299, 0.587, 0.114));
    float a = mix(t.a, luma, useLuma);
    if (a < 0.02) discard;
    vec3 n = normalize(vNormal);
    float ndl = dot(n, sunDir);
    float lit = 0.10 + 0.95 * smoothstep(-0.18, 0.35, ndl);
    vec3 col = mix(t.rgb, vec3(1.0), useLuma) * lit;
    gl_FragColor = vec4(col, a * opacity);
  }
`

const ATMO_VERT = /* glsl */ `
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const ATMO_FRAG = /* glsl */ `
  varying vec3 vNormal;
  void main() {
    float intensity = pow(0.66 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.5);
    gl_FragColor = vec4(0.35, 0.62, 1.0, 1.0) * intensity;
  }
`

export default function mount(el, props) {
  let cfg = parseConfig(props)
  let currentProps = props
  let disposed = false
  let raf = 0
  let lastInteraction = 0

  el.style.cssText = 'position:relative;width:100%;height:100%;background:radial-gradient(ellipse at 50% 40%, #0b1026 0%, #030408 70%);border-radius:10px;overflow:hidden'

  // ---------- three.js 场景 ----------
  const width = el.clientWidth || 420
  const height = el.clientHeight || 360
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(width, height)
  renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block'
  el.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 200)

  const loader = new THREE.TextureLoader()
  loader.setCrossOrigin('anonymous')
  const dayTex = loader.load(TEX.day)
  const nightTex = loader.load(TEX.night)
  const specTex = loader.load(TEX.specular)
  const cloudsFallbackTex = loader.load(TEX.clouds)

  // 地球（自定义昼夜混合 shader）
  const earthMat = new THREE.ShaderMaterial({
    uniforms: {
      dayMap: { value: dayTex },
      nightMap: { value: nightTex },
      specMap: { value: specTex },
      sunDir: { value: new THREE.Vector3(1, 0, 0) },
    },
    vertexShader: EARTH_VERT,
    fragmentShader: EARTH_FRAG,
  })
  const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 72, 72), earthMat)
  scene.add(earth)

  // 云层
  const cloudMat = new THREE.ShaderMaterial({
    uniforms: {
      cloudMap: { value: cloudsFallbackTex },
      sunDir: { value: new THREE.Vector3(1, 0, 0) },
      opacity: { value: cfg.cloudOpacity },
      useLuma: { value: 0 },
    },
    vertexShader: EARTH_VERT,
    fragmentShader: CLOUD_FRAG,
    transparent: true,
    depthWrite: false,
  })
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(1.012, 64, 64), cloudMat)
  scene.add(clouds)

  // 大气辉光（背面球体 + fresnel）
  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(1.03, 64, 64),
    new THREE.ShaderMaterial({
      vertexShader: ATMO_VERT,
      fragmentShader: ATMO_FRAG,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
    })
  )
  scene.add(atmo)

  // 星空背景
  {
    const N = 1200
    const pos = new Float32Array(N * 3)
    const v = new THREE.Vector3()
    for (let i = 0; i < N; i++) {
      v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1)
        .normalize()
        .multiplyScalar(60 + Math.random() * 30)
      pos.set([v.x, v.y, v.z], i * 3)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const stars = new THREE.Points(
      g,
      new THREE.PointsMaterial({ color: 0xffffff, size: 0.55, sizeAttenuation: false, transparent: true, opacity: 0.7 })
    )
    scene.add(stars)
  }

  // ---------- 相机轨道（自研轻量 orbit，避免引入 OrbitControls 依赖） ----------
  const sph = new THREE.Spherical().setFromVector3(
    lonLatToVec3(cfg.cameraLon, cfg.cameraLat, 3.1)
  )
  camera.position.setFromSpherical(sph)
  camera.lookAt(0, 0, 0)

  const cvs = renderer.domElement
  let dragging = false
  let px = 0
  let py = 0
  const onDown = (e) => {
    dragging = true
    px = e.clientX
    py = e.clientY
    lastInteraction = performance.now()
    cvs.setPointerCapture && e.pointerId != null && cvs.setPointerCapture(e.pointerId)
  }
  const onMove = (e) => {
    if (!dragging) return
    const dx = e.clientX - px
    const dy = e.clientY - py
    px = e.clientX
    py = e.clientY
    sph.theta -= dx * 0.005
    sph.phi = Math.min(Math.PI - 0.15, Math.max(0.15, sph.phi - dy * 0.005))
    lastInteraction = performance.now()
  }
  const onUp = () => { dragging = false }
  const onWheel = (e) => {
    e.preventDefault()
    sph.radius = Math.min(7, Math.max(1.7, sph.radius * (1 + Math.sign(e.deltaY) * 0.08)))
    lastInteraction = performance.now()
  }
  cvs.addEventListener('pointerdown', onDown)
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  cvs.addEventListener('wheel', onWheel, { passive: false })

  // ---------- HUD ----------
  const hud = document.createElement('div')
  hud.style.cssText = [
    'position:absolute', 'left:8px', 'top:8px', 'pointer-events:none',
    'font-family:ui-monospace,Menlo,Consolas,monospace', 'font-size:10px',
    'line-height:1.65', 'color:rgba(190,220,255,0.85)',
    'text-shadow:0 1px 3px rgba(0,0,0,0.9)', 'white-space:pre',
  ].join(';')
  el.appendChild(hud)

  const statusDot = document.createElement('div')
  statusDot.style.cssText = 'position:absolute;right:10px;top:10px;width:8px;height:8px;border-radius:50%;box-shadow:0 0 6px currentColor;pointer-events:none'
  el.appendChild(statusDot)

  const setStatus = (s) => {
    statusDot.style.background = STATUS_COLORS[s] || STATUS_COLORS.idle
    statusDot.style.color = STATUS_COLORS[s] || STATUS_COLORS.idle
  }
  setStatus(props.status || 'idle')

  // ---------- 参数控制面板（onParamsChange 契约） ----------
  const editable = () => typeof (currentProps && currentProps.onParamsChange) === 'function'
  const setParam = (key, value) => {
    if (!editable()) return
    const params = { ...((currentProps && currentProps.params) || {}), [key]: String(value) }
    currentProps = { ...currentProps, params }
    currentProps.onParamsChange(params)
  }

  const panelRefreshers = []
  const mkLabel = (t) => {
    const n = document.createElement('div')
    n.style.cssText = 'font-size:9px;color:rgba(190,220,255,0.5);margin:6px 0 2px'
    n.textContent = t
    return n
  }
  const mkSlider = (key, cfgKey, min, max, step, fmt, apply) => {
    const row = document.createElement('div')
    row.style.cssText = 'display:flex;align-items:center;gap:6px'
    const sl = document.createElement('input')
    sl.type = 'range'; sl.min = min; sl.max = max; sl.step = step
    sl.style.cssText = 'flex:1;accent-color:#60a5fa;margin:0;min-width:0'
    const val = document.createElement('span')
    val.style.cssText = 'font-size:9px;color:rgba(190,220,255,0.7);min-width:34px;text-align:right;font-family:ui-monospace,Menlo,monospace'
    sl.addEventListener('input', () => {
      const v = parseFloat(sl.value)
      val.textContent = fmt(v)
      apply(v)
    })
    sl.addEventListener('change', () => setParam(key, sl.value))
    panelRefreshers.push(() => {
      sl.disabled = !editable()
      sl.style.opacity = editable() ? '1' : '0.5'
      sl.value = String(cfg[cfgKey])
      val.textContent = fmt(cfg[cfgKey])
    })
    row.append(sl, val)
    return row
  }

  const gearBtn = document.createElement('button')
  gearBtn.textContent = '⚙'
  gearBtn.title = '视角与显示参数'
  gearBtn.style.cssText = 'position:absolute;right:8px;bottom:8px;width:26px;height:26px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(10,16,36,0.72);color:rgba(190,220,255,0.85);font-size:13px;cursor:pointer;backdrop-filter:blur(4px)'
  el.appendChild(gearBtn)

  const panel = document.createElement('div')
  panel.style.cssText = 'position:absolute;right:8px;bottom:40px;width:210px;padding:8px 10px;border-radius:10px;border:1px solid rgba(255,255,255,0.12);background:rgba(8,12,28,0.85);backdrop-filter:blur(6px);display:none;font-family:system-ui,sans-serif'

  // 自动旋转开关
  const rotateRow = document.createElement('label')
  rotateRow.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:10px;color:rgba(190,220,255,0.8);cursor:pointer'
  const rotateChk = document.createElement('input')
  rotateChk.type = 'checkbox'
  rotateChk.style.cssText = 'accent-color:#60a5fa;margin:0'
  rotateChk.addEventListener('change', () => {
    cfg.autoRotate = rotateChk.checked
    setParam('auto_rotate', rotateChk.checked ? 'true' : 'false')
  })
  rotateRow.append(rotateChk, document.createTextNode('自动环绕'))
  panelRefreshers.push(() => {
    rotateChk.disabled = !editable()
    rotateChk.checked = !!cfg.autoRotate
  })

  const applyCamera = () => {
    if (dragging) return
    sph.setFromVector3(lonLatToVec3(cfg.cameraLon, cfg.cameraLat, sph.radius))
  }
  panel.append(
    rotateRow,
    mkLabel('旋转速度（°/s）'),
    mkSlider('rotation_speed', 'rotationSpeed', 0, 20, 0.5, (v) => v.toFixed(1), (v) => { cfg.rotationSpeed = v }),
    mkLabel('相机纬度'),
    mkSlider('camera_lat', 'cameraLat', -80, 80, 1, (v) => v.toFixed(0) + '°', (v) => { cfg.cameraLat = v; applyCamera() }),
    mkLabel('相机经度'),
    mkSlider('camera_lon', 'cameraLon', -180, 180, 1, (v) => v.toFixed(0) + '°', (v) => { cfg.cameraLon = v; applyCamera() }),
    mkLabel('云层不透明度'),
    mkSlider('cloud_opacity', 'cloudOpacity', 0, 1, 0.05, (v) => v.toFixed(2), (v) => {
      cfg.cloudOpacity = v
      cloudMat.uniforms.opacity.value = v
    }),
  )
  el.appendChild(panel)
  gearBtn.addEventListener('click', () => {
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none'
  })

  // ---------- 实时云图 ----------
  let cloudSource = '离线云图'
  const loadLiveClouds = () => {
    if (disposed) return
    const url = CLOUD_LIVE_URL + '?t=' + Math.floor(Date.now() / CLOUD_REFRESH_MS)
    loader.load(
      url,
      (tex) => {
        if (disposed) return
        cloudMat.uniforms.cloudMap.value = tex
        cloudMat.uniforms.useLuma.value = 1
        cloudSource = '实时卫星云图'
      },
      undefined,
      () => { cloudSource = '离线云图' }
    )
  }
  loadLiveClouds()
  const cloudTimer = setInterval(loadLiveClouds, CLOUD_REFRESH_MS)

  // ---------- 渲染循环 ----------
  const sunVec = new THREE.Vector3()
  let lastSec = -1
  let sunLat = 0
  let sunLon = 0
  const clock = new THREE.Clock()

  const animate = () => {
    if (disposed) return
    raf = requestAnimationFrame(animate)
    const dt = clock.getDelta()

    // 相机自动环绕（旋转相机保持日地几何真实）
    if (cfg.autoRotate && !dragging && performance.now() - lastInteraction > 3000) {
      sph.theta += ((cfg.rotationSpeed * Math.PI) / 180) * dt
    }
    camera.position.setFromSpherical(sph)
    camera.lookAt(0, 0, 0)

    // 每秒重算真实太阳直射点
    const now = new Date()
    if (now.getSeconds() !== lastSec) {
      lastSec = now.getSeconds()
      const sp = subsolarPoint(now)
      sunLat = sp.lat
      sunLon = sp.lon
      lonLatToVec3(sunLon, sunLat, 1, sunVec).normalize()
      earthMat.uniforms.sunDir.value.copy(sunVec)
      cloudMat.uniforms.sunDir.value.copy(sunVec)
      cloudMat.uniforms.opacity.value = cfg.cloudOpacity

      const pad = (x) => String(x).padStart(2, '0')
      const fmtCoord = (v, pos, neg) =>
        `${Math.abs(v).toFixed(2)}°${v >= 0 ? pos : neg}`
      hud.textContent =
        `UTC ${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())} ` +
        `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}\n` +
        `太阳直射点 ${fmtCoord(sunLat, 'N', 'S')} ${fmtCoord(sunLon, 'E', 'W')}\n` +
        `云层 ${cloudSource}`
    }

    renderer.render(scene, camera)
  }
  animate()

  const onResize = () => {
    const w = el.clientWidth || width
    const h = el.clientHeight || height
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    renderer.setSize(w, h)
  }
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null
  ro && ro.observe(el)

  return {
    update(next) {
      currentProps = next
      cfg = parseConfig(next)
      setStatus((next && next.status) || 'idle')
      panelRefreshers.forEach((f) => f())
    },
    unmount() {
      disposed = true
      cancelAnimationFrame(raf)
      clearInterval(cloudTimer)
      ro && ro.disconnect()
      cvs.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      cvs.removeEventListener('wheel', onWheel)
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose()
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material]
          mats.forEach((m) => {
            Object.values(m.uniforms || {}).forEach((u) => u && u.value && u.value.isTexture && u.value.dispose())
            m.dispose()
          })
        }
      })
      renderer.dispose()
      el.innerHTML = ''
    },
  }
}
