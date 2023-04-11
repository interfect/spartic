import {SparticPeer, SparticSession} from './index.js'
import crypto from 'hypercore-crypto'

const PEER_COUNT = 4
const GROUP_ID = 5

let peers = []

for (let i = 0; i < PEER_COUNT; i++) {
  peers.push(new SparticPeer())
}

console.log('Starting server listeners...')
let listenPromises = []
for (let i = 0; i < PEER_COUNT; i++) {
  listenPromises.push(peers[i].listen())
}
await Promise.all(listenPromises)

console.log('Creating sessions...')
let sessions = []
for (let i = 0; i < PEER_COUNT; i++) {
  // Make the list of other keys
  let otherKeys = []
  for (let j = 0; j < PEER_COUNT; j++) {
    if (j != i) {
      otherKeys.push(peers[j].keyPair.publicKey)
    }
  }
  // Start a session for each peer with all the other peers in the group
  sessions.push(peers[i].createSession(GROUP_ID, otherKeys))
}

// Wait for the swarm to connect to pending peers.
console.log('Waiting for clients to connect...')
let flushPromises = []
for (let i = 0; i < PEER_COUNT; i++) {
  flushPromises.push(peers[i].flush())
}
await Promise.all(flushPromises)
console.log('Starting ticks')

let tickNumber = 0

function tick() {
  for (let i = 0; i < PEER_COUNT; i++) {
    // Exchange data for all the peers
    peers[i].sendSessionMessages(GROUP_ID)
    
    if (sessions[i].readyToParticipate()) {
      // If we need to send a block of data, make a block of data
      let block = Buffer.alloc(SparticSession.BLOCK_SIZE)
      // And send it
      sessions[i].participateInRound(block)
    }
    
    let result = sessions[i].popResult()
    if (result) {
      console.log('Peer ' + i + ' sees result: ', result)
    }
     
    // Log how all the peers are doing
    peers[i].logStatus()
  }
  tickNumber++
  setTimeout(tick, 10000)
}

setTimeout(tick, 10000)
