import * as THREE from 'three';

export const CELL_RAW = 2.0; 
export const GRID_SCALE = 0.75; 

// Tyto dva exporty jsme museli vrátit, aby LapTimer.js nespadl
export const ORIENT_DEG = { 0: 0, 10: 180, 16: 90, 22: 270 };
export const TYPE_NAMES = [ 'track-straight', 'track-corner', 'track-bump', 'track-finish', 'track_x' ];

export const TRACK_CELLS = [
	[ 0, 0, 'track-finish', 0 ]
];

export function buildTrack( scene, models, customCells ) {
	const trackGroup = new THREE.Group();
	trackGroup.position.y = -0.5;

	const cells = customCells || TRACK_CELLS;

	for ( const [ gx, gz, key, orient ] of cells ) {
		const piece = placePiece( models, key, gx, gz, orient );
		if ( piece ) trackGroup.add( piece );
	}

	trackGroup.scale.setScalar( GRID_SCALE );
	scene.add( trackGroup );
	trackGroup.updateMatrixWorld( true );

	trackGroup.traverse( ( child ) => {
		if ( child.isMesh ) {
			child.castShadow = true;
			child.receiveShadow = true;
		}
	} );
}

export function placePiece( models, key, gx, gz, orient ) {
	const src = models[ key ];
	if ( ! src ) return null;

	const piece = src.clone();
	piece.position.set( ( gx + 0.5 ) * CELL_RAW, 0.5, ( gz + 0.5 ) * CELL_RAW );

	let deg = orient;
	if (orient === 16) deg = 90;
	if (orient === 10) deg = 180;
	if (orient === 22) deg = 270;

	piece.rotation.y = THREE.MathUtils.degToRad( deg || 0 );
	return piece;
}

export function computeSpawnPosition( cells ) {
	let cell = cells[ 0 ];
	for ( const c of cells ) {
		if ( c[ 2 ] === 'track-finish' ) { cell = c; break; }
	}
	if ( ! cell ) return { position: [ 0, 0.5, 0 ], angle: 0 };
	const gx = cell[ 0 ]; const gz = cell[ 1 ];
	const x = ( gx + 0.5 ) * CELL_RAW * GRID_SCALE;
	const z = ( gz + 0.5 ) * CELL_RAW * GRID_SCALE;
	
	let deg = cell[ 3 ];
	if (deg === 16) deg = 90;
	if (deg === 10) deg = 180;
	if (deg === 22) deg = 270;

	const angle = THREE.MathUtils.degToRad( deg || 0 );
	return { position: [ x, 0.5, z ], angle };
}

export function computeTrackBounds( cells ) {
	if ( ! cells || cells.length === 0 ) return { centerX: 0, centerZ: 0, halfWidth: 30, halfDepth: 30 };
	let minX = Infinity, maxX = - Infinity; let minZ = Infinity, maxZ = - Infinity;
	for ( const [ gx, gz ] of cells ) {
		minX = Math.min( minX, gx ); maxX = Math.max( maxX, gx );
		minZ = Math.min( minZ, gz ); maxZ = Math.max( maxZ, gz );
	}
	const S = CELL_RAW * GRID_SCALE;
	const centerX = ( minX + maxX + 1 ) / 2 * S;
	const centerZ = ( minZ + maxZ + 1 ) / 2 * S;
	const halfWidth = ( maxX - minX + 1 ) / 2 * S + S;
	const halfDepth = ( maxZ - minZ + 1 ) / 2 * S + S;
	return { centerX, centerZ, halfWidth, halfDepth };
}

// Prázdná funkce vrácena zpět, aby main.js nespadl při pokusu o její import
export function decodeCells( str ) {
	return [];
}