import fs from 'fs';
import path from 'path';

class GlbBuilder {
  constructor(name = 'Scene') {
    this.sceneName = name;
    this.nodes = [];
    this.meshes = [];
    this.materials = [];
    this.accessors = [];
    this.bufferViews = [];
    this.animations = [];
    this.binChunks = [];
    this.binLength = 0;
  }

  _appendBuffer(typedArray, target) {
    const raw = Buffer.from(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
    const pad = (4 - (raw.length % 4)) % 4;
    const byteOffset = this.binLength;
    this.binChunks.push(raw);
    if (pad > 0) this.binChunks.push(Buffer.alloc(pad));
    this.binLength += raw.length + pad;
    const bv = { buffer: 0, byteOffset, byteLength: raw.length };
    if (target) bv.target = target;
    const idx = this.bufferViews.length;
    this.bufferViews.push(bv);
    return idx;
  }

  _addAccessor(bufferView, componentType, count, type, min, max) {
    const acc = { bufferView, componentType, count, type };
    if (min) acc.min = min;
    if (max) acc.max = max;
    const idx = this.accessors.length;
    this.accessors.push(acc);
    return idx;
  }

  addMaterial({
    name,
    color = [0.8, 0.8, 0.8, 1],
    metallic = 0.2,
    roughness = 0.5,
    emissive = [0, 0, 0],
    alphaMode = 'OPAQUE',
    doubleSided = false,
  }) {
    const mat = {
      name,
      pbrMetallicRoughness: {
        baseColorFactor: color.length === 4 ? color : [...color, 1],
        metallicFactor: metallic,
        roughnessFactor: roughness,
      },
    };
    if (emissive.some((v) => v > 0)) mat.emissiveFactor = emissive;
    if (alphaMode !== 'OPAQUE') mat.alphaMode = alphaMode;
    if (doubleSided) mat.doubleSided = true;
    const idx = this.materials.length;
    this.materials.push(mat);
    return idx;
  }

  _createMesh(positions, normals, indices, materialIndex, name) {
    const posArr = new Float32Array(positions);
    const normArr = new Float32Array(normals);
    const idxArr = new Uint16Array(indices);

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < posArr.length; i += 3) {
      const x = posArr[i], y = posArr[i + 1], z = posArr[i + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }

    const posBv = this._appendBuffer(posArr, 34962);
    const normBv = this._appendBuffer(normArr, 34962);
    const idxBv = this._appendBuffer(idxArr, 34963);

    const posAcc = this._addAccessor(posBv, 5126, posArr.length / 3, 'VEC3', [minX, minY, minZ], [maxX, maxY, maxZ]);
    const normAcc = this._addAccessor(normBv, 5126, normArr.length / 3, 'VEC3');
    const idxAcc = this._addAccessor(idxBv, 5123, idxArr.length, 'SCALAR');

    const meshIdx = this.meshes.length;
    this.meshes.push({
      name,
      primitives: [
        {
          attributes: { POSITION: posAcc, NORMAL: normAcc },
          indices: idxAcc,
          material: materialIndex,
        },
      ],
    });
    return meshIdx;
  }

  addNode({ name, mesh = undefined, translation = undefined, rotation = undefined, scale = undefined, children = undefined }) {
    const node = {};
    if (name) node.name = name;
    if (mesh !== undefined) node.mesh = mesh;
    if (translation) node.translation = translation;
    if (rotation) node.rotation = rotation;
    if (scale) node.scale = scale;
    if (children && children.length) node.children = children;
    const idx = this.nodes.length;
    this.nodes.push(node);
    return idx;
  }

  addBoxNode({ name, size = [1, 1, 1], pos = [0, 0, 0], rot = undefined, mat }) {
    const [sx, sy, sz] = size;
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    // 24 vertices (4 per face for crisp flat normals)
    const faces = [
      { n: [0, 0, 1], v: [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]] },
      { n: [0, 0, -1], v: [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]] },
      { n: [0, 1, 0], v: [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]] },
      { n: [0, -1, 0], v: [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]] },
      { n: [1, 0, 0], v: [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]] },
      { n: [-1, 0, 0], v: [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]] },
    ];
    const positions = [], normals = [], indices = [];
    faces.forEach((f, fi) => {
      const base = fi * 4;
      for (const p of f.v) {
        positions.push(p[0], p[1], p[2]);
        normals.push(f.n[0], f.n[1], f.n[2]);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    });
    const mesh = this._createMesh(positions, normals, indices, mat, name);
    return this.addNode({ name, mesh, translation: pos, rotation: rot });
  }

  addCylinderNode({ name, rTop = 0.5, rBot = 0.5, height = 1, segs = 24, pos = [0, 0, 0], rot = undefined, mat }) {
    const positions = [], normals = [], indices = [];
    const hy = height / 2;
    const slope = (rBot - rTop) / height;

    // Side ring vertices (2 rings)
    for (let i = 0; i <= segs; i++) {
      const th = (i / segs) * Math.PI * 2;
      const c = Math.cos(th), s = Math.sin(th);
      const len = Math.hypot(c, slope, s) || 1;
      const nx = c / len, ny = slope / len, nz = s / len;
      positions.push(rTop * c, hy, rTop * s);
      normals.push(nx, ny, nz);
      positions.push(rBot * c, -hy, rBot * s);
      normals.push(nx, ny, nz);
    }
    for (let i = 0; i < segs; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      indices.push(a, b, d, a, d, c);
    }

    // Top cap
    if (rTop > 0.0001) {
      const topCenter = positions.length / 3;
      positions.push(0, hy, 0);
      normals.push(0, 1, 0);
      for (let i = 0; i <= segs; i++) {
        const th = (i / segs) * Math.PI * 2;
        positions.push(rTop * Math.cos(th), hy, rTop * Math.sin(th));
        normals.push(0, 1, 0);
      }
      for (let i = 0; i < segs; i++) {
        indices.push(topCenter, topCenter + 1 + i + 1, topCenter + 1 + i);
      }
    }

    // Bottom cap
    if (rBot > 0.0001) {
      const botCenter = positions.length / 3;
      positions.push(0, -hy, 0);
      normals.push(0, -1, 0);
      for (let i = 0; i <= segs; i++) {
        const th = (i / segs) * Math.PI * 2;
        positions.push(rBot * Math.cos(th), -hy, rBot * Math.sin(th));
        normals.push(0, -1, 0);
      }
      for (let i = 0; i < segs; i++) {
        indices.push(botCenter, botCenter + 1 + i, botCenter + 1 + i + 1);
      }
    }

    const mesh = this._createMesh(positions, normals, indices, mat, name);
    return this.addNode({ name, mesh, translation: pos, rotation: rot });
  }

  addSphereNode({ name, radius = 0.5, rings = 14, sectors = 20, pos = [0, 0, 0], mat }) {
    const positions = [], normals = [], indices = [];
    for (let r = 0; r <= rings; r++) {
      const v = r / rings;
      const phi = v * Math.PI;
      for (let s = 0; s <= sectors; s++) {
        const u = s / sectors;
        const theta = u * Math.PI * 2;
        const x = Math.sin(phi) * Math.cos(theta);
        const y = Math.cos(phi);
        const z = Math.sin(phi) * Math.sin(theta);
        positions.push(radius * x, radius * y, radius * z);
        normals.push(x, y, z);
      }
    }
    const stride = sectors + 1;
    for (let r = 0; r < rings; r++) {
      for (let s = 0; s < sectors; s++) {
        const a = r * stride + s;
        const b = a + stride;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const mesh = this._createMesh(positions, normals, indices, mat, name);
    return this.addNode({ name, mesh, translation: pos });
  }

  addSpinAnimation(animName, nodeIndices, axis = 'y', duration = 1.2) {
    const times = new Float32Array([0, duration * 0.25, duration * 0.5, duration * 0.75, duration]);
    const angles = [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5, Math.PI * 2];
    const quats = new Float32Array(angles.length * 4);
    angles.forEach((a, i) => {
      const s = Math.sin(a / 2), c = Math.cos(a / 2);
      quats[i * 4] = axis === 'x' ? s : 0;
      quats[i * 4 + 1] = axis === 'y' ? s : 0;
      quats[i * 4 + 2] = axis === 'z' ? s : 0;
      quats[i * 4 + 3] = c;
    });
    const tBv = this._appendBuffer(times);
    const qBv = this._appendBuffer(quats);
    const tAcc = this._addAccessor(tBv, 5126, times.length, 'SCALAR', [0], [duration]);
    const qAcc = this._addAccessor(qBv, 5126, angles.length, 'VEC4');

    const samplers = [];
    const channels = [];
    nodeIndices.forEach((nodeIdx, idx) => {
      samplers.push({ input: tAcc, output: qAcc, interpolation: 'LINEAR' });
      channels.push({ sampler: idx, target: { node: nodeIdx, path: 'rotation' } });
    });
    this.animations.push({ name: animName, samplers, channels });
  }

  addOscillateAnimation(animName, nodeIdx, basePos, delta, duration = 3.0) {
    const times = new Float32Array([0, duration * 0.5, duration]);
    const vals = new Float32Array([
      basePos[0], basePos[1], basePos[2],
      basePos[0] + delta[0], basePos[1] + delta[1], basePos[2] + delta[2],
      basePos[0], basePos[1], basePos[2],
    ]);
    const tBv = this._appendBuffer(times);
    const vBv = this._appendBuffer(vals);
    const tAcc = this._addAccessor(tBv, 5126, times.length, 'SCALAR', [0], [duration]);
    const vAcc = this._addAccessor(vBv, 5126, 3, 'VEC3');
    this.animations.push({
      name: animName,
      samplers: [{ input: tAcc, output: vAcc, interpolation: 'LINEAR' }],
      channels: [{ sampler: 0, target: { node: nodeIdx, path: 'translation' } }],
    });
  }

  toGlbBuffer(rootChildren) {
    const rootIdx = this.addNode({ name: this.sceneName, children: rootChildren });
    const gltf = {
      asset: { version: '2.0', generator: 'XR-FUSION-EDU-GLB-Builder' },
      scene: 0,
      scenes: [{ name: this.sceneName, nodes: [rootIdx] }],
      nodes: this.nodes,
      meshes: this.meshes,
      materials: this.materials,
      accessors: this.accessors,
      bufferViews: this.bufferViews,
      buffers: [{ byteLength: this.binLength }],
    };
    if (this.animations.length) gltf.animations = this.animations;

    const jsonStr = JSON.stringify(gltf);
    const jsonRaw = Buffer.from(jsonStr, 'utf8');
    const jsonPad = (4 - (jsonRaw.length % 4)) % 4;
    const jsonChunkLen = jsonRaw.length + jsonPad;
    const jsonChunk = Buffer.concat([jsonRaw, Buffer.alloc(jsonPad, 0x20)]);

    const binBuf = Buffer.concat(this.binChunks);
    const totalLength = 12 + 8 + jsonChunkLen + 8 + binBuf.length;

    const header = Buffer.alloc(12);
    header.writeUInt32LE(0x46546C67, 0); // glTF
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(totalLength, 8);

    const jsonHeader = Buffer.alloc(8);
    jsonHeader.writeUInt32LE(jsonChunkLen, 0);
    jsonHeader.writeUInt32LE(0x4E4F534A, 4); // JSON

    const binHeader = Buffer.alloc(8);
    binHeader.writeUInt32LE(binBuf.length, 0);
    binHeader.writeUInt32LE(0x004E4942, 4); // BIN

    return Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binBuf]);
  }
}

