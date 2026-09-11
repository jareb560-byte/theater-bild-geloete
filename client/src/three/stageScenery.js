import * as THREE from 'three';

/** Indicative theater dressing. Only the supplied house opening/deck uses venue dimensions. */
export function createStageScenery(house) {
  const group = new THREE.Group();
  group.name = 'indicative-theater-surround';
  const materials = {
    shell: new THREE.MeshStandardMaterial({ color: 0x303b49, roughness: 0.66, metalness: 0.2 }),
    velvet: new THREE.MeshStandardMaterial({ color: 0x293448, roughness: 0.95, metalness: 0, side: THREE.DoubleSide }),
    metal: new THREE.MeshStandardMaterial({ color: 0x596776, roughness: 0.37, metalness: 0.7 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x9d8a69, roughness: 0.4, metalness: 0.65 }),
    lens: new THREE.MeshBasicMaterial({ color: 0xb2d9ff, toneMapped: false }),
    edge: new THREE.MeshBasicMaterial({ color: 0x78664a, toneMapped: false }),
  };
  const box = new THREE.BoxGeometry(1, 1, 1);
  const rod = new THREE.CylinderGeometry(1, 1, 1, 8);
  const p = house.prosceniumWidthM / 2;
  const h = house.prosceniumHeightM;
  const z = house.prosceniumZ;

  function block(material, sx, sy, sz, x, y, depth) {
    const mesh = new THREE.Mesh(box, material);
    mesh.scale.set(sx, sy, sz);
    mesh.position.set(x, y, depth);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }

  function bar(a, b, radius = 0.025) {
    const direction = b.clone().sub(a);
    const mesh = new THREE.Mesh(rod, materials.metal);
    mesh.scale.set(radius, direction.length(), radius);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    group.add(mesh);
  }

  function curtain(width, height, x, depth, folds = 12) {
    const geo = new THREE.PlaneGeometry(width, height, folds * 12, 10);
    const positions = geo.attributes.position;
    for (let i = 0; i < positions.count; i += 1) {
      const u = positions.getX(i) / width + 0.5;
      const v = positions.getY(i) / height + 0.5;
      const fold = Math.cos(u * Math.PI * 2 * folds) * 0.09 + Math.cos(u * Math.PI * 4 * folds) * 0.025;
      positions.setZ(i, fold * (0.82 + 0.18 * v));
      positions.setY(i, positions.getY(i) + (1 - v) * 0.025 * Math.cos(u * Math.PI * 2 * folds));
    }
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, materials.velvet);
    mesh.position.set(x, height / 2 + 0.025, depth);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // Recessed architectural surround leaves the configured opening completely clear.
  for (const side of [-1, 1]) {
    block(materials.shell, 1.55, h + 1.25, 0.85, side * (p + 1.3), (h + 1.25) / 2, z + 0.12);
    block(materials.shell, 0.17, h + 0.5, 0.22, side * (p + 0.57), (h + 0.5) / 2, z - 0.52);
    block(materials.trim, 0.022, h + 0.46, 0.035, side * (p + 0.48), (h + 0.46) / 2, z - 0.66);
    curtain(1.3, h, side * (p + 0.65), z + 0.65, 10);
    // Wing legs imply the scene's depth while keeping the central sightline open.
    for (let i = 1; i <= 3; i += 1) {
      curtain(0.8, h, side * (p + 0.72), z + i * house.stageDepthM / 4, 7);
    }
  }
  block(materials.shell, p * 2 + 4.1, 0.6, 1.1, 0, h + 0.95, z + 0.05);
  block(materials.trim, p * 2 + 1, 0.024, 0.035, 0, h + 0.48, z - 0.66);
  curtain(p * 2 + 1.1, 0.58, 0, z + 0.6, Math.round(p * 10));
  const border = group.children[group.children.length - 1];
  border.position.y = h + 0.3;

  const backZ = house.stageFrontZ + house.stageDepthM;
  curtain(house.stageWidthM, h + 0.5, 0, backZ + 0.05, Math.round(house.stageWidthM * 5));

  // Visible front edge, timber fascia, and a thin non-luminous safety marking.
  block(materials.shell, house.stageWidthM, 0.42, 0.24, 0, -0.22, house.stageFrontZ + 0.1);
  block(materials.edge, p * 2, 0.014, 0.016, 0, 0.01, house.stageFrontZ + 0.045);
  for (const side of [-1, 1]) {
    for (let step = 0; step < 3; step += 1) {
      const height = (step + 1) * 0.14;
      block(materials.shell, 1.05, height, 0.36, side * (p + 1.65), -0.43 + height / 2, house.stageFrontZ - 0.9 + step * 0.33);
    }
  }

  // One quiet front lighting bar; the fixture optics face downstage-center.
  const rigZ = z - 1.05;
  const rigY = h + 0.36;
  const left = -p - 0.2;
  const right = p + 0.2;
  for (const dy of [-0.15, 0.15]) {
    bar(new THREE.Vector3(left, rigY + dy, rigZ), new THREE.Vector3(right, rigY + dy, rigZ));
  }
  for (let x = left; x < right; x += 0.65) {
    bar(new THREE.Vector3(x, rigY - 0.15, rigZ), new THREE.Vector3(Math.min(x + 0.65, right), rigY + 0.15, rigZ), 0.012);
  }
  const fixtureGeo = new THREE.CylinderGeometry(0.13, 0.16, 0.38, 14);
  const lensGeo = new THREE.CircleGeometry(0.103, 18);
  for (let index = 0; index < 8; index += 1) {
    const x = THREE.MathUtils.lerp(-p + 0.45, p - 0.45, index / 7);
    const fixture = new THREE.Mesh(fixtureGeo, materials.metal);
    fixture.position.set(x, rigY - 0.4, rigZ);
    fixture.rotation.x = -0.55;
    group.add(fixture);
    const lens = new THREE.Mesh(lensGeo, materials.lens);
    lens.rotation.x = Math.PI / 2;
    lens.position.y = -0.195;
    fixture.add(lens);
    bar(new THREE.Vector3(x, rigY - 0.15, rigZ), new THREE.Vector3(x, rigY - 0.29, rigZ), 0.02);
  }

  return group;
}

