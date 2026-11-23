import { describe, expect, it } from 'vitest'
import {
  candidateKey,
  decide,
  formatCandidatesCsv,
  parseCandidatesCsv,
  parseCsvRows,
  parseLeadsCsv,
  toPrice,
  type Candidate,
} from './priceCandidates.ts'

const HEADER = 'venue_id,item,brand,cents,source_url,snippet,fetched,status'

// As Python's csv module writes it (pipeline/src/solycerveza/price_candidates.py).
const FILE = [
  HEADER,
  'osm:node/1,cana,,150,https://bar.es/carta,"Caña 1,50 €",2026-11-23,pending',
  'osm:node/1,tercio,mahou-5-estrellas,220,https://bar.es/carta,"Tercio ""Mahou"" 2,20 €",2026-11-23,dismissed',
  'osm:node/1,tercio,sagres,95,https://bar.es/,Tercio Sagres 0.95 €,2026-11-22,pending',
  'overture:abc,cana,,1200,https://cafe.es/,Caña 12.00,2026-11-23,accepted',
].join('\n')

describe('price candidates CSV', () => {
  it('reads quoted cells and writes the file back byte for byte', () => {
    const candidates = parseCandidatesCsv(FILE + '\n')
    expect(candidates).toHaveLength(4)
    expect(candidates[1]).toEqual({
      venueId: 'osm:node/1',
      item: 'tercio',
      brand: 'mahou-5-estrellas',
      cents: 220,
      sourceUrl: 'https://bar.es/carta',
      snippet: 'Tercio "Mahou" 2,20 €',
      fetched: '2026-11-23',
      status: 'dismissed',
    })
    // Sorted by venue, item, brand, then cents as a number (95 after 220 is by brand).
    expect(formatCandidatesCsv([...candidates].reverse())).toBe(FILE + '\n')
  })

  it('sorts cents as numbers, like the pipeline', () => {
    const [cana] = parseCandidatesCsv(FILE)
    if (!cana) throw new Error('fixture')
    const rows = formatCandidatesCsv([
      { ...cana, cents: 1000 },
      { ...cana, cents: 200 },
    ]).split('\n')
    expect(rows[1]).toContain(',200,')
    expect(rows[2]).toContain(',1000,')
  })

  it('reads a header-only file', () => {
    expect(parseCandidatesCsv(HEADER + '\n')).toEqual([])
  })

  it.each([
    ['venue_id,item\n', 'header must be'],
    [`${HEADER}\nosm:node/1,cana,,150\n`, 'wrong cell count'],
    [
      `${HEADER}\nosm:node/1,tercio,,150,https://b.es/,T,2026-11-23,pending\n`,
      'a tercio needs a brand',
    ],
    [
      `${HEADER}\nosm:node/1,cana,,150,https://b.es/,C,2026-11-23,maybe\n`,
      'price_candidates.csv:2',
    ],
    [`${HEADER}\n"unterminated\n`, 'unterminated'],
  ])('rejects %j', (text, message) => {
    expect(() => parseCandidatesCsv(text)).toThrow(message)
  })

  it('parses CRLF and empty cells', () => {
    expect(parseCsvRows('a,b\r\n,x\r\n')).toEqual([
      ['a', 'b'],
      ['', 'x'],
    ])
  })
})

describe('decisions', () => {
  const candidates = parseCandidatesCsv(FILE)
  const first = candidates[0] as Candidate

  it('records a decision on one candidate only', () => {
    const next = decide(candidates, {
      key: candidateKey(first),
      status: 'dismissed',
    })
    expect(next.map((c) => c.status)).toEqual([
      'dismissed',
      'dismissed',
      'pending',
      'accepted',
    ])
  })

  it('fails on an unknown candidate', () => {
    expect(() => decide(candidates, { key: 'x', status: 'accepted' })).toThrow(
      'no candidate',
    )
  })

  it('turns an accepted candidate into a price seen on the fetch date', () => {
    expect(toPrice(first)).toEqual({
      venueId: 'osm:node/1',
      item: 'cana',
      brand: null,
      cents: 150,
      seen: '2026-11-23',
    })
  })
})

describe('menu leads', () => {
  it('reads the leads file', () => {
    expect(
      parseLeadsCsv('venue_id,url\nosm:node/1,https://bar.es/carta.pdf\n'),
    ).toEqual([{ venueId: 'osm:node/1', url: 'https://bar.es/carta.pdf' }])
  })
})
