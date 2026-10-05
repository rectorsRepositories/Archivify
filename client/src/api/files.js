import { request, withQuery } from './request.js'

export const listFiles = (params = {}, options) => request(withQuery('/api/v1/files', params), options)
