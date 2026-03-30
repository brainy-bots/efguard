/**
 * Look up a character by game ID via GraphQL.
 * Iterates through characters to find a match (no direct filter available).
 * Returns the character name if found, null if not.
 */
import { executeGraphQLQuery } from '@evefrontier/dapp-kit'
import { WORLD_PKG } from '../env'

export interface CharacterLookup {
  id: string
  gameId: string
  name: string
  tribeId: number
}

const characterType = `${WORLD_PKG}::character::Character`

/**
 * Look up a character by game ID. Paginates through characters until found.
 * Returns null if not found after checking all characters.
 */
export async function lookupCharacterByGameId(gameId: string): Promise<CharacterLookup | null> {
  let cursor: string | null = null
  let hasNext = true

  while (hasNext) {
    const vars: Record<string, unknown> = {
      type: characterType,
      first: 50,
    }
    if (cursor) vars.after = cursor

    const res = await executeGraphQLQuery<{
      objects: {
        nodes: Array<{
          asMoveObject: {
            contents: {
              json: {
                id: string
                key: { item_id: string }
                tribe_id: number
                metadata: { name: string }
              }
            }
          }
        }>
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
      }
    }>(
      `query ($type: String!, $first: Int!, $after: String) {
        objects(filter: { type: $type }, first: $first, after: $after) {
          nodes {
            asMoveObject { contents { json } }
          }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      vars,
    )

    const nodes = res.data?.objects?.nodes ?? []
    for (const node of nodes) {
      const j = node.asMoveObject?.contents?.json
      if (j && j.key?.item_id === gameId) {
        return {
          id: j.id,
          gameId: j.key.item_id,
          name: j.metadata?.name ?? '',
          tribeId: j.tribe_id ?? 0,
        }
      }
    }

    hasNext = res.data?.objects?.pageInfo?.hasNextPage ?? false
    cursor = res.data?.objects?.pageInfo?.endCursor ?? null
  }

  return null
}