function quatEulerX(deg) {
  const r = (deg * Math.PI) / 180;
  return [Math.sin(r / 2), 0, 0, Math.cos(r / 2)];
}
function quatEulerY(deg) {
  const r = (deg * Math.PI) / 180;
  return [0, Math.sin(r / 2), 0, Math.cos(r / 2)];
}
function quatEulerZ(deg) {
  const r = (deg * Math.PI) / 180;
  return [0, 0, Math.sin(r / 2), Math.cos(r / 2)];
}

function createFanAssembly(b, radius, depth, hubMat, bladeMat, axis = 'z') {
  const children = [];
  children.push(b.addCylinderNode({
    name: 'fan_hub',
    rTop: radius * 0.3,
    rBot: radius * 0.3,
    height: depth,
    segs: 18,
    rot: axis === 'z' ? quatEulerX(90) : axis === 'x' ? quatEulerZ(90) : undefined,
    mat: hubMat,
  }));
  const numBlades = 7;
  for (let i = 0; i < numBlades; i++) {
    const a = (i / numBlades) * Math.PI * 2;
    const dist = radius * 0.56;
    if (axis === 'y') {
      children.push(b.addBoxNode({
        name: 'blade_' + i,
        size: [radius * 0.55, depth * 0.25, radius * 0.16],
        pos: [Math.cos(a) * dist, 0, Math.sin(a) * dist],
        rot: quatEulerY((-a * 180) / Math.PI),
        mat: bladeMat,
      }));
    } else if (axis === 'z') {
      children.push(b.addBoxNode({
        name: 'blade_' + i,
        size: [radius * 0.55, radius * 0.16, depth * 0.25],
        pos: [Math.cos(a) * dist, Math.sin(a) * dist, 0],
        rot: quatEulerZ((a * 180) / Math.PI),
        mat: bladeMat,
      }));
    }
  }
  return children;
}

