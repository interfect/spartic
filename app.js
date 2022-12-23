import {SparticPeer} from './index.js'
import crypto from 'hypercore-crypto'

const peer1 = new SparticPeer()
const peer2 = new SparticPeer()

// Topics are 32 bytes
const topic = crypto.randomBytes(32)


console.log('Connecting server')
const discovery = peer1.join(topic, { server: true, client: false })
// Wait for the topic to be fully announced on the DHT
console.log('Waiting for server to announce...')
await discovery.flushed() 

console.log('Connecting client')
peer2.join(topic, { server: false, client: true })
// Wait for the swarm to connect to pending peers.
console.log('Waiting for client to connect...')
await peer2.flush()

console.log('Connection should be up')

// After this point, both client and server should have connections
