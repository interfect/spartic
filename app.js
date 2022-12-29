import {SparticPeer} from './index.js'
import crypto from 'hypercore-crypto'

const PEER_COUNT = 4
const GROUP_ID = 1

let peers = []

for (let i = 0; i < PEER_COUNT; i++) {
  peers.push(new SparticPeer())
}

console.log('Starting server listeners...')
for (let i = 0; i < PEER_COUNT; i++) {
  await peers[i].listen()
}

console.log('Creating sessions...')
for (let i = 0; i < PEER_COUNT; i++) {
  // Make the list of other keys
  let otherKeys = []
  for (let j = 0; j < PEER_COUNT; j++) {
    if (j != i) {
      otherKeys.push(peers[j].keyPair.publicKey)
    }
  }
  peers[i].createSession(GROUP_ID, otherKeys)
}

// Wait for the swarm to connect to pending peers.
console.log('Waiting for clients to connect...')
for (let i = 0; i < PEER_COUNT; i++) {
  await peers[i].flush()
}

function tick() {
  console.log('Shipping messages...')
  for (let i = 0; i < PEER_COUNT; i++) {
    console.log('Shipping messages from peer ' + i)
    peers[i].sendSessionMessages(GROUP_ID)
  }
  setTimeout(tick, 1000)
}

setTimeout(tick, 1000)
