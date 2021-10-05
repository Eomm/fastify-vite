const devalue = require('devalue')
const manifetch = require('manifetch')
const { parse } = require('node-html-parser')

const { getCurrentInstance, reactive } = require('vue')
const { assign } = Object

const kData = Symbol.for('kData')
const kPayload = Symbol.for('kPayload')
const kGlobal = Symbol.for('kGlobal')
const kAPI = Symbol.for('kAPI')
const kFirstRender = Symbol('kFirstRender')

const isServer = typeof window === 'undefined'
const fetch = isServer ? () => {} : window.fetch

if (!isServer) {
  let firstRender = true
  Object.defineProperty(window, kFirstRender, {
    get () {
      return firstRender
    },
    set (v) {
      firstRender = v
      return firstRender
    },
  })
}

if (!isServer) {
  window.requestIdleCallback(() => {
    window[kFirstRender] = false
  })
}

function packIsland () {
  return (request, reply, payload, done) => {
    const serializedScripts = []
    const parsed = parse(payload)
    payload = payload.replace(/<script[^<>]*>.*?<\/script>/gs, '')
    const scripts = parsed.querySelectorAll('script')
    for (const script of scripts) {
      serializedScripts.push(script.attributes)
    }
    let error
    let modified = payload
    try {
      const hydrator = `
        ;(() => {
          const scripts = ${devalue(serializedScripts)}
          requestIdleCallback(() => {
            for (const script of scripts) {
              console.log('script', script)
              const scriptElem = document.createElement('script')
              scriptElem.setAttribute('type', script.type)
              scriptElem.setAttribute('src', script.src)
              document.head.appendChild(scriptElem)
            }
          })
        })();
      `
      modified = `${payload}<script>${hydrator}</script>`
    } catch (err) {
      error = err
    }
    done(error, modified)
  }
}

function useHydration ({ getData, getPayload } = {}) {
  const globalProps = useGlobalProperties()
  const hydration = {
    $global: globalProps.$global,
    $data: globalProps.$data,
    $payload: globalProps.$payload,
    $payloadPath: globalProps.$payloadPath,
    $api: globalProps.$api,
  }
  globalProps.$data = undefined
  globalProps.$payload = undefined

  if (isServer) {
    return hydration
  } else {
    const state = reactive(hydration)
    if (window[kFirstRender]) {
      return state
    }
    if (getPayload || getData) {
      let promise
      if (getPayload) {
        const getPayloadFromClient = async () => {
          const response = await fetch(hydration.$payloadPath())
          const json = await response.json()
          return json
        }
        state.$loading = true
        promise = getPayloadFromClient(hydration).then(($payload) => {
          state.$payload = $payload
          state.$loading = false
          return state
        })
      } else if (getData) {
        state.$loading = true
        promise = getData(hydration).then(($data) => {
          state.$data = $data
          state.$loading = false
          return state
        })
      }
      for (const key in hydration) {
        Object.defineProperty(promise, key, {
          enumerable: true,
          get: () => state[key],
          set: (value) => {
            state[key] = value
            return state[key]
          },
        })
      }
      return promise
    }
    return state
  }
}

function hydrate (app) {
  const hydration = {
    $global: window[kGlobal],
    $data: window[kData],
    $payload: window[kPayload],
    $payloadPath: () => `/-/payload${document.location.pathname}`,
    $api: new Proxy({ ...window[kAPI] }, {
      get: manifetch({
        prefix: '',
        fetch: (...args) => fetch(...args),
      }),
    }),
  }
  assign(app.config.globalProperties, hydration)
  delete window[kGlobal]
  delete window[kData]
  delete window[kAPI]
}

function useGlobalProperties () {
  return getCurrentInstance().appContext.app.config.globalProperties
}

module.exports = {
  useGlobalProperties,
  packIsland,
  useHydration,
  hydrate,
  isServer,
}
