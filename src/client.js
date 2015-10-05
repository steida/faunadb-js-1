import request from 'request'
import winston from 'winston'
import {BadRequest, FaunaHTTPError, InternalError, MethodNotAllowed, NotFound,
  PermissionDenied, Unauthorized, UnavailableError} from './errors'
import {Ref} from './objects'
import {toJSON, parseJSON} from './_json'
const env = process.env

const allOptions = new Set(['domain', 'scheme', 'port', 'timeout', 'secret', 'logger'])

const debugLogger = env.FAUNA_DEBUG || env.NODE_DEBUG === 'fauna' ? winston : null

/**
 * Directly communicates with FaunaDB via JSON.
 *
 * It is encouraged to pass e.g. {@link Ref} objects instead of raw JSON data.
 *
 * All methods return a converted JSON response.
 * This is an object containing Arrays, strings, and other objects.
 * Any {@link Ref} or {@link Set} values in it will also be parsed.
 * (So instead of `{ "@ref": "classes/frogs/123" }`,
 * you will get `new Ref("classes/frogs/123")`.)
 *
 * There is no way to automatically convert to any other type, such as {@link Event},
 * from the response; you'll have to do that yourself manually.
 */
export default class Client {
  /**
   *
   * @param {string} options.domain Base URL for the FaunaDB server.
   * @param {('http'|'https')} options.scheme HTTP scheme to use.
   * @param {number} options.port Port of the FaunaDB server.
   * @param {?Object} options.secret
   *   Auth token for the FaunaDB server.
   *   Passed straight to [request](https://github.com/request/request#http-authentication).
   * @param {string} options.secret.user
   * @param {string} options.secret.pass
   * @param {?number} options.timeout Read timeout in seconds.
   * @param {?Logger} options.logger
   *   A [winston](https://github.com/winstonjs/winston) Logger
   */
  constructor(options) {
    const opt = (name, _default) =>
      options.hasOwnProperty(name) ? options[name] : _default

    const
      domain = opt('domain', 'rest.faunadb.com'),
      scheme = opt('scheme', 'https'),
      port = opt('port', scheme === 'https' ? 443 : 80)
    this._baseUrl = `${scheme}://${domain}:${port}`

    this._timeout = Math.floor(opt('timeout', 60) * 1000)
    this._secret = opt('secret', null)
    this._logger = opt('logger', null)

    for (const key in options)
      if (!allOptions.has(key))
        throw new Error(`Bad option ${key}`)
  }

  /**
   * HTTP `GET`.
   * See the [docs](https://faunadb.com/documentation/rest).
   *
   * @param {string|Ref} path Path relative the `domain` from the constructor.
   * @param {Object} query URL parameters.
   * @return {Object} Converted JSON response.
   */
  get(path, query) {
    return this._execute('GET', path, null, query)
  }

  /**
   * HTTP `POST`.
   * See the [docs](https://faunadb.com/documentation/rest).
   *
   * @param {string|Ref} path Path relative to the `domain` from the constructor.
   * @param {Object} data Object to be converted to request JSON.
   * @return {Object} Converted JSON response.
   */
  post(path, data) {
    return this._execute('POST', path, data)
  }

  /**
   * Like `post`, but a `PUT` request.
   * See the [docs](https://faunadb.com/documentation/rest).
   */
  put(path, data) {
    return this._execute('PUT', path, data)
  }

  /**
   * Like `post`, but a `PATCH` request.
   * See the [docs](https://faunadb.com/documentation/rest).
   */
  patch(path, data) {
    return this._execute('PATCH', path, data)
  }

  /**
   * Like `post`, but a `DELETE` request.
   * See the [docs](https://faunadb.com/documentation/rest).
   */
  delete(path, data) {
    return this._execute('DELETE', path, data)
  }

  /**
   * Use the FaunaDB query API.
   * See the [docs](https://faunadb.com/documentation/queries)
   * and the query functions in this documentation.
   */
  query(expression) {
    return this._execute('POST', '', expression)
  }

  /**
   * Ping FaunaDB.
   * See the [docs](https://faunadb.com/documentation/rest#other).
   */
  ping(scope, timeout) {
    return this.get('ping', {scope, timeout})
  }

  _log(indented, logged) {
    if (indented) {
      const indent_str = '  '
      logged = indent_str + logged.split('\n').join(`\n${indent_str}`)
    }

    if (debugLogger !== null)
      debugLogger.info(logged)
    if (this._logger !== null)
      this._logger.info(logged)
  }

  async _execute(action, path, data, query) {
    if (path instanceof Ref)
      path = path.value
    if (query)
      query = removeUndefinedValues(query)

    if (this._logger === null && debugLogger === null) {
      const {response, body} = await this._execute_without_logging(action, path, data, query)
      return handleResponse(response, parseJSON(body))
    } else {
      const real_time_begin = Date.now()
      const {response, body} = await this._execute_without_logging(action, path, data, query)
      const real_time = Date.now() - real_time_begin

      this._log(false, `Fauna ${action} /${path}${queryStringForLogging(query)}`)
      this._log(true, `Credentials: ${JSON.stringify(this._secret)}`)
      if (data)
        this._log(true, `Request JSON: ${toJSON(data, true)}`)

      const headers_json = toJSON(response.headers, true)
      const response_object = parseJSON(body)
      const response_json = toJSON(response_object, true)
      this._log(true, `Response headers: ${headers_json}`)
      this._log(true, `Response JSON: ${response_json}`)
      const
        statusCode = response.statusCode,
        apiTime = response.headers['x-http-request-processing-time'],
        latency = Math.floor(real_time)
      this._log(true,
        `Response (${statusCode}): API processing ${apiTime}ms, network latency ${latency}ms`)
      return handleResponse(response, response_object)
    }
  }

  _execute_without_logging(action, path, data, query) {
    return new Promise((resolve, reject) => {
      // request has a bug when trying to request empty path.
      if (path === '')
        path = '/'

      const opts = {
        method: action,
        baseUrl: this._baseUrl,
        url: path,
        auth: this._secret,
        qs: query,
        body: toJSON(data),
        timeout: this._timeout
      }

      request(opts, (err, response, body) => {
        if (err)
          reject(err)
        else
          resolve({response, body})
      })
    })
  }
}

const
  handleResponse = (response, response_object) => {
    const code = response.statusCode
    if (200 <= code && code <= 299)
      return response_object.resource
    else
      switch (code) {
        case 400:
          throw new BadRequest(response_object)
        case 401:
          throw new Unauthorized(response_object)
        case 403:
          throw new PermissionDenied(response_object)
        case 404:
          throw new NotFound(response_object)
        case 405:
          throw new MethodNotAllowed(response_object)
        case 500:
          throw new InternalError(response_object)
        case 503:
          throw new UnavailableError(response_object)
        default:
          throw new FaunaHTTPError(response_object)
      }
  },

  queryStringForLogging = query => {
    return query ? `?${Object.keys(query).map(key => `${key}=${query[key]}`).join('&')}` : ''
  },

  removeUndefinedValues = object => {
    const res = {}
    for (const key in object) {
      const val = object[key]
      if (val !== undefined)
        res[key] = val
    }
    return Object.keys(res).length === 0 ? null : res
  }