const outDir = path.resolve(process.cwd(), 'public/models');
fs.mkdirSync(outDir, { recursive: true });

function saveGlb(filename, builder, nodes) {
  const buf = builder.toGlbBuffer(nodes);
  fs.writeFileSync(path.join(outDir, filename), buf);
  console.log(`Generated ${filename} (${(buf.length / 1024).toFixed(1)} KB)`);
}

// 1. 3D Printer
{
  const b = new GlbBuilder('Impresora3D');
  const frameMat = b.addMaterial({ name: 'AlumDark', color: [0.12, 0.14, 0.18], metallic: 0.75, roughness: 0.35 });
  const bedMat = b.addMaterial({ name: 'PrintBed', color: [0.08, 0.10, 0.14], metallic: 0.2, roughness: 0.2 });
  const accentMat = b.addMaterial({ name: 'CyanAccent', color: [0.0, 0.72, 1.0], metallic: 0.3, roughness: 0.3, emissive: [0.0, 0.35, 0.6] });
  const orangeMat = b.addMaterial({ name: 'Hotend', color: [1.0, 0.48, 0.10], metallic: 0.6, roughness: 0.35 });
  const spoolMat = b.addMaterial({ name: 'Filament', color: [0.71, 0.91, 0.0], metallic: 0.1, roughness: 0.45 });
  const screenMat = b.addMaterial({ name: 'LCD', color: [0.04, 0.35, 0.55], metallic: 0.1, roughness: 0.15, emissive: [0.0, 0.28, 0.45] });
  const modelMat = b.addMaterial({ name: 'PrintedCube', color: [0.0, 0.8, 0.95], metallic: 0.1, roughness: 0.4 });

  const nodes = [
    // Base & Feet
    b.addBoxNode({ name: 'base', size: [0.95, 0.08, 0.9], pos: [0, 0.04, 0], mat: frameMat }),
    // Heated Build Plate
    b.addBoxNode({ name: 'bed_plate', size: [0.64, 0.025, 0.64], pos: [0, 0.11, 0.02], mat: bedMat }),
    b.addBoxNode({ name: 'bed_trim', size: [0.66, 0.012, 0.66], pos: [0, 0.095, 0.02], mat: accentMat }),
    // Printed sample object on bed
    b.addCylinderNode({ name: 'printed_gear', rTop: 0.08, rBot: 0.09, height: 0.14, pos: [0, 0.19, 0.02], mat: modelMat }),
    // Vertical Gantry Columns
    b.addBoxNode({ name: 'col_left', size: [0.06, 0.95, 0.06], pos: [-0.42, 0.55, -0.08], mat: frameMat }),
    b.addBoxNode({ name: 'col_right', size: [0.06, 0.95, 0.06], pos: [0.42, 0.55, -0.08], mat: frameMat }),
    b.addBoxNode({ name: 'top_bar', size: [0.92, 0.06, 0.07], pos: [0, 1.02, -0.08], mat: frameMat }),
    // X-Gantry rail
    b.addBoxNode({ name: 'x_rail', size: [0.80, 0.045, 0.05], pos: [0, 0.52, -0.08], mat: frameMat }),
    // Spool Holder & Filament Spool
    b.addBoxNode({ name: 'spool_arm', size: [0.04, 0.14, 0.04], pos: [-0.22, 1.11, -0.08], mat: frameMat }),
    b.addCylinderNode({ name: 'spool_rim1', rTop: 0.14, rBot: 0.14, height: 0.015, pos: [-0.22, 1.18, -0.14], rot: quatEulerX(90), mat: frameMat }),
    b.addCylinderNode({ name: 'spool_filament', rTop: 0.125, rBot: 0.125, height: 0.07, pos: [-0.22, 1.18, -0.10], rot: quatEulerX(90), mat: spoolMat }),
    b.addCylinderNode({ name: 'spool_rim2', rTop: 0.14, rBot: 0.14, height: 0.015, pos: [-0.22, 1.18, -0.06], rot: quatEulerX(90), mat: frameMat }),
    // Front LCD Control Screen
    b.addBoxNode({ name: 'lcd_housing', size: [0.24, 0.12, 0.06], pos: [0.33, 0.11, 0.44], rot: quatEulerX(-35), mat: frameMat }),
    b.addBoxNode({ name: 'lcd_screen', size: [0.19, 0.08, 0.01], pos: [0.33, 0.125, 0.465], rot: quatEulerX(-35), mat: screenMat }),
  ];

  // Animated Extruder Carriage
  const extBody = b.addBoxNode({ name: 'extruder_carriage', size: [0.14, 0.15, 0.14], pos: [0, 0, 0.05], mat: frameMat });
  const extFan = b.addBoxNode({ name: 'extruder_shroud', size: [0.11, 0.11, 0.03], pos: [0, 0, 0.125], mat: orangeMat });
  const extNozzle = b.addCylinderNode({ name: 'nozzle', rTop: 0.02, rBot: 0.004, height: 0.06, pos: [0, -0.10, 0.05], mat: orangeMat });
  const extruderGroup = b.addNode({ name: 'extruder_group', translation: [-0.15, 0.52, -0.06], children: [extBody, extFan, extNozzle] });
  nodes.push(extruderGroup);
  b.addOscillateAnimation('Impresion_Cabezal', extruderGroup, [-0.18, 0.52, -0.06], [0.36, 0, 0], 2.8);

  saveGlb('3d_printer.glb', b, nodes);
}

