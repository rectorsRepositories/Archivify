import { request, withQuery } from './request.js'

export const listGames = (params = {}, options) => request(withQuery('/api/v1/games', params), options)
export const getGameFacets = async (options) => (await request('/api/v1/games/facets', options)).data
