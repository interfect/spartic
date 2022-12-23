import {SparticPeer} from './index.js'
import crypto from 'hypercore-crypto'

const peer1 = new SparticPeer()
const peer2 = new SparticPeer()

// Topics are 32 bytes
const topic = crypto.randomBytes(32)

console.log('Starting server listener')
await peer1.listen()

console.log('Connecting client')
peer2.joinPeer(peer1.keyPair.publicKey)

// Wait for the swarm to connect to pending peers.
console.log('Waiting for client to connect...')
await peer2.flush()

console.log('Connection should be up')

// After this point, both client and server should have connections
