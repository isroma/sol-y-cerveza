import { describe, expect, it, vi } from 'vitest'
import {
  answerPhoto,
  NO_KEY_HINT,
  PhotoReadError,
  photoStatus,
  type ReadPhoto,
} from './pricePhotoServer.ts'

const JPEG = '/9j/4AAQSkZJRgABAQAAAQAB'
const upload = { image: JPEG, mediaType: 'image/jpeg' }
const result = {
  proposals: [
    {
      item: 'cana' as const,
      brand: null,
      cents: 150,
      label: 'Caña 1,50',
      confidence: 'high' as const,
    },
  ],
  notes: [],
}

describe('photoStatus', () => {
  it('is off with a hint without a key', () => {
    expect(photoStatus('')).toEqual({ enabled: false, hint: NO_KEY_HINT })
    expect(photoStatus('sk-ant-test')).toEqual({ enabled: true })
  })
})

describe('answerPhoto', () => {
  it('answers 503 without a key and never calls the API', async () => {
    const read = vi.fn<ReadPhoto>()
    expect(await answerPhoto(upload, '', read)).toEqual({
      status: 503,
      body: { error: NO_KEY_HINT },
    })
    expect(read).not.toHaveBeenCalled()
  })

  it('rejects a non-image before calling the API', async () => {
    const read = vi.fn<ReadPhoto>()
    const answer = await answerPhoto(
      { image: btoa('plain text'), mediaType: 'image/jpeg' },
      'key',
      read,
    )
    expect(answer.status).toBe(415)
    expect(read).not.toHaveBeenCalled()
  })

  it('passes the validated upload on and returns its proposals', async () => {
    const read = vi.fn<ReadPhoto>().mockResolvedValue(result)
    expect(await answerPhoto(upload, 'key', read)).toEqual({
      status: 200,
      body: result,
    })
    expect(read).toHaveBeenCalledWith(upload)
  })

  it('maps reading failures to their status', async () => {
    const declined = vi
      .fn<ReadPhoto>()
      .mockRejectedValue(new PhotoReadError(422, 'declined'))
    expect(await answerPhoto(upload, 'key', declined)).toEqual({
      status: 422,
      body: { error: 'declined' },
    })
    const broken = vi.fn<ReadPhoto>().mockRejectedValue(new Error('boom'))
    expect(await answerPhoto(upload, 'key', broken)).toEqual({
      status: 502,
      body: { error: 'Error: boom' },
    })
  })
})
