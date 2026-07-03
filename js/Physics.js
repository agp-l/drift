import * as THREE from 'three';
import { rigidBody, box, sphere, MotionType, MotionQuality } from 'crashcat';
import { TRACK_CELLS, CELL_RAW, ORIENT_DEG, GRID_SCALE } from './Track.js';

const _debugMat = new THREE.MeshBasicMaterial( { color: 0x00ff00, wireframe: true } );

function addDebugBox( group, halfExtents, position, quaternion ) {

	const geo = new THREE.BoxGeometry( halfExtents[ 0 ] * 2, halfExtents[ 1 ] * 2, halfExtents[ 2 ] * 2 );
	const mesh = new THREE.Mesh( geo, _debugMat );
	mesh.position.set( position[ 0 ], position[ 1 ], position[ 2 ] );
	if ( quaternion ) mesh.quaternion.set( quaternion[ 0 ], quaternion[ 1 ], quaternion[ 2 ], quaternion[ 3 ] );
	group.add( mesh );

}

export function buildWallColliders( world, debugGroup, customCells ) {

	
}

export function createSphereBody( world, spawnPos ) {

	const body = rigidBody.create( world, {
		shape: sphere.create( { radius: 0.5 } ),
		motionType: MotionType.DYNAMIC,
		objectLayer: world._OL_MOVING,
		position: spawnPos || [ 3.5, 0.5, 5 ],
		mass: 1000.0,
		friction: 5.0,
		restitution: 0.1,
		linearDamping: 0.1,
		angularDamping: 4.0,
		gravityFactor: 1.5,
		motionQuality: MotionQuality.LINEAR_CAST,
	} );

	return body;

}
