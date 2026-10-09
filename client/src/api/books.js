import { request, withQuery } from './request.js'

/** @param {object} [params] Book filters and pagination. @param {object} [options] Abort signal. @returns {Promise<object>} Book list and pagination. */
export const listBooks = (params = {}, options) => request(withQuery('/api/v1/books', params), options)

/** @param {object} [options] Abort signal. @returns {Promise<object>} Available author, language, subject, and year filters. */
export const getBookFacets = async (options) => (await request('/api/v1/books/facets', options)).data

/** @param {string|number} id Book ID. @param {object} [options] Abort signal. @returns {Promise<object>} Full book metadata and format URLs. */
export const getBook = async (id, options) => (await request(`/api/v1/books/${encodeURIComponent(id)}`, options)).data
