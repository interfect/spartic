import buffer_xor from 'buffer-xor'
import crypto from 'hypercore-crypto'
import SynchronizedKeystream from './synchronized_keystream.js'

/// XOR together all the buffers in an array. Returns a new buffer.
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

/// Return true if a buffer is entirely 0 and false otherwise.
function is_all_zero(buffer) {
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] != 0) {
      // Some item is nonzero
      return false
    }
  }
  // No item was nonzero
  return true
}

describe('SynchronizedKeystream', () => {

  it('can create 4 distinct keystreams that XOR to 0', () => {

    const PEERS = 4

    let peer_secrets = []
    for (let i = 0; i < PEERS; i++) {
      peer_secrets.push([])
    }
    for (let i = 0; i < PEERS; i++) {
      for (let j = 0; j < PEERS; j++) {
        let secret = crypto.randomBytes(SynchronizedKeystream.SECRET_SIZE)
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
      peer_sync_bytes.push(sync_bytes)
    }

    // Make sure all pairs are non-identical (XOR to something nonzero)
    for (let i = 0; i < peer_sync_bytes.length; i++) {
      for (let j = 0; j < i; j++) {
        expect(is_all_zero(buffer_xor(peer_sync_bytes[i], peer_sync_bytes[j]))).toBeFalsy()
      }
    }

    // Make sure that the total combination XORs to 0
    expect(xor_all(peer_sync_bytes)).toBeTruthy()
    

  })

})

