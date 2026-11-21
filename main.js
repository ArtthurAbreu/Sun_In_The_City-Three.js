import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

// ===== Configuração =====
const TOTAL_ESFERAS = 5
const RAIO_COLETA = 2.5
const VEL_ESFERA = 5 // velocidade das esferas (o jogador chega a 30)
const VEL_MAX = 30 // unidades por segundo
const ACEL = 40
const GIRO = 2.5 // radianos por segundo
const ALTURA_MIN = 2.5 // altura mínima do robô
const ALTURA_MAX = 60

// ===== HUD =====
const $ = (id) => document.getElementById(id)
const hudPlacar = $('placar')
const hudTempo = $('tempo')
let placar = 0
let tempo = 0
let jogando = false

function atualizarPlacar() {
  hudPlacar.textContent = `Esferas: ${placar}/${TOTAL_ESFERAS}`
}
atualizarPlacar()

$('botao-proxima-fase').addEventListener('click', () => (location.href = 'index2.html'))
$('botao-reiniciar').addEventListener('click', () => location.reload())

function vencer() {
  jogando = false
  document.exitPointerLock()
  $('tempo-final').textContent = `${tempo.toFixed(1)} s`
  $('mensagem-vitoria').style.display = 'block'
}

// ===== Cena, câmera e renderizador =====
const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 1000)
camera.position.set(0, ALTURA_MIN, 0)
const jogador = new THREE.Vector3(0, ALTURA_MIN, 0) // posição real do robô (colisão e movimento)

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
document.body.appendChild(renderer.domElement)

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})

// Tela de carregamento: some quando texturas e modelos terminarem
const manager = new THREE.LoadingManager()
manager.onLoad = () => {
  $('carregando').style.display = 'none'
  jogando = true
}
const texLoader = new THREE.TextureLoader(manager)
const gltfLoader = new GLTFLoader(manager)

// ===== Chão e céu =====
const chao = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.MeshStandardMaterial({ color: 0x000000, side: THREE.DoubleSide })
)
chao.rotation.x = -Math.PI / 2
chao.receiveShadow = true
scene.add(chao)

const faces = ['ft', 'bk', 'up', 'dn', 'rt', 'lf']
const ceu = new THREE.Mesh(
  new THREE.BoxGeometry(400, 200, 400),
  faces.map((f) => new THREE.MeshBasicMaterial({ map: texLoader.load(`paisagem/violence_${f}.jpg`), side: THREE.BackSide }))
)
ceu.position.y = 80
scene.add(ceu)

// ===== Cidade (uma única malha instanciada) =====
const LARG = 5
const GAP = 2
const COLS = 6
const LINHAS = 6
const BLOCOS_X = 3
const BLOCOS_Z = 4
const larguraTotal = BLOCOS_X * (COLS * LARG + (COLS - 1) * GAP) + (BLOCOS_X - 1) * 10
const profundidadeTotal = BLOCOS_Z * (LINHAS * LARG + (LINHAS - 1) * GAP) + (BLOCOS_Z - 1) * 10

const predios = [] // { x, z, h } usados na colisão
for (let y = 0; y < BLOCOS_Z; y++)
  for (let k = 0; k < BLOCOS_X; k++)
    for (let i = 0; i < LINHAS; i++)
      for (let j = 0; j < COLS; j++) {
        predios.push({
          x: j * (LARG + GAP) + k * (COLS * LARG + (COLS - 1) * GAP + 10) - (larguraTotal / 2 - LARG / 2),
          z: i * (LARG + GAP) + y * (LINHAS * LARG + (LINHAS - 1) * GAP + 10) - (profundidadeTotal / 2 - LARG / 2),
          h: 5 + Math.random() * 20
        })
      }

const cidade = new THREE.InstancedMesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: 0xffffff }),
  predios.length
)
const molde = new THREE.Object3D()
const cor = new THREE.Color()
predios.forEach((p, n) => {
  molde.position.set(p.x, p.h / 2, p.z)
  molde.scale.set(LARG, p.h, LARG)
  molde.updateMatrix()
  cidade.setMatrixAt(n, molde.matrix)
  cidade.setColorAt(n, cor.setHSL(0, 0, 0.6 + Math.random() * 0.4))
})
cidade.castShadow = true
cidade.receiveShadow = true
cidade.frustumCulled = false
scene.add(cidade)

