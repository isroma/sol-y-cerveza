Tiny LiDAR files for the e2e tests, in the compact format of `buildings.json`
and `trees.json` (`web/src/map/extrusionCodec.ts`): two buildings and two
crowns (one deciduous) next to "Café Sol Dos" in `../fixtures.ts`. The smoke
tests stub `data/buildings.json` and `data/trees.json` with them, and
`scripts/sw-test-server.mjs` serves them for the offline project.
