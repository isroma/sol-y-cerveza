import { z } from 'zod'

/** Trees near the terraces, from the LiDAR (pipeline `solycerveza.trees`). */
export const TREES_URL = './data/trees.json'

const treesSchema = z.object({
  version: z.literal(1),
  attribution: z.array(z.string()),
  trees: z.array(
    z.tuple([
      z.number().min(-180).max(180),
      z.number().min(-90).max(90),
      z.number().positive().max(60),
      z.number().positive().max(20),
    ]),
  ),
})

export type TreesFile = z.infer<typeof treesSchema>

/** The trees, or none when the file hasn't been built yet. */
export async function loadTrees(
  fetchImpl: typeof fetch = fetch,
): Promise<TreesFile['trees']> {
  const response = await fetchImpl(TREES_URL)
  if (!response.ok) return []
  return treesSchema.parse(await response.json()).trees
}