// ===== Colisão =====
// Grade espacial: cada consulta olha só os prédios por perto (em vez dos 432)
const CELULA = 8
const grade = new Map()
const chave = (ix, iz) => ix * 1000 + iz
for (const p of predios) {
  const k = chave(Math.floor(p.x / CELULA), Math.floor(p.z / CELULA))
  if (!grade.has(k)) grade.set(k, [])
  grade.get(k).push(p)
}
function vizinhos(x, z) {
  const cx = Math.floor(x / CELULA)
  const cz = Math.floor(z / CELULA)
  const lista = []
  for (let i = -1; i <= 1; i++)
    for (let j = -1; j <= 1; j++) {
      const celula = grade.get(chave(cx + i, cz + j))
      if (celula) lista.push(...celula)
    }
  return lista
}

// Teste simples "este ponto está dentro de um prédio?" (usado nas esferas e no robô)
function bate(x, y, z, m = 0.8) {
  return vizinhos(x, z).some((p) => Math.abs(p.x - x) < LARG / 2 + m && Math.abs(p.z - z) < LARG / 2 + m && y < p.h + m)
}

// Jogador = círculo de RAIO no chão + margem vertical. Em vez de travar, empurra para fora
// pela saída mais curta: desliza nas paredes, contorna quinas e pousa nos telhados.
const RAIO = 1.0
const MARGEM_Y = 0.8
function resolver(p) {
  const meio = LARG / 2
  let pousou = false
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    let mexeu = false
    for (const b of vizinhos(p.x, p.z)) {
      if (p.y >= b.h + MARGEM_Y) continue
      const cx = THREE.MathUtils.clamp(p.x, b.x - meio, b.x + meio)
      const cz = THREE.MathUtils.clamp(p.z, b.z - meio, b.z + meio)
      let dx = p.x - cx
      let dz = p.z - cz
      const d = Math.hypot(dx, dz)
      if (d >= RAIO) continue

      let penH = RAIO - d
      if (d === 0) {
        // centro dentro da caixa: sai pela face mais próxima
        const ex = meio - Math.abs(p.x - b.x)
        const ez = meio - Math.abs(p.z - b.z)
        if (ex < ez) { dx = Math.sign(p.x - b.x) || 1; dz = 0; penH = ex + RAIO }
        else { dx = 0; dz = Math.sign(p.z - b.z) || 1; penH = ez + RAIO }
      }
      const penV = b.h + MARGEM_Y - p.y
      if (penV < penH) {
        p.y = b.h + MARGEM_Y // sobe no telhado
        pousou = true
      } else {
        const n = d > 0 ? d : 1
        p.x += (dx / n) * penH
        p.z += (dz / n) * penH
      }
      mexeu = true
    }
    if (!mexeu) break
  }
  return pousou
}

// ===== Esferas coletáveis (sempre em lugares livres) =====
const texEsfera = texLoader.load('Imagens/esfera.jpg')
const esferas = []
for (let q = 0; q < TOTAL_ESFERAS; q++) {
  let x, z
  do {
    x = (Math.random() - 0.5) * (larguraTotal - 20)
    z = (Math.random() - 0.5) * (profundidadeTotal - 20)
  } while (bate(x, 2, z, 2))
  const esfera = new THREE.Mesh(new THREE.SphereGeometry(1, 15, 16), new THREE.MeshBasicMaterial({ map: texEsfera }))
  esfera.position.set(x, 2.5 + Math.random() * 5, z)
  const ang = Math.random() * Math.PI * 2
  esfera.userData.vel = new THREE.Vector3(Math.cos(ang) * VEL_ESFERA, 0, Math.sin(ang) * VEL_ESFERA)
  scene.add(esfera)
  esferas.push(esfera)
}

