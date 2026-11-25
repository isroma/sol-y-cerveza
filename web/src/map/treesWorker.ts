/**
 * Loaded into MapLibre's workers (importScriptInWorkers in treeCrowns.ts), so
 * trees.json is fetched and decoded there, off the main thread, and handed
 * straight to the GeoJSON source without a copy between threads.
 */
import type { WorkerGlobalScopeInterface } from 'maplibre-gl'
import { loadTrees, TREES_PROTOCOL } from './treeCodec.ts'

function isMapLibreWorker(scope: object): scope is WorkerGlobalScopeInterface {
  return 'addProtocol' in scope
}

if (isMapLibreWorker(self)) self.addProtocol(TREES_PROTOCOL, loadTrees)