/** 1.80 m neutral reference, readable from the side and from the plan view. */
export function createReferenceFigure() {
  const figure = new THREE.Group();
  figure.name = 'reference-performer-1.80m';
  const suit = new THREE.MeshStandardMaterial({ color: 0x37424d, roughness: 0.92 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xaa9984, roughness: 0.9 });
  const capsule = new THREE.CapsuleGeometry(1, 1, 4, 8);
  const sphere = new THREE.SphereGeometry(1, 16, 12);
  function part(geo, material, size, position, tilt = 0) {
    const mesh = new THREE.Mesh(geo, material);
    mesh.scale.set(...size);
    mesh.position.set(...position);
    mesh.rotation.z = tilt;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    figure.add(mesh);
  }
  part(sphere, skin, [0.108, 0.13, 0.108], [0, 1.67, 0]);
  part(capsule, suit, [0.18, 0.18, 0.11], [0, 1.22, 0]);
  part(capsule, suit, [0.068, 0.275, 0.074], [-0.092, 0.5, 0], -0.045);
  part(capsule, suit, [0.068, 0.275, 0.074], [0.092, 0.5, 0.015], 0.035);
  part(capsule, suit, [0.051, 0.19, 0.054], [-0.225, 1.11, 0], -0.1);
  part(capsule, suit, [0.051, 0.19, 0.054], [0.225, 1.11, 0], 0.1);
  for (const side of [-1, 1]) {
    part(sphere, skin, [0.043, 0.07, 0.038], [side * 0.24, 0.78, 0]);
    part(sphere, suit, [0.078, 0.06, 0.14], [side * 0.1, 0.065, -0.045]);
  }
  return figure;
}

/** Fine painted-deck grain; deterministic so the surface stays stable between venue loads. */
export function createDeckTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  const pixels = context.createImageData(512, 512);
  let seed = 817;
  for (let y = 0; y < 512; y += 1) {
    for (let x = 0; x < 512; x += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const value = 170 + (seed >>> 28) + Math.sin(y * 0.43) * 2;
      const i = (y * 512 + x) * 4;
      pixels.data[i] = value;
      pixels.data[i + 1] = value;
      pixels.data[i + 2] = value;
      pixels.data[i + 3] = 255;
    }
  }
  context.putImageData(pixels, 0, 0);
  context.strokeStyle = 'rgba(22,26,32,0.18)';
  context.lineWidth = 1;
  context.strokeRect(0.5, 0.5, 511, 511);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.repeat.set(12, 6);
  return texture;
}