// As esferas deslizam na horizontal e quicam nos prédios e nos limites da cidade
const RAIO_ESFERA = 1
function moverEsfera(e, dt) {
  const p = e.position
  const v = e.userData.vel
  p.x += v.x * dt
  p.z += v.z * dt

  if (Math.abs(p.x) > limX) { p.x = limitar(p.x, -limX, limX); v.x *= -1 }
  if (Math.abs(p.z) > limZ) { p.z = limitar(p.z, -limZ, limZ); v.z *= -1 }

  const meio = LARG / 2
  for (const b of vizinhos(p.x, p.z)) {
    if (p.y - RAIO_ESFERA >= b.h) continue // passa por cima de prédios baixos
    const cx = limitar(p.x, b.x - meio, b.x + meio)
    const cz = limitar(p.z, b.z - meio, b.z + meio)
    const dx = p.x - cx
    const dz = p.z - cz
    const d = Math.hypot(dx, dz)
    if (d >= RAIO_ESFERA) continue

    let nx, nz, pen
    if (d > 0) { nx = dx / d; nz = dz / d; pen = RAIO_ESFERA - d }
    else {
      const ex = meio - Math.abs(p.x - b.x)
      const ez = meio - Math.abs(p.z - b.z)
      if (ex < ez) { nx = Math.sign(p.x - b.x) || 1; nz = 0; pen = ex + RAIO_ESFERA }
      else { nx = 0; nz = Math.sign(p.z - b.z) || 1; pen = ez + RAIO_ESFERA }
    }
    p.x += nx * pen
    p.z += nz * pen
    const dot = v.x * nx + v.z * nz
    if (dot < 0) { v.x -= 2 * dot * nx; v.z -= 2 * dot * nz } // reflete a velocidade
  }
}

// ===== Robô =====
let robo
gltfLoader.load(
  'modelos/coot_the_robot.glb',
  (gltf) => {
    robo = gltf.scene
    robo.traverse((o) => { if (o.isMesh) o.castShadow = true })
    scene.add(robo)
  },
  undefined,
  console.error
)

// ===== Luzes, Sol e Lua =====
const lanterna = new THREE.PointLight(0xffffff, 3, 6)
scene.add(lanterna)
scene.add(new THREE.HemisphereLight(0x777777, 0x000000, 1))

const alvoLuz = new THREE.Object3D()
alvoLuz.position.set(0, -1, 0)
scene.add(alvoLuz)

const luzSol = new THREE.DirectionalLight(0xfc5404, 16)
luzSol.target = alvoLuz
luzSol.castShadow = true
luzSol.shadow.mapSize.set(2048, 2048)
Object.assign(luzSol.shadow.camera, { left: -100, right: 100, top: 100, bottom: -100, near: 0.8, far: 1000 })
scene.add(luzSol)

const sol = new THREE.Mesh(new THREE.SphereGeometry(10, 15, 16), new THREE.MeshBasicMaterial({ map: texLoader.load('Imagens/Sol.jpeg') }))
const lua = new THREE.Mesh(new THREE.SphereGeometry(10, 15, 16), new THREE.MeshBasicMaterial({ map: texLoader.load('Imagens/Lua.jpeg') }))
scene.add(sol, lua)

const RAIO_ORBITA = larguraTotal / 2 + 100
let anguloSol = 0

// ===== Controles (estado das teclas, com aceleração suave) =====
const teclas = {}
addEventListener('keydown', (e) => {
  teclas[e.code] = true
  if (e.code === 'Space') e.preventDefault()
})
addEventListener('keyup', (e) => (teclas[e.code] = false))

let vel = 0
let velY = 0
let rumo = 0
const limX = larguraTotal / 2 - 10
const limZ = profundidadeTotal / 2 - 10
const limitar = THREE.MathUtils.clamp

// Mouse: clique na tela para capturar o cursor (Esc libera)
const SENS_MOUSE = 0.002
const DIST_CAMERA = 6 // distância da câmera até o robô
const INCL_INICIAL = 0.25 // elevação inicial da câmera (um pouco acima, atrás do robô)
let inclinacao = INCL_INICIAL
const alvoCam = new THREE.Vector3()
const posCam = new THREE.Vector3()
let olharYaw = 0 // giro da câmera em volta do robô (não muda a direção dele)
renderer.domElement.addEventListener('click', () => {
  if (jogando) renderer.domElement.requestPointerLock()
})
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return
  olharYaw -= e.movementX * SENS_MOUSE // gira livremente, 360°
  inclinacao = limitar(inclinacao + e.movementY * SENS_MOUSE, -0.2, 1.3)
})