// 2. ASUS ROG GeForce RTX 5070 OC
{
  const b = new GlbBuilder('RTX5070_OC');
  const shroudMat = b.addMaterial({ name: 'ROGShroud', color: [0.11, 0.13, 0.16], metallic: 0.65, roughness: 0.35 });
  const metalMat = b.addMaterial({ name: 'Heatsink', color: [0.68, 0.72, 0.78], metallic: 0.9, roughness: 0.25 });
  const pcbMat = b.addMaterial({ name: 'PCB', color: [0.04, 0.08, 0.06], metallic: 0.15, roughness: 0.55 });
  const goldMat = b.addMaterial({ name: 'GoldPins', color: [0.95, 0.76, 0.22], metallic: 0.95, roughness: 0.2 });
  const copperMat = b.addMaterial({ name: 'Copper', color: [0.85, 0.45, 0.24], metallic: 0.9, roughness: 0.25 });
  const rgbMat = b.addMaterial({ name: 'RGB', color: [0.0, 0.78, 1.0], metallic: 0.2, roughness: 0.2, emissive: [0.0, 0.55, 0.95] });
  const bladeMat = b.addMaterial({ name: 'FanBlade', color: [0.18, 0.20, 0.25], metallic: 0.3, roughness: 0.4 });

  const nodes = [
    b.addBoxNode({ name: 'shroud_main', size: [1.45, 0.22, 0.56], pos: [0, 0, 0], mat: shroudMat }),
    b.addBoxNode({ name: 'backplate', size: [1.43, 0.025, 0.54], pos: [0, 0.12, 0], mat: shroudMat }),
    b.addBoxNode({ name: 'pcb_board', size: [1.10, 0.02, 0.48], pos: [-0.14, 0.08, 0], mat: pcbMat }),
    b.addBoxNode({ name: 'pcie_connector', size: [0.46, 0.04, 0.02], pos: [-0.28, -0.13, -0.22], mat: goldMat }),
    b.addBoxNode({ name: 'io_bracket', size: [0.025, 0.26, 0.58], pos: [-0.735, -0.01, 0], mat: metalMat }),
    b.addBoxNode({ name: 'rgb_bar', size: [0.88, 0.03, 0.025], pos: [0.12, 0.09, 0.28], mat: rgbMat }),
    b.addBoxNode({ name: 'power_16pin', size: [0.09, 0.05, 0.06], pos: [0.28, 0.10, 0.23], mat: goldMat }),
    // Heatpipes
    b.addCylinderNode({ name: 'heatpipe1', rTop: 0.018, rBot: 0.018, height: 1.25, pos: [0, 0.03, 0.20], rot: quatEulerZ(90), mat: copperMat }),
    b.addCylinderNode({ name: 'heatpipe2', rTop: 0.018, rBot: 0.018, height: 1.25, pos: [0, 0.03, -0.20], rot: quatEulerZ(90), mat: copperMat }),
  ];

  // Heatsink fins
  for (let i = -12; i <= 12; i += 2) {
    nodes.push(b.addBoxNode({ name: 'fin_' + i, size: [0.012, 0.12, 0.44], pos: [i * 0.05, 0.02, 0], mat: metalMat }));
  }

  // 3 Spinning Fans on bottom/front face (oriented upward in showcase or bottom face)
  const fanRotors = [];
  [-0.45, 0, 0.45].forEach((fx, idx) => {
    const fanParts = createFanAssembly(b, 0.19, 0.03, rgbMat, bladeMat, 'y');
    const rotor = b.addNode({ name: 'gpu_fan_' + idx, translation: [fx, -0.115, 0], children: fanParts });
    nodes.push(rotor);
    fanRotors.push(rotor);
  });
  b.addSpinAnimation('Ventiladores_GPU', fanRotors, 'y', 0.9);

  saveGlb('asus_rog_rtx_5070_oc__pbr.glb', b, nodes);
}

// 3. Crucial RAM DDR4 8GB
{
  const b = new GlbBuilder('Crucial_DDR4_8GB');
  const pcbMat = b.addMaterial({ name: 'GreenDarkPCB', color: [0.04, 0.18, 0.10], metallic: 0.2, roughness: 0.45 });
  const chipMat = b.addMaterial({ name: 'DRAMChip', color: [0.09, 0.10, 0.12], metallic: 0.15, roughness: 0.35 });
  const goldMat = b.addMaterial({ name: 'GoldContacts', color: [0.96, 0.78, 0.22], metallic: 0.95, roughness: 0.2 });
  const labelMat = b.addMaterial({ name: 'CrucialLabel', color: [0.88, 0.92, 0.97], metallic: 0.1, roughness: 0.4 });
  const brandMat = b.addMaterial({ name: 'CrucialBlue', color: [0.0, 0.45, 0.85], metallic: 0.2, roughness: 0.3 });

  const nodes = [
    b.addBoxNode({ name: 'ram_pcb', size: [1.33, 0.31, 0.025], pos: [0, 0, 0], mat: pcbMat }),
    // Gold pins split by DDR4 key notch
    b.addBoxNode({ name: 'pins_left', size: [0.68, 0.035, 0.028], pos: [-0.30, -0.165, 0], mat: goldMat }),
    b.addBoxNode({ name: 'pins_right', size: [0.54, 0.035, 0.028], pos: [0.37, -0.165, 0], mat: goldMat }),
    // Brand label
    b.addBoxNode({ name: 'label_white', size: [0.46, 0.14, 0.005], pos: [-0.32, 0.02, 0.022], mat: labelMat }),
    b.addBoxNode({ name: 'label_blue', size: [0.14, 0.14, 0.006], pos: [-0.48, 0.02, 0.023], mat: brandMat }),
  ];

  // 8 DRAM ICs front & back
  for (let i = 0; i < 8; i++) {
    const x = -0.52 + i * 0.15;
    nodes.push(b.addBoxNode({ name: 'ic_f_' + i, size: [0.11, 0.14, 0.015], pos: [x, 0.02, 0.018], mat: chipMat }));
    nodes.push(b.addBoxNode({ name: 'ic_b_' + i, size: [0.11, 0.14, 0.015], pos: [x, 0.02, -0.018], mat: chipMat }));
  }

  saveGlb('crucial_8_gb_ddr4_2133_ram.glb', b, nodes);
}

