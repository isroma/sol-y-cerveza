import { describe, expect, it } from 'vitest'
import board from './fixtures/photo-board.json?raw'
import messy from './fixtures/photo-messy.json?raw'
import none from './fixtures/photo-none.json?raw'
import {
  base64Bytes,
  fitWithin,
  parseModelReading,
  parsePhotoUpload,
  PHOTO_MAX_BYTES,
  PHOTO_OUTPUT_SCHEMA,
  PHOTO_SYSTEM_PROMPT,
  photoResponseSchema,
  proposalName,
  sniffImage,
  toProposals,
} from './pricePhoto.ts'
import { BRANDS } from '../data/prices.ts'

const JPEG = '/9j/4AAQSkZJRgABAQAAAQAB'
const PNG = 'iVBORw0KGgoAAAANSUhEUg=='
const GIF = 'R0lGODlhAQABAAAAACw='
const WEBP = btoa('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ')
const TEXT = btoa('hello, not an image')

describe('fitWithin', () => {
  it('scales the long edge down to the limit', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1568, height: 1176 })
    expect(fitWithin(3024, 4032)).toEqual({ width: 1176, height: 1568 })
  })
  it('never upscales', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 })
  })
})

describe('sniffImage', () => {
  it('knows JPEG, PNG, GIF and WebP by their first bytes', () => {
    expect(sniffImage(JPEG)).toBe('image/jpeg')
    expect(sniffImage(PNG)).toBe('image/png')
    expect(sniffImage(GIF)).toBe('image/gif')
    expect(sniffImage(WEBP)).toBe('image/webp')
  })
  it('rejects anything else', () => {
    expect(sniffImage(TEXT)).toBeNull()
    expect(sniffImage('%%%')).toBeNull()
  })
})

describe('parsePhotoUpload', () => {
  it('accepts a base64 JPEG', () => {
    expect(parsePhotoUpload({ image: JPEG, mediaType: 'image/jpeg' })).toEqual({
      ok: true,
      upload: { image: JPEG, mediaType: 'image/jpeg' },
    })
  })
  it('rejects a malformed body', () => {
    expect(parsePhotoUpload({ image: JPEG })).toMatchObject({ status: 400 })
    expect(
      parsePhotoUpload({ image: JPEG, mediaType: 'application/pdf' }),
    ).toMatchObject({ status: 400 })
    expect(
      parsePhotoUpload({ image: 'not base64!', mediaType: 'image/jpeg' }),
    ).toMatchObject({ status: 400 })
  })
  it('rejects files that are not images, or not the type they claim', () => {
    expect(
      parsePhotoUpload({ image: TEXT, mediaType: 'image/jpeg' }),
    ).toMatchObject({ ok: false, status: 415 })
    expect(
      parsePhotoUpload({ image: PNG, mediaType: 'image/jpeg' }),
    ).toMatchObject({ ok: false, status: 415 })
  })
  it('rejects photos over 5 MB', () => {
    const big = JPEG + 'A'.repeat(Math.ceil((PHOTO_MAX_BYTES * 4) / 3))
    expect(parsePhotoUpload({ image: big, mediaType: 'image/jpeg' })).toEqual({
      ok: false,
      status: 413,
      error: 'the photo is larger than 5 MB',
    })
  })
  it('counts base64 bytes without decoding', () => {
    expect(base64Bytes(btoa('abcd'))).toBe(4)
    expect(base64Bytes(btoa('abcde'))).toBe(5)
    expect(base64Bytes(btoa('abcdef'))).toBe(6)
  })
})

