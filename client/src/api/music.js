import { allPages, request, withQuery } from './request.js'

export const listAlbums = (params = {}, options) => request(withQuery('/api/v1/music/albums', params), options)
export const getAlbumFacets = async (options) => (await request('/api/v1/music/albums/facets', options)).data
export const getAlbum = async (id, options) => (await request(`/api/v1/music/albums/${encodeURIComponent(id)}`, options)).data
export const getAlbumTracks = (id, options) => allPages(`/api/v1/music/albums/${encodeURIComponent(id)}/tracks`, options)
export const getLibrarySummary = async (options) => (await request('/api/v1/library/summary', options)).data
