import { describe, it, expect } from 'vitest'
import { apiErrorMessage, isNetworkError, apiErrorStatus } from './apiError'

const resp = (status: number, data: unknown) => ({ response: { status, data } })

describe('apiErrorMessage', () => {
  it('prefers the ApiResponseDto message', () => {
    expect(apiErrorMessage(resp(400, { success: false, message: 'Only Draft loans can be deleted.', errors: [] }), 'x'))
      .toBe('Only Draft loans can be deleted.')
  })

  it('joins an ApiResponseDto errors array', () => {
    expect(apiErrorMessage(resp(400, { success: false, message: null, errors: ['Bank Name is required.'] }), 'x'))
      .toBe('Bank Name is required.')
  })

  it('flattens ASP.NET ProblemDetails errors (object shape) instead of throwing', () => {
    const pd = { title: 'One or more validation errors occurred.', errors: { Email: ['Email is invalid.'], Password: ['Too short.'] } }
    expect(apiErrorMessage(resp(400, pd), 'x')).toBe('Email is invalid. Too short.')
  })

  it('falls back to ProblemDetails title', () => {
    expect(apiErrorMessage(resp(400, { title: 'Bad Request' }), 'x')).toBe('Bad Request')
  })

  it('maps statuses without a body', () => {
    expect(apiErrorMessage(resp(403, ''), 'x')).toBe('You do not have permission to do this.')
    expect(apiErrorMessage(resp(404, null), 'x')).toMatch(/not found/)
    expect(apiErrorMessage(resp(500, '<html>'), 'x')).toMatch(/server hit an error/)
  })

  it('reports network and timeout failures', () => {
    const net = { code: 'ERR_NETWORK', request: {} }
    expect(isNetworkError(net)).toBe(true)
    expect(apiErrorMessage(net)).toMatch(/Could not reach the server/)
    expect(apiErrorMessage({ code: 'ECONNABORTED', request: {} })).toMatch(/too long/)
  })

  it('uses a thrown Error message from inside a mutationFn', () => {
    expect(apiErrorMessage(new Error('No RM email on file for this lender'), 'x')).toBe('No RM email on file for this lender')
    expect(isNetworkError(new Error('boom'))).toBe(false)
  })

  it('returns the fallback for unknown input', () => {
    expect(apiErrorMessage(undefined, 'fallback')).toBe('fallback')
    expect(apiErrorStatus(undefined)).toBeUndefined()
  })
})