// 4. Custom Mechanical Keyboard
{
  const b = new GlbBuilder('MechanicalKeyboard');
  const caseMat = b.addMaterial({ name: 'AlumCase', color: [0.14, 0.16, 0.20], metallic: 0.8, roughness: 0.35 });
  const plateMat = b.addMaterial({ name: 'SwitchPlate', color: [0.06, 0.08, 0.10], metallic: 0.5, roughness: 0.4 });
  const keyDark = b.addMaterial({ name: 'KeyAlpha', color: [0.22, 0.25, 0.30], metallic: 0.1, roughness: 0.55 });
  const keyMod = b.addMaterial({ name: 'KeyMod', color: [0.10, 0.22, 0.34], metallic: 0.15, roughness: 0.5 });
  const keyAccent = b.addMaterial({ name: 'KeyAccent', color: [0.0, 0.72, 1.0], metallic: 0.2, roughness: 0.35, emissive: [0.0, 0.22, 0.38] });
  const keyOrange = b.addMaterial({ name: 'KeyEsc', color: [1.0, 0.48, 0.10], metallic: 0.15, roughness: 0.4 });

  const nodes = [
    b.addBoxNode({ name: 'kb_case', size: [1.50, 0.11, 0.58], pos: [0, 0, 0], rot: quatEulerX(6), mat: caseMat }),
    b.addBoxNode({ name: 'kb_plate', size: [1.42, 0.02, 0.50], pos: [0, 0.05, 0], rot: quatEulerX(6), mat: plateMat }),
  ];

  // Keycap grid (5 rows)
  const rows = 5;
  const cols = 15;
  for (let r = 0; r < rows; r++) {
    const z = -0.19 + r * 0.095;
    for (let c = 0; c < cols; c++) {
      if (r === 4 && c >= 4 && c <= 9) continue; // spacebar slot
      const x = -0.63 + c * 0.09;
      let mat = keyDark;
      if (r === 0 && c === 0) mat = keyOrange;
      else if (c === 0 || c === cols - 1 || r === 4) mat = keyMod;
      else if (r === 2 && c === 13) mat = keyAccent;
      nodes.push(b.addBoxNode({
        name: `key_${r}_${c}`,
        size: [0.074, 0.045, 0.074],
        pos: [x, 0.08 - r * 0.008, z],
        rot: quatEulerX(6),
        mat,
      }));
    }
  }
  // Spacebar
  nodes.push(b.addBoxNode({
    name: 'spacebar',
    size: [0.52, 0.045, 0.074],
    pos: [-0.04, 0.048, 0.19],
    rot: quatEulerX(6),
    mat: keyAccent,
  }));

  saveGlb('custom_-_mechanical_keyboard.glb', b, nodes);
}

// 5. Monitor Near Future
{
  const b = new GlbBuilder('NearFutureMonitor');
  const frameMat = b.addMaterial({ name: 'Chassis', color: [0.09, 0.11, 0.14], metallic: 0.75, roughness: 0.3 });
  const screenMat = b.addMaterial({ name: 'Display', color: [0.04, 0.45, 0.70], metallic: 0.1, roughness: 0.12, emissive: [0.02, 0.35, 0.58] });
  const standMat = b.addMaterial({ name: 'Stand', color: [0.55, 0.60, 0.68], metallic: 0.9, roughness: 0.25 });
  const glowMat = b.addMaterial({ name: 'NeonEdge', color: [0.0, 0.85, 1.0], metallic: 0.2, roughness: 0.2, emissive: [0.0, 0.6, 0.9] });

  const nodes = [
    b.addBoxNode({ name: 'base_foot', size: [0.64, 0.025, 0.36], pos: [0, 0.012, 0.04], mat: standMat }),
    b.addBoxNode({ name: 'neck_arm', size: [0.08, 0.48, 0.06], pos: [0, 0.26, -0.06], rot: quatEulerX(-10), mat: standMat }),
    b.addBoxNode({ name: 'rear_hub', size: [0.34, 0.22, 0.06], pos: [0, 0.46, -0.02], mat: frameMat }),
    b.addBoxNode({ name: 'panel_frame', size: [1.36, 0.76, 0.035], pos: [0, 0.52, 0.02], mat: frameMat }),
    b.addBoxNode({ name: 'panel_screen', size: [1.31, 0.71, 0.01], pos: [0, 0.52, 0.038], mat: screenMat }),
    b.addBoxNode({ name: 'hud_bar', size: [1.18, 0.025, 0.012], pos: [0, 0.21, 0.04], mat: glowMat }),
  ];

  saveGlb('near_future_computer_monitor.glb', b, nodes);
}

// 6. Placa Base (Motherboard)
{
  const b = new GlbBuilder('PlacaBase_ATX');
  const pcbMat = b.addMaterial({ name: 'MoboPCB', color: [0.05, 0.07, 0.09], metallic: 0.2, roughness: 0.5 });
  const metalMat = b.addMaterial({ name: 'Steel', color: [0.70, 0.74, 0.78], metallic: 0.9, roughness: 0.22 });
  const vrmMat = b.addMaterial({ name: 'VRMHeatsink', color: [0.16, 0.20, 0.26], metallic: 0.75, roughness: 0.3 });
  const slotBlue = b.addMaterial({ name: 'SlotCyan', color: [0.0, 0.65, 0.92], metallic: 0.2, roughness: 0.4 });
  const slotDark = b.addMaterial({ name: 'SlotDark', color: [0.14, 0.16, 0.19], metallic: 0.2, roughness: 0.5 });
  const accentMat = b.addMaterial({ name: 'ChipsetGlow', color: [0.0, 0.8, 1.0], metallic: 0.3, roughness: 0.25, emissive: [0.0, 0.45, 0.7] });

  const nodes = [
    b.addBoxNode({ name: 'atx_pcb', size: [1.0, 0.03, 1.22], pos: [0, 0, 0], mat: pcbMat }),
    // CPU Socket
    b.addBoxNode({ name: 'cpu_socket_base', size: [0.26, 0.03, 0.26], pos: [-0.08, 0.03, -0.24], mat: slotDark }),
    b.addBoxNode({ name: 'cpu_ilm_frame', size: [0.22, 0.015, 0.22], pos: [-0.08, 0.048, -0.24], mat: metalMat }),
    // VRM Heatsinks
    b.addBoxNode({ name: 'vrm_top', size: [0.34, 0.09, 0.11], pos: [-0.08, 0.06, -0.46], mat: vrmMat }),
    b.addBoxNode({ name: 'vrm_left', size: [0.12, 0.10, 0.40], pos: [-0.35, 0.06, -0.24], mat: vrmMat }),
    // 4 RAM Slots
    b.addBoxNode({ name: 'dimm_1', size: [0.025, 0.045, 0.46], pos: [0.18, 0.035, -0.24], mat: slotDark }),
    b.addBoxNode({ name: 'dimm_2', size: [0.025, 0.045, 0.46], pos: [0.23, 0.035, -0.24], mat: slotBlue }),
    b.addBoxNode({ name: 'dimm_3', size: [0.025, 0.045, 0.46], pos: [0.28, 0.035, -0.24], mat: slotDark }),
    b.addBoxNode({ name: 'dimm_4', size: [0.025, 0.045, 0.46], pos: [0.33, 0.035, -0.24], mat: slotBlue }),
    // 24-pin ATX power
    b.addBoxNode({ name: 'atx_24pin', size: [0.07, 0.06, 0.26], pos: [0.43, 0.045, -0.20], mat: slotDark }),
    // PCIe x16 Slot
    b.addBoxNode({ name: 'pcie_x16', size: [0.48, 0.04, 0.045], pos: [-0.15, 0.035, 0.14], mat: metalMat }),
    b.addBoxNode({ name: 'pcie_x4', size: [0.48, 0.035, 0.04], pos: [-0.15, 0.03, 0.34], mat: slotDark }),
    // M.2 Shield
    b.addBoxNode({ name: 'm2_shield', size: [0.36, 0.022, 0.09], pos: [-0.14, 0.025, 0.02], mat: vrmMat }),
    // Chipset Heatsink
    b.addBoxNode({ name: 'chipset_sink', size: [0.26, 0.05, 0.26], pos: [0.26, 0.04, 0.26], mat: vrmMat }),
    b.addBoxNode({ name: 'chipset_led', size: [0.18, 0.01, 0.03], pos: [0.26, 0.068, 0.26], mat: accentMat }),
    // CMOS Battery
    b.addCylinderNode({ name: 'cmos_battery', rTop: 0.055, rBot: 0.055, height: 0.018, pos: [0.05, 0.025, 0.24], mat: metalMat }),
    // Rear I/O ports block
    b.addBoxNode({ name: 'io_shield', size: [0.11, 0.14, 0.56], pos: [-0.44, 0.08, -0.24], mat: vrmMat }),
  ];

  saveGlb('placa_base.glb', b, nodes);
}

