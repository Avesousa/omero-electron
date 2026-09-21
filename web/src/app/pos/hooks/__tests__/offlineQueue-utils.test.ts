import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  isRetryable,
  RetryableHttpError,
  NonRetryableHttpError,
  throwIfHttpError,
  withAsyncRetry,
  FlushLock,
  waitForLockRelease,
} from '../useOfflineQueue'

describe('RetryableHttpError / NonRetryableHttpError', () => {
  it('RetryableHttpError stores status and name', () => {
    const err = new RetryableHttpError(503, 'Service Unavailable')
    expect(err.status).toBe(503)
    expect(err.name).toBe('RetryableHttpError')
    expect(err.message).toBe('Service Unavailable')
  })

  it('NonRetryableHttpError stores status and name', () => {
    const err = new NonRetryableHttpError(422, 'Unprocessable')
    expect(err.status).toBe(422)
    expect(err.name).toBe('NonRetryableHttpError')
  })
})

describe('isRetryable', () => {
  it('returns true for RetryableHttpError', () => {
    expect(isRetryable(new RetryableHttpError(503, 'oops'))).toBe(true)
  })

  it('returns false for NonRetryableHttpError', () => {
    expect(isRetryable(new NonRetryableHttpError(422, 'bad'))).toBe(false)
  })

  it('returns true for generic Error (network failure)', () => {
    expect(isRetryable(new Error('network error'))).toBe(true)
  })

  it('returns true for TypeError (fetch failed)', () => {
    expect(isRetryable(new TypeError('Failed to fetch'))).toBe(true)
  })

  it('returns true for string errors', () => {
    expect(isRetryable('something went wrong')).toBe(true)
  })
})

describe('throwIfHttpError', () => {
  const makeResponse = (status: number): Response =>
    ({ ok: status >= 200 && status < 300, status } as Response)

  it('does not throw for 2xx', () => {
    expect(() => throwIfHttpError(makeResponse(200))).not.toThrow()
    expect(() => throwIfHttpError(makeResponse(201))).not.toThrow()
  })

  it('throws RetryableHttpError for 5xx', () => {
    expect(() => throwIfHttpError(makeResponse(500))).toThrow(RetryableHttpError)
    expect(() => throwIfHttpError(makeResponse(503))).toThrow(RetryableHttpError)
  })

  it('throws NonRetryableHttpError for 4xx', () => {
    expect(() => throwIfHttpError(makeResponse(400))).toThrow(NonRetryableHttpError)
    expect(() => throwIfHttpError(makeResponse(422))).toThrow(NonRetryableHttpError)
    expect(() => throwIfHttpError(makeResponse(404))).toThrow(NonRetryableHttpError)
  })
})

describe('withAsyncRetry', () => {
  it('resolves immediately on success', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    const result = await withAsyncRetry(fn, 2, [0, 0])
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries on retryable errors and eventually succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new RetryableHttpError(503, 'retry'))
      .mockResolvedValue('ok')

    const result = await withAsyncRetry(fn, 2, [0, 0])
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('throws immediately on non-retryable error', async () => {
    const fn = vi.fn().mockRejectedValue(new NonRetryableHttpError(422, 'bad'))

    await expect(withAsyncRetry(fn, 2, [0, 0])).rejects.toBeInstanceOf(NonRetryableHttpError)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('exhausts retries and throws last error', async () => {
    const fn = vi.fn().mockRejectedValue(new RetryableHttpError(503, 'always fail'))

    await expect(withAsyncRetry(fn, 2, [0, 0])).rejects.toBeInstanceOf(RetryableHttpError)
    expect(fn).toHaveBeenCalledTimes(3) // 1 initial + 2 retries
  })
})

describe('FlushLock', () => {
  beforeEach(() => {
    FlushLock.release()
  })

  it('starts unlocked', () => {
    expect(FlushLock.isLocked()).toBe(false)
  })

  it('acquire sets locked', () => {
    FlushLock.acquire()
    expect(FlushLock.isLocked()).toBe(true)
  })

  it('release clears lock', () => {
    FlushLock.acquire()
    FlushLock.release()
    expect(FlushLock.isLocked()).toBe(false)
  })
})

describe('waitForLockRelease', () => {
  beforeEach(() => {
    FlushLock.release()
  })

  afterEach(() => {
    FlushLock.release()
  })

  it('resolves immediately when lock is free', async () => {
    await expect(waitForLockRelease(10)).resolves.toBeUndefined()
  })

  it('resolves after lock is released', async () => {
    FlushLock.acquire()
    setTimeout(() => FlushLock.release(), 50)
    await expect(waitForLockRelease(20)).resolves.toBeUndefined()
  })
})