function mover(dx, dz, dy) {
  const p = jogador
  p.x = limitar(p.x + dx, -limX, limX)
  p.z = limitar(p.z + dz, -limZ, limZ)
  p.y = limitar(p.y + dy, ALTURA_MIN, ALTURA_MAX)
  if (resolver(p) && velY < 0) velY = 0
  p.x = limitar(p.x, -limX, limX)
  p.z = limitar(p.z, -limZ, limZ)
}

function atualizar(dt) {
  const frente = (teclas.ArrowUp || teclas.KeyW ? 1 : 0) - (teclas.ArrowDown || teclas.KeyS ? 1 : 0)
  const giro = (teclas.ArrowLeft || teclas.KeyA ? 1 : 0) - (teclas.ArrowRight || teclas.KeyD ? 1 : 0)

  rumo += giro * GIRO * dt
  const alvoVel = frente * VEL_MAX
  vel += Math.sign(alvoVel - vel) * Math.min(Math.abs(alvoVel - vel), ACEL * dt)
  velY += ((teclas.Space ? 12 : -8) - velY) * Math.min(1, dt * 6)

  mover(-Math.sin(rumo) * vel * dt, -Math.cos(rumo) * vel * dt, velY * dt)
  // O robô é a posição do jogador
  robo.position.copy(jogador)
  robo.rotation.y = Math.PI + rumo
  lanterna.position.set(jogador.x, jogador.y + 1.5, jogador.z)

  // Ao andar, a câmera volta suavemente para trás do robô (posição inicial)
  if (frente !== 0) {
    const k = Math.min(1, dt * 3)
    inclinacao += (INCL_INICIAL - inclinacao) * k
    olharYaw -= olharYaw * k
  }

  // Câmera orbita 360° em volta do robô; se houver prédio no caminho, chega mais perto
  const ang = rumo + olharYaw
  alvoCam.set(jogador.x, jogador.y + 1, jogador.z)
  for (let dist = DIST_CAMERA; dist > 1; dist -= 0.5) {
    posCam.set(
      alvoCam.x + Math.sin(ang) * Math.cos(inclinacao) * dist,
      Math.max(0.5, alvoCam.y + Math.sin(inclinacao) * dist),
      alvoCam.z + Math.cos(ang) * Math.cos(inclinacao) * dist
    )
    if (!bate(posCam.x, posCam.y, posCam.z, 0.5)) break
  }
  camera.position.copy(posCam)
  camera.lookAt(alvoCam)

  // Coleta
  for (const e of esferas) {
    e.rotation.y += dt
    if (e.visible) moverEsfera(e, dt)
    if (e.visible && e.position.distanceTo(robo.position) < RAIO_COLETA) {
      e.visible = false
      placar++
      atualizarPlacar()
      if (placar === TOTAL_ESFERAS) vencer()
    }
  }

  tempo += dt
  hudTempo.textContent = `${tempo.toFixed(1)} s`
}

function atualizarCeu(dt) {
  anguloSol += dt * 0.03
  sol.position.set(
    RAIO_ORBITA * Math.sin(anguloSol) * Math.sin(1.046),
    RAIO_ORBITA * Math.cos(anguloSol),
    RAIO_ORBITA * 2 * Math.sin(anguloSol) * Math.cos(1.046)
  )
  lua.position.copy(sol.position).multiplyScalar(-1)

  const dia = sol.position.y > 0
  const astro = dia ? sol : lua
  luzSol.intensity = astro.position.y / 10
  luzSol.color.set(dia ? 0xfc5404 : 0x396992)
  luzSol.position.copy(astro.position)
}

// ===== Loop principal =====
const relogio = new THREE.Clock()
function animar() {
  requestAnimationFrame(animar)
  const dt = Math.min(relogio.getDelta(), 0.05)
  atualizarCeu(dt)
  if (jogando && robo) atualizar(dt)
  renderer.render(scene, camera)
}
animar()