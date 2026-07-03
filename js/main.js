import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { LightProbeGrid } from 'three/addons/lighting/LightProbeGrid.js';
import { LightProbeGridHelper } from 'three/addons/helpers/LightProbeGridHelper.js';
import { createWorldSettings, createWorld, addBroadphaseLayer, addObjectLayer, enableCollision, registerAll, updateWorld, rigidBody, box, MotionType, MotionQuality } from 'crashcat';
import { Vehicle, MAX_SPEED } from './Vehicle.js';
import { Camera } from './Camera.js';
import { Controls } from './Controls.js';
import { buildTrack, decodeCells, computeSpawnPosition, computeTrackBounds } from './Track.js';
import { buildWallColliders, createSphereBody } from './Physics.js';
import { SmokeTrails } from './Particles.js';
import { DriftMarks } from './DriftMarks.js';
import { GameAudio } from './Audio.js';
import { LapTimer } from './LapTimer.js';
import { ColorMapGLTFLoader } from './Loader.js';




const renderer = new THREE.WebGLRenderer({ antialias: true, outputBufferType: THREE.HalfFloatType });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight));
bloomPass.strength = 0.02;
bloomPass.radius = 0.02;
bloomPass.threshold = 0.5;

renderer.setEffects([bloomPass]);

document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xadb2ba);
scene.fog = new THREE.Fog(0xadb2ba, 30, 55);

const dirLight = new THREE.DirectionalLight(0xffffff, 3);
dirLight.position.set(11.4, 15, -5.3);
dirLight.castShadow = true;
dirLight.shadow.mapSize.setScalar(4096);
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 60;
dirLight.shadow.radius = 4;
scene.add(dirLight);

const hemiLight = new THREE.HemisphereLight(0xc8d8e8, 0x7a8a5a, 2);
hemiLight.position.copy(dirLight.position)
scene.add(hemiLight);

window.addEventListener('resize', () => {

	renderer.setSize(window.innerWidth, window.innerHeight);

});

const loader = new ColorMapGLTFLoader();

// Přidány všechny nové modely včetně pine a track-bump
const modelNames = [
	'vehicle-truck-yellow', 'vehicle-truck-green', 'vehicle-truck-purple', 'vehicle-truck-red',
	'track-straight', 'track-corner', 'track-bump', 'track-finish', 'track_x',
	'decoration-empty', 'decoration-forest', 'decoration-tents', 'tire',
	'pine', 'pine-fall', 'brash_bag', 'house2', 'town_sign', 'traffic_barrier',
	'tree_k', 'twisted_tree', 'wheels_stack', 'fence', 'fence_long', 'r2', 'stop_sign'
];

const models = {};

window.gameAudio = null;

async function loadModels() {

	const promises = modelNames.map((name) =>
		new Promise((resolve, reject) => {

			loader.load(`models/${name}.glb`, (gltf) => {

				const meshes = [];
				gltf.scene.traverse((child) => {

					if (child.isMesh) {

						child.material.side = THREE.FrontSide;
						meshes.push(child);

					}

				});

				if (name.startsWith('vehicle-')) {

					gltf.scene.scale.setScalar(0.5);

				}

				if (meshes.length === 1) {

					const mesh = meshes[0];
					mesh.removeFromParent();
					models[name] = mesh;

				} else {

					models[name] = gltf.scene;

				}

				resolve();

			}, undefined, reject);

		})
	);

	await Promise.all(promises);

}