// 7. PlayStation 5 (PS5)
{
  const b = new GlbBuilder('PlayStation5');
  const whiteMat = b.addMaterial({ name: 'PS5White', color: [0.92, 0.94, 0.97], metallic: 0.05, roughness: 0.32 });
  const coreMat = b.addMaterial({ name: 'PS5Core', color: [0.07, 0.08, 0.10], metallic: 0.4, roughness: 0.15 });
  const blueLed = b.addMaterial({ name: 'PS5BlueLED', color: [0.05, 0.55, 1.0], metallic: 0.1, roughness: 0.2, emissive: [0.05, 0.5, 1.0] });
  const standMat = b.addMaterial({ name: 'StandDark', color: [0.12, 0.13, 0.16], metallic: 0.3, roughness: 0.5 });

  const nodes = [
    b.addCylinderNode({ name: 'base_stand', rTop: 0.26, rBot: 0.28, height: 0.03, pos: [0, 0.015, 0], mat: standMat }),
    b.addBoxNode({ name: 'center_core', size: [0.14, 0.92, 0.52], pos: [0, 0.49, 0], mat: coreMat }),
    b.addBoxNode({ name: 'shell_left', size: [0.035, 0.98, 0.58], pos: [-0.10, 0.52, 0.01], rot: quatEulerZ(3), mat: whiteMat }),
    b.addBoxNode({ name: 'shell_right', size: [0.035, 0.98, 0.58], pos: [0.10, 0.52, 0.01], rot: quatEulerZ(-3), mat: whiteMat }),
    b.addBoxNode({ name: 'led_strip_l', size: [0.015, 0.84, 0.02], pos: [-0.072, 0.50, 0.25], mat: blueLed }),
    b.addBoxNode({ name: 'led_strip_r', size: [0.015, 0.84, 0.02], pos: [0.072, 0.50, 0.25], mat: blueLed }),
  ];

  saveGlb('ps5.glb', b, nodes);
}

// 8. Samsung 980 PRO NVMe 1TB
{
  const b = new GlbBuilder('Samsung980Pro_NVMe');
  const pcbMat = b.addMaterial({ name: 'NVMePCB', color: [0.06, 0.07, 0.08], metallic: 0.2, roughness: 0.45 });
  const controllerMat = b.addMaterial({ name: 'NickelCtrl', color: [0.76, 0.79, 0.84], metallic: 0.9, roughness: 0.2 });
  const nandMat = b.addMaterial({ name: 'VNAND', color: [0.14, 0.15, 0.18], metallic: 0.2, roughness: 0.4 });
  const goldMat = b.addMaterial({ name: 'MKeyPins', color: [0.95, 0.77, 0.22], metallic: 0.95, roughness: 0.2 });
  const orangeMat = b.addMaterial({ name: 'ProAccent', color: [0.92, 0.26, 0.14], metallic: 0.2, roughness: 0.4 });

  const nodes = [
    b.addBoxNode({ name: 'm2_pcb', size: [1.10, 0.02, 0.31], pos: [0, 0, 0], mat: pcbMat }),
    b.addBoxNode({ name: 'mkey_pins', size: [0.07, 0.022, 0.25], pos: [-0.55, 0, 0.01], mat: goldMat }),
    b.addBoxNode({ name: 'elpis_controller', size: [0.16, 0.028, 0.16], pos: [-0.30, 0.018, 0], mat: controllerMat }),
    b.addBoxNode({ name: 'dram_cache', size: [0.12, 0.022, 0.14], pos: [-0.08, 0.015, 0], mat: nandMat }),
    b.addBoxNode({ name: 'nand_pkg_1', size: [0.20, 0.025, 0.22], pos: [0.16, 0.016, 0], mat: nandMat }),
    b.addBoxNode({ name: 'nand_pkg_2', size: [0.20, 0.025, 0.22], pos: [0.40, 0.016, 0], mat: nandMat }),
    b.addBoxNode({ name: 'pro_stripe', size: [0.70, 0.005, 0.04], pos: [0.06, 0.030, -0.09], mat: orangeMat }),
  ];

  saveGlb('samsung_980_pro_nvme_1tb.glb', b, nodes);
}

// 9. USB Stick PSX Prop
{
  const b = new GlbBuilder('USBStick_PSX');
  const psxGray = b.addMaterial({ name: 'PSXGray', color: [0.68, 0.70, 0.72], metallic: 0.15, roughness: 0.45 });
  const darkGray = b.addMaterial({ name: 'PSXDark', color: [0.22, 0.24, 0.27], metallic: 0.2, roughness: 0.5 });
  const steelMat = b.addMaterial({ name: 'USBPlug', color: [0.82, 0.85, 0.89], metallic: 0.95, roughness: 0.18 });
  const blueMat = b.addMaterial({ name: 'USB3Tongue', color: [0.0, 0.55, 0.95], metallic: 0.1, roughness: 0.4 });
  const ledMat = b.addMaterial({ name: 'PSXLed', color: [0.45, 0.92, 0.15], metallic: 0.1, roughness: 0.2, emissive: [0.3, 0.75, 0.1] });

  const nodes = [
    b.addBoxNode({ name: 'usb_body', size: [0.76, 0.16, 0.34], pos: [-0.10, 0, 0], mat: psxGray }),
    b.addBoxNode({ name: 'usb_trim', size: [0.52, 0.17, 0.14], pos: [-0.12, 0, 0], mat: darkGray }),
    b.addBoxNode({ name: 'usb_plug_shell', size: [0.28, 0.09, 0.24], pos: [0.40, 0, 0], mat: steelMat }),
    b.addBoxNode({ name: 'usb_tongue', size: [0.24, 0.025, 0.20], pos: [0.40, 0.015, 0], mat: blueMat }),
    b.addBoxNode({ name: 'activity_led', size: [0.04, 0.03, 0.04], pos: [-0.36, 0.08, 0.10], mat: ledMat }),
  ];

  saveGlb('usb_stick__psx_prop.glb', b, nodes);
}

