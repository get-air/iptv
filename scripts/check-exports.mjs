const root = await import('../dist/index.js')
const effect = await import('../dist/effect.js')

if (typeof root.createIptvClient !== 'function') {
  throw new Error('Package root does not export createIptvClient')
}
if ('IptvService' in root || 'layerIptvClient' in root) {
  throw new Error('Package root leaked Effect-native services')
}
if (typeof root.InMemoryIptvSearchIndex !== 'function') {
  throw new Error('Package root does not export the plain search index')
}
if (typeof effect.IptvService !== 'function' || typeof effect.layerIptvClient !== 'function') {
  throw new Error('Effect entrypoint is missing its service or layer')
}
if (typeof effect.streamXmltv !== 'function') {
  throw new Error('Effect entrypoint is missing streaming XMLTV')
}
