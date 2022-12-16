import {SparticPeer, SynchronizedKeystream} from './index.js'
import crypto from 'hypercore-crypto'
import buffer_xor from 'buffer-xor'

function xor_all(buffers) {
  if (buffers.length == 0) {
    return null
  } else if (buffers.length == 1) {
    return buffers[0]
  } else {
    let scratch = buffers[0]
    for (let i = 1; i < buffers.length; i++) {
      scratch = buffer_xor(scratch, buffers[i])
    }
    return scratch
  }
}

const PEERS = 4

let peer_secrets = []
for (let i = 0; i < PEERS; i++) {
  peer_secrets.push([])
}
for (let i = 0; i < PEERS; i++) {
  for (let j = 0; j < PEERS; j++) {
    let secret = crypto.randomBytes(32)
    peer_secrets[i].push(secret)
    peer_secrets[j].push(secret)
  }
}

let peer_streams = []
for (let i = 0; i < PEERS; i++) {
  peer_streams.push(new SynchronizedKeystream(peer_secrets[i]))
}

let peer_sync_bytes = []
for (let i = 0; i < PEERS; i++) {
  let sync_bytes = peer_streams[i].read(0, 16)
  console.log('Peer ', i, ' produced bytes: ', sync_bytes)
  peer_sync_bytes.push(sync_bytes)
}

console.log('When combined: ', xor_all(peer_sync_bytes))


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