// 10. AMD Ryzen 7 9800X3D CPU
{
  const b = new GlbBuilder('AMD_Ryzen7_9800X3D');
  const pcbMat = b.addMaterial({ name: 'AM5TealPCB', color: [0.04, 0.34, 0.30], metallic: 0.25, roughness: 0.4 });
  const ihsMat = b.addMaterial({ name: 'NickelIHS', color: [0.78, 0.81, 0.85], metallic: 0.92, roughness: 0.22 });
  const smdMat = b.addMaterial({ name: 'SMDCap', color: [0.75, 0.56, 0.24], metallic: 0.6, roughness: 0.3 });
  const goldMat = b.addMaterial({ name: 'LGAPads', color: [0.95, 0.77, 0.22], metallic: 0.95, roughness: 0.2 });

  const nodes = [
    b.addBoxNode({ name: 'am5_substrate', size: [0.80, 0.035, 0.80], pos: [0, 0, 0], mat: pcbMat }),
    b.addBoxNode({ name: 'lga_pads', size: [0.72, 0.008, 0.72], pos: [0, -0.020, 0], mat: goldMat }),
    b.addBoxNode({ name: 'ihs_center', size: [0.54, 0.055, 0.54], pos: [0, 0.04, 0], mat: ihsMat }),
    // Iconic AM5 IHS legs/tabs
    b.addBoxNode({ name: 'ihs_leg_1', size: [0.68, 0.055, 0.18], pos: [0, 0.04, 0.18], mat: ihsMat }),
    b.addBoxNode({ name: 'ihs_leg_2', size: [0.68, 0.055, 0.18], pos: [0, 0.04, -0.18], mat: ihsMat }),
    b.addBoxNode({ name: 'ihs_leg_3', size: [0.18, 0.055, 0.68], pos: [0.18, 0.04, 0], mat: ihsMat }),
    b.addBoxNode({ name: 'ihs_leg_4', size: [0.18, 0.055, 0.68], pos: [-0.18, 0.04, 0], mat: ihsMat }),
  ];

  // SMD Capacitors in cutouts
  for (const [sx, sz] of [[0, 0.34], [0, -0.34], [0.34, 0], [-0.34, 0]]) {
    nodes.push(b.addBoxNode({ name: `smd_${sx}_${sz}`, size: [0.06, 0.02, 0.06], pos: [sx, 0.025, sz], mat: smdMat }));
  }

  saveGlb('amd_9800x3d_cpu_-_super_low_poly.glb', b, nodes);
}

// 11. Parrot ANAFI Drone
{
  const b = new GlbBuilder('Parrot_ANAFI');
  const bodyMat = b.addMaterial({ name: 'CarbonSlate', color: [0.24, 0.27, 0.31], metallic: 0.45, roughness: 0.4 });
  const darkMat = b.addMaterial({ name: 'PropDark', color: [0.09, 0.10, 0.12], metallic: 0.25, roughness: 0.45 });
  const lensMat = b.addMaterial({ name: 'CameraLens', color: [0.03, 0.18, 0.32], metallic: 0.9, roughness: 0.1, emissive: [0.0, 0.12, 0.22] });
  const tipMat = b.addMaterial({ name: 'AccentCyan', color: [0.0, 0.72, 1.0], metallic: 0.3, roughness: 0.3, emissive: [0.0, 0.3, 0.5] });

  const nodes = [
    b.addBoxNode({ name: 'fuselage', size: [0.22, 0.12, 0.72], pos: [0, 0, 0], mat: bodyMat }),
    b.addBoxNode({ name: 'battery_pack', size: [0.19, 0.09, 0.32], pos: [0, 0.02, -0.18], mat: darkMat }),
    b.addSphereNode({ name: 'gimbal_cam', radius: 0.085, pos: [0, -0.01, 0.39], mat: darkMat }),
    b.addCylinderNode({ name: 'cam_lens', rTop: 0.045, rBot: 0.045, height: 0.03, pos: [0, -0.01, 0.47], rot: quatEulerX(90), mat: lensMat }),
  ];

  const armCoords = [
    [-0.36, 0.02, 0.30, 35],
    [0.36, 0.02, 0.30, -35],
    [-0.36, 0.02, -0.28, -35],
    [0.36, 0.02, -0.28, 35],
  ];
  const rotors = [];
  armCoords.forEach(([ax, ay, az, deg], idx) => {
    nodes.push(b.addBoxNode({ name: 'arm_' + idx, size: [0.56, 0.03, 0.04], pos: [ax * 0.52, ay, az * 0.6], rot: quatEulerY(deg), mat: bodyMat }));
    nodes.push(b.addCylinderNode({ name: 'motor_' + idx, rTop: 0.042, rBot: 0.045, height: 0.06, pos: [ax, ay + 0.02, az], mat: darkMat }));
    const bladeA = b.addBoxNode({ name: 'prop_a_' + idx, size: [0.42, 0.008, 0.045], pos: [0, 0, 0], mat: darkMat });
    const bladeB = b.addBoxNode({ name: 'prop_b_' + idx, size: [0.045, 0.008, 0.42], pos: [0, 0, 0], mat: tipMat });
    const rotor = b.addNode({ name: 'rotor_' + idx, translation: [ax, ay + 0.055, az], children: [bladeA, bladeB] });
    nodes.push(rotor);
    rotors.push(rotor);
  });
  b.addSpinAnimation('Helices_Dron', rotors, 'y', 0.45);

  saveGlb('anafi_parrot.glb', b, nodes);
}

