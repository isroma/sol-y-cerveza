/**
 * Loaded into MapLibre's workers (importScriptInWorkers in extrusionSource.ts),
 * so the extrusion files are fetched and decoded there, off the main thread,
 * and handed straight to their GeoJSON sources without a copy between threads.
 */
import type { WorkerGlobalScopeInterface } from 'maplibre-gl'
import { EXTRUSIONS_PROTOCOL, loadExtrusions } from './extrusionCodec.ts'

function isMapLibreWorker(scope: object): scope is WorkerGlobalScopeInterface {
  return 'addProtocol' in scope
}

if (isMapLibreWorker(self))
  self.addProtocol(EXTRUSIONS_PROTOCOL, loadExtrusions)