async function init() {

	registerAll();
	await loadModels();

	let customCells = null;
	let customProps = [];
	let spawn = null;

	// Načtení mapy ze staženého souboru default-map.json
	try {
		const response = await fetch('./default-map.json');
		if (response.ok) {
			const data = await response.json();
			if (data.track && data.track.length > 0) {
				customCells = data.track;
				spawn = computeSpawnPosition(customCells);
			}
			if (data.props) {
				customProps = data.props;
			}
		}
	} catch (e) {
		console.warn('Nepodařilo se stáhnout default-map.json');
	}

	const bounds = computeTrackBounds(customCells);
	const hw = bounds.halfWidth;
	const hd = bounds.halfDepth;

	// Výrazně zvětšený prostor (přidáno 150 metrů do všech stran)
	const groundSize = Math.max(hw, hd) * 2 + 150;

	// Změna barvy pozadí na světle modrou oblohu
	scene.background = new THREE.Color(0x87CEEB);
	scene.fog = new THREE.Fog(0x87CEEB, 30, groundSize * 0.8);

	const shadowExtent = Math.max(hw, hd) + 40;
	dirLight.shadow.camera.left = - shadowExtent;
	dirLight.shadow.camera.right = shadowExtent;
	dirLight.shadow.camera.top = shadowExtent;
	dirLight.shadow.camera.bottom = - shadowExtent;
	dirLight.shadow.camera.updateProjectionMatrix();

	// VYTVOŘENÍ ZELENÉ PODLAHY (Tráva)
	const groundMat = new THREE.MeshStandardMaterial({ color: 0x614939, roughness: 0.8, metalness: 0.1 });
	const ground = new THREE.Mesh(new THREE.PlaneGeometry(groundSize, groundSize), groundMat);
	ground.rotation.x = - Math.PI / 2;
	ground.position.y = - 0.14;
	ground.receiveShadow = true;
	scene.add(ground);

	buildTrack(scene, models, customCells);

	const probeHeight = 6;
	const probes = new LightProbeGrid(
		hw * 2, probeHeight, hd * 2,
		Math.max(4, Math.round(hw / 4)),
		2,
		Math.max(4, Math.round(hd / 4)),
	);
	probes.position.set(bounds.centerX, probeHeight / 2, bounds.centerZ);
	probes.bake(renderer, scene, { cubemapSize: 32, near: 0.1, far: groundSize });
	scene.add(probes);

	const worldSettings = createWorldSettings();
	worldSettings.gravity = [0, - 9.81, 0];

	const BPL_MOVING = addBroadphaseLayer(worldSettings);
	const BPL_STATIC = addBroadphaseLayer(worldSettings);
	const OL_MOVING = addObjectLayer(worldSettings, BPL_MOVING);
	const OL_STATIC = addObjectLayer(worldSettings, BPL_STATIC);

	enableCollision(worldSettings, OL_MOVING, OL_STATIC);
	enableCollision(worldSettings, OL_MOVING, OL_MOVING);

	const world = createWorld(worldSettings);
	world._OL_MOVING = OL_MOVING;
	world._OL_STATIC = OL_STATIC;

	buildWallColliders(world, null, customCells);

	const roadHalf = groundSize / 2;
	rigidBody.create(world, {
		shape: box.create({ halfExtents: [roadHalf, 0.01, roadHalf] }),
		motionType: MotionType.STATIC,
		objectLayer: OL_STATIC,
		position: [bounds.centerX, - 0.125, bounds.centerZ],
		friction: 5.0,
		restitution: 0.0,
	});

	// ─── Generování vlastních objektů a fyziky ───
	const dynamicTires = [];

	for (const prop of customProps) {

		const px = prop.x * 0.75;
		const pz = prop.z * 0.75;

		// Ochrana proti černé obrazovce, kdyby se nějaký model nenačetl
		if (!models[prop.type]) continue;

		const mesh = models[prop.type].clone();
		mesh.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
		mesh.rotation.y = prop.rot;


		// ==========================================
		// 1. POHYBLIVÉ OBJEKTY (DYNAMICKÉ)
		// ==========================================

		if (prop.type === 'tire') {
            const halfY = 0.25; // Polovina výšky boxu (Y halfExtents)
            
            // 1. FYZIKA
            // Spodek boxu musí být na 0, střed tedy musí být na hodnotě halfY
            const body = rigidBody.create(world, {
                shape: box.create({ halfExtents: [0.25, halfY, 0.15] }),
                motionType: MotionType.DYNAMIC, 
                objectLayer: OL_MOVING,
                position: [px, halfY, pz], // Opraveno z 0.5 na 0.25
                mass: 30.0, friction: 3.0, restitution: 0.4, linearDamping: 2.0, angularDamping: 2.0,
            });

            // 2. VIZUÁLNÍ MODEL
            const mesh = models[prop.type].clone();
            mesh.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
            mesh.rotation.y = prop.rot;
            // Vizuální posun modelu dolů, aby seděl na zemi
            mesh.position.set(0, -halfY, 0);

            // 3. OBAL (WRAPPER)
            const wrapper = new THREE.Group();
            wrapper.add(mesh);
            scene.add(wrapper);
            
            dynamicTires.push({ body: body, mesh: wrapper });
		} else if (prop.type === 'wheels_stack') {
			const halfY = 0.6; // Polovina výšky tvého fyzikálního boxu

			// 1. FYZIKA
			// Střed tělesa musíme zvednout o halfY nahoru, aby spodní hrana seděla na nule
			const body = rigidBody.create(world, {
				shape: box.create({ halfExtents: [0.35, halfY, 0.35] }),
				motionType: MotionType.DYNAMIC, objectLayer: OL_MOVING,
				position: [px, halfY, pz],
				mass: 60.0, friction: 3.0, restitution: 0.4, linearDamping: 2.0, angularDamping: 2.0,
			});

			// 2. VIZUÁLNÍ MODEL
			const mesh = models[prop.type].clone();
			mesh.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
			mesh.rotation.y = prop.rot;

			// ZDE JE OPRAVA LEVITACE: 
			// Model posuneme o jeho poloviční výšku dolů (do minusu).
			mesh.position.set(0, -halfY, 0);

			// 3. OBAL (WRAPPER)
			// Vytvoříme skupinu. Model je uvnitř ní posunutý dolů. Fyzika hýbe skupinou.
			const wrapper = new THREE.Group();
			wrapper.add(mesh);
			scene.add(wrapper);

			// Do animace pošleme skupinu, nikoliv samotný model
			dynamicTires.push({ body: body, mesh: wrapper });


		} else if (prop.type === 'stop_sign') {
			const halfY = 0.6; // Polovina výšky tvého fyzikálního boxu

			// 1. FYZIKA
			// Střed tělesa musíme zvednout o halfY nahoru, aby spodní hrana seděla na nule
			const body = rigidBody.create(world, {
				shape: box.create({ halfExtents: [0.35, halfY, 0.35] }),
				motionType: MotionType.DYNAMIC, objectLayer: OL_MOVING,
				position: [px, halfY, pz],
				mass: 60.0, friction: 3.0, restitution: 0.4, linearDamping: 2.0, angularDamping: 2.0,
			});

			// 2. VIZUÁLNÍ MODEL
			const mesh = models[prop.type].clone();
			mesh.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
			mesh.rotation.y = prop.rot;

			// ZDE JE OPRAVA LEVITACE: 
			// Model posuneme o jeho poloviční výšku dolů (do minusu).
			mesh.position.set(0, -halfY, 0);

			// 3. OBAL (WRAPPER)
			// Vytvoříme skupinu. Model je uvnitř ní posunutý dolů. Fyzika hýbe skupinou.
			const wrapper = new THREE.Group();
			wrapper.add(mesh);
			scene.add(wrapper);

			// Do animace pošleme skupinu, nikoliv samotný model
			dynamicTires.push({ body: body, mesh: wrapper });


		} else if (prop.type === 'town_sign') {
			const halfY = 0.6;

			const body = rigidBody.create(world, {
				shape: box.create({ halfExtents: [0.8, halfY, 0.1] }),
				motionType: MotionType.DYNAMIC, objectLayer: OL_MOVING, position: [px, halfY, pz],
				mass: 25.0, friction: 3.0, restitution: 0.2, linearDamping: 2.0, angularDamping: 2.0,
			});

			const mesh = models[prop.type].clone();
			mesh.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
			mesh.rotation.y = prop.rot;
			mesh.position.set(0, -halfY, 0); // Vizuální model sražen na zem

			const wrapper = new THREE.Group();
			wrapper.add(mesh);
			scene.add(wrapper);
			dynamicTires.push({ body: body, mesh: wrapper });

		} else if (prop.type === 'traffic_barrier') {
			const halfY = 0.5; // Polovina výšky bariéry z tvých halfExtents

			const body = rigidBody.create(world, {
				shape: box.create({ halfExtents: [1.2, halfY, 0.3] }),
				motionType: MotionType.DYNAMIC, objectLayer: OL_MOVING, position: [px, halfY, pz],
				mass: 20.0, friction: 3.0, restitution: 0.2, linearDamping: 2.0, angularDamping: 2.0,
			});

			const mesh = models[prop.type].clone();
			mesh.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
			mesh.rotation.y = prop.rot;

			// Posunutí vizuálního modelu dolů uvnitř neviditelného obalu
			mesh.position.set(0, -halfY, 0);

			const wrapper = new THREE.Group();
			wrapper.add(mesh);
			scene.add(wrapper);

			// Do animace posíláme obal, nikoliv samotný model
			dynamicTires.push({ body: body, mesh: wrapper });


		} else if (prop.type === 'brash_bag') {
			const halfY = 0.4;

			const body = rigidBody.create(world, {
				shape: box.create({ halfExtents: [0.3, halfY, 0.3] }),
				motionType: MotionType.DYNAMIC, objectLayer: OL_MOVING, position: [px, halfY, pz],
				mass: 5.0, friction: 3.0, restitution: 0.2, linearDamping: 2.0, angularDamping: 2.0,
			});

			const mesh = models[prop.type].clone();
			mesh.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
			mesh.rotation.y = prop.rot;
			mesh.position.set(0, -halfY, 0); // Vizuální model sražen na zem

			const wrapper = new THREE.Group();
			wrapper.add(mesh);
			scene.add(wrapper);
			dynamicTires.push({ body: body, mesh: wrapper });

		} else if (prop.type === 'r2') {
			mesh.position.set(px, 0.5, pz);
			scene.add(mesh);

			const body = rigidBody.create(world, {
				shape: box.create({ halfExtents: [0.4, 0.5, 0.4] }),
				motionType: MotionType.DYNAMIC, objectLayer: OL_MOVING, position: [px, 0.5, pz],
				mass: 40.0, friction: 3.0, restitution: 0.2, linearDamping: 2.0, angularDamping: 2.0,
			});
			dynamicTires.push({ body: body, mesh: mesh });


			} else if (prop.type === 'fence_long') {
			const halfY = 0.5; // Polovina výšky z tvých halfExtents
			
			// 1. FYZIKA (Nyní pohyblivá)
			const body = rigidBody.create(world, {
				shape: box.create({ halfExtents: [2.0, halfY, 0.2] }),
				motionType: MotionType.DYNAMIC,     // Přepnuto na dynamické
				objectLayer: OL_MOVING,             // Vrstva pro pohyblivé objekty
				position: [px, halfY, pz],          // Střed leží v polovině výšky
				quaternion: [0, Math.sin(prop.rot / 2), 0, Math.cos(prop.rot / 2)],
				mass: 25.0,                         // Váha dlouhého plotu
				friction: 3.0, 
				restitution: 0.2, 
				linearDamping: 2.0, 
				angularDamping: 2.0,
			});

			// 2. VIZUÁLNÍ MODEL A OBAL
			const mesh = models[prop.type].clone();
			mesh.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
			mesh.rotation.y = prop.rot;
			
			// Posunutí vizuálního modelu dolů uvnitř neviditelného obalu
			mesh.position.set(0, -halfY, 0); 

			const wrapper = new THREE.Group();
			wrapper.add(mesh);
			scene.add(wrapper);
			
			// 3. NAPOJENÍ DO ANIMACE
			// Pošleme obal do pole dynamicTires, aby se v každém snímku aktualizoval
			dynamicTires.push({ body: body, mesh: wrapper });


			// ==========================================
			// 2. PEVNÉ OBJEKTY (STATICKÉ)
			// ==========================================

		} else if (prop.type === 'track-bump') {
			mesh.scale.set(2.0, 2.0, 2.0);
			mesh.position.set(px, 1.2, pz); // Vizuální výška (zvednuto kvůli textuře)
			scene.add(mesh);

			rigidBody.create(world, {
				shape: box.create({ halfExtents: [1.2, 9.07, 1.5] }),
				motionType: MotionType.STATIC, objectLayer: OL_STATIC,
				position: [px, 1.57, pz], // Fyzikální výška
				quaternion: [0, Math.sin(prop.rot / 2), 0, Math.cos(prop.rot / 2)], friction: 1.0, restitution: 0.1,
			});

		} else if (prop.type === 'house2') {
			mesh.scale.set(0.15, 0.15, 0.15); // Tvé nové zmenšení domu
			// Vizuální model sražen z 0.5 přesně na zem (0.0)
			mesh.position.set(px, 0.0, pz);
			scene.add(mesh);

			// Fyzika: polovina výšky je 1.0, takže střed posuneme do 1.0, 
			// aby spodek lícoval s vizuálním modelem na 0.0
			rigidBody.create(world, {
				shape: box.create({ halfExtents: [1.0, 1.0, 1.0] }),
				motionType: MotionType.STATIC, objectLayer: OL_STATIC, 
				position: [px, 1.0, pz], // Oprava výšky fyziky z 1.5 na 1.0
				quaternion: [0, Math.sin(prop.rot / 2), 0, Math.cos(prop.rot / 2)], friction: 1.0, restitution: 0.1,
			});


		} else if (prop.type === 'decoration-forest') {
			mesh.position.set(px, 0.5, pz); scene.add(mesh);
			rigidBody.create(world, { shape: box.create({ halfExtents: [0.3, 2.0, 0.3] }), motionType: MotionType.STATIC, objectLayer: OL_STATIC, position: [px, 1.0, pz], friction: 1.0, restitution: 0.1 });

		} else if (prop.type === 'pine') {
			mesh.position.set(px, 0.5, pz); scene.add(mesh);
			rigidBody.create(world, { shape: box.create({ halfExtents: [0.3, 2.0, 0.3] }), motionType: MotionType.STATIC, objectLayer: OL_STATIC, position: [px, 1.0, pz], friction: 1.0, restitution: 0.1 });

		} else if (prop.type === 'tree_k') {
			// Bez obalu, pouze přímá změna souřadnic. 
			// Vizuální model posadíme na zem (0.0).
			const mesh = models[prop.type].clone();
			mesh.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
			mesh.rotation.y = prop.rot;
			mesh.position.set(px, 0.0, pz);
			scene.add(mesh);

			// Fyzikální model zvedneme na poloviční výšku (2.0), aby spodní hrana lícovala se zemí (0.0).
			rigidBody.create(world, {
				shape: box.create({ halfExtents: [0.3, 2.0, 0.3] }),
				motionType: MotionType.STATIC, objectLayer: OL_STATIC,
				position: [px, 2.0, pz],
				friction: 1.0, restitution: 0.1
			});
		} else if (prop.type === 'twisted_tree') {
			// Zmenší vizuální model 4x (na 25 % původní velikosti)
			mesh.scale.set(0.25, 0.25, 0.25);

			// Posadí zmenšený model pevně na zem
			mesh.position.set(px, 0.0, pz);
			scene.add(mesh);

			// Zmenší fyzikální obal 4x.
			// Původní halfExtents [0.3, 2.0, 0.3] -> nově [0.075, 0.5, 0.075]
			rigidBody.create(world, {
				shape: box.create({ halfExtents: [0.075, 0.5, 0.075] }),
				motionType: MotionType.STATIC,
				objectLayer: OL_STATIC,
				// Střed zmenšené fyziky přesuneme do výšky 0.5 (což je polovina z halfExtents Y = 0.5 -> celková výška 1.0)
				position: [px, 0.5, pz],
				friction: 1.0,
				restitution: 0.1
			});
		} else if (prop.type === 'pine-fall') {
			mesh.position.set(px, 0.5, pz); scene.add(mesh);
			rigidBody.create(world, { shape: box.create({ halfExtents: [1.5, 0.4, 0.4] }), motionType: MotionType.STATIC, objectLayer: OL_STATIC, position: [px, 0.5, pz], quaternion: [0, Math.sin(prop.rot / 2), 0, Math.cos(prop.rot / 2)], friction: 1.0, restitution: 0.1 });

		} else if (prop.type === 'decoration-tents') {
			// Zmenšení vizuálního modelu na 25 %
			mesh.scale.set(0.45, 0.45, 0.45); 
			
			// Posazení na zem
			mesh.position.set(px, 0.0, pz); 
			scene.add(mesh);

			// Zmenšení fyzikálního obalu 4x
			rigidBody.create(world, { 
				shape: box.create({ halfExtents: [0.375, 0.25, 0.375] }), 
				motionType: MotionType.STATIC, 
				objectLayer: OL_STATIC, 
				// Střed fyziky je nyní v 0.25, takže spodek je přesně na 0.0
				position: [px, 0.25, pz], 
				quaternion: [0, Math.sin(prop.rot / 2), 0, Math.cos(prop.rot / 2)], 
				friction: 1.0, 
				restitution: 0.1 
			});


		} else if (prop.type === 'fence') {
			mesh.position.set(px, 0.5, pz); scene.add(mesh);
			rigidBody.create(world, { shape: box.create({ halfExtents: [1.5, 0.5, 0.2] }), motionType: MotionType.STATIC, objectLayer: OL_STATIC, position: [px, 0.5, pz], quaternion: [0, Math.sin(prop.rot / 2), 0, Math.cos(prop.rot / 2)], friction: 1.0, restitution: 0.1 });
		
			


		} else if (prop.type === 'decoration-empty') {
			// Zmenší vizuální model 4x (na 25 % původní velikosti)
			mesh.scale.set(0.25, 0.25, 0.25);

			// Posadí zmenšený model pevně na zem
			mesh.position.set(px, 0.0, pz);
			scene.add(mesh);

			// Zmenší fyzikální obal 4x.
			// Původní halfExtents [0.3, 2.0, 0.3] -> nově [0.075, 0.5, 0.075]
			rigidBody.create(world, {
				shape: box.create({ halfExtents: [0.075, 0.5, 0.075] }),
				motionType: MotionType.STATIC,
				objectLayer: OL_STATIC,
				// Střed zmenšené fyziky přesuneme do výšky 0.5 (což je polovina z halfExtents Y = 0.5 -> celková výška 1.0)
				position: [px, 0.5, pz],
				friction: 1.0,
				restitution: 0.1
			});
		}
	}
	const sphereBody = createSphereBody(world, spawn ? spawn.position : null);

	const vehicle = new Vehicle();
	vehicle.rigidBody = sphereBody;
	vehicle.physicsWorld = world;

	if (spawn) {
		const [sx, sy, sz] = spawn.position;
		vehicle.spherePos.set(sx, sy, sz);
		vehicle.prevModelPos.set(sx, 0, sz);
		vehicle.container.rotation.y = spawn.angle;
	}

	const vehicleGroup = vehicle.init(models['vehicle-truck-yellow']);
	scene.add(vehicleGroup);

	dirLight.target = vehicleGroup;

	const cam = new Camera();

	// ─── LOGIKA PRO MENU VÝBĚRU AUTA ───
	const vehicleSelect = document.getElementById('vehicle-select');
	if (vehicleSelect) {
		vehicleSelect.addEventListener('change', (e) => {
			const selectedModel = e.target.value;

			// 1. Vyčistíme kontejner od původní karoserie a kol
			while (vehicle.container.children.length > 0) {
				vehicle.container.remove(vehicle.container.children[0]);
			}

			// 2. Nahrajeme do něj nový model (fyzika zůstává beze změny!)
			vehicle.init(models[selectedModel]);
		});
	}
	// ───────────────────────────────────


	scene.add(cam.debug);

	const controls = new Controls();
    const particles = new SmokeTrails(scene);
    const driftMarks = new DriftMarks(scene, "default");
    
    // ZVUK A HUDBA
    const audio = new GameAudio();
    audio.init(cam.camera);
    
    const music = new THREE.Audio(audio.listener);
    const musicLoader = new THREE.AudioLoader();
    musicLoader.load('audio/audio.mp3', (buffer) => {
        music.setBuffer(buffer);
        music.setLoop(true);
        music.setVolume(0.3);
    });
    window.myMusic = music;
    window.toggleMusic = () => {
        const m = window.myMusic;
        if (!m) return;
        if (m.context.state === 'suspended') m.context.resume();
        if (m.isPlaying) m.pause(); else m.play();
    };

    const lapTimer = new LapTimer(customCells, "default");
    const timer = new THREE.Timer();
    const _forward = new THREE.Vector3();
    const _camLead = new THREE.Vector3();

    // DEFINICE CONTACT LISTENER (Tohle nesmí chybět!)
    const contactListener = {
        onContactAdded(bodyA, bodyB) {
            if (bodyA !== sphereBody && bodyB !== sphereBody) return;
            _forward.set(0, 0, 1).applyQuaternion(vehicle.container.quaternion);
            _forward.y = 0;
            _forward.normalize();
            const impactVelocity = Math.abs(vehicle.modelVelocity.dot(_forward));
            audio.playImpact(impactVelocity);
        }
    };

    function animate() {
        requestAnimationFrame(animate);
        timer.update();
        const dt = Math.min(timer.getDelta(), 1 / 30);
        const input = controls.update();

        updateWorld(world, contactListener, dt);

        for (const tire of dynamicTires) {
            const pos = tire.body.position;
            const quat = tire.body.quaternion;
            tire.mesh.position.set(pos[0], pos[1], pos[2]);
            tire.mesh.quaternion.set(quat[0], quat[1], quat[2], quat[3]);
        }

        vehicle.update(dt, input);
        dirLight.position.set(vehicle.spherePos.x + 11.4, 15, vehicle.spherePos.z - 5.3);

        const mv = vehicle.modelVelocity;
        _camLead.set(0, 0, 1).applyQuaternion(vehicle.container.quaternion).multiplyScalar(Math.sqrt(mv.x * mv.x + mv.z * mv.z));
        cam.update(dt, vehicle.spherePos, _camLead);
        particles.update(dt, vehicle);
        driftMarks.update(dt, vehicle);
        audio.update(dt, vehicle.linearSpeed / MAX_SPEED, input.z, vehicle.driftIntensity);

        const hasInput = input.touchActive || Math.abs(input.x) > 0.05 || Math.abs(input.z) > 0.05;
        lapTimer.update(dt, vehicle.spherePos, hasInput);

        renderer.render(scene, cam.camera);
    }
window.myMusic = music;

    // TATO FUNKCE ZAJISTÍ AUTOMATICKÉ SPUŠTĚNÍ
    const startAudio = () => {
        // Obnovíme audio kontext, pokud je zablokovaný
        const ctx = THREE.AudioContext.getContext();
        if (ctx.state === 'suspended') ctx.resume();
        
        // Spustíme hudbu
        if (window.myMusic) window.myMusic.play();
        
        // Odstraníme posluchač, aby se to nespouštělo při každém kliku
        window.removeEventListener('click', startAudio);
    };
    
    // Čekáme na první kliknutí kamkoliv do okna hry
    window.addEventListener('click', startAudio, { once: true });

	const playBtn = document.getElementById('play-button');
    if (playBtn) {
        playBtn.disabled = false;
        playBtn.innerText = 'PLAY'; // Změníme text zpět na PLAY
    }
	
    animate();
}

init();