// 12. Arduino Uno
{
  const b = new GlbBuilder('Arduino_Uno');
  const pcbMat = b.addMaterial({ name: 'ArduinoTeal', color: [0.0, 0.48, 0.52], metallic: 0.15, roughness: 0.42 });
  const silverMat = b.addMaterial({ name: 'SilverMetal', color: [0.80, 0.83, 0.87], metallic: 0.92, roughness: 0.2 });
  const blackMat = b.addMaterial({ name: 'PlasticBlack', color: [0.08, 0.09, 0.11], metallic: 0.1, roughness: 0.55 });
  const goldMat = b.addMaterial({ name: 'PinsGold', color: [0.95, 0.78, 0.22], metallic: 0.9, roughness: 0.25 });
  const ledGreen = b.addMaterial({ name: 'LEDGreen', color: [0.45, 0.95, 0.15], metallic: 0.1, roughness: 0.2, emissive: [0.25, 0.75, 0.05] });
  const resetRed = b.addMaterial({ name: 'ResetBtn', color: [0.90, 0.22, 0.22], metallic: 0.1, roughness: 0.4 });

  const nodes = [
    b.addBoxNode({ name: 'uno_pcb', size: [1.05, 0.03, 0.82], pos: [0, 0, 0], mat: pcbMat }),
    // USB-B Port & Barrel Jack
    b.addBoxNode({ name: 'usb_b_port', size: [0.24, 0.17, 0.19], pos: [-0.46, 0.095, -0.22], mat: silverMat }),
    b.addBoxNode({ name: 'dc_barrel_jack', size: [0.22, 0.17, 0.15], pos: [-0.45, 0.095, 0.25], mat: blackMat }),
    // ATmega328P DIP IC
    b.addBoxNode({ name: 'atmega328p', size: [0.54, 0.055, 0.14], pos: [0.16, 0.04, 0.12], mat: blackMat }),
    // Pin Headers
    b.addBoxNode({ name: 'hdr_digital', size: [0.68, 0.11, 0.05], pos: [0.12, 0.065, -0.35], mat: blackMat }),
    b.addBoxNode({ name: 'hdr_power', size: [0.30, 0.11, 0.05], pos: [-0.04, 0.065, 0.35], mat: blackMat }),
    b.addBoxNode({ name: 'hdr_analog', size: [0.26, 0.11, 0.05], pos: [0.30, 0.065, 0.35], mat: blackMat }),
    // Crystal & Reset & LED
    b.addBoxNode({ name: 'crystal_16mhz', size: [0.14, 0.04, 0.06], pos: [-0.16, 0.035, -0.05], mat: silverMat }),
    b.addBoxNode({ name: 'reset_btn', size: [0.06, 0.04, 0.06], pos: [-0.42, 0.035, -0.34], mat: resetRed }),
    b.addBoxNode({ name: 'icsp_pins', size: [0.08, 0.08, 0.09], pos: [0.46, 0.05, 0.0], mat: goldMat }),
    b.addBoxNode({ name: 'on_led', size: [0.04, 0.025, 0.03], pos: [0.34, 0.025, -0.14], mat: ledGreen }),
  ];

  saveGlb('arduino_uno.glb', b, nodes);
}

// 13. PC Gamer Torre Personalizada
{
  const b = new GlbBuilder('PC_Gamer_Torre');
  const caseMat = b.addMaterial({ name: 'TowerSteel', color: [0.10, 0.12, 0.16], metallic: 0.75, roughness: 0.38 });
  const glassMat = b.addMaterial({ name: 'TemperedGlass', color: [0.55, 0.80, 0.95, 0.22], metallic: 0.1, roughness: 0.08, alphaMode: 'BLEND', doubleSided: true });
  const moboMat = b.addMaterial({ name: 'InternalMobo', color: [0.05, 0.10, 0.15], metallic: 0.3, roughness: 0.4 });
  const rgbCyan = b.addMaterial({ name: 'RGBCyan', color: [0.0, 0.82, 1.0], metallic: 0.2, roughness: 0.2, emissive: [0.0, 0.65, 0.95] });
  const rgbNeon = b.addMaterial({ name: 'RGBNeon', color: [0.71, 0.91, 0.0], metallic: 0.2, roughness: 0.2, emissive: [0.45, 0.72, 0.0] });
  const bladeMat = b.addMaterial({ name: 'BladeDark', color: [0.16, 0.18, 0.22], metallic: 0.3, roughness: 0.4 });

  const nodes = [
    // Frame (top, bottom, back, front bezel)
    b.addBoxNode({ name: 'case_bottom', size: [0.46, 0.05, 0.94], pos: [0, 0.025, 0], mat: caseMat }),
    b.addBoxNode({ name: 'case_top', size: [0.46, 0.04, 0.94], pos: [0, 0.98, 0], mat: caseMat }),
    b.addBoxNode({ name: 'case_back', size: [0.46, 0.96, 0.04], pos: [0, 0.50, -0.45], mat: caseMat }),
    b.addBoxNode({ name: 'case_right_panel', size: [0.03, 0.94, 0.92], pos: [-0.215, 0.50, 0], mat: caseMat }),
    b.addBoxNode({ name: 'psu_shroud', size: [0.40, 0.20, 0.86], pos: [0, 0.15, -0.01], mat: caseMat }),
    // Internal Components
    b.addBoxNode({ name: 'internal_mobo', size: [0.03, 0.58, 0.54], pos: [-0.14, 0.60, -0.10], mat: moboMat }),
    b.addBoxNode({ name: 'internal_gpu', size: [0.22, 0.08, 0.48], pos: [-0.03, 0.44, -0.05], mat: caseMat }),
    b.addBoxNode({ name: 'gpu_rgb', size: [0.02, 0.025, 0.44], pos: [0.08, 0.44, -0.05], mat: rgbCyan }),
    b.addBoxNode({ name: 'cpu_cooler', size: [0.18, 0.18, 0.18], pos: [-0.04, 0.68, -0.14], mat: caseMat }),
    b.addBoxNode({ name: 'ram_stick_1', size: [0.07, 0.16, 0.015], pos: [-0.09, 0.68, 0.04], mat: rgbNeon }),
    b.addBoxNode({ name: 'ram_stick_2', size: [0.07, 0.16, 0.015], pos: [-0.09, 0.68, 0.08], mat: rgbNeon }),
    // Glass side panel
    b.addBoxNode({ name: 'glass_panel', size: [0.015, 0.90, 0.88], pos: [0.22, 0.50, 0], mat: glassMat }),
  ];

  // 3 Front RGB Intake Fans
  const frontFans = [];
  [0.24, 0.52, 0.80].forEach((fy, idx) => {
    const parts = createFanAssembly(b, 0.12, 0.03, rgbCyan, bladeMat, 'z');
    const rotor = b.addNode({ name: 'front_fan_' + idx, translation: [0, fy, 0.45], children: parts });
    nodes.push(rotor);
    frontFans.push(rotor);
  });
  b.addSpinAnimation('Ventiladores_Torre', frontFans, 'z', 0.85);

  saveGlb('pc_gamer.glb', b, nodes);
}

console.log('All 13 GLB models generated successfully in public/models/');
