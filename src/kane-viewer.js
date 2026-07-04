import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const CLOCK = new THREE.Clock();

export class KaneViewer {
  constructor(container, { onStatus, transparent = false, showFloor = true } = {}) {
    this.container = container;
    this.onStatus = onStatus || (() => {});
    this.root = null; // top-level Object3D of the loaded/placeholder avatar
    this.mixer = null;

    this.scene = new THREE.Scene();
    if (!transparent) {
      this.scene.background = new THREE.Color(0x0b0b12);
      this.scene.fog = new THREE.Fog(0x0b0b12, 4, 12);
    }

    this.camera = new THREE.PerspectiveCamera(
      32, container.clientWidth / container.clientHeight, 0.1, 100
    );
    this.camera.position.set(0, 1.55, 2.6);
    this.camera.lookAt(0, 1.5, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: transparent });
    if (transparent) this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = true;
    container.appendChild(this.renderer.domElement);

    this._buildLighting();
    if (showFloor) this._buildFloor();

    window.addEventListener('resize', () => this._onResize());
    this._onResize();

    this.renderer.setAnimationLoop((t) => this._tick(t));
  }

  _buildLighting() {
    const key = new THREE.DirectionalLight(0xfff2e0, 2.4);
    key.position.set(1.2, 2.4, 1.6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0x8fa8ff, 0.7);
    fill.position.set(-1.6, 1.2, 1.0);
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(0xb08cff, 1.1);
    rim.position.set(-0.6, 2.0, -2.0);
    this.scene.add(rim);

    this.scene.add(new THREE.AmbientLight(0x404060, 0.5));
  }

  _buildFloor() {
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(3, 48),
      new THREE.MeshStandardMaterial({ color: 0x14141f, roughness: 0.9, metalness: 0.05 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
  }

  /** Load a rigged glTF/GLB avatar. Falls back to a placeholder if it fails. */
  async loadModel(url) {
    this.onStatus(`loading model…`);
    const loader = new GLTFLoader();
    try {
      const gltf = await loader.loadAsync(url);
      this._setRoot(gltf.scene, gltf.animations);
      this.onStatus('model loaded');
      return gltf;
    } catch (err) {
      console.error('Kane: failed to load model', err);
      this.onStatus('model load failed — using placeholder');
      this._setRoot(buildPlaceholder(), []);
      return null;
    }
  }

  usePlaceholder() {
    this._setRoot(buildPlaceholder(), []);
    this.onStatus('placeholder avatar (no model loaded yet)');
  }

  _setRoot(object3D, animations) {
    if (this.root) this.scene.remove(this.root);
    this.root = object3D;
    this.root.traverse((n) => {
      if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; }
    });
    this.scene.add(this.root);
    this.mixer = animations && animations.length ? new THREE.AnimationMixer(this.root) : null;

    // Collect capability info for the animator layer.
    this.bones = {};
    this.morphMeshes = [];
    this.root.traverse((n) => {
      if (n.isBone || n.isObject3D) {
        const name = (n.name || '').toLowerCase();
        for (const key of ['head', 'neck', 'spine', 'lefteye', 'righteye', 'hips']) {
          if (name === key || name.includes(key)) this.bones[key] = this.bones[key] || n;
        }
      }
      if (n.isMesh && n.morphTargetDictionary) this.morphMeshes.push(n);
    });

    console.info('Kane viewer: detected bones', Object.keys(this.bones));
    console.info('Kane viewer: morph target meshes', this.morphMeshes.map((m) => ({
      mesh: m.name, targets: Object.keys(m.morphTargetDictionary),
    })));
  }

  _onResize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  _tick() {
    const dt = CLOCK.getDelta();
    if (this.mixer) this.mixer.update(dt);
    if (this._onFrame) this._onFrame(dt);
    this.renderer.render(this.scene, this.camera);
  }

  /** Register a per-frame callback (used by the animator). */
  onFrame(fn) { this._onFrame = fn; }
}

/** A simple stand-in humanoid (head/eyes/mouth/body) used until a real glTF is supplied. */
function buildPlaceholder() {
  const group = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xd9a878, roughness: 0.55 });
  const outfit = new THREE.MeshStandardMaterial({ color: 0x22224c, roughness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x151520, roughness: 0.5 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.55, 8, 16), outfit);
  body.position.y = 1.0;
  group.add(body);

  const headGroup = new THREE.Group();
  headGroup.name = 'Head';
  headGroup.position.y = 1.55;
  group.add(headGroup);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 32, 32), skin);
  headGroup.add(head);

  const eyeGeo = new THREE.SphereGeometry(0.018, 12, 12);
  const eyeL = new THREE.Mesh(eyeGeo, dark);
  eyeL.name = 'LeftEye';
  eyeL.position.set(-0.055, 0.02, 0.14);
  headGroup.add(eyeL);

  const eyeR = new THREE.Mesh(eyeGeo, dark);
  eyeR.name = 'RightEye';
  eyeR.position.set(0.055, 0.02, 0.14);
  headGroup.add(eyeR);

  const mouth = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.012, 0.01),
    new THREE.MeshStandardMaterial({ color: 0x7a3028 })
  );
  mouth.name = 'Mouth';
  mouth.position.set(0, -0.075, 0.15);
  headGroup.add(mouth);

  group.name = 'KanePlaceholder';
  group.userData.isPlaceholder = true;
  group.userData.parts = { head: headGroup, eyeL, eyeR, mouth };
  return group;
}
