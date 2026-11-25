Tiny LiDAR files for the e2e tests, in the compact format of `buildings.json`
and `trees.json` (`web/src/map/extrusionCodec.ts`): two buildings and two
crowns (one deciduous) next to "Café Sol Dos" in `../fixtures.ts`, and
`bridge-mesh.json` (`web/src/map/bridgeMesh.ts`): one upright plate and one
deck outline there. The smoke tests stub `data/buildings.json`,
`data/trees.json` and `data/bridge-mesh.json` with them, and
`scripts/sw-test-server.mjs` serves them for the offline project.