describe('parseModelReading', () => {
  it('turns a clean board into proposals, caña first then brand order', () => {
    expect(parseModelReading(board)).toEqual({
      proposals: [
        {
          item: 'cana',
          brand: null,
          cents: 150,
          label: "Caña 1'50",
          confidence: 'high',
        },
        {
          item: 'tercio',
          brand: 'cruzcampo',
          cents: 170,
          label: 'Tercio Cruzcampo 1.7 €',
          confidence: 'high',
        },
        {
          item: 'tercio',
          brand: 'mahou-5-estrellas',
          cents: 180,
          label: 'Tercio Mahou 5* 1,80',
          confidence: 'high',
        },
        {
          item: 'tercio',
          brand: 'super-bock',
          cents: 200,
          label: 'Super Bock 33cl 2€',
          confidence: 'low',
        },
      ],
      notes: [
        'Quinto Cruzcampo 1,20: 20 cl bottle, not reported',
        'Doble 2,20: not a caña',
      ],
    })
  })

  it('applies the CSV rules and explains what it dropped', () => {
    const result = parseModelReading(messy)
    expect(result?.proposals).toEqual([
      // A caña never has a brand.
      {
        item: 'cana',
        brand: null,
        cents: 140,
        label: 'Caña Cruzcampo 1,40',
        confidence: 'high',
      },
      // Two different prices for one item: the first is kept, flagged.
      {
        item: 'tercio',
        brand: 'amstel',
        cents: 180,
        label: 'Amstel terraza 1,80',
        confidence: 'low',
      },
    ])
    expect(result?.notes).toEqual([
      'Tercio Mahou Clásica 2,00: brand not in the list',
      '"Tercio 1,90": a tercio without a brand we list, skipped',
      '"Heineken 22,00": 2200 cents is out of range, skipped',
      '"Amstel barra 1,60": another price for Tercio Amstel, kept "Amstel terraza 1,80"',
    ])
  })

  it('passes on a photo without prices', () => {
    expect(parseModelReading(none)).toEqual({
      proposals: [],
      notes: ['The photo shows a food menu with no beer prices'],
    })
  })

  it('rejects answers that do not match the schema', () => {
    expect(parseModelReading('not json')).toBeNull()
    expect(parseModelReading('{"prices": []}')).toBeNull()
    expect(
      parseModelReading(
        JSON.stringify({
          prices: [
            {
              item: 'tercio',
              brand: 'mahou-clasica',
              cents: 200,
              label: 'Mahou Clásica',
              confidence: 'high',
            },
          ],
          notes: [],
        }),
      ),
    ).toBeNull()
    expect(
      parseModelReading(
        JSON.stringify({
          prices: [
            {
              item: 'cana',
              brand: null,
              cents: 1.5,
              label: 'Caña 1,50',
              confidence: 'high',
            },
          ],
          notes: [],
        }),
      ),
    ).toBeNull()
  })

  it('agrees with the endpoint response schema the browser checks', () => {
    for (const fixture of [board, messy, none]) {
      const result = parseModelReading(fixture)
      expect(photoResponseSchema.safeParse(result).success).toBe(true)
    }
  })
})

describe('toProposals', () => {
  it('keeps the same price read twice once, without a note', () => {
    const read = {
      item: 'cana' as const,
      brand: null,
      cents: 150,
      label: 'Caña 1,50',
      confidence: 'high' as const,
    }
    expect(toProposals([read, read])).toEqual({
      proposals: [read],
      notes: [],
    })
  })
  it('accepts the CSV bounds and nothing outside them', () => {
    const at = (cents: number) =>
      toProposals([
        { item: 'cana', brand: null, cents, label: '', confidence: 'high' },
      ]).proposals.length
    expect([at(49), at(50), at(1500), at(1501)]).toEqual([0, 1, 1, 0])
  })
})

describe('the prompt and schema', () => {
  it('list every brand id we take', () => {
    for (const brand of BRANDS) expect(PHOTO_SYSTEM_PROMPT).toContain(brand)
    expect(PHOTO_OUTPUT_SCHEMA.properties.prices.items.required).toEqual([
      'item',
      'brand',
      'cents',
      'label',
      'confidence',
    ])
  })
  it('names proposals like the price editor', () => {
    expect(proposalName({ item: 'cana', brand: null })).toBe('Caña')
    expect(proposalName({ item: 'tercio', brand: 'estrella-galicia' })).toBe(
      'Tercio Estrella Galicia',
    )
  })
})
