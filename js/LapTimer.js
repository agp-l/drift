import * as THREE from 'three';
import { CELL_RAW, GRID_SCALE, TRACK_CELLS, TYPE_NAMES, computeSpawnPosition } from './Track.js';

const FINISH = TYPE_NAMES[ 3 ];
const STORAGE_PREFIX = 'racing.bestLap.';
const _tmp = new THREE.Vector3();

function loadBest( key ) {
    try {
        const v = localStorage.getItem( key );
        const n = v !== null ? Number( v ) : NaN;
        return Number.isFinite( n ) ? n : null;
    } catch { return null; }
}

function saveBest( key, value ) {
    try { localStorage.setItem( key, String( value ) ); } catch {}
}

function formatTime( t ) {
    if ( t === null || t === undefined ) return '0:00.00';
    const m = Math.floor( t / 60 );
    const s = t - m * 60;
    return `${ m }:${ s.toFixed( 2 ).padStart( 5, '0' ) }`;
}

export class LapTimer {

    constructor( cells, trackId ) {
        this.storageKey = STORAGE_PREFIX + ( trackId || 'default' );
        this.lap = 1;
        this.bestLap = loadBest( this.storageKey );
        this.lastLap = null;
        this.currentLapTime = 0;
        this.running = false;
		this.firstCrossDone = false; // Pojistka pro první průjezd

        this.lineCenter = new THREE.Vector3();
        this.lineForward = new THREE.Vector3( 0, 0, 1 );
        this.lineRight = new THREE.Vector3( 1, 0, 0 );
        this.prevForwardProj = null;
        this.cellSize = CELL_RAW * GRID_SCALE;

        const list = cells || TRACK_CELLS;
        this.enabled = list.some( ( c ) => c[ 2 ] === FINISH );

        if ( this.enabled ) {
            const spawn = computeSpawnPosition( list );
            this.lineCenter.set( spawn.position[ 0 ], 0, spawn.position[ 2 ] );
            this.lineForward.set( Math.sin( spawn.angle ), 0, Math.cos( spawn.angle ) );
            this.lineRight.set( this.lineForward.z, 0, - this.lineForward.x );
            
            // Napojení na prvky z našeho nového bílého HTML menu
            this.linkUI();
        }
    }

    linkUI() {
        // Najdeme elementy přímo na stránce místo abychom je tvořili v JS
        this.lapEl = document.querySelector( '.lap' );
        this.currentEl = document.querySelector( '.current' );
        this.lastEl = document.querySelector( '.last' );
        this.bestEl = document.querySelector( '.best' );
        
        // Vypíšeme startovní hodnoty
        if (this.bestEl) this.bestEl.textContent = formatTime( this.bestLap );
    }

    update( dt, position, hasInput ) {
        if ( ! this.enabled ) return;
        if ( ! this.running && ! hasInput ) return;
        this.running = true;

        this.currentLapTime += dt;
        if (this.currentEl) this.currentEl.textContent = formatTime( this.currentLapTime );

        _tmp.copy( position ).sub( this.lineCenter );
        const forwardProj = _tmp.dot( this.lineForward );
        const lateralProj = Math.abs( _tmp.dot( this.lineRight ) );

        if ( this.prevForwardProj !== null ) {
            // OPRAVA: Výrazně zvětšený hitbox do šířky, aby bral i průjezd u kraje
            const onLine = lateralProj <= this.cellSize * 4.0; 
            const noTeleport = Math.abs( forwardProj - this.prevForwardProj ) < 5;
            const crossedForward = this.prevForwardProj <= 0 && forwardProj > 0;

         if ( onLine && noTeleport && crossedForward ) {
                
                if ( !this.firstCrossDone ) {
                    // 1. PRVNÍ PRŮJEZD: Hráč právě odstartoval. 
                    // Pouze vynulujeme časomíru a nahodíme pojistku.
                    this.firstCrossDone = true;
                    this.currentLapTime = 0;
                } else {
                    // 2. DALŠÍ PRŮJEZDY: Skutečné dokončení kola.
                    this.completeLap();
                }
                
            }
        }

        this.prevForwardProj = forwardProj;
    }

    completeLap() {
        const isBest = this.bestLap === null || this.currentLapTime < this.bestLap;
        this.lastLap = this.currentLapTime;
        
        if ( isBest ) {
            this.bestLap = this.currentLapTime;
            saveBest( this.storageKey, this.bestLap );
        }
        
        this.lap += 1;
        this.currentLapTime = 0;

        // Propíšeme nová data do menu
        if (this.lapEl) this.lapEl.textContent = this.lap;
        if (this.lastEl) this.lastEl.textContent = formatTime( this.lastLap );
        if (this.bestEl) this.bestEl.textContent = formatTime( this.bestLap );

        // Zelené probliknutí při nejlepším čase, červené při horším
        if (this.currentEl) {
            const color = isBest ? '#5af168' : '#ff6e6e';
            this.currentEl.animate(
                [ { color }, { color }, { color: '#1f2430' } ],
                { duration: 1200, easing: 'ease-out' }
            );
        }
    }
}